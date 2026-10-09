"""vision 이벤트 전송 후 Pi 원본(영상·썸네일) 정리 테스트 — 전송 결과와 상관없이 Pi에 남기지 않는다.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import sys
import tempfile
import types
import unittest
from datetime import datetime, timezone
from unittest import mock
from pathlib import Path

# picamera2/ultralytics가 없는 PC에서도 vision_pipeline을 import할 수 있게 빈 모듈로 대체 (Pi에선 실제 모듈 사용)
for _name, _attr in (("picamera2", "Picamera2"), ("ultralytics", "YOLO")):
    try:
        __import__(_name)
    except ImportError:
        sys.modules[_name] = types.SimpleNamespace(**{_attr: object})

from edge.transport.config import Config  # noqa: E402
from edge.transport.emit import EventEmitter  # noqa: E402
from vision import vision_pipeline as vp  # noqa: E402


class EmitSavedEventTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.video = tmp / "events" / "clip.mp4"
        self.thumb = tmp / "events" / "clip_thumb.jpg"
        self.video.parent.mkdir()
        self.video.write_bytes(b"video")
        self.thumb.write_bytes(b"jpg")
        cfg = Config(backend_url="http://backend.test", device_id="cam", device_secret="s",
                     outbox_dir=tmp / "outbox")
        self.emitter = EventEmitter(cfg)  # start() 안 함 — 전송 없이 큐 저장까지만

    def tearDown(self):
        self._tmp.cleanup()

    def saved_event(self, event_type="fall_suspect"):
        return {"video_path": str(self.video), "thumbnail_path": str(self.thumb), "event_type": event_type,
                "event_time": datetime.now(timezone.utc), "score": 0.9}

    def test_originals_deleted_after_queued(self):
        uid = vp.emit_saved_event(self.emitter, self.saved_event(), "camera_01")
        self.assertIsNotNone(uid)
        self.assertFalse(self.video.exists())
        self.assertFalse(self.thumb.exists())
        # 전송용 복사본은 큐에 남아 있어야 재시도 가능
        row = self.emitter.outbox.fetch_due()[0]
        self.assertEqual({a["field"] for a in row["attachments"]}, {"image", "video"})
        self.assertTrue(all(Path(a["path"]).is_file() for a in row["attachments"]))
        # 원본 경로를 큐에 기록하지 않음 (이미 지웠으므로)
        self.assertTrue(all("original" not in a for a in row["attachments"]))

    def test_originals_deleted_when_not_queued(self):
        # 방문자 쿨다운(5분) 중이면 큐에 안 들어감 — 예전엔 이 원본이 Pi에 계속 쌓였음
        self.assertIsNotNone(vp.emit_saved_event(self.emitter, self.saved_event("door_visitor"), "camera_01"))
        self.video.write_bytes(b"video")
        self.thumb.write_bytes(b"jpg")
        self.assertIsNone(vp.emit_saved_event(self.emitter, self.saved_event("door_visitor"), "camera_01"))
        self.assertFalse(self.video.exists())
        self.assertFalse(self.thumb.exists())


class SoundRequestTest(unittest.TestCase):
    """마이크 소리 이벤트 녹화 요청 처리 / 녹화 중 감지된 영상 이벤트 전송."""

    def setUp(self):
        import numpy as np
        from edge.transport.av_share import AVShare
        from vision.event_recorder import EventRecorder

        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.av = AVShare(tmp / "av")
        self.recorder = EventRecorder(base_dir=str(tmp / "events"), fps=5, pre_seconds=1, post_seconds=1)
        self.frame = np.zeros((4, 4, 3), dtype=np.uint8)
        self.tmp = tmp

    def tearDown(self):
        self._tmp.cleanup()

    def test_request_starts_recording(self):
        rid = self.av.request_video("scream", trigger_time=100.0, post_sec=5.0, score=0.7)
        self.assertEqual(vp.handle_sound_requests(self.av, self.recorder, self.frame, now=100.5), rid)
        self.assertTrue(self.recorder.recording)
        self.assertEqual(self.recorder.request_id, rid)
        self.assertEqual(self.recorder.remaining_post_frames, 25)  # 5초 × 5fps

    def test_rejected_when_busy_or_too_old(self):
        self.recorder.start_event("fall_suspect", self.frame)
        busy = self.av.request_video("scream", trigger_time=100.0, post_sec=5.0)
        self.assertIsNone(vp.handle_sound_requests(self.av, self.recorder, self.frame, now=100.5))
        self.assertEqual(self.av.take_video_result(busy), ("failed", None))

        self.recorder._reset()
        old = self.av.request_video("scream", trigger_time=100.0, post_sec=5.0)
        now = 100.0 + vp.SOUND_REQUEST_MAX_AGE_SEC + 1
        self.assertIsNone(vp.handle_sound_requests(self.av, self.recorder, self.frame, now=now))
        self.assertEqual(self.av.take_video_result(old), ("failed", None))

    def test_publish_sound_clip_moves_video_and_drops_thumbnail(self):
        video, thumb = self.tmp / "c.mp4", self.tmp / "c.jpg"
        video.write_bytes(b"v")
        thumb.write_bytes(b"j")
        vp.publish_sound_clip(self.av, {"request_id": "r1", "video_path": str(video), "thumbnail_path": str(thumb)})
        self.assertFalse(video.exists() or thumb.exists())
        self.assertEqual(self.av.take_video_result("r1")[0], "ready")

    def test_detected_vision_event_priority(self):
        person = {"confidence": 0.8}
        self.assertEqual(vp.detected_vision_event(True, True, 0.5, True, person), ("intrusion_suspect", 0.8))
        self.assertEqual(vp.detected_vision_event(False, True, 0.5, True, person), ("fall_suspect", 0.8))
        self.assertEqual(vp.detected_vision_event(False, False, 0.5, True, person), ("delivery_suspect", 0.5))
        self.assertEqual(vp.detected_vision_event(False, False, None, True, None), ("door_visitor", None))
        self.assertIsNone(vp.detected_vision_event(False, False, None, False, person))

    def test_deferred_vision_event_emitted_with_copy(self):
        video, thumb = self.tmp / "c.mp4", self.tmp / "c.jpg"
        video.write_bytes(b"v")
        thumb.write_bytes(b"j")
        cfg = Config(backend_url="http://backend.test", device_id="cam", device_secret="s",
                     outbox_dir=self.tmp / "outbox")
        emitter = EventEmitter(cfg)
        saved = {"request_id": "r1", "video_path": str(video), "thumbnail_path": str(thumb), "has_audio": True}
        deferred = {"event_type": "fall_suspect", "score": 0.8, "frame": self.frame,
                    "event_time": datetime.now(timezone.utc)}

        def fake_imwrite(path, frame):
            Path(path).write_bytes(b"jpg")
            return True

        with mock.patch.object(vp.cv2, "imwrite", side_effect=fake_imwrite):
            uid = vp.emit_deferred_vision_event(emitter, saved, deferred, "camera_01")

        self.assertIsNotNone(uid)
        self.assertTrue(video.exists())  # 원본은 마이크로 넘겨야 하므로 남김
        row = emitter.outbox.fetch_due()[0]
        self.assertEqual(row["payload"]["metadata"]["category_id"], "fall_suspect")
        self.assertTrue(row["payload"]["metadata"]["video_has_audio"])
        self.assertEqual({a["field"] for a in row["attachments"]}, {"image", "video"})
        self.assertFalse(Path(str(video) + ".vision.mp4").exists())  # 복사본은 큐로 옮긴 뒤 지움


if __name__ == "__main__":
    unittest.main()
