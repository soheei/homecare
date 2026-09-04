"""
build_threshold_f1_f2_tables.py — threshold_f1.png / threshold_f2.png와 같은 소스
(output/threshold_sweep.csv, output/detection_rate_sweep.csv)를 표로 정리한다.
카테고리별로 threshold마다의 precision/recall/F1(또는 F2)을 전부 나열하고,
그래프에서 점으로 강조 표시한 최고점(F1-max / F2-max) 행을 **볼드**로 표시한다.

evaluate.py를 먼저 실행해서 두 CSV를 만들어야 한다.
"""

import csv
import os

FBETA_BETA = 2

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "output")
SWEEP_CSV_PATH = os.path.join(OUTPUT_DIR, "threshold_sweep.csv")
DETECTION_CSV_PATH = os.path.join(OUTPUT_DIR, "detection_rate_sweep.csv")
F1_TABLE_PATH = os.path.join(OUTPUT_DIR, "threshold_f1_table.md")
F2_TABLE_PATH = os.path.join(OUTPUT_DIR, "threshold_f2_table.md")


def fbeta_score(precision, recall, beta):
    beta_sq = beta * beta
    denom = beta_sq * precision + recall
    if denom == 0:
        return 0.0
    return (1 + beta_sq) * precision * recall / denom


def load_sweep():
    by_category = {}
    with open(SWEEP_CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            threshold = float(row["threshold"])
            precision = float(row["precision"])
            recall = float(row["recall"])
            f1 = float(row["f1"])
            f2 = fbeta_score(precision, recall, FBETA_BETA)
            by_category.setdefault(row["category_id"], []).append(
                dict(threshold=threshold, precision=precision, recall=recall, f1=f1, f2=f2)
            )
    for points in by_category.values():
        points.sort(key=lambda p: p["threshold"])
    return by_category


def load_detection():
    by_category = {}
    with open(DETECTION_CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            by_category.setdefault(row["category_id"], []).append(
                (float(row["threshold"]), float(row["detection_rate"]))
            )
    for points in by_category.values():
        points.sort(key=lambda p: p[0])
    return by_category


def fmt(v):
    return f"{v:.3f}"


def build_score_table(by_category, score_key, score_label, title, output_path):
    lines = [f"# {title}", ""]
    lines.append(
        "카테고리별 threshold 스윕 전체 값. `output/threshold_sweep.csv` 원자료를 "
        f"{score_label} 기준으로 표로 정리했고, 그래프(`threshold_{score_key}.png`)에서 "
        "점으로 강조 표시한 최고점 행은 **볼드**로 표시했다."
    )
    lines.append("")

    for category_id, points in sorted(by_category.items()):
        best_i = max(range(len(points)), key=lambda i: points[i][score_key])

        lines.append(f"## {category_id}")
        lines.append("")
        lines.append(f"| Threshold | Precision | Recall | {score_label} |")
        lines.append("|---|---|---|---|")
        for i, p in enumerate(points):
            row = f"| {p['threshold']:.2f} | {fmt(p['precision'])} | {fmt(p['recall'])} | {fmt(p[score_key])} |"
            if i == best_i:
                row = f"| **{p['threshold']:.2f}** | **{fmt(p['precision'])}** | **{fmt(p['recall'])}** | **{fmt(p[score_key])}** |"
            lines.append(row)
        lines.append("")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"표 저장: {output_path}")


def append_detection_section(detection_by_category, output_path):
    lines = ["", "## 탐지율(detection rate) 카테고리 (precision/recall/F 계산 불가)", ""]
    for category_id, points in sorted(detection_by_category.items()):
        lines.append(f"### {category_id}")
        lines.append("")
        lines.append("| Threshold | Detection rate |")
        lines.append("|---|---|")
        for threshold, rate in points:
            lines.append(f"| {threshold:.2f} | {fmt(rate)} |")
        lines.append("")

    with open(output_path, "a", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    if not os.path.exists(SWEEP_CSV_PATH) or not os.path.exists(DETECTION_CSV_PATH):
        raise SystemExit(f"{OUTPUT_DIR} 안에 CSV 없음 — 먼저 evaluate.py를 실행하세요.")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    by_category = load_sweep()
    detection_by_category = load_detection()

    build_score_table(
        by_category, "f1", "F1",
        "Threshold Sweep 표 — F1 (threshold_f1.png 대응)",
        F1_TABLE_PATH,
    )
    append_detection_section(detection_by_category, F1_TABLE_PATH)

    build_score_table(
        by_category, "f2", "F2",
        "Threshold Sweep 표 — F2 beta=2 (threshold_f2.png 대응)",
        F2_TABLE_PATH,
    )
    append_detection_section(detection_by_category, F2_TABLE_PATH)


if __name__ == "__main__":
    main()
