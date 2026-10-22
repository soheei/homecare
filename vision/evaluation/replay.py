"""Replay local videos through existing detectors, without recording or transmission."""
import argparse
import ast
import hashlib
import json
import math
import time
from pathlib import Path

from .evaluate import load_labels, write_report

VISION = Path(__file__).resolve().parents[1]
SETTING_NAMES = (
    "FPS", "WIDTH", "HEIGHT", "YOLO_CONFIDENCE", "DOOR_ROI", "DELIVERY_OBJECT_ROI",
    "VISITOR_REQUIRED_FRAMES", "DELIVERY_REQUIRED_FRAMES", "INTRUSION_REQUIRED_FRAMES",
    "INTRUSION_MISSING_FRAMES_TO_RESET", "FALL_DROP_WINDOW_SEC", "FALL_DROP_RATIO",
    "FALL_STABLE_SEC", "FALL_CANDIDATE_TIMEOUT_SEC",
)


def pipeline_settings():
    # Read literal settings without importing Pi camera / transport initialization.
    tree = ast.parse((VISION / "vision_pipeline.py").read_text(encoding="utf-8"))
    settings = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in SETTING_NAMES:
                    settings[target.id] = ast.literal_eval(node.value)
    if set(settings) != set(SETTING_NAMES):
        raise ValueError("pipeline settings changed: review replay adapter before evaluating")
    return settings


class RuleRunner:
    def __init__(self, settings, mode, armed):
        from vision.activity_tracker import FallPersonTracker
        from vision.fall_detector import FallDetector
        from vision.visitor_detector import VisitorDetector
        from vision.delivery_detector import DeliveryDetector
        from vision.intrusion_detector import IntrusionDetector
        s = settings
        self.mode, self.armed = mode, armed
        self.tracker = FallPersonTracker()
        self.fall = FallDetector(drop_window_sec=s["FALL_DROP_WINDOW_SEC"], drop_ratio=s["FALL_DROP_RATIO"],
                                 stable_sec=s["FALL_STABLE_SEC"], candidate_timeout_sec=s["FALL_CANDIDATE_TIMEOUT_SEC"])
        self.visitor = VisitorDetector(roi=s["DOOR_ROI"], required_frames=s["VISITOR_REQUIRED_FRAMES"])
        self.delivery = DeliveryDetector(roi=s["DOOR_ROI"], object_roi=s["DELIVERY_OBJECT_ROI"],
                                         required_frames=s["DELIVERY_REQUIRED_FRAMES"])
        self.intrusion = IntrusionDetector(required_frames=s["INTRUSION_REQUIRED_FRAMES"],
                                           missing_frames_to_reset=s["INTRUSION_MISSING_FRAMES_TO_RESET"])

    def update(self, frame, detections, timestamp, detector):
        height, width = frame.shape[:2]
        person = detector.get_best_person(detections)
        fall = False
        if self.mode == "living":
            tracked, changed = self.tracker.update(detections, timestamp=timestamp)
            fall = self.fall.update_tracked(tracked, timestamp=timestamp, changed=changed,
                                           person_visible=any(d['class_id'] == 0 for d in detections),
                                           frame_size=(width, height))
        visitor = self.visitor.update(person, width, height)
        delivery = self.delivery.update(detections, width, height, frame=frame, timestamp=timestamp)
        intrusion = self.intrusion.update(person, self.armed and self.mode == "living")
        return [name for name, found in (
            ("intrusion_suspect", intrusion), (self.fall.last_event['category'] if fall else 'fall_suspect', fall),
            ("delivery_suspect", delivery is not None and self.mode == "entrance"),
            ("visitor_detected", visitor and self.mode == "entrance")) if found]


def replay_clip(row, detector, settings):
    import cv2
    capture = cv2.VideoCapture(row["resolved_file"])
    try:
        if not capture.isOpened():
            raise ValueError(f"cannot open clip: {row['clip_id']}")
        source_fps = capture.get(cv2.CAP_PROP_FPS)
        frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        if not math.isfinite(source_fps) or source_fps <= 0 or not math.isfinite(frame_count) or frame_count <= 0:
            raise ValueError("video needs valid constant-frame-rate metadata")
        if abs(frame_count/source_fps-row["duration_s"]) > max(0.1, 1/source_fps):
            raise ValueError(f"duration label does not match video: {row['clip_id']}")
        runner = RuleRunner(settings, row["mode"], bool(row["armed"]))
        index, sampled, next_sample = 0, 0, 0.0
        events = []
        started = time.perf_counter()
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            timestamp = index/source_fps
            index += 1
            if timestamp + 1e-9 < next_sample:
                continue
            next_sample = (math.floor(timestamp * settings["FPS"] + 1e-9) + 1) / settings["FPS"]
            if timestamp >= row["duration_s"]:
                continue
            frame = cv2.resize(frame, (settings["WIDTH"], settings["HEIGHT"]))
            detections = detector.detect(frame)
            for category in runner.update(frame, detections, timestamp, detector):
                event = {"category": category, "time_s": timestamp}
                if category in ('fall_suspect', 'fall_detected'):
                    event.update(getattr(getattr(runner, 'fall', None), 'last_event', None) or {})
                events.append(event)
            sampled += 1
        if abs(index-frame_count) > 1 or not sampled:
            raise ValueError(f"incomplete video decode: {row['clip_id']}")
        return events, {"decoded_frames": index, "sampled_frames": sampled,
                        "source_fps": source_fps, "processing_wall_s": time.perf_counter()-started}
    finally:
        capture.release()


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024*1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("labels", type=Path)
    parser.add_argument("--split", choices=("dev", "test"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", type=Path, default=VISION / "yolov8n.pt")
    args = parser.parse_args()
    rows = [r for r in load_labels(args.labels) if r["split"] == args.split]
    if not rows:
        parser.error("no clips in selected split")
    if not args.model.is_file():
        parser.error("local model required; automatic model download is not allowed")
    for row in rows:
        if not Path(row["resolved_file"]).is_file():
            parser.error(f"missing local video: {row['clip_id']}")
    settings = pipeline_settings()
    from vision.yolo_detector import YOLODetector
    detector = YOLODetector(model_path=str(args.model.resolve()), confidence=settings["YOLO_CONFIDENCE"])
    predictions, diagnostics = {}, {}
    for row in rows:
        print(f"Evaluating {row['clip_id']}")
        predictions[row["clip_id"]], diagnostics[row["clip_id"]] = replay_clip(row, detector, settings)
    metadata = {"stage": "offline_raw_detection", "split": args.split, "settings": settings,
                "clock": "CFR video frame index / source FPS; not Pi wall clock",
                "model_sha256": digest(args.model), "labels_sha256": digest(args.labels),
                "source_sha256": {str(p.relative_to(VISION)): digest(p) for p in
                                  sorted(VISION.rglob("*.py")) if "data" not in p.parts and "output" not in p.parts},
                "diagnostics": diagnostics}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "predictions.json").write_text(json.dumps({"metadata": metadata, "predictions": predictions},
                                                           indent=2, allow_nan=False), encoding="utf-8")
    write_report(args.output, rows, predictions, metadata)


if __name__ == "__main__":
    main()
