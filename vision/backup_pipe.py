import dataclasses
import logging
import os
import shutil
import time

from datetime import datetime
from pathlib import Path

import cv2
from picamera2 import Picamera2

from edge.transport.av_share import AVShare
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

# 최종 FallDetector 설정
#
# 5 FPS 기준:
# - 최근 4프레임의 이동을 확인
# - 약 0.6초 동안 35px 이상 아래로 이동하면 낙상 후보
# - 이후 움직임이 줄어드는 상태가 2프레임 유지되면 낙상 판정

FALL_HISTORY_FRAMES = 4
FALL_DROP_THRESHOLD = 35
FALL_CANDIDATE_FRAMES = 2
FALL_MOVEMENT_THRESHOLD = 8


# ==========================================
# Visitor / Delivery
# ==========================================

DOOR_ROI = (
    0.0,
    0.0,
    1.0,
    1.0,
)

VISITOR_REQUIRED_FRAMES = 15
DELIVERY_REQUIRED_FRAMES = 10


# ==========================================
# Storage
# ==========================================

DEFAULT_EVENT_DIR = "/mnt/ssd/events"
DEFAULT_CAMERA_ID = "camera_01"


# ==========================================
# Camera service
# ==========================================

DEFAULT_HEARTBEAT_INTERVAL_SEC = 20.0


# ==========================================
# Microphone integration
# ==========================================

SOUND_REQUEST_MAX_AGE_SEC = 3.0


