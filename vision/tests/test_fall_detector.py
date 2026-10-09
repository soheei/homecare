"""현재 낙상 판정: 4프레임 급하강 후 연속 안정 프레임을 확인한다."""
import contextlib
import io
import unittest

from vision.fall_detector import FallDetector


class FallDetectorTest(unittest.TestCase):
    def setUp(self):
        self.detector = FallDetector(
            history_frames=4, drop_threshold=35,
            candidate_frames=2, movement_threshold=8,
        )

    def run_frames(self, positions):
        with contextlib.redirect_stdout(io.StringIO()):
            return [self.detector.update(None if y is None else {"center_y": y})
                    for y in positions]

    def test_fall_after_drop_and_two_stable_frames(self):
        self.assertEqual(self.run_frames([100, 100, 100, 150, 150, 150]),
                         [False, False, False, False, False, True])

    def test_movement_restarts_stable_frame_count(self):
        self.assertEqual(self.run_frames([100, 100, 100, 150, 150, 170, 170, 170]),
                         [False] * 7 + [True])

    def test_stationary_without_drop_is_not_fall(self):
        self.assertNotIn(True, self.run_frames([200] * 8))

    def test_continuous_motion_is_not_fall(self):
        self.assertNotIn(True, self.run_frames([100 + i * 30 for i in range(8)]))

    def test_one_stable_frame_after_candidate(self):
        self.detector.candidate_frames = 1
        self.assertEqual(self.run_frames([100, 100, 100, 150, 150]),
                         [False, False, False, False, True])

    def test_missing_person_clears_candidate(self):
        self.assertNotIn(True, self.run_frames([100, 100, 100, 150, None] + [150] * 6))

    def test_drop_at_threshold_is_not_fall(self):
        self.assertNotIn(True, self.run_frames([100, 100, 100, 135, 135, 135]))

    def test_recovery_cancels_candidate(self):
        self.assertNotIn(True, self.run_frames([100, 100, 100, 150, 100, 100, 100]))

    def test_configured_history_lengths(self):
        for length in (2, 3, 6):
            with self.subTest(length=length):
                self.detector = FallDetector(history_frames=length)
                positions = [100] * (length - 1) + [150] * 3
                self.assertEqual(self.run_frames(positions),
                                 [False] * (len(positions) - 1) + [True])

    def test_invalid_history_length(self):
        with self.assertRaises(ValueError):
            FallDetector(history_frames=1)

    def test_reset_discards_candidate(self):
        self.run_frames([100, 100, 100, 150])
        self.detector.reset()
        self.assertNotIn(True, self.run_frames([150] * 6))


if __name__ == "__main__":
    unittest.main()
