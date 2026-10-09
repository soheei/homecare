"""실제 main 루프의 침입 연결을 검증한다. 하드웨어·네트워크·파일 저장은 대체한다."""

import contextlib
import io
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

for _name, _attr in (("picamera2", "Picamera2"), ("ultralytics", "YOLO")):
    try:
        __import__(_name)
    except ImportError:
        sys.modules[_name] = types.SimpleNamespace(**{_attr: object})

from edge.transport.config import Config
from vision.intrusion_detector import DetectionModeState
from vision import vision_pipeline as vp


class IntrusionWiringTest(unittest.TestCase):
    def run_pipeline(self, states, sound=False, fall_frames=(), failure=None,
                     busy=False, real_visitor=False, entrance_signals=False, fall_positions=None):
        """states는 프레임별 (경비 상태, 카메라 모드, 사람 존재 여부)."""
        frame = np.zeros((4, 4, 3), dtype=np.uint8)
        person = {"class_id": 0, "confidence": 0.9, "center_y": 2, "center_x": 2,
                  "x1": 0, "y1": 0, "x2": 4, "y2": 4}
        state = DetectionModeState()
        cfg = Config("http://backend.test", "mic", "test", 5, Path("unused"))
        camera = mock.Mock()
        yolo = mock.Mock()
        recorder = mock.Mock(recording=sound or busy, request_id="sound-1" if sound else None,
                             event_type="sound" if sound else "door_visitor")
        recorder.update.return_value = None
        fall = vp.FallDetector() if fall_positions is not None else mock.Mock()
        if fall_positions is None:
            fall.update.return_value = False
        starts = []
        current = -1
        initial_capture = True
        saved = {"request_id": "sound-1" if sound else None, "video_path": "unused.mp4"}

        def capture():
            nonlocal current, initial_capture
            if initial_capture:
                initial_capture = False
                return frame
            current += 1
            if current >= len(states):
                if failure is not None:
                    raise failure
                raise KeyboardInterrupt
            armed, mode, present = states[current]
            state.update_from_heartbeat({"mode": mode, "securityArmed": armed})
            if fall_positions is not None:
                y = fall_positions[current]
                person.update(center_y=y, y1=y - 80, y2=y + 80)
            yolo.get_best_person.return_value = person if present else None
            yolo.detect.return_value = [person.copy()] if present else []
            if fall_positions is None:
                fall.update.return_value = current in fall_frames
            # 보류 이벤트가 생긴 다음 프레임에서 소리 영상 저장 완료를 재현한다.
            recorder.recording = sound or busy
            recorder.update.return_value = saved if (sound or busy) and current == len(states) - 1 else None
            return frame

        camera.capture_array.side_effect = capture
        def start_event(**kw):
            starts.append((current, kw))
            recorder.recording = True
            recorder.event_type = kw["event_type"]
        recorder.start_event.side_effect = start_event
        visitor = vp.VisitorDetector(required_frames=3) if real_visitor else mock.Mock(
            update=mock.Mock(return_value=entrance_signals))
        with contextlib.ExitStack() as stack:
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(mock.patch.dict(os.environ, {"HOMECARE_CAMERA_DEVICE_ID": "cam"}))
            replacements = {
                "load_config": mock.Mock(return_value=cfg),
                "read_settings": mock.Mock(return_value={"event_dir": "unused", "camera_id": "cam", "heartbeat_interval_sec": 20}),
                "EventEmitter": mock.Mock(), "AVShare": mock.Mock(),
                "YOLODetector": mock.Mock(return_value=yolo),
                "DetectionModeState": mock.Mock(return_value=state),
                "Picamera2": mock.Mock(return_value=camera),
                "EventRecorder": mock.Mock(return_value=recorder),
                "FallDetector": mock.Mock(return_value=fall),
                "VisitorDetector": mock.Mock(return_value=visitor),
                "DeliveryDetector": mock.Mock(return_value=mock.Mock(
                    update=mock.Mock(return_value=0.8 if entrance_signals else None))),
                "handle_sound_requests": mock.Mock(),
                "publish_sound_clip": mock.Mock(),
                "emit_deferred_vision_event": mock.Mock(),
                "emit_saved_event": mock.Mock(),
            }
            for name, replacement in replacements.items():
                stack.enter_context(mock.patch.object(vp, name, replacement))
            stack.enter_context(mock.patch.object(vp.camera_service, "start", return_value=[]))
            stack.enter_context(mock.patch.object(vp.time, "sleep"))
            if failure is None:
                vp.main()
            else:
                with self.assertRaisesRegex(RuntimeError, "camera failed"):
                    vp.main()
            camera.stop.assert_called_once_with()
            return starts, replacements

    def test_only_armed_living_records_intrusion(self):
        for armed in (False, True):
            for mode in ("living", "entrance"):
                with self.subTest(armed=armed, mode=mode):
                    starts, _ = self.run_pipeline([(armed, mode, True)] * 6)
                    self.assertEqual(len(starts), int(armed and mode == "living"))
                    if starts:
                        self.assertEqual(starts[0][0], 2)
                        self.assertEqual(starts[0][1]["event_type"], "intrusion_suspect")
                        self.assertEqual(starts[0][1]["score"], 0.9)

    def test_mode_or_disarming_clears_pending_and_triggered_state(self):
        active = (True, "living", True)
        for inactive in ((False, "living", True), (True, "entrance", True)):
            with self.subTest(inactive=inactive):
                starts, _ = self.run_pipeline([active] * 2 + [inactive] + [active] * 3
                                              + [inactive] + [active] * 3)
                self.assertEqual([i for i, _ in starts], [5, 9])

    def test_missing_person_rearms_after_five_frames(self):
        active = (True, "living", True)
        starts, _ = self.run_pipeline([active] * 4 + [(True, "living", False)] * 5 + [active] * 3)
        self.assertEqual([i for i, _ in starts], [2, 11])

    def test_intrusion_precedes_fall_in_normal_recording(self):
        starts, _ = self.run_pipeline([(True, "living", True)] * 3, fall_frames=(2,))
        self.assertEqual([kw["event_type"] for _, kw in starts], ["intrusion_suspect"])

    def test_intrusion_is_deferred_and_emitted_with_sound_clip(self):
        starts, mocks = self.run_pipeline([(True, "living", True)] * 4, sound=True, fall_frames=(2,))
        self.assertEqual(starts, [])
        emit = mocks["emit_deferred_vision_event"]
        self.assertEqual([call.args[2]["event_type"] for call in emit.call_args_list],
                         ["intrusion_suspect"])
        self.assertEqual(emit.call_args_list[0].args[2]["score"], 0.9)
        mocks["publish_sound_clip"].assert_called_once()

    def test_later_intrusion_is_preserved_after_fall_during_sound(self):
        _, mocks = self.run_pipeline([(False, "living", True)] + [(True, "living", True)] * 4,
                                     sound=True, fall_frames=(0,))
        self.assertEqual([c.args[2]["event_type"] for c in
                          mocks["emit_deferred_vision_event"].call_args_list],
                         ["fall_suspect", "intrusion_suspect"])

    def test_risks_during_regular_recording_are_emitted(self):
        _, mocks = self.run_pipeline([(False, "living", True)] + [(True, "living", True)] * 4,
                                     busy=True, fall_frames=(0,))
        self.assertEqual([c.args[2]["event_type"] for c in
                          mocks["emit_deferred_vision_event"].call_args_list],
                         ["fall_suspect", "intrusion_suspect"])
        mocks["emit_saved_event"].assert_called_once()

    def test_visitor_is_detected_after_switching_to_entrance(self):
        starts, _ = self.run_pipeline([(False, "living", True)] * 4 +
                                      [(False, "entrance", True)] * 4,
                                      real_visitor=True)
        self.assertEqual([(i, kw["event_type"]) for i, kw in starts],
                         [(6, "door_visitor")])

    def test_camera_cleanup_on_error(self):
        self.run_pipeline([], failure=RuntimeError("camera failed"))

    def test_fall_only_runs_when_unarmed_living(self):
        for armed in (False, True):
            for mode in ("living", "entrance"):
                with self.subTest(armed=armed, mode=mode):
                    starts, mocks = self.run_pipeline([(armed, mode, True)] * 2, fall_frames=(0,))
                    expected = ["fall_suspect"] if not armed and mode == "living" else []
                    self.assertEqual([kw["event_type"] for _, kw in starts], expected)
                    self.assertEqual(mocks["FallDetector"].return_value.update.call_count,
                                     2 if expected else 0)

    def test_entrance_events_are_independent_of_guard(self):
        for armed in (False, True):
            for mode in ("living", "entrance"):
                with self.subTest(armed=armed, mode=mode):
                    _, mocks = self.run_pipeline([(armed, mode, True)] * 2,
                                                  sound=True, entrance_signals=True)
                    kinds = [c.args[2]["event_type"] for c in
                             mocks["emit_deferred_vision_event"].call_args_list]
                    self.assertEqual(kinds, ["delivery_suspect", "door_visitor"]
                                     if mode == "entrance" else [])

    def test_guard_change_resets_fall_but_not_entrance_history(self):
        for mode in ("living", "entrance"):
            _, mocks = self.run_pipeline([(False, mode, True), (True, mode, True)])
            self.assertGreaterEqual(mocks["FallDetector"].return_value.reset.call_count, 2)
            self.assertEqual(mocks["VisitorDetector"].return_value.reset.call_count, 1)
            self.assertEqual(mocks["DeliveryDetector"].return_value.reset.call_count, 1)

    def test_entrance_arming_does_not_use_previous_living_mode(self):
        starts, _ = self.run_pipeline([(False, "living", True)] * 2 +
                                      [(True, "entrance", True)] * 4)
        self.assertEqual(starts, [])

    def test_no_detection_before_first_valid_state(self):
        starts, mocks = self.run_pipeline([(False, None, True)] * 4, fall_frames=(0,),
                                         entrance_signals=True)
        self.assertEqual(starts, [])
        mocks["FallDetector"].return_value.update.assert_not_called()

    def test_guard_toggle_discards_real_fall_candidate(self):
        off, on = (False, "living", True), (True, "living", True)
        starts, _ = self.run_pipeline([off] * 4 + [on] + [off] * 4,
                                      fall_positions=[100, 100, 100, 150, 150, 150, 150, 150, 150])
        self.assertEqual(starts, [])


if __name__ == "__main__":
    unittest.main()
