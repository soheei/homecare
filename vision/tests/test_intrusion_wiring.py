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
from edge.transport.modes import ModeState
from vision import vision_pipeline as vp


class IntrusionWiringTest(unittest.TestCase):
    def run_pipeline(self, states, sound=False, fall_frames=(), failure=None,
                     busy=False, real_visitor=False):
        """states는 프레임별 (경비 상태, 카메라 모드, 사람 존재 여부)."""
        frame = np.zeros((4, 4, 3), dtype=np.uint8)
        person = {"confidence": 0.9, "center_y": 2, "center_x": 2}
        state = ModeState()
        cfg = Config("http://backend.test", "mic", "test", 5, Path("unused"))
        guard = mock.Mock()
        camera = mock.Mock()
        yolo = mock.Mock()
        recorder = mock.Mock(recording=sound or busy, request_id="sound-1" if sound else None,
                             event_type="sound" if sound else "door_visitor")
        recorder.update.return_value = None
        fall = mock.Mock()
        fall.update.return_value = False
        starts = []
        current = -1
        saved = {"request_id": "sound-1" if sound else None, "video_path": "unused.mp4"}

        def capture():
            nonlocal current
            current += 1
            if current >= len(states):
                if failure is not None:
                    raise failure
                raise KeyboardInterrupt
            armed, mode, present = states[current]
            state.update_from_heartbeat({"mode": mode})
            guard.is_armed.return_value = armed
            yolo.get_best_person.return_value = person if present else None
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
            update=mock.Mock(return_value=False))
        with contextlib.ExitStack() as stack:
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(mock.patch.dict(os.environ, {"HOMECARE_CAMERA_DEVICE_ID": "cam"}))
            replacements = {
                "load_config": mock.Mock(return_value=cfg),
                "read_settings": mock.Mock(return_value={"event_dir": "unused", "camera_id": "cam", "heartbeat_interval_sec": 20}),
                "EventEmitter": mock.Mock(), "AVShare": mock.Mock(),
                "YOLODetector": mock.Mock(return_value=yolo),
                "GuardModeClient": mock.Mock(return_value=guard),
                "ModeState": mock.Mock(return_value=state),
                "Picamera2": mock.Mock(return_value=camera),
                "EventRecorder": mock.Mock(return_value=recorder),
                "FallDetector": mock.Mock(return_value=fall),
                "VisitorDetector": mock.Mock(return_value=visitor),
                "DeliveryDetector": mock.Mock(return_value=mock.Mock(update=mock.Mock(return_value=None))),
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
            guard.start.assert_called_once_with()
            guard.stop.assert_called_once_with()
            camera.stop.assert_called_once_with()
            self.assertEqual(replacements["GuardModeClient"].call_args.args[0].device_id, "cam")
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
                         ["intrusion_suspect", "fall_suspect"])
        self.assertEqual(emit.call_args_list[0].args[2]["score"], 0.9)
        mocks["publish_sound_clip"].assert_called_once()

    def test_later_intrusion_is_preserved_after_fall_during_sound(self):
        _, mocks = self.run_pipeline([(True, "living", True)] * 5,
                                     sound=True, fall_frames=(0,))
        self.assertEqual([c.args[2]["event_type"] for c in
                          mocks["emit_deferred_vision_event"].call_args_list],
                         ["fall_suspect", "intrusion_suspect"])

    def test_risks_during_regular_recording_are_emitted(self):
        _, mocks = self.run_pipeline([(True, "living", True)] * 5,
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

    def test_guard_stops_on_camera_error(self):
        self.run_pipeline([], failure=RuntimeError("camera failed"))


if __name__ == "__main__":
    unittest.main()