def read_settings():
    """
    환경변수 설정값을 읽는다.

    edge/.env는 load_config()에서 로드되므로
    반드시 load_config() 이후에 호출해야 한다.

    HOMECARE_EVENT_DIR가 상대 경로면
    저장소 루트 기준으로 해석한다.
    """

    event_dir = Path(
        os.environ.get(
            "HOMECARE_EVENT_DIR",
            DEFAULT_EVENT_DIR,
        )
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


def emit_saved_event(
    emitter,
    saved_event,
    camera_id,
):
    """
    저장된 이벤트를 전송 큐에 넣는다.

    emit()이 첨부 파일을 outbox로 복사한 뒤 반환하므로
    Pi의 원본 영상/썸네일은 삭제한다.
    """

    try:
        return emitter.emit(
            category_id=saved_event["event_type"],
            source="vision",
            score=saved_event.get("score"),
            description=None,
            image_path=saved_event["thumbnail_path"],
            video_path=saved_event["video_path"],
            extra={
                "camera_id": camera_id,
                "vision_event": saved_event[
                    "event_type"
                ],
                "video_has_audio": bool(
                    saved_event.get("has_audio")
                ),
            },
            occurred_at=saved_event["event_time"],
        )

    finally:
        # 원본 영상과 썸네일 삭제
        for key in (
            "video_path",
            "thumbnail_path",
        ):
            try:
                Path(
                    saved_event[key]
                ).unlink(
                    missing_ok=True
                )
            except OSError:
                pass


def publish_sound_clip(
    av_share,
    saved_event,
):
    """
    소리 이벤트 녹화 요청으로 만들어진
    카메라 영상을 마이크 프로세스에 넘긴다.

    마이크 쪽에서 wav와 함께 하나의 이벤트로 전송한다.
    """

    av_share.publish_video_result(
        saved_event["request_id"],
        saved_event["video_path"],
    )

    Path(
        saved_event["thumbnail_path"]
    ).unlink(
        missing_ok=True
    )


def detected_vision_event(
    fall_detected,
    delivery_score,
    visitor_detected,
    person,
):
    """
    영상 이벤트 우선순위:

    위험 > 택배 > 방문자
    """

    person_score = (
        person["confidence"]
        if person is not None
        else None
    )

    if fall_detected:
        return "fall_suspect", person_score

    if delivery_score is not None:
        return "delivery_suspect", delivery_score

    if visitor_detected:
        return "visitor_detected", person_score

    return None


def emit_deferred_vision_event(
    emitter,
    saved_event,
    deferred,
    camera_id,
):
    """
    소리 이벤트 녹화 중 감지된
    영상 이벤트를 같은 영상으로 전송한다.

    녹화기가 하나이기 때문에
    소리 이벤트 영상 녹화 중에는
    별도 영상을 새로 녹화하지 않는다.
    """

    video_copy = (
        saved_event["video_path"]
        + ".vision.mp4"
    )

    thumb_copy = (
        saved_event["thumbnail_path"]
        + ".vision.jpg"
    )

    try:
        shutil.copyfile(
            saved_event["video_path"],
            video_copy,
        )

        cv2.imwrite(
            thumb_copy,
            deferred["frame"],
        )

    except OSError as e:
        print(
            f"[WARN] "
            f"deferred vision event copy failed: {e}"
        )
        return None

    return emit_saved_event(
        emitter,
        {
            "video_path": video_copy,
            "thumbnail_path": thumb_copy,
            "event_type": deferred["event_type"],
            "event_time": deferred["event_time"],
            "score": deferred["score"],
            "has_audio": saved_event.get(
                "has_audio"
            ),
        },
        camera_id,
    )


def handle_sound_requests(
    av_share,
    recorder,
    frame,
    now,
):
    """
    마이크 프로세스에서 들어온
    카메라 영상 녹화 요청을 처리한다.
    """

    started = None

    for req in av_share.poll_video_requests():

        trigger_time = (
            req.get("trigger_time") or 0
        )

        too_old = (
            now - float(trigger_time)
            > SOUND_REQUEST_MAX_AGE_SEC
        )

        # 이미 녹화 중이거나 너무 늦은 요청
        if recorder.recording or too_old:

            print(
                f"[SOUND REQUEST REJECTED] "
                f"{req.get('category_id')} "
                f"({'too old' if too_old else 'busy'})"
            )

            av_share.publish_video_result(
                req["id"],
                None,
            )

            continue

        print(
            f"[SOUND EVENT] "
            f"{req.get('category_id')} "
            f"-> recording with audio"
        )

        recorder.start_event(
            event_type=req.get(
                "category_id"
            ),
            frame=frame,
            score=req.get("score"),
            post_seconds=req.get("post_sec"),
            request_id=req["id"],
        )

        started = req["id"]

    return started


def main():

    print("====================================")
    print(" HomeCare Vision Pipeline")
    print("====================================")

    # ==================================
    # Logging
    # ==================================

    logging.basicConfig(
        level=logging.INFO,
        format=(
            "%(asctime)s "
            "%(levelname)s "
            "%(name)s: %(message)s"
        ),
    )

    # ==================================
    # Edge config
    # ==================================

    cfg = load_config()

    settings = read_settings()

    event_base_dir = settings[
        "event_dir"
    ]

    camera_id = settings[
        "camera_id"
    ]

    # ==================================
    # Camera Device ID
    # ==================================

    camera_device_id = os.environ.get(
        "HOMECARE_CAMERA_DEVICE_ID"
    )

    if not camera_device_id:

        print(
            "설정 오류: "
            "HOMECARE_CAMERA_DEVICE_ID 누락 "
            "(edge/.env.example 참고)"
        )

        return 2

    # 카메라 전용 outbox
    cfg = dataclasses.replace(
        cfg,
        device_id=camera_device_id,
        outbox_dir=(
            cfg.outbox_dir / "vision"
        ),
    )

    # ==================================
    # EventEmitter
    # ==================================

    emitter = EventEmitter(cfg)
    emitter.start()

    # ==================================
    # Latest frame / camera service
    # ==================================

    latest_frame = (
        camera_service.LatestFrame()
    )

    service_stops = []

    # ==================================
    # Audio/Video Share
    # ==================================

    av_share = AVShare()

    # 소리 이벤트 녹화 중 발생한
    # 영상 이벤트 보관
    deferred_vision_event = None

    # ==================================
    # YOLO
    # ==================================

    detector = YOLODetector(
        model_path=YOLO_MODEL,
        confidence=YOLO_CONFIDENCE,
    )

    # ==================================
    # Fall Detector
    # ==================================

    fall_detector = FallDetector(
        history_frames=FALL_HISTORY_FRAMES,
        drop_threshold=FALL_DROP_THRESHOLD,
        candidate_frames=FALL_CANDIDATE_FRAMES,
        movement_threshold=FALL_MOVEMENT_THRESHOLD,
    )

    # ==================================
    # Visitor Detector
    # ==================================

    visitor_detector = (
        VisitorDetector(
            roi=DOOR_ROI,
            required_frames=(
                VISITOR_REQUIRED_FRAMES
            ),
        )
    )

    # ==================================
    # Delivery Detector
    # ==================================

    delivery_detector = (
        DeliveryDetector(
            roi=DOOR_ROI,
            required_frames=(
                DELIVERY_REQUIRED_FRAMES
            ),
        )
    )

    # ==================================
    # Event Recorder
    # ==================================

    recorder = EventRecorder(
        base_dir=event_base_dir,
        camera_id=camera_id,
        fps=FPS,
        pre_seconds=3,
        post_seconds=3,
        audio_source=av_share.read_audio,
    )

    # ==================================
    # Camera
    # ==================================

    picam2 = Picamera2()

    camera_config = (
        picam2.create_video_configuration(
            main={
                "size": (
                    WIDTH,
                    HEIGHT,
                ),
                "format": "RGB888",
            },
            controls={
                "FrameRate": FPS,
            },
        )
    )

    picam2.configure(
        camera_config
    )

    picam2.start()

    time.sleep(2)

    # 카메라가 열린 후
    # 하트비트 서비스 시작
    service_stops = camera_service.start(
        cfg,
        latest_frame,
        interval_sec=(
            settings[
                "heartbeat_interval_sec"
            ]
        ),
    )

    print("[CAMERA STARTED]")
    print("[YOLO STARTED]")
    print("[VISION STARTED]")
    print(
        f"[EVENT DIR] {event_base_dir}"
    )
    print(
        f"[CAMERA ID] {camera_id}"
    )
    print(
        f"[AV SHARE] {av_share.root}"
    )
    print("Ctrl+C to stop")

    try:

        while True:

            # ==================================
            # 1. Camera Frame
            # ==================================

            # Picamera2 RGB888은
            # OpenCV에서 바로 사용할 수 있는
            # BGR 배열을 반환한다.
            #
            # 따라서 RGB2BGR 변환을 하지 않는다.

            frame = picam2.capture_array()

            frame_time = time.time()

            frame_height, frame_width = (
                frame.shape[:2]
            )

            # ==================================
            # 2. Latest frame / heartbeat
            # ==================================

            latest_frame.set(
                frame
            )

            av_share.mark_vision_alive()

            # ==================================
            # 3. Event Recording
            # ==================================

            saved_event = recorder.update(
                frame,
                frame_time,
            )

            # ==================================
            # 4. Saved Event
            # ==================================

            if (
                saved_event is not None
                and saved_event.get(
                    "request_id"
                )
            ):

                # 소리 이벤트 녹화 중에
                # 영상 이벤트가 발생했던 경우
                if (
                    deferred_vision_event
                    is not None
                ):

                    uid = (
                        emit_deferred_vision_event(
                            emitter,
                            saved_event,
                            deferred_vision_event,
                            camera_id,
                        )
                    )

                    print(
                        "[EDGE EMIT] "
                        f"{deferred_vision_event['event_type']} "
                        f"(during sound clip) "
                        f"uid={uid}"
                    )

                    deferred_vision_event = None

                # 소리 이벤트용 영상 전달
                publish_sound_clip(
                    av_share,
                    saved_event,
                )

                print(
                    "[SOUND CLIP READY] "
                    f"request="
                    f"{saved_event['request_id']}"
                )

            elif saved_event is not None:

                print(
                    "[EVENT READY FOR EDGE]"
                )

                uid = emit_saved_event(
                    emitter,
                    saved_event,
                    camera_id,
                )

                print(
                    f"[EDGE EMIT] uid={uid}"
                )

            # ==================================
            # 5. YOLO
            # ==================================

            detections = detector.detect(
                frame
            )

            person = (
                detector.get_best_person(
                    detections
                )
            )

            # ==================================
            # 6. Fall
            # ==================================

            fall_detected = (
                fall_detector.update(
                    person
                )
            )

            # ==================================
            # 7. Visitor
            # ==================================

            visitor_detected = (
                visitor_detector.update(
                    person,
                    frame_width,
                    frame_height,
                )
            )

            # ==================================
            # 8. Delivery
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
            # 9. Vision Event Priority
            #
            # 위험 > 택배 > 방문자
            # ==================================

            if not recorder.recording:

                # ----------------------------------
                # Danger: Fall
                # ----------------------------------

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
                        event_type=(
                            "fall_suspect"
                        ),
                        frame=frame,
                        score=score,
                    )

                # ----------------------------------
                # Normal: Delivery
                # ----------------------------------

                elif (
                    delivery_score
                    is not None
                ):

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
                        event_type=(
                            "delivery_suspect"
                        ),
                        frame=frame,
                        score=delivery_score,
                    )

                # ----------------------------------
                # Normal: Visitor
                # ----------------------------------

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
                        event_type=(
                            "visitor_detected"
                        ),
                        frame=frame,
                        score=score,
                    )

            # ==================================
            # 10. Vision event during
            #     sound clip recording
            # ==================================

            elif (
                recorder.request_id
                and deferred_vision_event
                is None
            ):

                detected = (
                    detected_vision_event(
                        fall_detected,
                        delivery_score,
                        visitor_detected,
                        person,
                    )
                )

                if detected is not None:

                    print(
                        f"[VISION EVENT] "
                        f"{detected[0]} "
                        "(during sound clip recording)"
                    )

                    deferred_vision_event = {
                        "event_type":
                            detected[0],
                        "score":
                            detected[1],
                        "frame":
                            frame.copy(),
                        "event_time":
                            datetime.now().astimezone(),
                    }

            # ==================================
            # 11. Sound event recording request
            # ==================================

            handle_sound_requests(
                av_share,
                recorder,
                frame,
                frame_time,
            )

    except KeyboardInterrupt:

        print(
            "\n[STOP] "
            "Vision pipeline stopped"
        )

    finally:

        print("[CLEANUP]")

        # ------------------------------
        # Camera service 종료
        # ------------------------------

        for stop in service_stops:
            stop.set()

        # ------------------------------
        # Camera 종료
        # ------------------------------

        try:
            picam2.stop()
        except Exception:
            pass

        # ------------------------------
        # EventEmitter 종료
        # ------------------------------

        try:
            emitter.stop()
        except KeyboardInterrupt:
            print(
                "[CLEANUP] "
                "Emitter stop interrupted"
            )
        except Exception:
            pass

        print("[EXIT]")


if __name__ == "__main__":
    raise SystemExit(
        main()
    )
