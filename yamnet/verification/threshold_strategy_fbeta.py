"""
threshold_strategy_fbeta.py — F1-max 대비 F2-max / recall-constrained threshold 비교.

배경: evaluate.py는 카테고리별로 F1이 최대인 threshold를 고른다(fold 1-4 튜닝,
fold 5 holdout 평가). 이는 precision과 recall을 동등하게 취급하지만, category_map.py
기준 "높음 위험, locked" 카테고리(fire_alarm_siren, glass_impact)는 미탐(FN)이
오탐(FP)보다 치명적일 수 있어 recall을 더 우선하는 방식이 나은지 확인한다.

evaluate.py의 판정 로직(run_rule/confusion_counts/precision_recall_f1/THRESHOLD_GRID)은
그대로 import해서 쓰고, 이 스크립트에서는 threshold "선택 기준"만 F1-max/F2-max/
recall-constrained 세 가지로 늘린다. evaluate.py, threshold_sweep.csv는 건드리지 않는다.

출력:
  - output/threshold_strategy_fbeta_results.json (원시 계산 결과, 표 생성용)
  - 표준출력 로그 (실행 시 셸에서 `2>&1 | tee` 등으로 raw output 파일로 남길 것)
"""

import json
import os

from evaluate import THRESHOLD_GRID, confusion_counts, precision_recall_f1
from threshold_strategy_common import F1_CATEGORY_IDS, OUTPUT_DIR, get_scores_cache, load_relevant_rows

RECALL_CONSTRAINT = 0.9
FBETA_BETA = 2

RESULTS_JSON_PATH = os.path.join(OUTPUT_DIR, "threshold_strategy_fbeta_results.json")


def fbeta_score(precision, recall, beta):
    beta_sq = beta * beta
    denom = beta_sq * precision + recall
    if denom <= 0:
        return 0.0
    return (1 + beta_sq) * precision * recall / denom


def sweep_category(category_id, relevant_rows, scores_cache):
    from evaluate import POSITIVE_ESC50_CATEGORIES

    positive_names = set(POSITIVE_ESC50_CATEGORIES[category_id])
    tuning_rows = [r for r in relevant_rows if int(r["fold"]) <= 4]
    holdout_rows = [r for r in relevant_rows if int(r["fold"]) == 5]

    sweep = []
    for threshold in THRESHOLD_GRID:
        tp, fp, fn, _tn = confusion_counts(category_id, tuning_rows, scores_cache, threshold, positive_names)
        precision, recall, f1 = precision_recall_f1(tp, fp, fn)
        f2 = fbeta_score(precision, recall, FBETA_BETA)
        sweep.append(dict(
            threshold=threshold,
            tp=tp, fp=fp, fn=fn,
            precision=round(precision, 4),
            recall=round(recall, 4),
            f1=round(f1, 4),
            f2=round(f2, 4),
        ))

    # F1-max: evaluate.py와 동일하게 strict '>' — 동률이면 먼저 나온(더 낮은) threshold 유지
    best_f1_point, best_f1 = None, -1.0
    for point in sweep:
        if point["f1"] > best_f1:
            best_f1 = point["f1"]
            best_f1_point = point

    # F2-max: 동일한 tie-break 규칙
    best_f2_point, best_f2 = None, -1.0
    for point in sweep:
        if point["f2"] > best_f2:
            best_f2 = point["f2"]
            best_f2_point = point

    # recall-constrained: recall >= 0.9인 threshold 중 precision 최대 (동률이면 먼저 나온 것)
    candidates = [p for p in sweep if p["recall"] >= RECALL_CONSTRAINT]
    best_rc_point, best_rc_precision = None, -1.0
    for point in candidates:
        if point["precision"] > best_rc_precision:
            best_rc_precision = point["precision"]
            best_rc_point = point

    def holdout_at(threshold):
        tp, fp, fn, tn = confusion_counts(category_id, holdout_rows, scores_cache, threshold, positive_names)
        precision, recall, f1 = precision_recall_f1(tp, fp, fn)
        return dict(
            threshold=threshold,
            tp=tp, fp=fp, fn=fn, tn=tn,
            precision=round(precision, 4),
            recall=round(recall, 4),
            f1=round(f1, 4),
        )

    result = dict(
        category_id=category_id,
        n_tuning=len(tuning_rows),
        n_holdout=len(holdout_rows),
        sweep=sweep,
        f1_max=dict(
            tuning_threshold=best_f1_point["threshold"],
            tuning_precision=best_f1_point["precision"],
            tuning_recall=best_f1_point["recall"],
            tuning_f1=best_f1_point["f1"],
            holdout=holdout_at(best_f1_point["threshold"]),
        ),
        f2_max=dict(
            tuning_threshold=best_f2_point["threshold"],
            tuning_precision=best_f2_point["precision"],
            tuning_recall=best_f2_point["recall"],
            tuning_f2=best_f2_point["f2"],
            holdout=holdout_at(best_f2_point["threshold"]),
        ),
        recall_constrained=None,
    )

    if best_rc_point is not None:
        result["recall_constrained"] = dict(
            satisfied=True,
            tuning_threshold=best_rc_point["threshold"],
            tuning_precision=best_rc_point["precision"],
            tuning_recall=best_rc_point["recall"],
            holdout=holdout_at(best_rc_point["threshold"]),
        )
    else:
        result["recall_constrained"] = dict(satisfied=False)

    return result


