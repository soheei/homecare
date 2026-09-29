"""FallDetector 2단계 판정 테스트 — 세로형→급하강→가로형(의심) 후 가로형이 required_frames 동안 유지돼야 낙상.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import contextlib
import io
import unittest

from vision.fall_detector import FallDetector

UPRIGHT = dict(width=40, height=100)  # 가로/세로 0.4
LYING = dict(width=100, height=40)  # 가로/세로 2.5


def person(center_y, shape):
    return dict(center_y=center_y, **shape)


class FallDetectorTest(unittest.TestCase):
    def setUp(self):
        self.detector = FallDetector(
            vertical_threshold=25,
            previous_aspect_threshold=0.9,
            fall_aspect_threshold=1.3,
            required_frames=3,
        )

    def run_frames(self, frames):
        with contextlib.redirect_stdout(io.StringIO()):  # [FALL CHECK] 출력 숨김
            return [self.detector.update(p) for p in frames]

    def test_fall_detected_after_lying_held(self):
        results = self.run_frames([
            person(100, UPRIGHT),
            person(200, LYING),  # 의심 시작 (1)
            person(200, LYING),  # 2
            person(200, LYING),  # 3 → 낙상
        ])
        self.assertEqual(results, [False, False, False, True])

    def test_cancelled_when_getting_up(self):
        results = self.run_frames([
            person(100, UPRIGHT),
            person(200, LYING),
            person(200, LYING),
            person(120, UPRIGHT),  # 다시 일어남 → 취소
            person(120, UPRIGHT),
        ])
        self.assertNotIn(True, results)

    def test_lying_without_drop_is_not_fall(self):
        # 처음부터 누워 있는 사람(급하강 없음)은 낙상 아님
        results = self.run_frames([person(200, LYING)] * 6)
        self.assertNotIn(True, results)

    def test_walking_upright_is_not_fall(self):
        results = self.run_frames([person(100 + i * 30, UPRIGHT) for i in range(6)])
        self.assertNotIn(True, results)

    def test_required_frames_one_detects_immediately(self):
        self.detector.required_frames = 1
        results = self.run_frames([person(100, UPRIGHT), person(200, LYING)])
        self.assertEqual(results, [False, True])


if __name__ == "__main__":
    unittest.main()
