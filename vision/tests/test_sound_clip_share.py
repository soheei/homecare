"""녹화 중에 들어온 소리 이벤트 요청이 거절되지 않고 같은 영상을 받는지 테스트.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import sys
import tempfile
import types
import unittest
from pathlib import Path

# picamera2/ultralytics가 없는 PC에서도 vision_pipeline을 import할 수 있게 빈 모듈로 대체 (Pi에선 실제 모듈 사용)
for _name, _attr in (("picamera2", "Picamera2"), ("ultralytics", "YOLO")):
    try:
        __import__(_name)
    except ImportError:
        sys.modules[_name] = types.SimpleNamespace(**{_attr: object})

from vision import vision_pipeline as vp  # noqa: E402
from vision.sound_clip_share import WaitingSoundRequests  # noqa: E402


class SoundClipShareTest(unittest.TestCase):
    def setUp(self):
        import numpy as np
        from edge.transport.av_share import AVShare
        from vision.event_recorder import EventRecorder

        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.av = AVShare(self.tmp / "av")
        self.recorder = EventRecorder(base_dir=str(self.tmp / "events"), fps=5, pre_seconds=1, post_seconds=1)
        self.frame = np.zeros((4, 4, 3), dtype=np.uint8)
        self.waiting = WaitingSoundRequests()

    def tearDown(self):
        self._tmp.cleanup()

    def test_busy_request_waits_instead_of_being_rejected(self):
        self.recorder.start_event("fall_suspect", self.frame)  # 낙상 녹화 중
        rid = self.av.request_video("scream_shout", trigger_time=100.0, post_sec=5.0)

        started = vp.handle_sound_requests(self.av, self.recorder, self.frame, now=100.5, waiting=self.waiting)

        self.assertIsNone(started)                       # 새 녹화는 시작하지 않음
        self.assertEqual(len(self.waiting), 1)           # 대신 기다림
        self.assertEqual(self.av.take_video_result(rid), (None, None))  # 거절(failed)이 아님 → 마이크가 계속 기다림

    def test_waiting_request_receives_copy_of_finished_video(self):
        self.recorder.start_event("fall_suspect", self.frame)
        rid = self.av.request_video("scream_shout", trigger_time=100.0, post_sec=5.0)
        vp.handle_sound_requests(self.av, self.recorder, self.frame, now=100.5, waiting=self.waiting)

        video = self.tmp / "clip.mp4"
        video.write_bytes(b"video-bytes")
        self.waiting.publish(self.av, str(video))

        status, path = self.av.take_video_result(rid)
        self.assertEqual(status, "ready")
        self.assertEqual(Path(path).read_bytes(), b"video-bytes")
        self.assertNotEqual(Path(path), video)           # 마이크가 지워도 원본이 남도록 복사본
        self.assertTrue(video.exists())
        self.assertEqual(len(self.waiting), 0)

    def test_each_waiting_request_gets_its_own_copy(self):
        self.recorder.start_event("fall_suspect", self.frame)
        a = self.av.request_video("scream_shout", trigger_time=100.0, post_sec=5.0)
        b = self.av.request_video("glass_impact", trigger_time=100.1, post_sec=5.0)
        vp.handle_sound_requests(self.av, self.recorder, self.frame, now=100.5, waiting=self.waiting)
        self.assertEqual(len(self.waiting), 2)

        video = self.tmp / "clip.mp4"
        video.write_bytes(b"v")
        self.waiting.publish(self.av, str(video))

        path_a, path_b = self.av.take_video_result(a)[1], self.av.take_video_result(b)[1]
        self.assertNotEqual(path_a, path_b)
        Path(path_a).unlink()                            # 한쪽이 지워도 다른 쪽은 남아 있어야 함
        self.assertTrue(Path(path_b).is_file())

    def test_too_old_request_is_still_rejected(self):
        self.recorder.start_event("fall_suspect", self.frame)
        rid = self.av.request_video("scream_shout", trigger_time=100.0, post_sec=5.0)
        now = 100.0 + vp.SOUND_REQUEST_MAX_AGE_SEC + 1

        vp.handle_sound_requests(self.av, self.recorder, self.frame, now=now, waiting=self.waiting)

        self.assertEqual(len(self.waiting), 0)
        self.assertEqual(self.av.take_video_result(rid), ("failed", None))

    def test_without_waiting_busy_is_rejected_as_before(self):
        self.recorder.start_event("fall_suspect", self.frame)
        rid = self.av.request_video("scream_shout", trigger_time=100.0, post_sec=5.0)
        vp.handle_sound_requests(self.av, self.recorder, self.frame, now=100.5)
        self.assertEqual(self.av.take_video_result(rid), ("failed", None))

    def test_copy_failure_answers_without_video(self):
        rid = self.av.request_video("scream_shout", trigger_time=100.0, post_sec=5.0)
        self.waiting.add(rid)
        self.waiting.publish(self.av, str(self.tmp / "missing.mp4"))  # 원본 없음 → 복사 실패
        self.assertEqual(self.av.take_video_result(rid), ("failed", None))


if __name__ == "__main__":
    unittest.main()