def print_category_result(r):
    print(f"\n[{r['category_id']}]  (tuning n={r['n_tuning']}, holdout n={r['n_holdout']})")

    f1 = r["f1_max"]
    print(
        f"  F1-max threshold={f1['tuning_threshold']}  "
        f"(tuning P={f1['tuning_precision']} R={f1['tuning_recall']} F1={f1['tuning_f1']})"
    )
    ho = f1["holdout"]
    print(
        f"    holdout(fold5): TP={ho['tp']} FP={ho['fp']} FN={ho['fn']} TN={ho['tn']}  "
        f"P={ho['precision']} R={ho['recall']} F1={ho['f1']}"
    )

    f2 = r["f2_max"]
    print(
        f"  F2-max threshold={f2['tuning_threshold']}  "
        f"(tuning P={f2['tuning_precision']} R={f2['tuning_recall']} F2={f2['tuning_f2']})"
    )
    ho = f2["holdout"]
    print(
        f"    holdout(fold5): TP={ho['tp']} FP={ho['fp']} FN={ho['fn']} TN={ho['tn']}  "
        f"P={ho['precision']} R={ho['recall']} F1={ho['f1']}"
    )

    rc = r["recall_constrained"]
    if rc["satisfied"]:
        print(
            f"  recall>=0.9 constrained threshold={rc['tuning_threshold']}  "
            f"(tuning P={rc['tuning_precision']} R={rc['tuning_recall']})"
        )
        ho = rc["holdout"]
        print(
            f"    holdout(fold5): TP={ho['tp']} FP={ho['fp']} FN={ho['fn']} TN={ho['tn']}  "
            f"P={ho['precision']} R={ho['recall']} F1={ho['f1']}"
        )
    else:
        print("  recall>=0.9 constrained threshold: 조건 만족 threshold 없음 (모든 threshold에서 tuning recall < 0.9)")


def main():
    print("=" * 70)
    print("threshold_strategy_fbeta.py — F1-max vs F2-max vs recall-constrained threshold 비교")
    print(f"(THRESHOLD_GRID={THRESHOLD_GRID[0]}~{THRESHOLD_GRID[-1]}, recall constraint >= {RECALL_CONSTRAINT}, F-beta beta={FBETA_BETA})")
    print("=" * 70)

    relevant_rows = load_relevant_rows()
    scores_cache = get_scores_cache(relevant_rows)

    results = {}
    for category_id in F1_CATEGORY_IDS:
        r = sweep_category(category_id, relevant_rows, scores_cache)
        results[category_id] = r
        print_category_result(r)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(RESULTS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n결과 JSON 저장: {RESULTS_JSON_PATH}")

    return results


if __name__ == "__main__":
    main()
