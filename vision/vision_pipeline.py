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
from .yolo_detector import YOLODetector, confident_only
from .fall_detector import FallDetector
from .visitor_detector import VisitorDetector
from .delivery_detector import DeliveryDetector
from .event_recorder import EventRecorder
from .sound_clip_share import WaitingSoundRequests
from .activity_tracker import FallPersonTracker
from .intrusion_detector import (
    DetectionModeState,
    IntrusionDetector,
)

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
# 누운 사람 미탐 방지: 낙상 추적에만 쓰는 낮은 사람 신뢰도(오탐 증가 감수).
FALL_PERSON_CONFIDENCE = 0.25


# ==========================================
# Fall
# ==========================================

# 픽셀/프레임 대신 실제 초와 하강 전 사람 높이에 대한 비율을 사용한다.
# 자세 조건의 나머지 초기값은 FallDetector에 있으며 현장 영상 검증이 필요하다.
# 미탐을 줄이기 위해 완화한 값(오탐 증가 감수): 느리게 주저앉는 낙상도 후보가 된다.
FALL_DROP_WINDOW_SEC = 1.0
FALL_DROP_RATIO = 0.2
FALL_MIN_DROP_SPEED = 0.25
FALL_STABLE_SEC = 0.8
FALL_CANDIDATE_TIMEOUT_SEC = 2.5


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
DELIVERY_REQUIRED_FRAMES = 3  # 최소 표본 수. 실제 확인 시간은 감지기의 2초 조건.

# 택배 물체를 확인할 영역. 설치 화면에서 바닥 좌표로 조정한다.
# DOOR_ROI는 사람 중심을 확인하므로, 바닥 영역과 별도로 유지한다.
# 실제 설치 화면 확인 전에는 기존 전체 화면 범위를 유지한다.
DELIVERY_OBJECT_ROI = (0.0, 0.0, 1.0, 1.0)

# ==========================================
# Intrusion
# ==========================================

# 5 FPS 기준으로 사람 3프레임 연속 감지
INTRUSION_REQUIRED_FRAMES = 3

