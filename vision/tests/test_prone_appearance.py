import unittest
from vision.fall_detector import FallDetector
from vision.activity_tracker import FallPersonTracker
from vision.tests.test_fall_person_tracker import person


class ProneAppearanceTest(unittest.TestCase):
    def run_boxes(self, boxes):
        detector, tracker = FallDetector(), FallPersonTracker()
        hits = []
        for i, box in enumerate(boxes):
            selected, changed = tracker.update([] if box is None else [box], timestamp=i * .2)
            if detector.update_tracked(selected, timestamp=i * .2, changed=changed):
                hits.append(i)
        return hits

    def test_absence_then_prone_detects_once(self):
        low = person(200, 200, width=160, height=80)
        self.assertEqual(self.run_boxes([None] * 6 + [low] * 30), [16])

    def test_upright_entry_does_not_arm_appearance(self):
        upright = person(200, 100)
        self.assertEqual(self.run_boxes([None] * 6 + [upright] * 20), [])

    def test_startup_prone_without_observed_absence_does_not_fire(self):
        self.assertEqual(self.run_boxes([person(200, 200, width=160, height=80)] * 30), [])

    def test_brief_or_intermittent_prone_does_not_fire(self):
        low = person(200, 200, width=160, height=80)
        upright = person(200, 100)
        for tail in ([low] * 4 + [upright] * 20, [low, None] * 20):
            self.assertEqual(self.run_boxes([None] * 6 + tail), [])

    def test_reset_clears_absence(self):
        d = FallDetector()
        for i in range(6):
            d.update_tracked(None, i * .2, changed=True)
        d.reset()
        low = person(200, 200, width=160, height=80)
        self.assertFalse(any(d.update_tracked(low, 1.2+i*.2) for i in range(20)))

    def test_processing_gap_cannot_replace_observed_absence(self):
        d = FallDetector()
        d.update_tracked(None, 0)
        low = person(200, 200, width=160, height=80)
        self.assertFalse(any(d.update_tracked(low, 3+i*.2) for i in range(20)))

    def test_target_change_cancels_pending_confirmation(self):
        d = FallDetector()
        for i in range(6): d.update_tracked(None, i*.2)
        low = person(200, 200, width=160, height=80)
        hits = [d.update_tracked(low, 1.2+i*.2, changed=i in (0, 5)) for i in range(20)]
        self.assertNotIn(True, hits)

    def test_ambiguous_visible_people_are_not_absence(self):
        d = FallDetector()
        for i in range(10): d.update_tracked(None, i*.2, person_visible=True)
        low = person(200, 200, width=160, height=80)
        self.assertFalse(any(d.update_tracked(low, 2+i*.2) for i in range(20)))
