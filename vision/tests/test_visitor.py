"""방문자 판정 테스트 — 카메라/YOLO 없이 가짜 사람 박스로 검증.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import unittest

from vision.activity_tracker import ActivityTracker
from vision.visitor_detector import VisitorDetector

W, H = 640, 480
PERSON = {"center_x": 320, "center_y": 240, "confidence": 0.9}
OUTSIDE = {"center_x": 600, "center_y": 240, "confidence": 0.9}  # ROI(왼쪽 절반) 밖


def run(detector, frames):
    """frames: 프레임별 사람(dict) 또는 None. True가 나온 프레임 번호 목록을 반환."""
    return [i for i, p in enumerate(frames) if detector.update(p, W, H)]


class VisitorDetectorTest(unittest.TestCase):
    def test_person_staying_fires_once(self):
        # 예전 버그: 계속 서 있으면 카운터가 매 프레임 0으로 돌아가 절대 발생하지 않았음
        d = VisitorDetector(required_frames=3)
        self.assertEqual(run(d, [PERSON] * 20), [2])

    def test_passing_by_is_ignored(self):
        d = VisitorDetector(required_frames=15)
        self.assertEqual(run(d, [PERSON] * 8 + [None] * 10), [])

    def test_brief_detection_misses_do_not_restart(self):
        # YOLO가 4프레임마다 1프레임씩 사람을 놓쳐도 한 번 머문 것으로 봄
        frames = ([PERSON] * 3 + [None]) * 10
        d = VisitorDetector(required_frames=15)
        self.assertEqual(len(run(d, frames)), 1)

    def test_leave_and_come_back_fires_again(self):
        d = VisitorDetector(required_frames=15)
        frames = [PERSON] * 20 + [None] * 10 + [PERSON] * 20
        self.assertEqual(run(d, frames), [14, 44])

    def test_person_outside_roi_is_ignored(self):
        d = VisitorDetector(roi=(0.0, 0.0, 0.5, 1.0), required_frames=3)
        self.assertEqual(run(d, [OUTSIDE] * 20), [])


class ActivityTrackerTest(unittest.TestCase):
    def test_state_events(self):
        t = ActivityTracker(dwell_frames=4, appear_frames=2, lost_frames=2)
        events = [t.update(p) for p in [PERSON] * 5 + [None] * 2 + [PERSON] * 2 + [None] * 2]
        self.assertEqual(
            [e for e in events if e],
            ["appeared", "dwelling", "left", "appeared", "passed"],
        )
        self.assertIs(t.last_person, PERSON)  # 떠난 뒤에도 마지막 위치 기억 (택배 판정용)


if __name__ == "__main__":
    unittest.main()
