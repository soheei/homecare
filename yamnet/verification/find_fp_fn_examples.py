"""
find_fp_fn_examples.py — evaluate.py가 계산하는 holdout(fold 5) confusion matrix의
실제 FP/FN 클립을 category_id별로 찾아 파일명/실제 라벨/YAMNet score/판정을 남긴다.

evaluate.py의 로직(run_rule, evaluate_category, POSITIVE_ESC50_CATEGORIES 등)을
그대로 재사용한다 — 판정 방식을 새로 만들지 않는다. score는 rule에 실제로 쓰이는
class_ids(또는 class_id_groups 등) 전체에 대한 클립 내 최댓값 프레임 점수로,
"이 카테고리 관련 클래스가 이 클립에서 가장 강하게 뜬 값"을 뜻한다(개별 규칙의
window/조합 판정 자체를 그대로 보여주는 값은 아님 — 참고용 스칼라).
"""

import csv
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "core"))

from category_map import CLASS_NAMES  # noqa: E402
from event_rules import CATEGORY_RULE_CONFIG  # noqa: E402
from evaluate import (  # noqa: E402
    OUTPUT_DIR,
    POSITIVE_ESC50_CATEGORIES,
    build_scores_cache,
    evaluate_category,
    load_esc50_meta,
    load_yamnet,
    run_rule,
)

EXAMPLES_CSV = os.path.join(OUTPUT_DIR, "fp_fn_examples.csv")
MAX_EXAMPLES_PER_TYPE = 3

TARGET_CATEGORIES = [
    "glass_impact", "fire_alarm_siren", "baby_person_distress",
    "door_visitor", "door_security", "animal",
]


def rule_class_ids(category_id):
    kwargs = CATEGORY_RULE_CONFIG[category_id]["kwargs"]
    if "class_ids" in kwargs:
        return kwargs["class_ids"]
    if "class_id_groups" in kwargs:
        return [i for g in kwargs["class_id_groups"] for i in g]
    if "ordered_class_id_groups" in kwargs:
        return [i for g in kwargs["ordered_class_id_groups"] for i in g]
    if "activity_class_ids" in kwargs:
        return kwargs["activity_class_ids"]
    raise ValueError(f"class_ids를 못 찾음: {category_id}")


def peak_score_and_class(scores, class_ids):
    sub = scores[:, class_ids]
    frame_i, col_i = divmod(int(sub.argmax()), sub.shape[1])
    class_id = class_ids[col_i]
    return float(sub[frame_i, col_i]), class_id


def main():
    meta_rows = load_esc50_meta()
    needed = set()
    for names in POSITIVE_ESC50_CATEGORIES.values():
        needed.update(names)
    relevant_rows = [r for r in meta_rows if r["category"] in needed]
    filenames = [r["filename"] for r in relevant_rows]

    print(f"Loading YAMNet and running inference on {len(filenames)} clips...")
    model = load_yamnet()
    scores_cache = build_scores_cache(model, filenames)

    rows_out = []
    print()
    for category_id in TARGET_CATEGORIES:
        positive_names = set(POSITIVE_ESC50_CATEGORIES[category_id])
        result = evaluate_category(category_id, relevant_rows, scores_cache)
        best_threshold = result["tuned_threshold"]
        class_ids = rule_class_ids(category_id)

        holdout_rows = [r for r in relevant_rows if int(r["fold"]) == 5]

        fps, fns = [], []
        for row in holdout_rows:
            filename = row["filename"]
            scores = scores_cache[filename]
            label = 1 if row["category"] in positive_names else 0
            pred = 1 if run_rule(category_id, scores, best_threshold).triggered else 0
            if pred == label:
                continue

            peak_score, peak_class_id = peak_score_and_class(scores, class_ids)
            example = dict(
                category_id=category_id,
                type="FP" if (pred == 1 and label == 0) else "FN",
                filename=filename,
                true_esc50_category=row["category"],
                threshold=best_threshold,
                peak_score=round(peak_score, 4),
                peak_class=CLASS_NAMES.get(peak_class_id, f"?{peak_class_id}"),
                predicted_triggered=bool(pred),
            )
            (fps if example["type"] == "FP" else fns).append(example)

        print(f"[{category_id}] threshold={best_threshold}  FP 총 {len(fps)}건, FN 총 {len(fns)}건 (holdout=fold5)")
        for ex in (fps[:MAX_EXAMPLES_PER_TYPE] + fns[:MAX_EXAMPLES_PER_TYPE]):
            print(
                f"  [{ex['type']}] {ex['filename']}  true={ex['true_esc50_category']}  "
                f"peak_score={ex['peak_score']}({ex['peak_class']})  "
                f"threshold={ex['threshold']}  predicted_triggered={ex['predicted_triggered']}"
            )
            rows_out.append(ex)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(EXAMPLES_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "category_id", "type", "filename", "true_esc50_category",
            "threshold", "peak_score", "peak_class", "predicted_triggered",
        ])
        writer.writeheader()
        writer.writerows(rows_out)

    print()
    print(f"FP/FN 예시 저장: {EXAMPLES_CSV}")


if __name__ == "__main__":
    main()
