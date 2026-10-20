import csv
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

from .evaluate import FIELDS, load_labels, score, wilson
from .replay import pipeline_settings, replay_clip


def label(clip_id="a", positive=1, kind="clip"):
    return dict(clip_id=clip_id, file=f"{clip_id}.mp4", session=clip_id, scenario="fixture",
                category="fall_suspect", label=positive, kind=kind,
                start_s=5.0 if positive else 0.0, end_s=10.0,
                duration_s=10.0, lighting="day", distance="near", mode="living", armed=0, split="dev")


def event(timestamp):
    return {"category": "fall_suspect", "time_s": timestamp}


class EvaluationTests(unittest.TestCase):
    def test_detected_and_suspect_are_separate_categories(self):
        row = {**label(), 'category': 'fall_detected'}
        self.load([row])
        report, _ = score([row], {'a': [event(6)]})
        self.assertEqual(report['categories']['fall_detected']['FN'], 1)
        report, _ = score([row], {'a': [{'category': 'fall_detected', 'time_s': 6}]})
        self.assertEqual(report['categories']['fall_detected']['TP'], 1)

    def load(self, rows):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"labels.csv"
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=sorted(FIELDS))
                writer.writeheader()
                writer.writerows(rows)
            return load_labels(path)

    def test_confusion_and_timing(self):
        rows = [label("tp"), label("fn"), label("fp", 0), label("tn", 0)]
        report, details = score(rows, {"tp": [event(6), event(7)], "fn": [], "fp": [event(2)], "tn": []})
        s = report["categories"]["fall_suspect"]
        self.assertEqual([s[k] for k in ("TP", "FP", "TN", "FN")], [1, 1, 1, 1])
        self.assertEqual(s["f1"], 0.5)
        self.assertEqual(s["mcc"], 0)
        self.assertEqual(s["extra_clip_events"], 1)
        self.assertEqual(s["latency_median_s"], 1)
        self.assertEqual(len(details), 4)

    def test_background_counts_events_not_clips(self):
        row = label(positive=0, kind="background")
        row.update(duration_s=3600, end_s=3600)
        report, _ = score([row], {"a": [event(1), event(2)]})
        s = report["categories"]["fall_suspect"]
        self.assertEqual(s["raw_false_events_per_hour"], 2)
        self.assertEqual(s["n_clips"], 0)
        self.assertIsNone(s["accuracy"])

    def test_out_of_window_is_not_timely_hit(self):
        report, _ = score([label()], {"a": [event(1)]})
        s = report["categories"]["fall_suspect"]
        self.assertEqual(s["TP"], 1)
        self.assertEqual(s["timely_recall"], 0)
        self.assertIsNone(s["latency_median_s"])

    def test_missing_predictions_are_errors(self):
        with self.assertRaises(ValueError):
            score([label()], {})

    def test_invalid_prediction_times(self):
        for value in (-1, 10, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                score([label()], {"a": [event(value)]})

    def test_other_category_does_not_count(self):
        report, _ = score([label()], {"a": [{"category": "visitor_detected", "time_s": 6}]})
        self.assertEqual(report["categories"]["fall_suspect"]["FN"], 1)

    def test_wilson_reference(self):
        lo, hi = wilson(5, 10)
        self.assertAlmostEqual(lo, 0.23659309)
        self.assertAlmostEqual(hi, 0.76340691)
        self.assertIsNone(wilson(0, 0))

    def test_valid_labels(self):
        self.assertEqual(len(self.load([label()])), 1)

    def test_label_validation(self):
        for patch in ({"label": 2}, {"start_s": -1}, {"duration_s": "nan"},
                      {"mode": "entrance"}, {"kind": "background"}, {"session": ""}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.load([{**label(), **patch}])

    def test_session_and_file_leakage(self):
        for key in ("session", "file"):
            first, second = label("a"), label("b")
            second.update(split="test")
            second[key] = first[key]
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.load([first, second])

    def test_duplicate_ids(self):
        with self.assertRaises(ValueError):
            self.load([label(), label()])

    def test_pipeline_settings_without_pi_import(self):
        settings = pipeline_settings()
        self.assertEqual(settings["VISITOR_REQUIRED_FRAMES"], 15)
        self.assertEqual(settings["FPS"], 5)

    def test_replay_sampling_clock_and_decode_failure(self):
        class Capture:
            def __init__(self, count):
                self.index, self.count, self.released = 0, count, False

            def isOpened(self):
                return True

            def get(self, key):
                return 29.97 if key == 1 else 300

            def read(self):
                self.index += 1
                return (True, object()) if self.index <= self.count else (False, None)

            def release(self):
                self.released = True

        capture = Capture(300)
        cv = SimpleNamespace(VideoCapture=lambda _: capture, CAP_PROP_FPS=1, CAP_PROP_FRAME_COUNT=2,
                             resize=lambda frame, size: frame)
        runner = SimpleNamespace(update=lambda frame, detections, timestamp, detector: ["fall_suspect"])
        detector = SimpleNamespace(detect=lambda frame: [])
        row = {**label(), "resolved_file": "fixture.mp4", "duration_s": 300/29.97}
        with patch.dict("sys.modules", {"cv2": cv}), patch("vision.evaluation.replay.RuleRunner", return_value=runner):
            events, diagnostics = replay_clip(row, detector, pipeline_settings())
            self.assertEqual(diagnostics["sampled_frames"], 50)
            self.assertAlmostEqual(events[1]["time_s"], 6/29.97)
            self.assertTrue(capture.released)
            capture = Capture(100)
            with self.assertRaisesRegex(ValueError, "incomplete video decode"):
                replay_clip(row, detector, pipeline_settings())
            self.assertTrue(capture.released)


if __name__ == "__main__":
    unittest.main()
