"""
plot_threshold_f2.py — evaluate.py가 저장한 threshold_sweep.csv(precision/recall)로
카테고리별 F2 점수(recall에 F1보다 2배 가중)를 계산해 threshold_f1.png와 동일한
스타일로 시각화한다. detection_rate_sweep.csv(탐지율)와 UNSUPPORTED_CATEGORIES 표시도
plot_threshold_f1.py와 동일하게 따른다.

evaluate.py를 먼저 실행해서 두 CSV를 만들어야 한다.
"""

import csv
import os

import matplotlib.pyplot as plt

from evaluate import UNSUPPORTED_CATEGORIES  # noqa: F401 (카테고리 목록 확인용, 사유는 영문판을 별도 유지)

FBETA_BETA = 2

# 그래프에는 한글 폰트가 없어 UNSUPPORTED_CATEGORIES의 한글 사유 대신 영문 요약을 쓴다.
UNSUPPORTED_CATEGORIES_EN = {
    "kitchen_risk": "duration rule (30min+) needs continuous audio, ESC-50 clips are 5s",
    "long_silence": "meta_absence rule needs hours of absence, ESC-50 clips are 5s",
    "fall_suspect": "no Thud->Scream sequential sample in ESC-50",
    "ambient_log": "class_ids are TV/Music/Speech, no matching ESC-50 category",
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "output")
F1_CSV_PATH = os.path.join(OUTPUT_DIR, "threshold_sweep.csv")
DETECTION_CSV_PATH = os.path.join(OUTPUT_DIR, "detection_rate_sweep.csv")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "threshold_f2.png")


def fbeta_score(precision, recall, beta):
    beta_sq = beta * beta
    denom = beta_sq * precision + recall
    if denom == 0:
        return 0.0
    return (1 + beta_sq) * precision * recall / denom


def load_f2_sweep(path):
    by_category = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            precision = float(row["precision"])
            recall = float(row["recall"])
            f2 = fbeta_score(precision, recall, FBETA_BETA)
            by_category.setdefault(row["category_id"], []).append(
                (float(row["threshold"]), f2)
            )
    for points in by_category.values():
        points.sort(key=lambda p: p[0])
    return by_category


def load_sweep(path, value_field):
    by_category = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            by_category.setdefault(row["category_id"], []).append(
                (float(row["threshold"]), float(row[value_field]))
            )
    for points in by_category.values():
        points.sort(key=lambda p: p[0])
    return by_category


def plot(f2_by_category, detection_by_category, unsupported, output_path):
    fig, ax = plt.subplots(figsize=(11, 7))
    color_cycle = plt.rcParams["axes.prop_cycle"].by_key()["color"]
    color_by_category = {}

    def next_color(category_id):
        color = color_cycle[len(color_by_category) % len(color_cycle)]
        color_by_category[category_id] = color
        return color

    for category_id, points in sorted(f2_by_category.items()):
        thresholds = [p[0] for p in points]
        scores = [p[1] for p in points]
        best_i = max(range(len(points)), key=lambda i: scores[i])
        color = next_color(category_id)

        ax.plot(
            thresholds, scores, marker="o", markersize=3, color=color,
            label=f"{category_id} (F2)",
        )
        ax.scatter(
            [thresholds[best_i]], [scores[best_i]],
            color=color, s=60, zorder=5, edgecolors="black", linewidths=0.8,
        )

    for category_id, points in sorted(detection_by_category.items()):
        thresholds = [p[0] for p in points]
        scores = [p[1] for p in points]
        color = next_color(category_id)

        ax.plot(
            thresholds, scores, marker="s", markersize=3, linestyle="--", color=color,
            label=f"{category_id} (detection rate)",
        )

    ax.set_xlabel("Threshold")
    ax.set_ylabel("F2 (solid, beta=2) / Detection rate (dashed)")
    ax.set_title("YAMNet Threshold Sweep by Category — F2 (all catalog entries)")
    ax.set_ylim(-0.02, 1.02)
    ax.grid(True, alpha=0.3)
    ax.legend(loc="upper right", fontsize=7, ncol=2)

    if unsupported:
        note_lines = ["Not evaluable on ESC-50 5s clips:"]
        note_lines += [f"  - {cat}: {reason}" for cat, reason in unsupported.items()]
        ax.text(
            0.01, -0.16, "\n".join(note_lines),
            transform=ax.transAxes, fontsize=7, va="top", ha="left",
            family="monospace",
        )
        fig.subplots_adjust(bottom=0.16 + 0.03 * len(unsupported))
    else:
        fig.tight_layout()

    fig.savefig(output_path, dpi=150)
    print(f"그래프 저장: {output_path}")


def main():
    if not os.path.exists(F1_CSV_PATH) or not os.path.exists(DETECTION_CSV_PATH):
        raise SystemExit(f"{OUTPUT_DIR} 안에 CSV 없음 — 먼저 evaluate.py를 실행하세요.")

    if set(UNSUPPORTED_CATEGORIES_EN) != set(UNSUPPORTED_CATEGORIES):
        raise SystemExit(
            "UNSUPPORTED_CATEGORIES_EN이 evaluate.UNSUPPORTED_CATEGORIES와 어긋남 — "
            "evaluate.py 변경 시 이 파일의 영문 설명도 함께 갱신할 것."
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    f2_by_category = load_f2_sweep(F1_CSV_PATH)
    detection_by_category = load_sweep(DETECTION_CSV_PATH, "detection_rate")
    plot(f2_by_category, detection_by_category, UNSUPPORTED_CATEGORIES_EN, OUTPUT_PATH)


if __name__ == "__main__":
    main()
