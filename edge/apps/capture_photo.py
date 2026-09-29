"""
capture_photo.py — Camera Module V3로 사진 1장을 찍어 백엔드(POST /api/events)에 이미지 이벤트로 전송

    python -m edge.apps.capture_photo
    python -m edge.apps.capture_photo --description "현관 확인"   # 이벤트 설명 지정
    python -m edge.apps.capture_photo --no-send                   # 촬영만 하고 edge/data/captures에 저장 (카메라 점검용)

rpicam-still(예전 OS는 libcamera-still)로 촬영한다 — camera_monitor.py와 같은 libcamera-apps 명령이라
추가 설치가 필요 없다. 백엔드가 사진을 Supabase Storage 'events' 버킷에 올리고 events.image_url에 저장한다.

이벤트는 마이크 기기가 아니라 카메라 기기(HOMECARE_CAMERA_DEVICE_ID)로 보낸다. 전송 큐도 마이크
파이프라인(stream_pipeline.py)과 분리한다 — 같은 큐를 쓰면 마이크 쪽 sender가 사진 이벤트를 마이크 기기
id로 보내버릴 수 있다.

필요 환경변수(edge/.env): config.py의 필수값 + HOMECARE_CAMERA_DEVICE_ID
"""

import argparse
import dataclasses
import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from ..transport import sender
from ..transport.config import ConfigError, load_config
from ..transport.emit import EventEmitter

log = logging.getLogger("edge.capture_photo")

WAIT_LIMIT_SEC = 180
CAPTURE_TIMEOUT_SEC = 30

# Raspberry Pi OS 버전에 따라 명령 이름이 다르다(최신: rpicam-*, 예전: libcamera-*) — 순서대로 시도
STILL_COMMANDS = ["rpicam-still", "libcamera-still"]


def capture(output: Path, width: int, height: int) -> bool:
    """사진 1장을 output(.jpg)에 저장. 성공하면 True."""
    output.parent.mkdir(parents=True, exist_ok=True)
    for name in STILL_COMMANDS:
        # -t 3000: 자동노출/화이트밸런스(AWB)가 수렴하도록 3초 뒤 촬영(1초는 AWB 수렴 전이라 색 편향 발생),
        # --awb auto: AWB 모드 명시, -n: 미리보기 창 없음(헤드리스)
        cmd = [name, "-n", "-t", "3000", "--awb", "auto", "--width", str(width), "--height", str(height),
               "-q", "85", "-o", str(output)]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=CAPTURE_TIMEOUT_SEC)
        except FileNotFoundError:
            continue
        except subprocess.TimeoutExpired:
            log.error("%s 응답 지연(%d초 초과)", name, CAPTURE_TIMEOUT_SEC)
            return False

        if result.returncode == 0 and output.is_file() and output.stat().st_size > 0:
            return True
        log.error("%s 촬영 실패(exit %s): %s", name, result.returncode, (result.stderr or "").strip()[-300:])
        return False

    log.error("rpicam-still/libcamera-still 명령을 찾을 수 없음 — libcamera-apps 설치 필요")
    return False


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--description", default=None, help="이벤트 설명 (기본: '카메라 사진 촬영')")
    p.add_argument("--width", type=int, default=1920)
    p.add_argument("--height", type=int, default=1080)
    p.add_argument("--no-send", action="store_true", help="촬영만 하고 전송하지 않음")
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: Optional[list] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"설정 오류: {e}")
        return 2

    camera_device_id = os.environ.get("HOMECARE_CAMERA_DEVICE_ID")
    if not camera_device_id and not args.no_send:
        print("설정 오류: HOMECARE_CAMERA_DEVICE_ID 누락 (edge/.env.example 참고)")
        return 2

    photo = cfg.outbox_dir / "captures" / f"{datetime.now():%Y%m%d_%H%M%S}.jpg"
    if not capture(photo, args.width, args.height):
        print("실패: 사진을 찍지 못했습니다 (위 로그 확인, `python -m edge.apps.camera_monitor --list-cameras`로 인식 여부 점검)")
        return 1
    print(f"촬영 완료: {photo} ({photo.stat().st_size // 1024} KB)")
    if args.no_send:
        return 0

    # 카메라 기기 id + 카메라 전용 큐로 전송
    cam_cfg = dataclasses.replace(cfg, device_id=camera_device_id, outbox_dir=cfg.outbox_dir / "camera")
    emitter = EventEmitter(cam_cfg)
    uid = emitter.emit("camera_capture", source="camera", description=args.description,
                       image_path=str(photo), extra={"width": args.width, "height": args.height})
    photo.unlink(missing_ok=True)  # 큐 폴더에 복사됐으므로 원본은 지운다

    print(f"대상: {cam_cfg.events_url}  (카메라 기기 {camera_device_id})")
    deadline = time.time() + WAIT_LIMIT_SEC
    while time.time() < deadline:
        result = sender.flush_once(cam_cfg, emitter.outbox)
        if result["sent"]:
            print("성공: 백엔드에 저장됨 (웹 '최근 이벤트'에서 사진 확인)")
            return 0
        if emitter.outbox.counts()["dead"]:
            print("실패: 백엔드가 이벤트를 거절했습니다 (위 로그의 HTTP 코드 확인)")
            return 1
        time.sleep(1)

    print(f"시간 초과: 전송되지 않았습니다 (이벤트 uid={uid}는 큐에 남아 있음, 다음 실행 때 함께 재전송)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
