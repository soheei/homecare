import dataclasses
import logging
import os
import time
from pathlib import Path

import cv2
from picamera2 import Picamera2

from edge.transport.config import load_config
from edge.transport.emit import EventEmitter

from . import camera_service
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

VISITOR_REQUIRED_FRAMES = 15   # 5fps 기준 3초 머물러야 방문자 (그 전에 사라지면 지나감)
DELIVERY_REQUIRED_FRAMES = 10  # 사람이 떠난 뒤 새 물체가 5fps 기준 2초 연속 보이면 택배

# ==========================================
# Storage
# ==========================================

DEFAULT_EVENT_DIR = "/mnt/ssd/events"
DEFAULT_CAMERA_ID = "camera_01"

# ==========================================
# Camera service (하트비트 / 현재 화면 보기)
# ==========================================

DEFAULT_HEARTBEAT_INTERVAL_SEC = 20.0


def read_settings():
    """
    환경변수 설정값을 읽는다. edge/.env는 load_config()에서 로드되므로
    반드시 load_config() 이후에 호출해야 .env에 적은 값이 반영된다.

    HOMECARE_EVENT_DIR가 상대 경로(예: edge/data/events)면
    실행 위치와 상관없이 저장소 루트 기준으로 해석한다.
    """

    event_dir = Path(
        os.environ.get("HOMECARE_EVENT_DIR", DEFAULT_EVENT_DIR)
    )

    if not event_dir.is_absolute():
        event_dir = VISION_DIR.parent / event_dir

    return {
        "event_dir": str(event_dir),
        "camera_id": os.environ.get(
            "HOMECARE_CAMERA_ID",
            DEFAULT_CAMERA_ID,
        ),
        "heartbeat_interval_sec": float(
            os.environ.get(
                "HOMECARE_CAMERA_CHECK_INTERVAL_SEC",
                DEFAULT_HEARTBEAT_INTERVAL_SEC,
            )
        ),
    }


def main():
    print("====================================")
    print(" HomeCare Vision Pipeline")
    print("====================================")

    # --------------------------------------
    # Edge
    # --------------------------------------

    # 하트비트/캡처/전송 로그(logging)를 터미널·journalctl에 출력
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    cfg = load_config()

    # .env 로드 이후에 읽어야 HOMECARE_EVENT_DIR 등 .env 값이 반영됨
    settings = read_settings()
    event_base_dir = settings["event_dir"]
    camera_id = settings["camera_id"]

    # vision은 카메라 서비스 — 이벤트·하트비트는 마이크가 아니라 카메라 기기 id로,
    # 전송 큐도 마이크(edge/data/)와 분리 (같은 큐면 마이크 쪽 sender가 마이크 id로 보내버림)
    camera_device_id = os.environ.get("HOMECARE_CAMERA_DEVICE_ID")

    if not camera_device_id:
        print("설정 오류: HOMECARE_CAMERA_DEVICE_ID 누락 (edge/.env.example 참고)")
        return 2

    cfg = dataclasses.replace(
        cfg,
        device_id=camera_device_id,
        outbox_dir=cfg.outbox_dir / "vision",
    )

    emitter = EventEmitter(cfg)
    emitter.start()

    latest_frame = camera_service.LatestFrame()
    service_stops = []

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
        base_dir=event_base_dir,
        camera_id=camera_id,
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

    # 카메라가 열린 뒤에 시작 (카메라를 못 열면 하트비트도 안 나감)
    service_stops = camera_service.start(
        cfg,
        latest_frame,
        interval_sec=settings["heartbeat_interval_sec"],
    )

    print("[CAMERA STARTED]")
    print("[YOLO STARTED]")
    print("[VISION STARTED]")
    print(f"[EVENT DIR] {event_base_dir}")
    print(f"[CAMERA ID] {camera_id}")
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

            # 하트비트 / "현재 화면 보기"용 최신 프레임
            latest_frame.set(frame)

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
                        "camera_id": camera_id,
                        "vision_event":
                            saved_event[
                                "event_type"
                            ],
                    },
                    occurred_at=saved_event[
                        "event_time"
                    ],
                    # 전송 성공하면 Pi 원본(영상·썸네일) 삭제 — Storage에 올라갔으므로.
                    # 최종 실패하면 원본은 남겨 둔다.
                    delete_originals_on_sent=True,
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
                    frame=frame,
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

        for stop in service_stops:
            stop.set()

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
    raise SystemExit(main())
