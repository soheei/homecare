"""Hardware-free checks: python3 -B -m unittest yamnet.test_record_dataset."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock
import wave

from yamnet.record_dataset import parser, record


class RecordingTests(unittest.TestCase):
    def run_recording(self, mode):
        with tempfile.TemporaryDirectory() as folder:
            args = parser().parse_args([
                "scream_shout", "left", "--seconds", "1", "--countdown", "0",
                "--output-dir", folder,
            ])
            sd = MagicMock()
            sd.query_devices.return_value = {"name": "fake mic"}
            stream = sd.RawInputStream.return_value.__enter__.return_value
            calls = 0

            def read(count):
                nonlocal calls
                calls += 1
                if mode == "interrupted" and calls == 2:
                    raise KeyboardInterrupt
                return b"\x01\x00" * count, mode == "overflow"

            stream.read.side_effect = read
            result = record(args, sd)
            path = next(Path(folder).rglob("*.wav"))
            data = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertEqual(data["status"], mode)
            self.assertEqual(result, 0 if mode == "complete" else 1)
            with wave.open(str(path), "rb") as wav:
                self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()),
                                 (1, 2, 16000))
                self.assertEqual(wav.getnframes(), data["frames"])
                self.assertEqual(wav.getnframes(), 4096 if mode == "interrupted" else 16000)
                self.assertEqual(wav.readframes(1), b"\x01\x00")

    def test_complete_wav(self):
        self.run_recording("complete")

    def test_overflow_is_not_success(self):
        self.run_recording("overflow")

    def test_interrupt_preserves_partial_wav(self):
        self.run_recording("interrupted")


if __name__ == "__main__":
    unittest.main()
