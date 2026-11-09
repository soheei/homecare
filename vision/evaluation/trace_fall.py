"""낙상이 왜 안 잡히는지 프레임별로 보여주는 진단 도구(판정 로직은 바꾸지 않는다).

녹화한 영상 한 개를 파이프라인과 같은 설정으로 돌려, 프레임마다 사람 검출·추적·
하강/자세 조건과 "후보가 못 된 이유"를 표로 출력한다.

    python -m vision.evaluation.trace_fall 영상.mp4 [--csv out.csv] [--annotate out.mp4]
"""
import argparse
import csv
import math
from pathlib import Path

from .replay import VISION, pipeline_settings


def why_not_candidate(fall, current):
    """현재 박스 기준으로 낙상 후보 조건 중 무엇이 모자란지 한 줄로 설명."""
    if fall.fall_candidate:
        return "후보 진행중"
    origins = [s for s in fall.history if s["time"] < current["time"]]
    if not origins:
        return "이력 없음(첫 프레임/리셋 직후)"
    standing = [s for s in origins if s["w"] / s["h"] <= 0.8]
    if not standing:
        return "기준 자세 없음(최근 박스가 모두 가로비>0.8, 서 있는 사람 아님)"
    best = None
    for o in standing:
        elapsed = current["time"] - o["time"]
        drop = (current["y"] - o["y"]) / o["h"]
        score = (drop, o, elapsed)
        if best is None or drop > best[0]:
            best = score
    drop, o, elapsed = best
    speed = drop / elapsed
    if drop <= fall.drop_ratio:
        return f"하강량 부족 {drop:.2f} <= {fall.drop_ratio}"
    if speed < fall.min_drop_speed:
        return f"하강 느림 {speed:.2f} < {fall.min_drop_speed}"
    if not fall._low_posture(current, o):
        return (f"낮은 자세 아님 h비 {current['h'] / o['h']:.2f}(<={fall.max_height_ratio} 필요) "
                f"가로비 {current['w'] / current['h']:.2f}")
    return "조건 충족(다음 프레임에 후보)"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--model", type=Path, default=VISION / "yolov8n.pt")
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--annotate", type=Path, help="박스를 그린 영상 저장")
    args = parser.parse_args()
    if not args.video.is_file():
        parser.error("video not found")
    if not args.model.is_file():
        parser.error("local model required; automatic model download is not allowed")

    import cv2
    from vision.activity_tracker import FallPersonTracker
    from vision.fall_detector import FallDetector
    from vision.yolo_detector import YOLODetector

    s = pipeline_settings()
    detector = YOLODetector(model_path=str(args.model.resolve()), confidence=s["YOLO_CONFIDENCE"],
                            fall_confidence=s["FALL_PERSON_CONFIDENCE"])
    tracker = FallPersonTracker()
    fall = FallDetector(drop_window_sec=s["FALL_DROP_WINDOW_SEC"], drop_ratio=s["FALL_DROP_RATIO"],
                        min_drop_speed=s["FALL_MIN_DROP_SPEED"], stable_sec=s["FALL_STABLE_SEC"],
                        candidate_timeout_sec=s["FALL_CANDIDATE_TIMEOUT_SEC"])

    capture = cv2.VideoCapture(str(args.video))
    fps = capture.get(cv2.CAP_PROP_FPS)
    if not capture.isOpened() or not math.isfinite(fps) or fps <= 0:
        parser.error("cannot open video or invalid fps")
    writer = None
    rows, index, next_sample = [], 0, 0.0
    header = ("t", "persons", "confs", "tracked", "changed", "w/h", "h", "candidate",
              "low_sec", "event", "reason")
    print(" | ".join(header))
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        t = index / fps
        index += 1
        if t + 1e-9 < next_sample:
            continue
        next_sample = (math.floor(t * s["FPS"] + 1e-9) + 1) / s["FPS"]
        frame = cv2.resize(frame, (s["WIDTH"], s["HEIGHT"]))
        dets = detector.detect(frame)
        people = [d for d in dets if d["class_id"] == 0]
        person, changed = tracker.update(dets, timestamp=t)
        hit = fall.update_tracked(person, timestamp=t, changed=changed,
                                  person_visible=bool(people), frame_size=(frame.shape[1], frame.shape[0]))
        event = fall.last_event["reason"] if hit and fall.last_event else ""
        cur = fall._sample(person, t) if person else None
        if cur is None:
            reason = "사람 미검출" if not people else "추적 대상 없음"
        else:
            reason = why_not_candidate(fall, cur)
        row = (f"{t:.2f}", len(people), ",".join(f"{d['confidence']:.2f}" for d in people),
               "Y" if person else "-", "Y" if changed else "-",
               f"{cur['w'] / cur['h']:.2f}" if cur else "", f"{cur['h']:.0f}" if cur else "",
               "Y" if fall.fall_candidate else "-", f"{fall.observed_low_sec:.2f}", event, reason)
        rows.append(row)
        print(" | ".join(str(v) for v in row))
        if args.annotate:
            for d in people:
                color = (0, 255, 0) if d is person else (0, 165, 255)
                cv2.rectangle(frame, (d["x1"], d["y1"]), (d["x2"], d["y2"]), color, 2)
                cv2.putText(frame, f"{d['confidence']:.2f}", (d["x1"], max(12, d["y1"] - 4)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
            cv2.putText(frame, f"{t:.2f}s {event or reason}", (5, 18),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255) if event else (255, 255, 255), 1)
            if writer is None:
                writer = cv2.VideoWriter(str(args.annotate), cv2.VideoWriter_fourcc(*"mp4v"),
                                         s["FPS"], (frame.shape[1], frame.shape[0]))
            writer.write(frame)
    capture.release()
    if writer:
        writer.release()
    if args.csv:
        with args.csv.open("w", newline="", encoding="utf-8-sig") as stream:
            out = csv.writer(stream)
            out.writerow(header)
            out.writerows(rows)
    events = [r for r in rows if r[9]]
    print(f"\n프레임 {len(rows)}개 중 낙상 이벤트 {len(events)}건: {[(r[0], r[9]) for r in events]}")


if __name__ == "__main__":
    main()
