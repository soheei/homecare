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

FALL_VERTICAL_THRESHOLD = 25
FALL_PREVIOUS_ASPECT_THRESHOLD = 0.9  # 낙상 직전 세로형 기준 (가로/세로 < 0.9)
FALL_ASPECT_RATIO_THRESHOLD = 1.3  # 낙상 후 가로형 기준 (가로/세로 > 1.3)
FALL_REQUIRED_FRAMES = 3  # 낙상 의심 후 가로형이 유지돼야 하는 프레임 수

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

# ==========================================
# 마이크 연동 (edge/transport/av_share.py)
# ==========================================

# 소리 이벤트 녹화 요청이 이보다 늦게 도착하면 사전 버퍼(3초)가 감지 순간을 못 담으므로 거절
SOUND_REQUEST_MAX_AGE_SEC = 3.0


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


def emit_saved_event(emitter, saved_event, camera_id):
    """
    저장된 이벤트(영상·썸네일)를 전송 큐에 넣고, Pi의 원본 파일은 바로 지운다.

    emit()이 첨부를 큐 폴더(edge/data/vision/attachments)로 복사한 뒤 반환하므로
    원본은 더 필요 없다. 쿨다운 등으로 큐에 안 들어가도 원본은 지운다 — Pi에 영상을 쌓지 않기 위함.
    큐 복사본은 재시도용으로만 남고, 전송 성공·최종 실패(dead) 때 outbox가 지운다.
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
                "vision_event": saved_event["event_type"],
                "video_has_audio": bool(saved_event.get("has_audio")),
            },
            occurred_at=saved_event["event_time"],
        )
    finally:
        for key in ("video_path", "thumbnail_path"):
            try:
                Path(saved_event[key]).unlink(missing_ok=True)
            except OSError:
                pass


def publish_sound_clip(av_share, saved_event):
    """
    소리 이벤트 요청으로 녹화한 영상을 마이크 프로세스에 넘긴다.
    이벤트 전송은 마이크 쪽이 wav와 함께 한 건으로 하므로 여기서는 emit하지 않는다.
    썸네일은 쓰지 않으니 바로 지운다.
    """

    av_share.publish_video_result(
        saved_event["request_id"],
        saved_event["video_path"],
    )

    Path(saved_event["thumbnail_path"]).unlink(missing_ok=True)


def detected_vision_event(fall_detected, delivery_score, visitor_detected, person):
    """메인 루프의 우선순위(위험 > 택배 > 방문자)대로 이번 프레임의 영상 이벤트 (type, score) 또는 None."""

    person_score = person["confidence"] if person is not None else None

    if fall_detected:
        return "fall_suspect", person_score

    if delivery_score is not None:
        return "delivery_suspect", delivery_score

    if visitor_detected:
        return "door_visitor", person_score

    return None


def emit_deferred_vision_event(emitter, saved_event, deferred, camera_id):
    """
    소리 이벤트 녹화 중에 감지된 영상 이벤트(낙상 등)를 같은 영상의 복사본으로 전송한다.
    (녹화기가 하나라 그 사이 감지를 새로 녹화할 수 없음 — 버리면 비명 뒤 낙상 같은 경우를 놓친다)
    원본 영상은 마이크 쪽으로 넘어가므로 복사본을 만들어 보낸다.
    """

    video_copy = saved_event["video_path"] + ".vision.mp4"
    thumb_copy = saved_event["thumbnail_path"] + ".vision.jpg"

    try:
        shutil.copyfile(saved_event["video_path"], video_copy)
        cv2.imwrite(thumb_copy, deferred["frame"])
    except OSError as e:
        print(f"[WARN] deferred vision event copy failed: {e}")
        return None

    return emit_saved_event(
        emitter,
        {
            "video_path": video_copy,
            "thumbnail_path": thumb_copy,
            "event_type": deferred["event_type"],
            "event_time": deferred["event_time"],
            "score": deferred["score"],
            "has_audio": saved_event.get("has_audio"),
        },
        camera_id,
    )


def handle_sound_requests(av_share, recorder, frame, now):
    """
    마이크의 소리 이벤트 녹화 요청을 처리한다.
    녹화기가 비어 있으면 첫 요청을 녹화 시작, 나머지(이미 녹화 중·너무 늦게 온 요청)는 실패로 알려
    마이크가 기다리지 않고 소리만 보내게 한다. 시작한 요청 id를 반환(없으면 None).
    """

    started = None

    for req in av_share.poll_video_requests():

        too_old = now - float(req.get("trigger_time") or 0) > SOUND_REQUEST_MAX_AGE_SEC

        if recorder.recording or too_old:
            print(
                f"[SOUND REQUEST REJECTED] {req.get('category_id')} "
                f"({'too old' if too_old else 'busy'})"
            )
            av_share.publish_video_result(req["id"], None)
            continue

        print(
            f"[SOUND EVENT] {req.get('category_id')} -> recording with audio"
        )

        recorder.start_event(
            event_type=req.get("category_id"),
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

    # 마이크 프로세스와 소리 공유 / 소리 이벤트 녹화 요청 수신
    av_share = AVShare()

    # 소리 이벤트 녹화 중에 감지된 영상 이벤트 (녹화가 끝나면 같은 영상으로 전송)
    deferred_vision_event = None

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
        previous_aspect_threshold=FALL_PREVIOUS_ASPECT_THRESHOLD,
        fall_aspect_threshold=FALL_ASPECT_RATIO_THRESHOLD,
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
        audio_source=av_share.read_audio,
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
    print(f"[AV SHARE] {av_share.root}")
    print("Ctrl+C to stop")

    try:
        while True:

            # ==================================
            # 1. Camera Frame
            # ==================================

            # Picamera2는 format="RGB888"로 설정해도 실제로는 BGR 순서로 배열을 반환한다
            # (라즈베리파이 재단 공식 문서에 명시된 알려진 이름/실제 채널 순서 불일치).
            # 즉 여기서 이미 OpenCV(cv2.imencode/imwrite, YOLO)가 기대하는 BGR 순서라
            # RGB2BGR 변환을 추가로 하면 채널이 다시 뒤집혀 파란/보라 색 편향이 생긴다.
            frame = picam2.capture_array()
            frame_time = time.time()  # 소리 링버퍼와 같은 시계(time.time())로 싱크

            frame_height, frame_width = (
                frame.shape[:2]
            )

            # 하트비트 / "현재 화면 보기"용 최신 프레임
            latest_frame.set(frame)

            # 마이크 프로세스에 "카메라 켜져 있음" 알림 (꺼져 있으면 녹화 요청을 안 보냄)
            av_share.mark_vision_alive()

            # ==================================
            # 2. Event Recording
            # ==================================

            saved_event = recorder.update(
                frame,
                frame_time,
            )

            # ==================================
            # 3. 저장 완료된 이벤트 -> edge
            # ==================================

            if saved_event is not None and saved_event.get("request_id"):

                # 녹화 중 감지된 영상 이벤트가 있으면 같은 영상 복사본으로 먼저 전송
                if deferred_vision_event is not None:

                    uid = emit_deferred_vision_event(
                        emitter,
                        saved_event,
                        deferred_vision_event,
                        camera_id,
                    )

                    print(
                        f"[EDGE EMIT] {deferred_vision_event['event_type']} "
                        f"(during sound clip) uid={uid}"
                    )

                    deferred_vision_event = None

                # 소리 이벤트용 영상 → 마이크가 wav와 함께 전송
                publish_sound_clip(
                    av_share,
                    saved_event,
                )

                print(
                    f"[SOUND CLIP READY] request={saved_event['request_id']}"
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

            # 소리 이벤트 녹화 중에 감지된 영상 이벤트는 기억해 뒀다가 같은 영상으로 전송
            elif recorder.request_id and deferred_vision_event is None:

                detected = detected_vision_event(
                    fall_detected,
                    delivery_score,
                    visitor_detected,
                    person,
                )

                if detected is not None:

                    print(
                        f"[VISION EVENT] {detected[0]} "
                        "(during sound clip recording)"
                    )

                    deferred_vision_event = {
                        "event_type": detected[0],
                        "score": detected[1],
                        "frame": frame.copy(),
                        "event_time": datetime.now().astimezone(),
                    }

            # ==================================
            # 9. 마이크 소리 이벤트 녹화 요청
            #
            # 영상 이벤트가 우선 — 같은 프레임에서 위에서 녹화를 시작했으면 요청은 거절(소리만 전송)
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