# 사람이 5프레임 연속 사라지면
# 다음 침입 이벤트를 감지할 수 있도록 초기화
INTRUSION_MISSING_FRAMES_TO_RESET = 5

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
        uid = emitter.emit(
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
                "fall_incident": saved_event.get('fall_incident'),
            },
            occurred_at=saved_event["event_time"],
        )

    except Exception:
        # 큐 저장 예외에서는 원본을 보존하고 호출자에게 실패를 알린다.
        logging.getLogger(__name__).exception("영상 큐 저장 실패: 원본 보존 %s", saved_event["video_path"])
        raise
    else:
        # 정상 큐 저장 또는 의도적인 쿨다운 제외일 때만 정리한다.
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
        return uid


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
    intrusion_detected,
    fall_detected,
    delivery_score,
    visitor_detected,
    person,
):

    """
    영상 이벤트 우선순위:

    침입 > 낙상 > 택배 > 방문자
    """

    person_score = (
        person["confidence"]
        if person is not None
        else None
    )

    if intrusion_detected:
        return "intrusion_suspect", person_score

    if fall_detected:
        return "fall_detected", person_score

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
    녹화 중 감지된 후속 영상 이벤트를 같은 영상으로 전송한다.

    녹화기가 하나이기 때문에
    기존 영상 녹화 중에는
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
            "fall_incident": deferred.get('fall_incident'),
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
    waiting=None,
):
    """
    마이크 프로세스에서 들어온
    카메라 영상 녹화 요청을 처리한다.

    waiting을 주면, 이미 녹화 중일 때 요청을 거절하지 않고
    진행 중인 녹화가 끝난 뒤 같은 영상을 받도록 기다리게 한다.
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

        # 이미 녹화 중인데 늦지 않은 요청은 그 녹화 영상을 같이 쓴다
        if waiting is not None and recorder.recording and not too_old:

            print(
                f"[SOUND REQUEST WAITING] "
                f"{req.get('category_id')} "
                "(sharing the recording in progress)"
            )

            waiting.add(req["id"])

            continue

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

    # 녹화 중 소리 요청에도 완료된 영상의 복사본을 전달한다.
    waiting_sound_requests = WaitingSoundRequests()

    # 녹화 중 발생한 후속 영상 이벤트를 종류별로 보관
    deferred_vision_events = {}

    # ==================================
    # YOLO
    # ==================================

    detector = YOLODetector(
        model_path=YOLO_MODEL,
        confidence=YOLO_CONFIDENCE,
        fall_confidence=FALL_PERSON_CONFIDENCE,
    )

    # ==========================================
    # Intrusion detector (경비 상태는 하트비트로 장소와 함께 수신)
    # ==========================================

    intrusion_detector = IntrusionDetector(
        required_frames=INTRUSION_REQUIRED_FRAMES,
        missing_frames_to_reset=INTRUSION_MISSING_FRAMES_TO_RESET,
    )
    # ==================================
    # Fall Detector
    # ==================================

    fall_detector = FallDetector(
        drop_window_sec=FALL_DROP_WINDOW_SEC,
        drop_ratio=FALL_DROP_RATIO,
        min_drop_speed=FALL_MIN_DROP_SPEED,
        stable_sec=FALL_STABLE_SEC,
        candidate_timeout_sec=FALL_CANDIDATE_TIMEOUT_SEC,
    )
    fall_person_tracker = FallPersonTracker()

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
            object_roi=DELIVERY_OBJECT_ROI,
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
    mode_state = DetectionModeState()  # 장소·경비를 동일 응답에서 함께 적용

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
        # 첫 응답이 프레임 미수신으로 지연되지 않도록 준비한다.
        # 이 캡처가 실패해도 finally에서 카메라와 전송 스레드를 정리한다.
        latest_frame.set(picam2.capture_array())
        service_stops = camera_service.start(
            cfg,
            latest_frame,
            interval_sec=settings["heartbeat_interval_sec"],
            mode_state=mode_state,
        )
        previous_state = None
        # 진단용(HOMECARE_FALL_DEBUG=1): 실시간에서만 생기는 프레임 간격·모드 문제를 로그로 본다.
        fall_debug = os.environ.get("HOMECARE_FALL_DEBUG") == "1"
        debug_prev = None

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
            frame_monotonic = time.monotonic()

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

            # 녹화 중에 들어온 소리 이벤트 요청에 같은 영상 복사본 전달 (원본이 넘어가기 전에)
            if saved_event is not None:
                waiting_sound_requests.publish(
                    av_share,
                    saved_event["video_path"],
                )

            # ==================================
            # 4. Saved Event
            # ==================================

            if saved_event is not None:
                # 원본 삭제/마이크 전달 전에 보류 이벤트의 첨부를 복사한다.
                for deferred in deferred_vision_events.values():
                    emit_deferred_vision_event(
                        emitter, saved_event, deferred, camera_id,
                    )
                deferred_vision_events.clear()
                if saved_event.get("request_id"):
                    publish_sound_clip(av_share, saved_event)
                else:
                    emit_saved_event(emitter, saved_event, camera_id)

            # ==================================
            # 5. YOLO
            # ==================================

            # 낙상 추적은 저신뢰 사람 박스(누운 자세)까지, 나머지는 기존 문턱으로 거른다.
            fall_detections = detector.detect(
                frame
            )
            detections = confident_only(fall_detections, YOLO_CONFIDENCE)

            person = (
                detector.get_best_person(
                    detections
                )
            )

            # ==================================
            # 6. Fall
            # ==================================

            # 프레임별 모드를 고정하고 전환 시 이전 장면의 감지 이력을 버린다.
            current_state = mode_state.snapshot()
            current_mode, armed = current_state or (None, False)
            if current_state != previous_state:
                fall_detector.reset()
                fall_person_tracker.reset()
                # 경비만 바뀌면 현관 방문/택배의 진행 중 이력은 유지한다.
                if previous_state is None or current_mode != previous_state[0]:
                    visitor_detector.reset()
                    delivery_detector.reset()
                previous_state = current_state

            fall_detected = False
            fall_person = None
            if current_mode in ("living", "entrance"):
                fall_person, changed = fall_person_tracker.update(fall_detections, timestamp=frame_monotonic)
                fall_detected = fall_detector.update_tracked(
                    fall_person, timestamp=frame_monotonic, changed=changed,
                    person_visible=any(d['class_id'] == 0 for d in fall_detections),
                    frame_size=(frame.shape[1], frame.shape[0]))

            if fall_debug:
                dt = None if debug_prev is None else frame_monotonic - debug_prev
                debug_prev = frame_monotonic
                people = [d for d in fall_detections if d['class_id'] == 0]
                print(f"[FALL DEBUG] mode={current_mode} dt={'-' if dt is None else f'{dt:.2f}'}"
                      f"{' GAP>0.6(이력 리셋)' if dt is not None and dt > 0.6 else ''} "
                      f"persons={[round(d['confidence'], 2) for d in people]} "
                      f"tracked={'Y' if fall_person else '-'} changed={locals().get('changed')} "
                      f"candidate={fall_detector.fall_candidate} fall={fall_detected}")

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
                    timestamp=frame_monotonic,
                )
            )

            # 현재 모드(거실/현관)에 속하지 않는 감지는 이벤트로 만들지 않음
            # 비활성 상태에도 호출해 이전 후보/중복 방지 상태를 초기화한다.
            intrusion_detected = intrusion_detector.update(
                person,
                armed and current_mode == "living",
            )
            visitor_detected = visitor_detected and current_mode == "entrance"
            if current_mode != "entrance":
                delivery_score = None

            # ==================================
            # 9. Vision Event Priority
            #
            # 침입 > 낙상 > 택배 > 방문자
            # ==================================

            # 우선순위대로 처리하되 동시 감지와 녹화 중 후속 이벤트도 보관한다.
            person_score = person["confidence"] if person is not None else None
            detected_events = [
                ("intrusion_suspect", person_score, intrusion_detected),
                (fall_detector.last_event['category'] if fall_detected else 'fall_suspect',
                 fall_person["confidence"] if fall_person else None, fall_detected),
                ("delivery_suspect", delivery_score, delivery_score is not None),
                ("visitor_detected", person_score, visitor_detected),
            ]
            for event_type, score, detected in detected_events:
                if not detected:
                    continue
                if (event_type == 'fall_detected' and recorder.recording
                        and recorder.event_type == 'fall_suspect'
                        and getattr(recorder, 'fall_incident', None)
                        and recorder.fall_incident['incident_id'] == fall_detector.last_event['incident_id']):
                    recorder.event_type = 'fall_detected'
                    recorder.event_score = score
                    recorder.fall_incident = dict(fall_detector.last_event)
                    continue
                if not recorder.recording:
                    recorder.start_event(event_type=event_type, frame=frame, score=score)
                    if event_type in ('fall_detected', 'fall_suspect'):
                        recorder.fall_incident = dict(fall_detector.last_event)
                elif event_type != recorder.event_type:
                    # 한 클립당 종류별 첫 감지만 보관해 메모리 사용량을 제한한다.
                    deferred_vision_events.setdefault(event_type, {
                        "event_type": event_type,
                        "score": score,
                        "frame": frame.copy(),
                        "event_time": datetime.fromtimestamp(frame_time).astimezone(),
                        "fall_incident": (dict(fall_detector.last_event)
                                          if event_type in ('fall_detected', 'fall_suspect') else None),
                    })

            # ==================================
            # 11. Sound event recording request
            # ==================================

            handle_sound_requests(
                av_share,
                recorder,
                frame,
                frame_time,
                waiting=waiting_sound_requests,
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
