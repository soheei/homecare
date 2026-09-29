"""vision 이벤트 전송 후 Pi 원본(영상·썸네일) 정리 테스트 — 전송 결과와 상관없이 Pi에 남기지 않는다.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import sys
import tempfile
import types
import unittest
from datetime import datetime, timezone
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


if __name__ == "__main__":
    unittest.main()
