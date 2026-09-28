"""
camera_monitor.py — Camera Module V3(CSI) 하드웨어 인식 여부를 주기적으로 확인해 백엔드에 하트비트 전송
                    + 앱/채팅의 "현재 화면 보기" 요청을 받아 사진 1장 촬영 (homecare-camera.service)

    python -m edge.apps.camera_monitor
    python -m edge.apps.camera_monitor --list-cameras   # 감지 결과만 한 번 출력하고 종료 (디버그용)

아직 카메라 영상 분석 파이프라인(YOLO 등)은 없다 — 하트비트는 "카메라가 OS에 잡히는지"만
확인하는 임시 신호다. 실제 분석 파이프라인이 생기면 그 프로세스가 하트비트를 보내도록 교체할 것
(stream_pipeline.py가 마이크 쪽에서 이미 하는 방식과 동일하게).

카메라가 감지되지 않으면 하트비트를 보내지 않는다 — device.service.js가 last_heartbeat
최신 여부로 online/offline을 판단하므로, 감지 실패 시 그냥 보내지 않으면 곧 offline으로 표시된다.

현재 화면 캡처: 백엔드가 Pi로 먼저 접속할 수 없어서, 이 프로세스가
GET /api/devices/:id/capture-requests/next 로 롱폴링(최대 25초 대기)하다가 요청을 받으면
rpicam-still로 1장 찍어 POST /api/devices/:id/capture-requests/:requestId 로 올린다.
사진은 임시 폴더에만 잠깐 두고 지운다(Pi에 저장 안 함). 서비스가 꺼져 있으면 요청을 받지 않으므로
백엔드가 "카메라가 꺼져 있다"고 안내한다. 인식 확인과 촬영이 동시에 카메라를 쓰지 않도록 lock을 건다.

필요 환경변수(edge/.env, config.py의 필수값과 별도로 추가):
  HOMECARE_CAMERA_DEVICE_ID   Supabase devices 테이블의 카메라 기기 UUID
선택:
  HOMECARE_CAMERA_CHECK_INTERVAL_SEC   확인 주기(초), 기본 20
"""

import argparse
import logging
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import requests

from . import capture_photo
from ..transport import heartbeat
from ..transport.config import ConfigError, load_config

log = logging.getLogger("edge.camera_monitor")

# 현재 화면 캡처 설정 (모바일 화면 표시용이라 1280x720이면 충분하고 업로드도 빠름)
CAPTURE_WIDTH = 1280
CAPTURE_HEIGHT = 720
POLL_TIMEOUT_SEC = 45   # 백엔드가 최대 25초 붙잡고 있으므로 그보다 길게
RETRY_WAIT_SEC = 5

# 인식 확인(rpicam-hello)과 촬영(rpicam-still)이 동시에 카메라를 쓰지 않도록
camera_lock = threading.Lock()

# Raspberry Pi OS 버전에 따라 명령 이름이 다르다(최신: rpicam-*, 예전: libcamera-*) — 순서대로 시도
CAMERA_LIST_COMMANDS = [
    ["rpicam-hello", "--list-cameras"],
    ["libcamera-hello", "--list-cameras"],
]


def camera_detected() -> bool:
    """`rpicam-hello`/`libcamera-hello --list-cameras` 출력으로 CSI 카메라 인식 여부 확인."""
    for cmd in CAMERA_LIST_COMMANDS:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        except FileNotFoundError:
            continue
        except subprocess.TimeoutExpired:
            log.warning("%s 응답 지연(10초 초과) — 미인식으로 처리", cmd[0])
            return False

        output = (result.stdout or "") + (result.stderr or "")
        return "Available cameras" in output and "No cameras available" not in output

    log.warning("rpicam-hello/libcamera-hello 명령을 찾을 수 없음 — libcamera-apps 설치 필요")
    return False


def camera_detected_locked() -> bool:
    with camera_lock:
        return camera_detected()


def capture_current_frame(width: int = CAPTURE_WIDTH, height: int = CAPTURE_HEIGHT):
    """현재 화면 1장 촬영 → (JPEG bytes, None) 또는 (None, 실패 사유 'camera_not_detected' | 'capture_failed')."""
    with camera_lock, tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "frame.jpg"
        if capture_photo.capture(path, width, height):
            return path.read_bytes(), None
        return None, ("capture_failed" if camera_detected() else "camera_not_detected")


