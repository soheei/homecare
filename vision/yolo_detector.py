from ultralytics import YOLO


class YOLODetector:
    def __init__(
        self,
        model_path="yolov8n.pt",
        confidence=0.5,
    ):
        self.model = YOLO(model_path)
        self.confidence = confidence

    def detect(self, frame):
        """
        한 프레임에서 필요한 객체들을 모두 검출한다.

        반환 예:
        [
            {
                "class_id": 0,
                "label": "person",
                "confidence": 0.91,
                "x1": 100,
                "y1": 50,
                "x2": 300,
                "y2": 450,
                "center_x": 200,
                "center_y": 250,
                "width": 200,
                "height": 400,
            }
        ]
        """

        results = self.model.predict(
            frame,
            conf=self.confidence,
            verbose=False,
        )

        if not results:
            return []

        result = results[0]

        if result.boxes is None or len(result.boxes) == 0:
            return []

        detections = []

        for box in result.boxes:
            class_id = int(box.cls[0])
            confidence = float(box.conf[0])

            x1, y1, x2, y2 = box.xyxy[0].tolist()

            x1 = int(x1)
            y1 = int(y1)
            x2 = int(x2)
            y2 = int(y2)

            width = x2 - x1
            height = y2 - y1

            if width <= 0 or height <= 0:
                continue

            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2

            label = self.model.names[class_id]

            detections.append(
                {
                    "class_id": class_id,
                    "label": label,
                    "confidence": confidence,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                    "center_x": center_x,
                    "center_y": center_y,
                    "width": width,
                    "height": height,
                }
            )

        return detections

    def get_best_person(self, detections):
        persons = [
            d for d in detections
            if d["class_id"] == 0
        ]

        if not persons:
            return None

        return max(
            persons,
            key=lambda d: d["confidence"],
        )
