"""다른 사람의 좌표를 이어 붙여 낙상으로 오인하지 않는지 검사한다."""
import contextlib
import io
import unittest

from vision.activity_tracker import FallPersonTracker
from vision.fall_detector import FallDetector


def person(x, y, confidence=0.9):
    return {"class_id": 0, "confidence": confidence, "center_x": x, "center_y": y,
            "x1": x - 30, "x2": x + 30, "y1": y - 80, "y2": y + 80}


class FallPersonTrackerTest(unittest.TestCase):
    def test_confidence_swap_keeps_same_person(self):
        tracker = FallPersonTracker()
        tracker.update([person(100, 100), person(300, 150, 0.8)])
        selected, changed = tracker.update([person(100, 100, 0.6), person(300, 150, 0.99)])
        self.assertEqual(selected["center_x"], 100)
        self.assertFalse(changed)

    def test_switching_person_does_not_create_fall(self):
        tracker, detector = FallPersonTracker(), FallDetector()
        results = []
        with contextlib.redirect_stdout(io.StringIO()):
            for p in [person(100, 100)] * 3 + [person(300, 150)] * 4:
                selected, changed = tracker.update([p])
                if changed:
                    detector.reset()
                results.append(detector.update(selected))
        self.assertNotIn(True, results)

    def test_same_person_fall_still_detected(self):
        tracker, detector = FallPersonTracker(), FallDetector()
        results = []
        with contextlib.redirect_stdout(io.StringIO()):
            for y in (100, 100, 100, 150, 150, 150):
                selected, changed = tracker.update([person(100, y)])
                if changed:
                    detector.reset()
                results.append(detector.update(selected))
        self.assertEqual(results, [False] * 5 + [True])

    def test_ambiguous_overlap_clears_target(self):
        tracker = FallPersonTracker()
        tracker.update([person(100, 100)])
        self.assertEqual(tracker.update([person(95, 100), person(105, 100)]), (None, True))

    def test_missing_person_and_explicit_reset_break_continuity(self):
        tracker = FallPersonTracker()
        tracker.update([person(100, 100)])
        self.assertEqual(tracker.update([]), (None, True))
        self.assertTrue(tracker.update([person(100, 100)])[1])
        tracker.reset()
        self.assertTrue(tracker.update([person(100, 100)])[1])
