from .activity_tracker import ActivityTracker


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

        required_frames:
            ROI 안에 이만큼 머물러야 방문자로 판단 (한 번 머무는 동안 1회).
            그 전에 사라지면 그냥 지나간 것으로 보고 무시한다.
        """

        self.roi = roi
        self.required_frames = required_frames

        self.tracker = ActivityTracker(
            dwell_frames=required_frames,
        )

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

        # ROI 밖의 사람은 없는 것으로 본다
        event = self.tracker.update(
            person if is_inside else None
        )

        if event == "passed":
            print("[VISITOR] passed by (ignored)")

        if event == "dwelling":
            print("[VISITOR DETECTED]")

            return True

        return False
