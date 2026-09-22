"""
camera_monitor.py — Camera Module V3(CSI) 하드웨어 인식 여부를 주기적으로 확인해 백엔드에 하트비트 전송

    python -m edge.camera_monitor
    python -m edge.camera_monitor --list-cameras   # 감지 결과만 한 번 출력하고 종료 (디버그용)

아직 카메라 영상 분석 파이프라인(YOLO 등)은 없다 — 이 스크립트는 "카메라가 OS에 잡히는지"만
확인하는 임시 신호다. 실제 분석 파이프라인이 생기면 그 프로세스가 하트비트를 보내도록 교체할 것
(stream_pipeline.py가 마이크 쪽에서 이미 하는 방식과 동일하게).

카메라가 감지되지 않으면 하트비트를 보내지 않는다 — device.service.js가 last_heartbeat
최신 여부로 online/offline을 판단하므로, 감지 실패 시 그냥 보내지 않으면 곧 offline으로 표시된다.

필요 환경변수(edge/.env, config.py의 필수값과 별도로 추가):
  HOMECARE_CAMERA_DEVICE_ID   Supabase devices 테이블의 카메라 기기 UUID
선택:
  HOMECARE_CAMERA_CHECK_INTERVAL_SEC   확인 주기(초), 기본 20
"""

import argparse
import logging
import os
import subprocess
import time

from . import heartbeat
from .config import ConfigError, load_config

log = logging.getLogger("edge.camera_monitor")

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

    log.info("카메라 감지 모니터링 시작 (기기 id=%s, 주기=%.0f초, Ctrl+C로 종료)", camera_device_id, interval)
    thread, stop = heartbeat.start_background(
        cfg.backend_url,
        camera_device_id,
        cfg.device_secret,
        interval_sec=interval,
        timeout=cfg.request_timeout,
        should_send=camera_detected,
        get_metrics=lambda: {"hardware_detected": True},
    )
    try:
        while thread.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("종료 신호 받음")
    finally:
        stop.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
