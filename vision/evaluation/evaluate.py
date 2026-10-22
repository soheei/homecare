"""Validate clip labels and score explicit per-clip prediction records (stdlib only)."""
import argparse
import csv
import json
import math
from pathlib import Path
from statistics import median

CATEGORIES = ("visitor_detected", "delivery_suspect", "fall_suspect", "intrusion_suspect", "fall_detected")
FIELDS = {"clip_id", "file", "session", "scenario", "category", "label", "kind",
          "start_s", "end_s", "duration_s", "lighting", "distance", "mode", "armed", "split"}


def number(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("numbers must be finite")
    return result


def load_labels(path):
    path = Path(path)
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not FIELDS.issubset(reader.fieldnames or []):
            raise ValueError(f"missing columns: {sorted(FIELDS - set(reader.fieldnames or []))}")
        rows = list(reader)
    if not rows:
        raise ValueError("label file is empty")
    ids, sessions, files = set(), {}, {}
    for row in rows:
        if any(row[k] is None or not row[k].strip() for k in FIELDS):
            raise ValueError("all required fields must be nonempty")
        if row["clip_id"] in ids:
            raise ValueError("duplicate clip_id")
        ids.add(row["clip_id"])
        if row["category"] not in CATEGORIES or row["split"] not in ("dev", "test"):
            raise ValueError("unknown category or split")
        if row["label"] not in ("0", "1") or row["armed"] not in ("0", "1"):
            raise ValueError("label and armed must be 0 or 1")
        if row["kind"] not in ("clip", "background") or row["mode"] not in ("entrance", "living"):
            raise ValueError("invalid kind or mode")
        row["label"], row["armed"] = int(row["label"]), int(row["armed"])
        for key in ("start_s", "end_s", "duration_s"):
            row[key] = number(row[key])
        if not 0 <= row["start_s"] < row["end_s"] <= row["duration_s"]:
            raise ValueError("require 0 <= start_s < end_s <= duration_s")
        if row["kind"] == "background" and row["label"]:
            raise ValueError("background must have label=0")
        if not row["label"] and (row["start_s"] != 0 or row["end_s"] != row["duration_s"]):
            raise ValueError("negative/background observation must span the full file")
        if row["label"]:
            if row["category"] in CATEGORIES[:2]:
                enabled = row["mode"] == "entrance"
            elif row["category"] in ("fall_suspect", "fall_detected"):
                enabled = True  # 낙상은 거실·현관 모두에서 동작
            else:
                enabled = row["mode"] == "living"
            if row["category"] == "intrusion_suspect":
                enabled = enabled and row["armed"] == 1
            if not enabled:
                raise ValueError("positive label contradicts mode/armed policy")
        resolved = str((path.parent / row["file"]).resolve())
        for mapping, key in ((sessions, row["session"]), (files, resolved)):
            if key in mapping and mapping[key] != row["split"]:
                raise ValueError("session/file leakage between dev and test")
            mapping[key] = row["split"]
        row["resolved_file"] = resolved
    return rows


def ratio(n, d):
    return n / d if d else None


def wilson(k, n):
    if not n:
        return None
    z = 1.959963984540054
    p = k / n
    center = (p + z*z/(2*n)) / (1 + z*z/n)
    half = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / (1 + z*z/n)
    return [max(0.0, center-half), min(1.0, center+half)]


def score(rows, predictions):
    """Clip confusion matrix; temporal hits/duplicates reported separately."""
    expected = {r["clip_id"] for r in rows}
    if set(predictions) != expected:
        raise ValueError("prediction coverage must exactly match selected clip IDs; use [] for no events")
    details = []
    for row in rows:
        events = predictions[row["clip_id"]]
        if not isinstance(events, list):
            raise ValueError("each clip prediction must be an event list")
        times = []
        for event in events:
            if event["category"] not in CATEGORIES:
                raise ValueError("unknown predicted category")
            timestamp = number(event["time_s"])
            if not 0 <= timestamp < row["duration_s"]:
                raise ValueError("prediction outside clip duration")
            if event["category"] == row["category"]:
                times.append(timestamp)
        times.sort()
        hits = [t for t in times if row["start_s"] <= t <= row["end_s"]]
        outcome = ("TP" if times else "FN") if row["label"] else ("FP" if times else "TN")
        details.append({**{k: row[k] for k in FIELDS}, "outcome": outcome,
                        "event_count": len(times), "extra_events": max(0, len(times)-1),
                        "timely_hit": bool(hits) if row["label"] else None,
                        "latency_s": hits[0]-row["start_s"] if row["label"] and hits else None})
    summaries = {}
    for category in CATEGORIES:
        clips = [d for d in details if d["category"] == category and d["kind"] == "clip"]
        counts = {key: sum(d["outcome"] == key for d in clips) for key in ("TP", "FP", "TN", "FN")}
        tp, fp, tn, fn = (counts[k] for k in ("TP", "FP", "TN", "FN"))
        bg = [d for d in details if d["category"] == category and d["kind"] == "background"]
        hours = sum(d["duration_s"] for d in bg)/3600
        latencies = [d["latency_s"] for d in clips if d["latency_s"] is not None]
        summaries[category] = {**counts, "n_clips": len(clips),
            "precision": ratio(tp, tp+fp), "recall": ratio(tp, tp+fn),
            "f1": ratio(2*tp, 2*tp+fp+fn), "accuracy": ratio(tp+tn, len(clips)),
            "mcc": ratio(tp*tn-fp*fn, math.sqrt((tp+fp)*(tp+fn)*(tn+fp)*(tn+fn))),
            "precision_ci95": wilson(tp, tp+fp), "recall_ci95": wilson(tp, tp+fn),
            "background_hours": hours, "background_events": sum(d["event_count"] for d in bg),
            "raw_false_events_per_hour": ratio(sum(d["event_count"] for d in bg), hours),
            "extra_clip_events": sum(d["extra_events"] for d in clips),
            "timely_recall": ratio(sum(d["timely_hit"] is True for d in clips), tp+fn),
            "latency_n": len(latencies), "latency_median_s": median(latencies) if latencies else None}
    f1s = [s["f1"] for s in summaries.values() if s["f1"] is not None]
    return {"categories": summaries, "macro_f1": ratio(sum(f1s), len(f1s)),
            "macro_f1_categories": len(f1s)}, details


def write_report(output, rows, predictions, metadata):
    summary, details = score(rows, predictions)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps({"metadata": metadata, **summary},
                                                  ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    with (output / "clips.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=sorted(details[0]))
        writer.writeheader()
        writer.writerows(details)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("labels", type=Path)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--split", choices=("dev", "test"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = [r for r in load_labels(args.labels) if r["split"] == args.split]
    if not rows:
        parser.error("no rows for selected split")
    payload = json.loads(args.predictions.read_text(encoding="utf-8"))
    write_report(args.output, rows, payload["predictions"], payload["metadata"])


if __name__ == "__main__":
    main()
