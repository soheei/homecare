"""Standalone Pi camera recording: python record_dataset.py F01.

No detection, environment files, network, or event transmission. Dependencies are
the same Picamera2/OpenCV used by vision_pipeline. Importing this module is safe
on machines without a camera; hardware imports happen only when recording.
"""
import argparse
import json
import re
import time
import uuid
from datetime import datetime
from pathlib import Path


FPS = 15
SIZE = (640, 480)
SCENARIOS = {
    "TEST": (15, "시험: 빈 화면 → 입장 → 전신 확인 → 퇴장"),
    "F01": (30, "옆면이 보이는 안전한 모의 낙상"),
    "F02": (30, "비스듬한 방향의 안전한 모의 낙상"),
    "F03": (30, "천천히 주저앉기"),
    "F04": (30, "의자에 앉았다 일어나기"),
    "F05": (30, "바닥 물건 줍기"),
    "F06": (30, "매트에 앉은 뒤 의도적으로 눕기"),
    "I01": (30, "입장 → 5초 이상 머무름 → 퇴장"),
    "I02": (30, "멈추지 않고 화면 통과"),
    "I03": (40, "입장 → 퇴장 → 빈 화면 5초 이상 → 재입장"),
    "I04": (30, "사람 없이 문 또는 조명 변화"),
    "V01": (30, "현관 앞 5초 대기"),
    "V02": (30, "현관 앞 10초 대기"),
    "V03": (30, "짧게 지나가기"),
    "V04": (30, "가장자리 또는 먼 곳에서 5초 대기"),
    "D01": (45, "큰 박스 놓고 퇴장"),
    "D02": (45, "작거나 바닥색과 비슷한 박스 놓고 퇴장"),
    "D03": (45, "가장자리/먼 바닥에 박스를 놓고 옆으로 퇴장"),
    "D04": (45, "빈손으로 방문 후 퇴장"),
    "D05": (45, "처음부터 놓여 있던 박스 회수"),
    "D06": (45, "빈손 방문 중 문 또는 조명 변경"),
    "BG": (600, "배경 10분: 앞 5분 빈 화면, 뒤 5분 자연스러운 통행"),
}


def next_path(directory, scenario):
    """Keep every take, including partial ones, and avoid overwriting files."""
    directory.mkdir(parents=True, exist_ok=True)
    pattern = re.compile(rf"^{re.escape(scenario)}_R(\d+)_")
    numbers = [int(m.group(1)) for p in directory.iterdir()
               if (m := pattern.match(p.name))]
    take = max(numbers, default=0) + 1
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    return directory / f"{scenario}_R{take}_{stamp}_{uuid.uuid4().hex[:6]}.mp4"


