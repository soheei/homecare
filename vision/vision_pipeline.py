import os
import time
from pathlib import Path

import cv2
from picamera2 import Picamera2

from edge.transport.config import load_config
from edge.transport.emit import EventEmitter

from .yolo_detector import YOLODetector
from .fall_detector import FallDetector
from .visitor_detector import VisitorDetector
from .delivery_detector import DeliveryDetector
from .event_recorder import EventRecorder


# ==========================================
# Camera
# ==========================================

FPS = 5
WIDTH = 640
HEIGHT = 480

# ==========================================
# YOLO
# ==========================================

VISION_DIR = Path(__file__).resolve().parent

LOCAL_MODEL = VISION_DIR / "yolov8n.pt"

if LOCAL_MODEL.exists():
    YOLO_MODEL = str(LOCAL_MODEL)
else:
    YOLO_MODEL = "yolov8n.pt"

YOLO_CONFIDENCE = 0.5

# ==========================================
# Fall
# ==========================================

FALL_VERTICAL_THRESHOLD = 15
FALL_ASPECT_RATIO_THRESHOLD = 1.2
FALL_REQUIRED_FRAMES = 1

# ==========================================
# Visitor / Delivery
# ==========================================

DOOR_ROI = (
    0.0,
    0.0,
    1.0,
    1.0,
)

VISITOR_REQUIRED_FRAMES = 3
DELIVERY_REQUIRED_FRAMES = 3

# ==========================================
# Storage
# ==========================================

EVENT_BASE_DIR = os.environ.get(
    "HOMECARE_EVENT_DIR",
    "/mnt/ssd/events",
)

CAMERA_ID = os.environ.get(
    "HOMECARE_CAMERA_ID",
    "camera_01",
)


def main():
    print("====================================")
    print(" HomeCare Vision Pipeline")
    print("====================================")

    # --------------------------------------
    # Edge
    # --------------------------------------

    cfg = load_config()

    emitter = EventEmitter(cfg)
    emitter.start()

    # --------------------------------------
    # YOLO
    # --------------------------------------

    detector = YOLODetector(
        model_path=YOLO_MODEL,
        confidence=YOLO_CONFIDENCE,
    )

    # --------------------------------------
    # Detectors
    # --------------------------------------

    fall_detector = FallDetector(
        vertical_threshold=FALL_VERTICAL_THRESHOLD,
        aspect_ratio_threshold=FALL_ASPECT_RATIO_THRESHOLD,
        required_frames=FALL_REQUIRED_FRAMES,
    )

    visitor_detector = VisitorDetector(
        roi=DOOR_ROI,
        required_frames=VISITOR_REQUIRED_FRAMES,
    )

    delivery_detector = DeliveryDetector(
        roi=DOOR_ROI,
        required_frames=DELIVERY_REQUIRED_FRAMES,
    )

    # --------------------------------------
    # Recorder
    # --------------------------------------

    recorder = EventRecorder(
        base_dir=EVENT_BASE_DIR,
        camera_id=CAMERA_ID,
        fps=FPS,
        pre_seconds=3,
        post_seconds=3,
    )

    # --------------------------------------
    # Camera
    # --------------------------------------

    picam2 = Picamera2()

    camera_config = (
        picam2.create_video_configuration(
            main={
                "size": (WIDTH, HEIGHT),
                "format": "RGB888",
            },
            controls={
                "FrameRate": FPS,
            },
        )
    )

    picam2.configure(camera_config)
    picam2.start()

    time.sleep(2)

    print("[CAMERA STARTED]")
    print("[YOLO STARTED]")
    print("[VISION STARTED]")
    print(f"[EVENT DIR] {EVENT_BASE_DIR}")
    print(f"[CAMERA ID] {CAMERA_ID}")
    print("Ctrl+C to stop")

    try:
        while True:

            # ==================================
            # 1. Camera Frame
            # ==================================

            frame = picam2.capture_array()

            frame = cv2.cvtColor(
                frame,
                cv2.COLOR_RGB2BGR,
            )

            frame_height, frame_width = (
                frame.shape[:2]
            )

            # ==================================
            # 2. Event Recording
            # ==================================

            saved_event = recorder.update(
                frame
            )

            # ==================================
            # 3. 저장 완료된 이벤트 -> edge
            # ==================================

            if saved_event is not None:

                print(
                    "[EVENT READY FOR EDGE]"
                )

                uid = emitter.emit(
                    category_id=saved_event[
                        "event_type"
                    ],
                    source="vision",
                    score=saved_event.get(
                        "score"
                    ),
                    description=None,
                    image_path=saved_event[
                        "thumbnail_path"
                    ],
                    video_path=saved_event[
                        "video_path"
                    ],
                    extra={
                        "camera_id": CAMERA_ID,
                        "vision_event":
                            saved_event[
                                "event_type"
                            ],
                    },
                    occurred_at=saved_event[
                        "event_time"
                    ],
                )

                print(
                    f"[EDGE EMIT] uid={uid}"
                )

            # ==================================
            # 4. YOLO
            # ==================================

            detections = detector.detect(
                frame
            )

            person = detector.get_best_person(
                detections
            )

            # ==================================
            # 5. Fall
            # ==================================

            fall_detected = (
                fall_detector.update(
                    person
                )
            )

            # ==================================
            # 6. Visitor
            # ==================================

            visitor_detected = (
                visitor_detector.update(
                    person,
                    frame_width,
                    frame_height,
                )
            )

            # ==================================
            # 7. Delivery
            # ==================================

            delivery_score = (
                delivery_detector.update(
                    detections,
                    frame_width,
                    frame_height,
                )
            )

            # ==================================
            # 8. Event Priority
            #
            # 위험 > 택배 > 방문자
            # ==================================

            if not recorder.recording:

                # ------------------------------
                # Danger: Fall
                # ------------------------------

                if fall_detected:

                    score = None

                    if person is not None:
                        score = person[
                            "confidence"
                        ]

                    print(
                        "================================"
                    )

                    print(
                        "[VISION EVENT]"
                        " FALL DETECTED"
                    )

                    print(
                        "================================"
                    )

                    recorder.start_event(
                        event_type="fall_suspect",
                        frame=frame,
                        score=score,
                    )

                # ------------------------------
                # Normal: Delivery
                # ------------------------------

                elif delivery_score is not None:

                    print(
                        "================================"
                    )

                    print(
                        "[VISION EVENT]"
                        " DELIVERY DETECTED"
                    )

                    print(
                        "================================"
                    )

                    recorder.start_event(
                        event_type="delivery_suspect",
                        frame=frame,
                        score=delivery_score,
                    )

                # ------------------------------
                # Normal: Visitor
                # ------------------------------

                elif visitor_detected:

                    score = None

                    if person is not None:
                        score = person[
                            "confidence"
                        ]

                    print(
                        "================================"
                    )

                    print(
                        "[VISION EVENT]"
                        " VISITOR DETECTED"
                    )

                    print(
                        "================================"
                    )

                    recorder.start_event(
                        event_type="door_visitor",
                        frame=frame,
                        score=score,
                    )

    except KeyboardInterrupt:
        print(
            "\n[STOP] "
            "Vision pipeline stopped"
        )

    finally:

        print("[CLEANUP]")

        try:
            picam2.stop()
        except Exception:
            pass

        try:
            emitter.stop()
        except Exception:
            pass

        print("[EXIT]")


if __name__ == "__main__":
    main()
