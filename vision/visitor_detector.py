class VisitorDetector:
    def __init__(
        self,
        roi=(0.0, 0.0, 1.0, 1.0),
        required_frames=3,
    ):
        """
        roi:
            (x1, y1, x2, y2)
            모두 0~1 사이의 비율.

        기본값:
            전체 화면
        """

        self.roi = roi
        self.required_frames = required_frames

        self.inside = False
        self.enter_count = 0

    def _inside_roi(
        self,
        person,
        frame_width,
        frame_height,
    ):
        if person is None:
            return False

        center_x = person["center_x"]
        center_y = person["center_y"]

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
        person,
        frame_width,
        frame_height,
    ):
        is_inside = self._inside_roi(
            person,
            frame_width,
            frame_height,
        )

        # 사람이 ROI 밖
        if not is_inside:
            self.inside = False
            self.enter_count = 0
            return False

        # 새롭게 들어온 경우
        if not self.inside:
            self.enter_count += 1
        else:
            self.enter_count = 0

        self.inside = True

        if self.enter_count >= self.required_frames:
            self.enter_count = 0

            print("[VISITOR DETECTED]")

            return True

        return False
