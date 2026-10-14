"""Camera-free checks of take naming, recording completion and interruption."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from vision import record_dataset as recording


class RecordingTests(unittest.TestCase):
    def test_take_numbers_include_partial_files_and_do_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "F01_R1_old.mp4").write_bytes(b"original")
            (root / "F01_R3_failed.json").write_text("{}")
            (root / "F02_R9_other.mp4").touch()
            path = recording.next_path(root, "F01")
            self.assertTrue(path.name.startswith("F01_R4_"))
            self.assertEqual((root / "F01_R1_old.mp4").read_bytes(), b"original")

    def run_recording(self, interrupt=False, slow=False):
        clock = [0.0]
        camera_state = {"stopped": False, "closed": False, "captures": 0}
        writers = []

        class Camera:
            def create_video_configuration(self, **kwargs):
                return kwargs

            def configure(self, config):
                pass

            def start(self):
                pass

            def capture_array(self):
                camera_state["captures"] += 1
                if interrupt and camera_state["captures"] == 4:
                    raise KeyboardInterrupt()
                clock[0] += 0.2 if slow else 1 / recording.FPS
                return object()

            def stop(self):
                camera_state["stopped"] = True

            def close(self):
                camera_state["closed"] = True

        class Writer:
            def __init__(self, path, *args):
                self.path = Path(path)
                self.released = False
                self.count = 0
                writers.append(self)

            def isOpened(self):
                return True

            def write(self, frame):
                self.count += 1

            def release(self):
                self.released = True
                self.path.write_bytes(b"fake video")

        fake_cv = types.SimpleNamespace(VideoWriter=Writer, VideoWriter_fourcc=lambda *a: 0)
        fake_pi = types.SimpleNamespace(Picamera2=Camera)
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict("sys.modules", {"cv2": fake_cv, "picamera2": fake_pi}), \
                patch.object(recording.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(recording.time, "sleep"), \
                patch.dict(recording.SCENARIOS, {"TEST": (1, "test")}), \
                contextlib.redirect_stdout(io.StringIO()):
            result = recording.record("TEST", Path(directory), countdown=0)
            metadata = json.loads(next(Path(directory).glob("*.json")).read_text(encoding="utf-8"))
        self.assertTrue(writers[0].released)
        self.assertTrue(camera_state["stopped"])
        self.assertTrue(camera_state["closed"])
        return result, metadata

    def test_complete_preserves_timing_metadata(self):
        result, metadata = self.run_recording()
        self.assertEqual(result, 0)
        self.assertEqual(metadata["status"], "complete")
        self.assertAlmostEqual(metadata["observed_fps"], 15)
        self.assertGreater(len(metadata["frame_elapsed_seconds"]), 10)

    def test_interruption_is_not_reported_as_success(self):
        result, metadata = self.run_recording(interrupt=True)
        self.assertEqual(result, 1)
        self.assertEqual(metadata["status"], "interrupted")
        self.assertEqual(metadata["frames"], 3)

    def test_slow_capture_warns_instead_of_claiming_valid_timing(self):
        result, metadata = self.run_recording(slow=True)
        self.assertEqual(result, 2)
        self.assertTrue(metadata["timing_warning"])


if __name__ == "__main__":
    unittest.main()
