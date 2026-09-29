"""av_share.py 테스트 — 마이크↔카메라 프로세스 간 소리 링버퍼 / 녹화 요청·결과 주고받기.
실행: 저장소 루트에서 `python -m unittest discover -s edge/tests -t .`"""

import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

from edge.transport import av_share
from edge.transport.av_share import AVShare

SR = 16000


class AudioRingTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.now = [1000.0]
        self.av = AVShare(self._tmp.name, clock=lambda: self.now[0])

    def tearDown(self):
        self._tmp.cleanup()

    def push_seconds(self, seconds, value, end_time):
        self.av.push_audio(np.full(int(seconds * SR), value, dtype=np.float32), SR, end_time)

    def test_reads_exact_span(self):
        # 990~995초: 0.25, 995~1000초: 0.5
        self.push_seconds(5, 0.25, 995.0)
        self.push_seconds(5, 0.5, 1000.0)
        audio, sr = self.av.read_audio(994.0, 996.0, wait_sec=0)
        self.assertEqual(sr, SR)
        self.assertEqual(len(audio), 2 * SR)
        self.assertEqual(audio[0], int(0.25 * 32767))
        self.assertEqual(audio[-1], int(0.5 * 32767))

    def test_pads_uncovered_part_with_silence(self):
        # 링버퍼는 998~1000초만 있음 → 996~998초는 무음, 길이는 요청 구간 그대로(영상과 싱크 유지)
        self.push_seconds(2, 0.5, 1000.0)
        audio, _ = self.av.read_audio(996.0, 1000.0, wait_sec=0)
        self.assertEqual(len(audio), 4 * SR)
        self.assertTrue((audio[:2 * SR] == 0).all())
        self.assertTrue((audio[2 * SR:] != 0).all())

    def test_ring_is_limited(self):
        self.push_seconds(av_share.RING_SEC + 5, 0.1, 1000.0)
        audio, sr, _ = self.av._load_ring()
        self.assertEqual(len(audio), int(av_share.RING_SEC * sr))

    def test_stale_ring_means_mic_off(self):
        self.push_seconds(5, 0.5, 1000.0)
        self.now[0] = 1000.0 + av_share.RING_STALE_SEC + 1
        self.assertIsNone(self.av.read_audio(996.0, 999.0, wait_sec=0))

    def test_no_ring_file(self):
        self.assertIsNone(self.av.read_audio(996.0, 999.0, wait_sec=0))

    def test_waits_for_ring_to_cover_end(self):
        self.push_seconds(5, 0.5, 999.0)
        pushed = []

        def sleep(sec):
            # 기다리는 동안 마이크가 다음 청크를 씀
            self.now[0] += sec
            if not pushed:
                self.push_seconds(1, 0.5, 1000.0)
                pushed.append(True)

        audio, _ = self.av.read_audio(998.0, 1000.0, wait_sec=2, sleep=sleep)
        self.assertTrue(pushed)
        self.assertTrue((audio != 0).all())


class VideoRequestTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.av = AVShare(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_vision_alive(self):
        self.assertFalse(self.av.vision_alive())
        self.av.mark_vision_alive()
        self.assertTrue(self.av.vision_alive())
        old = self.av._clock() - av_share.VISION_ALIVE_SEC - 1
        os.utime(self.av.alive_path, (old, old))
        self.assertFalse(self.av.vision_alive())

    def test_request_result_roundtrip(self):
        rid = self.av.request_video("scream", trigger_time=123.0, post_sec=5.0, score=0.8)
        reqs = self.av.poll_video_requests()
        self.assertEqual([(r["id"], r["category_id"], r["post_sec"]) for r in reqs], [(rid, "scream", 5.0)])
        self.assertEqual(self.av.poll_video_requests(), [])  # 한 번 꺼내면 사라짐

        self.assertEqual(self.av.take_video_result(rid), (None, None))
        src = Path(self._tmp.name) / "clip.mp4"
        src.write_bytes(b"mp4")
        self.av.publish_video_result(rid, str(src))
        self.assertFalse(src.exists())  # 원본은 이동됨
        status, path = self.av.take_video_result(rid)
        self.assertEqual(status, "ready")
        self.assertEqual(Path(path).read_bytes(), b"mp4")

    def test_failure_result(self):
        rid = self.av.request_video("scream", trigger_time=123.0, post_sec=5.0)
        self.av.publish_video_result(rid, None)
        self.assertEqual(self.av.take_video_result(rid), ("failed", None))
        self.assertEqual(self.av.take_video_result(rid), (None, None))

    def test_cancel_removes_late_result(self):
        rid = self.av.request_video("scream", trigger_time=123.0, post_sec=5.0)
        self.av.cancel_request(rid)
        self.assertEqual(self.av.poll_video_requests(), [])


if __name__ == "__main__":
    unittest.main()