def handle_capture_request(session, backend_url: str, device_id: str, device_secret: str, request_id: str,
                           capture_fn=None) -> None:
    """캡처 요청 1건 처리: 촬영 후 결과(이미지 또는 실패 사유)를 백엔드에 제출.

    capture_fn: 촬영 함수(() -> (JPEG bytes, None) | (None, 사유)). 기본은 rpicam-still 촬영.
                vision 파이프라인처럼 카메라를 이미 열고 있는 쪽은 최신 프레임을 돌려주는 함수를 넘긴다.
    """
    url = f"{backend_url}/api/devices/{device_id}/capture-requests/{request_id}"
    headers = {"X-Device-Id": device_id, "X-Device-Secret": device_secret}

    started = time.monotonic()
    image, reason = (capture_fn or capture_current_frame)()
    try:
        if image:
            resp = session.post(url, files={"image": ("frame.jpg", image, "image/jpeg")},
                                headers=headers, timeout=30)
        else:
            resp = session.post(url, json={"error": reason}, headers=headers, timeout=30)
    except requests.RequestException as e:
        log.warning("캡처 결과 전송 오류(request=%s): %s", request_id, type(e).__name__)
        return

    if image:
        log.info("현재 화면 캡처 전송 request=%s %d KB %.1f초 → HTTP %s",
                 request_id, len(image) // 1024, time.monotonic() - started, resp.status_code)
    else:
        log.error("현재 화면 캡처 실패(%s) request=%s → HTTP %s", reason, request_id, resp.status_code)


def run_capture_listener(backend_url: str, device_id: str, device_secret: str, stop: threading.Event, session=None,
                         capture_fn=None) -> None:
    """백엔드 캡처 요청 롱폴링 루프 (stop이 set될 때까지)."""
    session = session or requests.Session()
    url = f"{backend_url}/api/devices/{device_id}/capture-requests/next"
    headers = {"X-Device-Id": device_id, "X-Device-Secret": device_secret}

    while not stop.is_set():
        try:
            resp = session.get(url, headers=headers, timeout=POLL_TIMEOUT_SEC)
        except requests.RequestException as e:
            log.warning("캡처 요청 대기 오류: %s — %d초 후 재시도", type(e).__name__, RETRY_WAIT_SEC)
            stop.wait(RETRY_WAIT_SEC)
            continue

        if resp.status_code != 200:
            if resp.status_code == 404:
                log.warning("백엔드에 캡처 요청 API가 없음(배포 전 버전?) — 60초 후 재시도")
                stop.wait(60)
            elif resp.status_code in (401, 403):
                log.error("캡처 요청 인증 실패(HTTP %s) — HOMECARE_CAMERA_DEVICE_ID / EDGE_DEVICE_SECRET 확인", resp.status_code)
                stop.wait(30)
            else:
                log.warning("캡처 요청 대기 실패 HTTP %s — %d초 후 재시도", resp.status_code, RETRY_WAIT_SEC)
                stop.wait(RETRY_WAIT_SEC)
            continue

        try:
            data = resp.json().get("data")
        except ValueError:
            data = None
        if data and data.get("requestId"):
            log.info("현재 화면 캡처 요청 받음 request=%s", data["requestId"])
            try:
                handle_capture_request(session, backend_url, device_id, device_secret, data["requestId"],
                                       capture_fn=capture_fn)
            except Exception:  # 예기치 못한 오류로 대기 스레드(=서비스)가 죽지 않게
                log.exception("캡처 요청 처리 오류 request=%s", data["requestId"])


def start_capture_listener(backend_url: str, device_id: str, device_secret: str, capture_fn=None):
    stop = threading.Event()
    thread = threading.Thread(
        target=run_capture_listener, args=(backend_url, device_id, device_secret, stop, None, capture_fn),
        name="capture-listener", daemon=True,
    )
    thread.start()
    return thread, stop


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--list-cameras", action="store_true", help="감지 결과만 한 번 출력하고 종료")
    p.add_argument("--log-level", default="INFO")
    return p


def main() -> int:
    args = build_arg_parser().parse_args()
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.list_cameras:
        print("카메라 감지됨" if camera_detected() else "카메라 감지 안 됨")
        return 0

    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"설정 오류: {e}")
        return 2

    camera_device_id = os.environ.get("HOMECARE_CAMERA_DEVICE_ID")
    if not camera_device_id:
        print("설정 오류: HOMECARE_CAMERA_DEVICE_ID 누락 (edge/.env.example 참고)")
        return 2

    interval = float(os.environ.get("HOMECARE_CAMERA_CHECK_INTERVAL_SEC", "20"))

    log.info("카메라 감지 모니터링 + 현재 화면 캡처 대기 시작 (기기 id=%s, 주기=%.0f초, Ctrl+C로 종료)",
             camera_device_id, interval)
    thread, stop = heartbeat.start_background(
        cfg.backend_url,
        camera_device_id,
        cfg.device_secret,
        interval_sec=interval,
        timeout=cfg.request_timeout,
        should_send=camera_detected_locked,
        get_metrics=lambda: {"hardware_detected": True},
    )
    capture_thread, capture_stop = start_capture_listener(cfg.backend_url, camera_device_id, cfg.device_secret)
    try:
        while thread.is_alive() and capture_thread.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("종료 신호 받음")
    finally:
        stop.set()
        capture_stop.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
