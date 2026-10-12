"""실제 시간과 사람 박스 형태를 사용한 낙상 판정 회귀 테스트."""
import unittest
from unittest import mock

from vision.fall_detector import FallDetector


def person(x=200, y=100, width=80, height=200, scale=1):
    return {"center_x": x * scale, "center_y": y * scale,
            "width": width * scale, "height": height * scale}


def fallen(x=200, y=180, scale=1):
    return person(x=x, y=y, width=160, height=80, scale=scale)


class FallDetectorTest(unittest.TestCase):
    def setUp(self):
        self.detector = FallDetector()

    def run_frames(self, boxes, step=0.2, start=0):
        return [self.detector.update(box, timestamp=start + i * step)
                for i, box in enumerate(boxes)]

    def start_candidate(self):
        self.assertNotIn(True, self.run_frames([person()] * 3 + [fallen()]))
        self.assertTrue(self.detector.fall_candidate)

    def test_drop_posture_and_hold_detect_once(self):
        results = self.run_frames([person()] * 3 + [fallen()] * 12)
        self.assertEqual([i for i, hit in enumerate(results) if hit], [7])

    def test_fast_deep_sitting_is_accepted_as_suspect(self):
        # 미탐 우선 정책의 의도적인 오탐: 박스만으로 정면 낙상과 구분 불가.
        sitting = person(y=160, width=80, height=130)
        self.assertEqual(sum(self.run_frames([person()] * 3 + [sitting] * 15)), 1)

    def test_bending_without_large_height_change_is_not_fall(self):
        bending = person(y=160, width=100, height=160)
        self.assertNotIn(True, self.run_frames([person()] * 3 + [bending] * 15))

    def test_box_translation_without_posture_change_is_not_fall(self):
        self.assertNotIn(True, self.run_frames([person()] * 3 + [person(y=180)] * 15))

    def test_already_lying_down_is_not_new_fall(self):
        self.assertNotIn(True, self.run_frames([fallen()] * 20))

    def test_short_pause_is_not_enough(self):
        self.assertNotIn(True, self.run_frames([person()] * 3 + [fallen()] * 4))

    def test_scale_invariance(self):
        for scale in (0.5, 1, 2):
            with self.subTest(scale=scale):
                self.detector.reset()
                results = self.run_frames([person(scale=scale)] * 3 + [fallen(scale=scale)] * 6)
                self.assertEqual([i for i, hit in enumerate(results) if hit], [7])

    def test_slow_lowering_is_not_rapid_drop(self):
        boxes = [person(y=100 + i * 10, height=200 - i * 15, width=80 + i * 10)
                 for i in range(9)]
        self.assertNotIn(True, self.run_frames(boxes + [boxes[-1]] * 10, step=0.4))

    def test_horizontal_motion_after_fall_is_allowed(self):
        self.start_candidate()
        moving = [fallen(x=200 + 20 * i) for i in range(1, 15)]
        self.assertEqual(sum(self.run_frames(moving, start=0.8)), 1)
        self.assertFalse(self.detector.fall_candidate)
        self.assertNotIn(True, self.run_frames([moving[-1]] * 10, start=3.6))

    def test_small_continuous_drift_does_not_hide_fall(self):
        self.start_candidate()
        self.assertEqual(sum(self.run_frames(
            [fallen(x=200 + i * 6) for i in range(1, 16)], start=0.8)), 1)

    def test_movement_does_not_restart_hold_timer(self):
        self.start_candidate()
        results = self.run_frames([fallen(), fallen(x=230)] + [fallen(x=230)] * 4, start=0.8)
        self.assertEqual(results, [False] * 3 + [True, False, False])

    def test_recovery_cancels_candidate(self):
        self.start_candidate()
        self.assertNotIn(True, self.run_frames([person()] * 10, start=0.8))
        self.assertFalse(self.detector.fall_candidate)

    def test_short_missing_person_preserves_candidate_without_counting_gap(self):
        self.start_candidate()
        results = self.run_frames([None] + [fallen()] * 10, start=0.8)
        self.assertEqual([i for i, hit in enumerate(results) if hit], [5])

    def test_height_only_front_fall_is_detected(self):
        front = person(y=180, width=60, height=100)
        self.assertEqual(sum(self.run_frames([person()] * 3 + [front] * 10)), 1)

    def test_aspect_only_fall_is_detected(self):
        wide = person(y=180, width=180, height=150)
        self.assertEqual(sum(self.run_frames([person()] * 3 + [wide] * 10)), 1)

    def test_absence_alone_cannot_confirm_fall(self):
        self.start_candidate()
        self.assertNotIn(True, self.run_frames([None] * 20, start=0.8))
        self.assertFalse(self.detector.fall_candidate)

    def test_processing_gap_is_not_counted_as_low_observation(self):
        self.start_candidate()
        self.assertFalse(self.detector.update(fallen(), timestamp=1.4))
        self.assertEqual(sum(self.run_frames([fallen()] * 4, start=1.6)), 1)

    def test_candidate_expires_without_enough_observations(self):
        self.start_candidate()
        self.assertNotIn(True, self.run_frames([fallen()] * 4, step=0.8, start=1.4))
        self.assertFalse(self.detector.fall_candidate)

    def test_reset_discards_candidate(self):
        self.start_candidate()
        self.detector.reset()
        self.assertNotIn(True, self.run_frames([fallen()] * 10, start=0.8))

    def test_long_gap_cannot_confirm_old_candidate(self):
        self.start_candidate()
        self.assertNotIn(True, self.run_frames([fallen()] * 10, start=2.0))

    def test_gap_at_limit_is_allowed(self):
        self.start_candidate()
        self.assertFalse(self.detector.update(fallen(), timestamp=1.2))
        self.assertTrue(self.detector.update(fallen(), timestamp=1.8))

    def test_elapsed_time_alone_does_not_replace_minimum_samples(self):
        self.detector = FallDetector(min_stable_samples=5)
        self.start_candidate()
        self.assertFalse(self.detector.update(fallen(), timestamp=1.0))
        self.assertFalse(self.detector.update(fallen(), timestamp=1.4))
        self.assertFalse(self.detector.update(fallen(), timestamp=1.6))
        self.assertTrue(self.detector.update(fallen(), timestamp=1.8))

    def test_duplicate_or_backwards_time_breaks_continuity(self):
        for timestamp in (0.6, 0.1):
            with self.subTest(timestamp=timestamp):
                self.detector.reset()
                self.start_candidate()
                self.assertFalse(self.detector.update(fallen(), timestamp=timestamp))
                self.assertFalse(self.detector.fall_candidate)

    def test_hold_is_seconds_not_frame_count(self):
        for step in (0.1, 0.2, 0.4):
            with self.subTest(step=step):
                self.detector.reset()
                self.start_candidate()
                times = [0.6 + i * step for i in range(1, int(1.2 / step) + 2)]
                hits = [t for t in times if self.detector.update(fallen(), timestamp=t)]
                self.assertEqual(len(hits), 1)
                self.assertGreaterEqual(hits[0] + 1e-9, 1.4)
                self.assertLess(hits[0], 1.4 + step + 1e-9)

    def test_invalid_boxes_break_continuity(self):
        for box in ({"center_y": 100}, person(height=0), person(width=-1),
                    person(y=float("nan")), person(x=float("inf"))):
            with self.subTest(box=box):
                self.detector.reset()
                self.start_candidate()
                self.assertFalse(self.detector.update(box, timestamp=0.8))
                self.assertFalse(self.detector.fall_candidate)

    def test_low_posture_must_be_continuous(self):
        self.start_candidate()
        sitting = person(y=180, width=80, height=140)
        boxes = [fallen(), sitting] + [fallen()] * 5
        results = self.run_frames(boxes, start=0.8)
        self.assertEqual(results, [False] * 6 + [True])

    def test_default_clock_is_monotonic(self):
        with mock.patch("vision.fall_detector.time.monotonic", side_effect=[i * 0.2 for i in range(9)]):
            results = [self.detector.update(p) for p in [person()] * 3 + [fallen()] * 6]
        self.assertEqual([i for i, hit in enumerate(results) if hit], [7])

    def test_invalid_settings(self):
        for kwargs in ({"stable_sec": 0}, {"drop_ratio": float("nan")},
                       {"candidate_timeout_sec": 0.5}, {"max_gap_sec": 2},
                       {"max_height_ratio": 1}, {"min_aspect_growth": 1},
                       {"min_stable_samples": 1}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                FallDetector(**kwargs)


if __name__ == "__main__":
    unittest.main()
