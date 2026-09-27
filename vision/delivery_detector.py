class DeliveryDetector:
    # COCO class IDs
    # 24: backpack
    # 26: handbag
    # 28: suitcase

    DELIVERY_CLASS_IDS = {24, 26, 28}

    def __init__(
        self,
        roi=(0.0, 0.0, 1.0, 1.0),
        required_frames=3,
    ):
        self.roi = roi
        self.required_frames = required_frames

        self.candidate_count = 0
        self.last_score = None

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
    ):
        persons = [
            d
            for d in detections
            if d["class_id"] == 0
            and self._inside_roi(
                d,
                frame_width,
                frame_height,
            )
        ]

        delivery_objects = [
            d
            for d in detections
            if d["class_id"] in self.DELIVERY_CLASS_IDS
            and self._inside_roi(
                d,
                frame_width,
                frame_height,
            )
        ]

        candidate = (
            len(persons) > 0
            and len(delivery_objects) > 0
        )

        if not candidate:
            self.candidate_count = 0
            self.last_score = None
            return None

        best_object = max(
            delivery_objects,
            key=lambda d: d["confidence"],
        )

        self.last_score = best_object["confidence"]
        self.candidate_count += 1

        if self.candidate_count >= self.required_frames:
            score = self.last_score

            self.candidate_count = 0
            self.last_score = None

            print("[DELIVERY DETECTED]")

            return score

        return None
