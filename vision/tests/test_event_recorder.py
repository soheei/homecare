"""이벤트 영상 저장 + H.264 변환 테스트 — 카메라/ffmpeg 없이 가짜 VideoWriter·ffmpeg로 검증.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import contextlib
import io
import os
import subprocess
import tempfile
import unittest
from unittest import mock

import numpy as np

from vision import event_recorder
from vision.event_recorder import EventRecorder

FRAME = np.full((48, 64, 3), 100, dtype=np.uint8)


def fake_writer_factory(h264_ok):
    """avc1(H.264) 열기 성공 여부를 정할 수 있는 가짜 cv2.VideoWriter. release() 때 파일을 만든다."""

    class FakeWriter:
        def __init__(self, path, fourcc, fps, size):
            self.path = path
            self.opened = h264_ok if fourcc == event_recorder.cv2.VideoWriter_fourcc(*"avc1") else True

        def isOpened(self):
            return self.opened

        def write(self, frame):
            pass

        def release(self):
            if self.opened:
                with open(self.path, "wb") as f:
                    f.write(b"mp4v-or-h264")

    return FakeWriter


def fake_ffmpeg(returncode=0, make_output=True):
    def run(cmd, **kw):
        if make_output:
            with open(cmd[-1], "wb") as f:  # 마지막 인자 = 변환 결과 파일
                f.write(b"h264")
        return subprocess.CompletedProcess(cmd, returncode, stdout="", stderr="boom" if returncode else "")
    return run


class EventRecorderTest(unittest.TestCase):
    def record(self, h264_ok, run_side_effect):
        """사전 1프레임 → 이벤트 시작 → 사후 5프레임 저장. (결과 dict, subprocess.run mock) 반환."""
        tmp = tempfile.mkdtemp()
        rec = EventRecorder(base_dir=tmp, fps=5, pre_seconds=1, post_seconds=1)
        with mock.patch.object(event_recorder.cv2, "VideoWriter", fake_writer_factory(h264_ok)), \
                mock.patch.object(event_recorder.cv2, "imwrite"), \
                mock.patch.object(event_recorder.subprocess, "run", side_effect=run_side_effect) as run, \
                contextlib.redirect_stdout(io.StringIO()):
            rec.update(FRAME)
            rec.start_event("door_visitor", FRAME, score=0.9)
            saved = None
            while saved is None:
                saved = rec.update(FRAME)
        return saved, run

    def test_mp4v_is_converted_to_h264(self):
        saved, run = self.record(h264_ok=False, run_side_effect=fake_ffmpeg())
        cmd = run.call_args.args[0]
        self.assertIn("libx264", cmd)
        self.assertIn("yuv420p", cmd)
        with open(saved["video_path"], "rb") as f:
            self.assertEqual(f.read(), b"h264")  # 변환본으로 교체됨
        self.assertFalse(os.path.exists(saved["video_path"] + ".h264.mp4"))

    def test_no_conversion_when_h264_writer_works(self):
        saved, run = self.record(h264_ok=True, run_side_effect=fake_ffmpeg())
        run.assert_not_called()
        self.assertTrue(os.path.exists(saved["video_path"]))

    def test_missing_ffmpeg_keeps_original_and_event(self):
        saved, _ = self.record(h264_ok=False, run_side_effect=FileNotFoundError("ffmpeg"))
        self.assertIsNotNone(saved)  # 이벤트는 그대로 전송 대상
        with open(saved["video_path"], "rb") as f:
            self.assertEqual(f.read(), b"mp4v-or-h264")

    def test_failed_conversion_keeps_original_and_cleans_temp(self):
        saved, _ = self.record(h264_ok=False, run_side_effect=fake_ffmpeg(returncode=1))
        with open(saved["video_path"], "rb") as f:
            self.assertEqual(f.read(), b"mp4v-or-h264")
        self.assertFalse(os.path.exists(saved["video_path"] + ".h264.mp4"))


if __name__ == "__main__":
    unittest.main()
