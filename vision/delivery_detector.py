import cv2
import numpy as np

from .activity_tracker import ActivityTracker


class DeliveryDetector:
    """
    택배 감지 = "사람이 와서 무언가를 두고 떠났다" (두고 간 물체 감지)

    YOLO 기본 모델(COCO)에는 상자 클래스가 없어서, 물체 종류 대신
    사람이 오기 직전 배경과 떠난 뒤 화면을 비교해 새로 생긴 물체를 찾는다.

    1. 사람 없음 : 배경을 천천히 갱신 (서서히 바뀌는 조명은 따라감)
    2. 사람 등장 : 배경 고정
    3. 사람 퇴장 : 최대 WATCH_FRAMES 동안 배경과 비교해,
                   사람이 있던 자리 근처에 새 덩어리가
                   required_frames 연속으로 보이면 택배
       - 화면 대부분이 바뀌면(조명 켜짐, 문 열림) 무시하고 배경을 새로 잡음
       - 그 사이 사람이 다시 나타나면 확인 중단
    4. 택배 확정 : 그 물체를 배경에 포함 (같은 물체로 반복 발생하지 않음)
    """

    PROC_SIZE = (160, 120)        # 비교용 축소 크기 (Pi 부담·잡음 감소)
    DIFF_THRESHOLD = 35           # 배경 대비 밝기 차이 기준 (0~255)
    MIN_AREA_RATIO = 0.004        # 화면 대비 물체 최소 크기
    MAX_AREA_RATIO = 0.25         # 화면 대비 물체 최대 크기
    GLOBAL_CHANGE_RATIO = 0.4     # 화면의 40% 이상이 바뀌면 조명 변화로 보고 무시
    BG_ALPHA = 0.05               # 사람이 없을 때 배경 갱신 속도
    WATCH_FRAMES = 50             # 퇴장 후 확인 시간 (5fps 기준 10초)
    REGION_MARGIN = 0.5           # 사람 박스 주변으로 넓혀서 볼 비율

    def __init__(
        self,
        roi=(0.0, 0.0, 1.0, 1.0),
        required_frames=3,
    ):
        """
        roi:
            (x1, y1, x2, y2), 0~1 비율. 이 안의 사람/물체만 본다.

        required_frames:
            새 물체가 연속 이만큼 보여야 택배로 확정.
        """

        self.roi = roi
        self.required_frames = required_frames

        self.tracker = ActivityTracker()

        self.background = None     # float32, PROC_SIZE 흑백
        self.watch_left = 0
        self.stable_count = 0
        self.region = None         # 사람이 있던 자리 (축소 좌표)

    def reset(self):
        self.tracker = ActivityTracker()
        self.background = None
        self.watch_left = 0
        self.stable_count = 0
        self.region = None

    def _inside_roi(
        self,
        detection,
        frame_width,
        frame_height,
    ):
        center_x = detection["center_x"]
        center_y = detection["center_y"]

        x1, y1, x2, y2 = self.roi

        roi_x1 = frame_width * x1
        roi_y1 = frame_height * y1
        roi_x2 = frame_width * x2
        roi_y2 = frame_height * y2

        return (
            roi_x1 <= center_x <= roi_x2
            and roi_y1 <= center_y <= roi_y2
        )

    def update(
        self,
        detections,
        frame_width,
        frame_height,
        frame=None,
    ):
        """택배로 확정되면 점수(0~1), 아니면 None."""

        if frame is None:
            return None

        gray = self._prepare(frame)

        persons = [
            d
            for d in detections
            if d["class_id"] == 0
        ]

        persons_in_roi = [
            d
            for d in persons
            if self._inside_roi(
                d,
                frame_width,
                frame_height,
            )
        ]

        person = max(
            persons_in_roi,
            key=lambda d: d["confidence"],
        ) if persons_in_roi else None

        event = self.tracker.update(person)

        # 사람이 떠남 (머물렀든 잠깐 들렀든) → 두고 간 물체 확인 시작
        if event in ("left", "passed") and self.background is not None:
            self.watch_left = self.WATCH_FRAMES
            self.stable_count = 0
            self.region = self._person_region(
                self.tracker.last_person,
                frame_width,
                frame_height,
            )

        if self.watch_left > 0:
            return self._watch(gray, persons)

        # 화면에 사람이 없을 때만 배경 갱신
        if not persons and not self.tracker.present:
            self._update_background(gray)

        return None

    def _watch(self, gray, persons):
        # 사람이 다시 나타나면 확인 중단 (새 방문으로 추적기가 처리)
        if persons:
            self._stop_watch()
            return None

        self.watch_left -= 1

        score, global_change = self._find_left_object(gray)

        if global_change:
            print("[DELIVERY] large scene change (lighting?) - ignored")
            self.background = gray.astype(np.float32)
            self._stop_watch()
            return None

        self.stable_count = self.stable_count + 1 if score is not None else 0

        if self.stable_count >= self.required_frames:
            print(f"[DELIVERY DETECTED] score={score:.2f}")

            # 두고 간 물체를 배경에 포함 → 같은 물체로 반복 발생 방지
            self.background = gray.astype(np.float32)
            self._stop_watch()

            return score

        if self.watch_left == 0:
            self.background = gray.astype(np.float32)
            self._stop_watch()

        return None

    def _stop_watch(self):
        self.watch_left = 0
        self.stable_count = 0
        self.region = None

    def _prepare(self, frame):
        if frame.ndim == 3:
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        small = cv2.resize(frame, self.PROC_SIZE)

        return cv2.GaussianBlur(small, (5, 5), 0)

    def _update_background(self, gray):
        if self.background is None:
            self.background = gray.astype(np.float32)
            return

        cv2.accumulateWeighted(
            gray,
            self.background,
            self.BG_ALPHA,
        )

    def _person_region(self, person, frame_width, frame_height):
        """사람이 서 있던 자리(주변 포함)를 축소 좌표로. 박스 정보가 없으면 None(화면 전체)."""

        if person is None or "x1" not in person:
            return None

        sx = self.PROC_SIZE[0] / frame_width
        sy = self.PROC_SIZE[1] / frame_height

        mw = person["width"] * self.REGION_MARGIN
        mh = person["height"] * self.REGION_MARGIN

        return (
            (person["x1"] - mw) * sx,
            (person["y1"] - mh) * sy,
            (person["x2"] + mw) * sx,
            (person["y2"] + mh) * sy,
        )

    def _find_left_object(self, gray):
        """(점수 또는 None, 화면 대부분이 바뀌었는지)"""

        background = cv2.convertScaleAbs(self.background)
        diff = cv2.absdiff(gray, background)

        _, mask = cv2.threshold(
            diff,
            self.DIFF_THRESHOLD,
            255,
            cv2.THRESH_BINARY,
        )

        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_OPEN,
            np.ones((3, 3), np.uint8),
        )

        total = mask.shape[0] * mask.shape[1]

        if cv2.countNonZero(mask) > total * self.GLOBAL_CHANGE_RATIO:
            return None, True

        contours, _ = cv2.findContours(
            mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )

        best = None

        for contour in contours:
            area = cv2.contourArea(contour)

            if not (
                total * self.MIN_AREA_RATIO
                <= area
                <= total * self.MAX_AREA_RATIO
            ):
                continue

            x, y, w, h = cv2.boundingRect(contour)
            cx = x + w / 2
            cy = y + h / 2

            if not self._in_watch_area(cx, cy):
                continue

            blob = diff[y:y + h, x:x + w][mask[y:y + h, x:x + w] > 0]

            # 배경과 뚜렷하게 다를수록 높은 점수 (밝기 차이 100 이상이면 1.0)
            score = min(1.0, float(blob.mean()) / 100)

            if best is None or score > best:
                best = score

        return best, False

    def _in_watch_area(self, cx, cy):
        pw, ph = self.PROC_SIZE
        x1, y1, x2, y2 = self.roi

        if not (x1 * pw <= cx <= x2 * pw and y1 * ph <= cy <= y2 * ph):
            return False

        if self.region is None:
            return True

        rx1, ry1, rx2, ry2 = self.region

        return rx1 <= cx <= rx2 and ry1 <= cy <= ry2
