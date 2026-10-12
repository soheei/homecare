"""다른 사람의 좌표를 이어 붙여 낙상으로 오인하지 않는지 검사한다."""
import contextlib
import io
import unittest

from vision.activity_tracker import FallPersonTracker
from vision.fall_detector import FallDetector


def person(x, y, confidence=0.9, width=80, height=200):
    return {"class_id": 0, "confidence": confidence, "center_x": x, "center_y": y,
            "x1": x - width / 2, "x2": x + width / 2,
            "y1": y - height / 2, "y2": y + height / 2}


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
            for i, p in enumerate([person(100, 100)] * 3 +
                                  [person(400, 180, width=160, height=80)] * 6):
                selected, changed = tracker.update([p])
                if changed:
                    detector.reset()
                results.append(detector.update(selected, timestamp=i * 0.2))
        self.assertNotIn(True, results)

    def test_same_person_fall_still_detected(self):
        tracker, detector = FallPersonTracker(), FallDetector()
        results = []
        with contextlib.redirect_stdout(io.StringIO()):
            boxes = [person(100, 100)] * 3 + [person(100, 180, width=160, height=80)] * 6
            for i, box in enumerate(boxes):
                selected, changed = tracker.update([box])
                if changed:
                    detector.reset()
                results.append(detector.update(selected, timestamp=i * 0.2))
        self.assertEqual(results, [False] * 7 + [True, False])

    def test_ambiguous_overlap_clears_target(self):
        tracker = FallPersonTracker()
        tracker.update([person(100, 100)])
        self.assertEqual(tracker.update([person(95, 100), person(105, 100)]), (None, True))

    def test_short_missing_person_preserves_target_but_long_gap_resets(self):
        tracker = FallPersonTracker()
        tracker.update([person(100, 100)], timestamp=0)
        self.assertEqual(tracker.update([], timestamp=0.2), (None, False))
        self.assertFalse(tracker.update([person(100, 100)], timestamp=0.4)[1])
        self.assertEqual(tracker.update([], timestamp=1.5), (None, True))
        self.assertTrue(tracker.update([person(100, 100)], timestamp=1.6)[1])
        tracker.reset()
        self.assertTrue(tracker.update([person(100, 100)])[1])

    def test_single_person_large_posture_change_keeps_target(self):
        tracker = FallPersonTracker()
        tracker.update([person(100, 100)], timestamp=0)
        selected, changed = tracker.update(
            [person(100, 230, width=160, height=60)], timestamp=0.2)
        self.assertIsNotNone(selected)
        self.assertFalse(changed)

    def test_fall_survives_missing_frame_through_tracker(self):
        tracker, detector = FallPersonTracker(), FallDetector()
        boxes = ([person(100, 100)] * 3
                 + [person(100, 180, width=160, height=80), None]
                 + [person(100, 180, width=160, height=80)] * 8)
        results = []
        for i, box in enumerate(boxes):
            selected, changed = tracker.update([] if box is None else [box], timestamp=i * 0.2)
            if changed:
                detector.reset()
            results.append(detector.update(selected, timestamp=i * 0.2))
        self.assertEqual([i for i, hit in enumerate(results) if hit], [9])
