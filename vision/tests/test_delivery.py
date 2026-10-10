"""택배(두고 간 물체) 판정 테스트 — 카메라/YOLO 없이 합성 프레임 + 가짜 사람 박스로 검증.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import contextlib
import io
import unittest

import numpy as np

from vision.delivery_detector import DeliveryDetector

W, H = 640, 480
BG = 100
PERSON = {
    "class_id": 0, "confidence": 0.9,
    "x1": 250, "y1": 100, "x2": 390, "y2": 420,
    "center_x": 320, "center_y": 260, "width": 140, "height": 320,
}
rng = np.random.default_rng(0)


def frame(person=False, package=None, brightness=0, packages=()):
    """배경(밝기 100 + 약한 잡음) 위에 사람/상자를 그린 BGR 프레임."""
    img = np.full((H, W), BG + brightness, dtype=np.int16)
    img += rng.integers(-5, 6, size=(H, W), dtype=np.int16)
    if person:
        img[PERSON["y1"]:PERSON["y2"], PERSON["x1"]:PERSON["x2"]] = 200
    for x1, y1, x2, y2 in ([package] if package else []) + list(packages):
        img[y1:y2, x1:x2] = 180
    img = np.clip(img, 0, 255).astype(np.uint8)
    return np.dstack([img] * 3)


AT_FEET = (280, 380, 360, 440)      # 사람이 서 있던 발밑
FAR_CORNER = (20, 20, 90, 80)       # 사람과 먼 구석


def run(detector, frames):
    """frames: (detections, frame) 목록. 택배 점수가 나온 (프레임 번호, 점수) 목록."""
    hits = []
    with contextlib.redirect_stdout(io.StringIO()):
        for i, (dets, img) in enumerate(frames):
            score = detector.update(dets, W, H, frame=img)
            if score is not None:
                hits.append((i, score))
    return hits


def visit(after, n_after=30, n_empty=10, n_person=10):
    """빈 화면 → 사람 방문 → 사람 떠난 뒤 after(i) 프레임."""
    return (
        [([], frame()) for _ in range(n_empty)]
        + [([PERSON], frame(person=True)) for _ in range(n_person)]
        + [after(i) for i in range(n_after)]
    )


class DeliveryDetectorTest(unittest.TestCase):
    def test_package_left_at_feet_is_detected_once(self):
        d = DeliveryDetector(required_frames=10)
        hits = run(d, visit(lambda i: ([], frame(package=AT_FEET)), n_after=80))
        self.assertEqual(len(hits), 1)
        self.assertAlmostEqual(hits[0][1], 0.8, delta=0.1)  # 밝기 차이 80 → 0.8

    def test_nothing_left_is_not_delivery(self):
        d = DeliveryDetector(required_frames=10)
        self.assertEqual(run(d, visit(lambda i: ([], frame()))), [])

    def test_lighting_change_is_ignored(self):
        d = DeliveryDetector(required_frames=10)
        self.assertEqual(run(d, visit(lambda i: ([], frame(brightness=80)))), [])

    def test_object_far_from_person_is_ignored(self):
        d = DeliveryDetector(required_frames=10)
        self.assertEqual(run(d, visit(lambda i: ([], frame(package=FAR_CORNER)))), [])

    def test_person_coming_back_stops_check(self):
        # 떠난 직후 다시 돌아와 계속 서 있으면(상자는 발밑에) 택배로 확정하지 않음
        d = DeliveryDetector(required_frames=10)
        back = lambda i: (  # noqa: E731
            ([], frame(package=AT_FEET)) if i < 7 else ([PERSON], frame(person=True, package=AT_FEET))
        )
        self.assertEqual(run(d, visit(back)), [])

    def test_without_frame_returns_none(self):
        d = DeliveryDetector()
        self.assertIsNone(d.update([PERSON], W, H))

    def test_alternating_locations_do_not_accumulate(self):
        d = DeliveryDetector(required_frames=10)
        boxes = ((220, 380, 280, 440), (360, 380, 420, 440))
        hits = run(d, visit(lambda i: ([], frame(package=boxes[i % 2])), n_after=60))
        self.assertEqual(hits, [])

    def test_slowly_moving_object_does_not_accumulate(self):
        d = DeliveryDetector(required_frames=10)
        def after(i):
            x = 220 + (i % 25) * 4
            return [], frame(package=(x, 380, x + 80, 440))
        self.assertEqual(run(d, visit(after, n_after=60)), [])

    def test_small_position_jitter_is_tolerated(self):
        d = DeliveryDetector(required_frames=10)
        def after(i):
            dx = (-2, 0, 2)[i % 3]
            return [], frame(package=(280 + dx, 380, 360 + dx, 440))
        self.assertEqual(len(run(d, visit(after))), 1)

    def test_changing_size_does_not_accumulate(self):
        d = DeliveryDetector(required_frames=10)
        boxes = ((290, 380, 350, 440), (260, 350, 380, 470))
        self.assertEqual(run(d, visit(lambda i: ([], frame(package=boxes[i % 2])))), [])

    def test_missing_object_restarts_confirmation(self):
        d = DeliveryDetector(required_frames=10)
        hits = run(d, visit(lambda i: ([], frame(package=None if i == 9 else AT_FEET))))
        self.assertEqual(len(hits), 1)
        # 10 empty + 10 visitor frames, then observations 10..19 after the gap.
        self.assertEqual(hits[0][0], 39)

    def test_stationary_package_with_moving_second_object(self):
        d = DeliveryDetector(required_frames=10)
        def after(i):
            x = 200 + (i % 20) * 4
            return [], frame(package=AT_FEET, packages=[(x, 200, x + 60, 260)])
        self.assertEqual(len(run(d, visit(after))), 1)

    def test_floor_roi_does_not_require_person_center_at_floor(self):
        # Person center y=260 is outside the floor ROI, but the package is inside.
        d = DeliveryDetector(required_frames=10, object_roi=(0.0, 0.75, 1.0, 1.0))
        self.assertEqual(len(run(d, visit(lambda i: ([], frame(package=AT_FEET))))), 1)

    def test_object_outside_floor_roi_is_ignored(self):
        d = DeliveryDetector(required_frames=10, object_roi=(0.0, 0.75, 1.0, 1.0))
        above_floor = (280, 200, 360, 260)
        self.assertEqual(run(d, visit(lambda i: ([], frame(package=above_floor)))), [])

    def test_omitted_object_roi_preserves_existing_roi(self):
        d = DeliveryDetector(roi=(0.0, 0.0, 1.0, 0.7), required_frames=10)
        self.assertEqual(run(d, visit(lambda i: ([], frame(package=AT_FEET)))), [])

    def test_missing_frame_restarts_confirmation(self):
        d = DeliveryDetector(required_frames=10)
        self.assertEqual(run(d, visit(lambda i: ([], frame(package=AT_FEET)), n_after=9)), [])
        self.assertIsNone(d.update([], W, H, frame=None))
        hits = run(d, [([], frame(package=AT_FEET)) for _ in range(10)])
        self.assertEqual([index for index, _ in hits], [9])

    def test_reset_discards_background_and_candidates(self):
        d = DeliveryDetector(required_frames=10)
        run(d, visit(lambda i: ([], frame(package=AT_FEET)), n_after=9))
        d.reset()
        self.assertIsNone(d.background)
        self.assertEqual(d.object_candidates, [])
        self.assertEqual(d.stable_count, 0)
        self.assertEqual(d.watch_left, 0)
        self.assertEqual(run(d, [([], frame(package=AT_FEET)) for _ in range(20)]), [])

    def test_person_return_discards_existing_candidates(self):
        d = DeliveryDetector(required_frames=10)
        run(d, visit(lambda i: ([], frame(package=AT_FEET)), n_after=9))
        run(d, [([PERSON], frame(person=True, package=AT_FEET))])
        self.assertEqual(d.object_candidates, [])
        self.assertEqual(d.stable_count, 0)
        self.assertEqual(d.watch_left, 0)


if __name__ == "__main__":
    unittest.main()
