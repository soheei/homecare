"""
fold_rotation_holdout.py — evaluate.py의 fold 5 단일 holdout 방식이 얼마나 안정적인지
검증하기 위해, 5개 fold를 돌아가며 각각 holdout으로 쓰는 wrapper.

evaluate.py의 판정 로직(run_rule/confusion_counts/precision_recall_f1/THRESHOLD_GRID/
POSITIVE_ESC50_CATEGORIES)은 그대로 import해서 쓰고 전혀 수정하지 않는다. 이 스크립트가
바꾸는 건 "어느 fold를 holdout으로 쓸지" 뿐이다 — evaluate.py의 evaluate_category()와
동일한 로직(threshold sweep에서 F1 최대, strict '>' tie-break)을 holdout_fold 파라미터로
일반화해 5번 반복한다.

evaluate.py, threshold_sweep.csv는 건드리지 않는다.

출력:
  - output/fold_rotation_holdout_results.json (원시 계산 결과, 표 생성용)
  - 표준출력 로그 (실행 시 셸에서 `2>&1 | tee` 등으로 raw output 파일로 남길 것)
"""

import json
import os
import statistics

from evaluate import POSITIVE_ESC50_CATEGORIES, THRESHOLD_GRID, confusion_counts, precision_recall_f1
from threshold_strategy_common import F1_CATEGORY_IDS, OUTPUT_DIR, get_scores_cache, load_relevant_rows

RESULTS_JSON_PATH = os.path.join(OUTPUT_DIR, "fold_rotation_holdout_results.json")
FOLDS = [1, 2, 3, 4, 5]


def evaluate_category_with_holdout_fold(category_id, relevant_rows, scores_cache, holdout_fold):
    """evaluate.py의 evaluate_category()와 동일한 로직(F1-max, strict '>' tie-break)을
    holdout_fold 파라미터로 일반화한 버전. confusion_counts/precision_recall_f1은
    evaluate.py에서 그대로 import해서 쓴다 — 판정 로직 자체는 손대지 않는다."""
    positive_names = set(POSITIVE_ESC50_CATEGORIES[category_id])

    tuning_rows = [r for r in relevant_rows if int(r["fold"]) != holdout_fold]
    holdout_rows = [r for r in relevant_rows if int(r["fold"]) == holdout_fold]

    best_threshold, best_f1 = THRESHOLD_GRID[0], -1.0
    for threshold in THRESHOLD_GRID:
        tp, fp, fn, _tn = confusion_counts(category_id, tuning_rows, scores_cache, threshold, positive_names)
        precision, recall, f1 = precision_recall_f1(tp, fp, fn)
        if f1 > best_f1:
            best_f1 = f1
            best_threshold = threshold

    tp, fp, fn, tn = confusion_counts(category_id, holdout_rows, scores_cache, best_threshold, positive_names)
    precision, recall, f1 = precision_recall_f1(tp, fp, fn)

    return dict(
        holdout_fold=holdout_fold,
        n_tuning=len(tuning_rows),
        n_holdout=len(holdout_rows),
        tuned_threshold=best_threshold,
        tuning_f1=round(best_f1, 4),
        tp=tp, fp=fp, fn=fn, tn=tn,
        precision=round(precision, 4),
        recall=round(recall, 4),
        f1=round(f1, 4),
    )


def aggregate(per_fold_results):
    precisions = [r["precision"] for r in per_fold_results]
    recalls = [r["recall"] for r in per_fold_results]
    f1s = [r["f1"] for r in per_fold_results]

    def stats(values):
        return dict(
            mean=round(statistics.mean(values), 4),
            stdev=round(statistics.stdev(values), 4) if len(values) > 1 else 0.0,
            min=round(min(values), 4),
            max=round(max(values), 4),
        )

    return dict(precision=stats(precisions), recall=stats(recalls), f1=stats(f1s))


def print_category_result(category_id, per_fold_results, agg, n_positive_total):
    print(f"\n[{category_id}]  (positive clips 총 {n_positive_total}개, 5-fold 전체)")
    for r in per_fold_results:
        print(
            f"  holdout=fold{r['holdout_fold']}: tuned_threshold={r['tuned_threshold']} "
            f"(tuning_f1={r['tuning_f1']})  TP={r['tp']} FP={r['fp']} FN={r['fn']} TN={r['tn']}  "
            f"P={r['precision']} R={r['recall']} F1={r['f1']}"
        )
    p, r_, f = agg["precision"], agg["recall"], agg["f1"]
    print(
        f"  [5-fold 집계] Precision mean={p['mean']} stdev={p['stdev']} range=[{p['min']}, {p['max']}]"
    )
    print(
        f"  [5-fold 집계] Recall    mean={r_['mean']} stdev={r_['stdev']} range=[{r_['min']}, {r_['max']}]"
    )
    print(
        f"  [5-fold 집계] F1        mean={f['mean']} stdev={f['stdev']} range=[{f['min']}, {f['max']}]"
    )


def main():
    print("=" * 70)
    print("fold_rotation_holdout.py — 5-fold rotation holdout 안정성 검증")
    print("(evaluate.py의 판정 로직은 그대로, holdout fold만 1~5로 돌아가며 반복)")
    print("=" * 70)

    relevant_rows = load_relevant_rows()
    scores_cache = get_scores_cache(relevant_rows)

    results = {}
    for category_id in F1_CATEGORY_IDS:
        positive_names = set(POSITIVE_ESC50_CATEGORIES[category_id])
        n_positive_total = sum(1 for r in relevant_rows if r["category"] in positive_names)

        per_fold_results = [
            evaluate_category_with_holdout_fold(category_id, relevant_rows, scores_cache, holdout_fold)
            for holdout_fold in FOLDS
        ]
        agg = aggregate(per_fold_results)

        results[category_id] = dict(
            n_positive_total=n_positive_total,
            per_fold=per_fold_results,
            aggregate=agg,
        )
        print_category_result(category_id, per_fold_results, agg, n_positive_total)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(RESULTS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n결과 JSON 저장: {RESULTS_JSON_PATH}")

    return results


if __name__ == "__main__":
    main()