def record(scenario, output_dir, countdown=10):
    import cv2
    from picamera2 import Picamera2

    seconds, action = SCENARIOS[scenario]
    path = next_path(output_dir, scenario)
    camera = None
    writer = None
    started = False
    frame_times = []
    status = "failed"
    error = None
    start_wall = None
    print(f"\n장면: {scenario} — {action}", flush=True)
    print(f"길이: {seconds}초 / 무음 / {SIZE[0]}×{SIZE[1]} / 목표 {FPS} FPS")
    print(f"저장: {path}", flush=True)
    try:
        camera = Picamera2()
        config = camera.create_video_configuration(
            main={"size": SIZE, "format": "RGB888"},
            controls={"FrameRate": FPS},
        )
        camera.configure(config)
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, SIZE)
        if not writer.isOpened():
            raise RuntimeError("MP4 writer를 열 수 없습니다. 저장 권한/코덱/공간을 확인하세요.")
        camera.start()
        started = True
        # Drain frames while exposure settles and the actor moves out of view.
        time.sleep(2)
        ready_at = time.monotonic() + countdown
        last_remaining = None
        while time.monotonic() < ready_at:
            remaining = max(1, int(ready_at - time.monotonic()) + 1)
            if remaining != last_remaining:
                print(f"[준비] {remaining}초 후 시작 — 화면 밖에서 대기", flush=True)
                last_remaining = remaining
            camera.capture_array()
        print("\a[REC 0초] 촬영 시작! 매뉴얼의 0초부터 진행하세요.", flush=True)
        start_wall = datetime.now().astimezone().isoformat()
        beginning = time.monotonic()
        next_notice = 5
        while time.monotonic() - beginning < seconds:
            frame = camera.capture_array()
            elapsed = time.monotonic() - beginning
            # Picamera2 RGB888 arrays are BGR for OpenCV, as in vision_pipeline.
            writer.write(frame)
            frame_times.append(elapsed)
            if elapsed >= next_notice:
                print(f"[REC] {elapsed:.0f}/{seconds}초", flush=True)
                next_notice = (int(elapsed) // 5 + 1) * 5
        status = "complete"
    except KeyboardInterrupt:
        status = "interrupted"
        error = "Ctrl+C: 부분 영상. 정식 시도 대신 재촬영하세요."
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    finally:
        # Try each cleanup independently so errors do not leave the camera busy.
        for cleanup in (
            writer.release if writer is not None else None,
            camera.stop if camera is not None and started else None,
            camera.close if camera is not None else None,
        ):
            if cleanup is not None:
                try:
                    cleanup()
                except Exception as exc:
                    status = "failed"
                    error = f"cleanup: {type(exc).__name__}: {exc}"

    span = frame_times[-1] - frame_times[0] if len(frame_times) > 1 else 0
    observed_fps = (len(frame_times) - 1) / span if span > 0 else 0
    gaps = [b - a for a, b in zip(frame_times, frame_times[1:])]
    max_gap = max(gaps, default=0)
    timing_warning = abs(observed_fps / FPS - 1) > 0.05 or max_gap > 2.5 / FPS
    if not frame_times or not path.is_file() or path.stat().st_size == 0:
        status = "failed"
        error = error or "저장된 영상/프레임이 없습니다."
    metadata = {
        "scenario": scenario, "action": action, "file": path.name,
        "status": status, "error": error, "started_at": start_wall,
        "requested_seconds": seconds, "width": SIZE[0], "height": SIZE[1],
        "encoded_fps": FPS, "frames": len(frame_times),
        "observed_fps": observed_fps, "max_frame_gap_seconds": max_gap,
        "timing_warning": timing_warning,
        "frame_elapsed_seconds": frame_times,
        "note": "Capture completion times, not sensor timestamps. Not evaluation ground truth.",
    }
    path.with_suffix(".json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    if status != "complete":
        print(f"[미완료] {error}\n부분 파일 보존: {path}", flush=True)
        return 1
    print(f"\a[DONE] 저장 완료: {path}", flush=True)
    print(f"프레임 {len(frame_times)}, 관측 FPS {observed_fps:.2f}, 최대 간격 {max_gap:.3f}초")
    print("반드시 시험 영상을 실제로 재생하세요. 소리는 녹음되지 않습니다.")
    if timing_warning:
        print("[타이밍 경고] 프레임 지연이 있습니다. MP4 시간과 실제 동작 시간이 다를 수 있습니다.")
        print("JSON 시각을 함께 보존하고 부하를 줄인 뒤 재촬영하세요. 시간 조건 평가에 바로 쓰지 마세요.")
        return 2
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", choices=SCENARIOS)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "dataset",
                        help="기본: 이 스크립트 옆 dataset 폴더 (없으면 자동 생성)")
    parser.add_argument("--countdown", type=int, default=10, help="촬영 전 준비 시간(기본 10초)")
    args = parser.parse_args(argv)
    if args.countdown < 0:
        parser.error("--countdown must be >= 0")
    try:
        return record(args.scenario, args.output_dir, args.countdown)
    except Exception as exc:
        print(f"[실패] {type(exc).__name__}: {exc}")
        print("기존 vision용 Python 환경, 카메라 점유, 저장 권한/공간을 확인하세요.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
