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


class RecordMixin:
    def record(self, h264_ok, run_side_effect, audio_source=None, frame_interval=0.2, writer=None, **start_kw):
        """사전 1프레임 → 이벤트 시작 → 사후 프레임 저장. (결과 dict, subprocess.run mock) 반환.
        프레임 시각은 100초부터 frame_interval 간격."""
        tmp = tempfile.mkdtemp()
        rec = EventRecorder(base_dir=tmp, fps=5, pre_seconds=1, post_seconds=1, audio_source=audio_source)
        t = [100.0]

        def next_time():
            t[0] += frame_interval
            return t[0] - frame_interval

        with mock.patch.object(event_recorder.cv2, "VideoWriter", writer or fake_writer_factory(h264_ok)), \
                mock.patch.object(event_recorder.cv2, "imwrite"), \
                mock.patch.object(event_recorder.subprocess, "run", side_effect=run_side_effect) as run, \
                contextlib.redirect_stdout(io.StringIO()):
            rec.update(FRAME, next_time())
            rec.start_event("door_visitor", FRAME, score=0.9, **start_kw)
            saved = None
            while saved is None:
                saved = rec.update(FRAME, next_time())
        return saved, run


class EventRecorderTest(RecordMixin, unittest.TestCase):
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


class EventRecorderAudioTest(RecordMixin, unittest.TestCase):
    """마이크 링버퍼 소리를 영상 구간에 맞춰 합치기."""

    def audio_source(self, calls):
        def read(start, end):
            calls.append((start, end))
            return np.zeros(int((end - start) * 16000), dtype=np.int16), 16000
        return read

    def test_audio_muxed_into_h264_video(self):
        calls = []
        saved, run = self.record(h264_ok=False, run_side_effect=fake_ffmpeg(),
                                 audio_source=self.audio_source(calls))
        self.assertTrue(saved["has_audio"])
        cmd = run.call_args.args[0]
        self.assertEqual(run.call_count, 1)  # 소리 합치기 + H.264 변환을 한 번에
        self.assertIn("aac", cmd)
        self.assertIn("libx264", cmd)
        self.assertEqual(cmd.count("-i"), 2)
        with open(saved["video_path"], "rb") as f:
            self.assertEqual(f.read(), b"h264")
        # 사전 1 + 사후 5프레임, 0.2초 간격 → 100.0 ~ 101.0 + 한 프레임(0.2초)
        (start, end), = calls
        self.assertAlmostEqual(start, 100.0)
        self.assertAlmostEqual(end, 101.2)

    def test_h264_video_is_copied_not_reencoded(self):
        saved, run = self.record(h264_ok=True, run_side_effect=fake_ffmpeg(),
                                 audio_source=self.audio_source([]))
        cmd = run.call_args.args[0]
        self.assertIn("copy", cmd)
        self.assertNotIn("libx264", cmd)
        self.assertTrue(saved["has_audio"])

    def test_mic_off_gives_video_only(self):
        saved, run = self.record(h264_ok=False, run_side_effect=fake_ffmpeg(), audio_source=lambda s, e: None)
        self.assertFalse(saved["has_audio"])
        self.assertNotIn("aac", run.call_args.args[0])  # H.264 변환만

    def test_mux_failure_falls_back_to_h264_conversion(self):
        calls = []

        def run(cmd, **kw):
            calls.append(cmd)
            if "aac" in cmd:
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="no aac")
            return fake_ffmpeg()(cmd)

        saved, _ = self.record(h264_ok=False, run_side_effect=run, audio_source=self.audio_source([]))
        self.assertFalse(saved["has_audio"])
        self.assertEqual(len(calls), 2)
        with open(saved["video_path"], "rb") as f:
            self.assertEqual(f.read(), b"h264")

    def test_writer_uses_measured_fps(self):
        fps_used = []
        base = fake_writer_factory(True)

        class Writer(base):
            def __init__(self, path, fourcc, fps, size):
                fps_used.append(fps)
                super().__init__(path, fourcc, fps, size)

        # 설정은 5fps지만 YOLO가 느려 실제로는 0.4초 간격(2.5fps)
        self.record(h264_ok=True, run_side_effect=fake_ffmpeg(), frame_interval=0.4, writer=Writer)
        self.assertAlmostEqual(fps_used[0], 2.5)

    def test_request_id_and_post_seconds_override(self):
        calls = []
        saved, _ = self.record(h264_ok=True, run_side_effect=fake_ffmpeg(), audio_source=self.audio_source(calls),
                               post_seconds=2, request_id="req-1")
        self.assertEqual(saved["request_id"], "req-1")
        # 사전 1 + 사후 10프레임(2초 × 5fps), 0.2초 간격 → 100.0 ~ 102.0 + 한 프레임
        (start, end), = calls
        self.assertAlmostEqual(end, 102.2)


if __name__ == "__main__":
    unittest.main()
