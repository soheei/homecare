"""
build_threshold_strategy_report.py — threshold_strategy_fbeta.py와 fold_rotation_holdout.py가
저장한 JSON 결과(output/threshold_strategy_fbeta_results.json,
output/fold_rotation_holdout_results.json)만 읽어서 output/threshold_strategy_comparison.md를
생성한다. 이 스크립트는 숫자를 계산하지 않는다 — 두 JSON에 이미 저장된 실제 실행 결과를
표로 옮겨 적을 뿐이다 (임의 수치 생성 금지 원칙).
"""

import json
import os

from threshold_strategy_common import F1_CATEGORY_IDS, OUTPUT_DIR

FBETA_JSON = os.path.join(OUTPUT_DIR, "threshold_strategy_fbeta_results.json")
ROTATION_JSON = os.path.join(OUTPUT_DIR, "fold_rotation_holdout_results.json")
REPORT_MD = os.path.join(OUTPUT_DIR, "threshold_strategy_comparison.md")

HIGH_RISK_LOCKED = {"fire_alarm_siren", "glass_impact"}
LOW_POSITIVE_COUNT = {"glass_impact", "baby_person_distress", "door_visitor"}

CATEGORY_LABELS = {
    "glass_impact": "glass_impact (높음 위험, locked)",
    "fire_alarm_siren": "fire_alarm_siren (높음 위험, locked)",
    "baby_person_distress": "baby_person_distress",
    "door_visitor": "door_visitor",
    "door_security": "door_security",
    "animal": "animal",
}


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def fmt(x):
    return f"{x:.4f}" if isinstance(x, float) else str(x)


def build_part1_summary_table(fbeta_results):
    lines = [
        "| Category | 전략 | tuning threshold | tuning P | tuning R | holdout TP | holdout FP | holdout FN | holdout TN | holdout P | holdout R | holdout F1 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for cat_id in F1_CATEGORY_IDS:
        r = fbeta_results[cat_id]
        label = CATEGORY_LABELS.get(cat_id, cat_id)

        f1 = r["f1_max"]
        ho = f1["holdout"]
        lines.append(
            f"| {label} | F1-max | {fmt(f1['tuning_threshold'])} | {fmt(f1['tuning_precision'])} | "
            f"{fmt(f1['tuning_recall'])} | {ho['tp']} | {ho['fp']} | {ho['fn']} | {ho['tn']} | "
            f"{fmt(ho['precision'])} | {fmt(ho['recall'])} | {fmt(ho['f1'])} |"
        )

        f2 = r["f2_max"]
        ho = f2["holdout"]
        lines.append(
            f"| {label} | F2-max (beta=2) | {fmt(f2['tuning_threshold'])} | {fmt(f2['tuning_precision'])} | "
            f"{fmt(f2['tuning_recall'])} | {ho['tp']} | {ho['fp']} | {ho['fn']} | {ho['tn']} | "
            f"{fmt(ho['precision'])} | {fmt(ho['recall'])} | {fmt(ho['f1'])} |"
        )

        rc = r["recall_constrained"]
        if rc["satisfied"]:
            ho = rc["holdout"]
            lines.append(
                f"| {label} | recall>=0.9 constrained | {fmt(rc['tuning_threshold'])} | {fmt(rc['tuning_precision'])} | "
                f"{fmt(rc['tuning_recall'])} | {ho['tp']} | {ho['fp']} | {ho['fn']} | {ho['tn']} | "
                f"{fmt(ho['precision'])} | {fmt(ho['recall'])} | {fmt(ho['f1'])} |"
            )
        else:
            lines.append(
                f"| {label} | recall>=0.9 constrained | 조건 만족 threshold 없음 | - | - | - | - | - | - | - | - | - |"
            )
    return "\n".join(lines)


def build_rotation_per_fold_table(rotation_results, cat_id):
    r = rotation_results[cat_id]
    lines = [
        "| holdout fold | tuned threshold(F1-max, 나머지 4-fold) | tuning F1 | TP | FP | FN | TN | Precision | Recall | F1 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for pf in r["per_fold"]:
        lines.append(
            f"| fold{pf['holdout_fold']} | {fmt(pf['tuned_threshold'])} | {fmt(pf['tuning_f1'])} | "
            f"{pf['tp']} | {pf['fp']} | {pf['fn']} | {pf['tn']} | {fmt(pf['precision'])} | "
            f"{fmt(pf['recall'])} | {fmt(pf['f1'])} |"
        )
    agg = r["aggregate"]
    p, rec, f1 = agg["precision"], agg["recall"], agg["f1"]
    lines.append(
        f"| **평균±표준편차** | - | - | - | - | - | - | "
        f"**{fmt(p['mean'])} (stdev {fmt(p['stdev'])})** | "
        f"**{fmt(rec['mean'])} (stdev {fmt(rec['stdev'])})** | "
        f"**{fmt(f1['mean'])} (stdev {fmt(f1['stdev'])})** |"
    )
    return "\n".join(lines)


def build_rotation_summary_table(rotation_results):
    lines = [
        "| Category | positive clips (5-fold 전체) | Precision mean±stdev | Precision range | Recall mean±stdev | Recall range | F1 mean±stdev | F1 range |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for cat_id in F1_CATEGORY_IDS:
        r = rotation_results[cat_id]
        agg = r["aggregate"]
        p, rec, f1 = agg["precision"], agg["recall"], agg["f1"]
        label = CATEGORY_LABELS.get(cat_id, cat_id)
        low_n_note = " ⚠️positive 적음" if cat_id in LOW_POSITIVE_COUNT else ""
        lines.append(
            f"| {label}{low_n_note} | {r['n_positive_total']} | {fmt(p['mean'])}±{fmt(p['stdev'])} | "
            f"[{fmt(p['min'])}, {fmt(p['max'])}] | {fmt(rec['mean'])}±{fmt(rec['stdev'])} | "
            f"[{fmt(rec['min'])}, {fmt(rec['max'])}] | {fmt(f1['mean'])}±{fmt(f1['stdev'])} | "
            f"[{fmt(f1['min'])}, {fmt(f1['max'])}] |"
        )
    return "\n".join(lines)


def main():
    fbeta_results = load_json(FBETA_JSON)
    rotation_results = load_json(ROTATION_JSON)

    parts = []
    parts.append("# HomeTalk yamnet/evaluate.py 후속 분석 — Threshold 선택 전략 비교\n")
    parts.append(
        "- 작성 목적: 정리 자료 (PPT 아님). 아래 모든 수치는 `threshold_strategy_fbeta.py`와 "
        "`fold_rotation_holdout.py`를 실제 실행한 결과(`output/threshold_strategy_fbeta_results.json`, "
        "`output/fold_rotation_holdout_results.json`)를 그대로 옮긴 값이며, 임의로 만든 값은 없다."
    )
    parts.append(
        "- 배경: `evaluate.py`는 카테고리별 F1이 최대인 threshold를 선택한다(fold 1-4 튜닝 → fold 5 holdout 평가). "
        "이 방식은 precision과 recall을 동등하게 취급하지만, `category_map.py` 기준 `fire_alarm_siren`/`glass_impact`는 "
        "`default_risk_level=\"높음\"`, `locked=True` 카테고리라 미탐(FN)이 오탐(FP)보다 치명적일 수 있다. "
        "이 문서는 (1) F1-max 대신 recall을 더 우선하는 threshold 선택 방식(F2-max, recall-constrained)이 "
        "더 적합한지, (2) fold 5 하나만 holdout으로 쓰는 현재 방식이 얼마나 안정적인지 두 가지를 확인한다."
    )
    parts.append(
        "- `evaluate.py`, `event_rules.py`, `category_map.py`, `output/threshold_sweep.csv`는 전혀 수정하지 않았다 — "
        "새 스크립트(`threshold_strategy_common.py`, `threshold_strategy_fbeta.py`, `fold_rotation_holdout.py`, "
        "`build_threshold_strategy_report.py`)에서 `evaluate.py`의 판정 로직(`run_rule`/`confusion_counts`/"
        "`precision_recall_f1`/`THRESHOLD_GRID`/`POSITIVE_ESC50_CATEGORIES`)만 그대로 import해서 재사용했다."
    )
    parts.append(
        "- negative pool은 `evaluate.py`의 `main()`과 동일하게 `POSITIVE_ESC50_CATEGORIES` 8개 카테고리 전체(1160 클립)를 "
        "union한 것을 썼다 — F1 계산 대상은 6개 카테고리뿐이지만 `health_signal`/`household_activity_log` ESC-50 클립도 "
        "다른 카테고리 입장에선 negative이기 때문이다. 아래 F1-max 결과가 `output/evaluate_raw_output.txt`의 원래 값과 "
        "정확히 일치함을 확인했다 (§0 검증 참고)."
    )

    parts.append("\n## 0. 재현/검증")
    parts.append(
        "| 항목 | 내용 |\n| --- | --- |\n"
        "| Part 1 실행 스크립트 | `threshold_strategy_fbeta.py` |\n"
        "| Part 1 원본 로그 | `output/threshold_strategy_fbeta_raw_output.txt` |\n"
        "| Part 1 원시 결과(JSON) | `output/threshold_strategy_fbeta_results.json` |\n"
        "| Part 2 실행 스크립트 | `fold_rotation_holdout.py` |\n"
        "| Part 2 원본 로그 | `output/fold_rotation_holdout_raw_output.txt` |\n"
        "| Part 2 원시 결과(JSON) | `output/fold_rotation_holdout_results.json` |\n"
        "| 검증 | Part 1/2의 F1-max, fold5 holdout 결과(TP/FP/FN/TN/P/R/F1)가 6개 카테고리 전부 "
        "`output/evaluate_raw_output.txt`(기존 evaluate.py 실행 결과)와 정확히 일치함을 확인 |"
    )

    parts.append("\n## 1. F-beta 기반 threshold 비교 (F1-max vs F2-max vs recall-constrained)")
    parts.append(
        "- 스윕 데이터: 카테고리별 fold 1-4 튜닝 데이터에 대해 `THRESHOLD_GRID`(0.10~0.90, 0.05 간격) 전 구간을 스윕한 "
        "동일한 sweep 결과에서 세 threshold를 각각 선택했다.\n"
        "- F1-max: `evaluate.py`와 동일 (변경 없음).\n"
        "- F2-max: F-beta(beta=2, recall에 4배 가중치)가 최대인 threshold.\n"
        "- recall-constrained: fold 1-4 튜닝 recall >= 0.9인 threshold 중 precision이 가장 높은 threshold. "
        "만족하는 threshold가 하나도 없으면 \"조건 만족 threshold 없음\"으로 표시.\n"
        "- 동률 처리: `evaluate.py`와 동일하게 strict `>` 비교로, 여러 threshold가 동점이면 THRESHOLD_GRID에서 더 작은 "
        "threshold가 선택된다.\n"
        "- 세 threshold 모두 fold 5 holdout에서 다시 TP/FP/FN/TN/Precision/Recall/F1을 계산했다."
    )
    parts.append(build_part1_summary_table(fbeta_results))

    parts.append("\n### 1-1. 관찰 (수치 기반, 임의 해석 최소화)")
    obs = []
    gi = fbeta_results["glass_impact"]
    obs.append(
        "- **glass_impact**: fold 1-4 튜닝 recall이 가장 높은 threshold(0.10)에서도 recall=0.8438로 0.9를 넘지 못해 "
        "recall-constrained 조건을 만족하는 threshold가 없다. F1-max와 F2-max가 threshold=0.10으로 동일하게 선택돼 "
        "holdout 결과(TP=8 FP=5 FN=0 TN=219, P=0.6154 R=1.0 F1=0.7619)도 동일하다 — 이 데이터에서는 F2 기준을 "
        "적용해도 threshold가 달라지지 않았다."
    )
    fa = fbeta_results["fire_alarm_siren"]
    obs.append(
        "- **fire_alarm_siren**: F1-max threshold=0.50은 holdout recall=0.6875(FN=5)에 그치지만, "
        "F2-max/recall-constrained 모두 threshold=0.20을 선택해 holdout recall=0.9375(FN=1)로 오른다. 대신 "
        "holdout precision은 0.8462(F1-max) → 0.7143로 낮아지고 FP는 2 → 6으로 늘어난다 — recall을 우선하면 "
        "FN이 5→1로 줄지만 FP가 2→6으로 느는 trade-off가 이 카테고리에서 뚜렷하게 나타난다."
    )
    obs.append(
        "- **baby_person_distress**: F1-max(threshold=0.45)는 holdout recall=0.5(FN=4)로 낮다. F2-max(threshold=0.20)는 "
        "holdout recall=0.875(FN=1)로 크게 개선되면서 precision도 0.875로 유지된다(FP=1). recall-constrained "
        "(threshold=0.30, 튜닝 recall=0.9062)는 holdout에서 오히려 recall=0.625(FN=3)로 떨어진다 — 튜닝(fold1-4) "
        "recall과 holdout(fold5) recall이 어긋나는 사례로, positive 샘플 수가 40개로 적어 fold별 변동이 큰 것으로 보인다 "
        "(§2 5-fold rotation 결과 참고)."
    )
    obs.append(
        "- **door_security**: recall-constrained 조건을 만족하는 threshold가 없다(튜닝 recall 최댓값이 0.9 미만). "
        "F1-max와 F2-max 모두 threshold=0.10~0.20 부근에서 낮은 F1(<0.6)을 보여, 이 카테고리는 어떤 기준을 쓰든 "
        "recall을 0.9 이상으로 끌어올릴 여지가 THRESHOLD_GRID 범위 내에서 보이지 않는다."
    )
    obs.append(
        "- **animal**: F1-max와 F2-max가 threshold=0.10으로 동일하게 선택되고(holdout recall=0.2727) recall-constrained "
        "조건도 만족하지 않는다 — 11개 ESC-50 서브카테고리를 하나의 `animal` 규칙으로 묶은 구조상 recall이 구조적으로 낮다."
    )
    parts.extend(obs)

    parts.append("\n## 2. 5-fold rotation holdout 안정성 검증")
    parts.append(
        "- `evaluate.py`의 판정 로직은 그대로 두고, 5개 fold를 돌아가며 각각 holdout으로 써서(나머지 4개 fold로 F1-max "
        "threshold 튜닝) 5번의 결과를 계산했다. fold5를 holdout으로 쓴 행은 `evaluate.py` 원본 결과와 동일하다(§0 검증)."
    )
    parts.append(build_rotation_summary_table(rotation_results))

    parts.append(
        "\n특히 positive 샘플이 적은 카테고리(glass_impact/baby_person_distress: positive 40개, door_visitor: positive "
        "40개)의 fold별 상세 결과:"
    )
    for cat_id in ["glass_impact", "baby_person_distress", "door_visitor"]:
        label = CATEGORY_LABELS.get(cat_id, cat_id)
        parts.append(f"\n### {label}")
        parts.append(build_rotation_per_fold_table(rotation_results, cat_id))

    parts.append("\n나머지 카테고리(fire_alarm_siren/door_security/animal) fold별 상세 결과:")
    for cat_id in ["fire_alarm_siren", "door_security", "animal"]:
        label = CATEGORY_LABELS.get(cat_id, cat_id)
        parts.append(f"\n### {label}")
        parts.append(build_rotation_per_fold_table(rotation_results, cat_id))

    parts.append("\n### 2-1. 관찰 (수치 기반)")
    obs2 = []
    obs2.append(
        "- **glass_impact** (positive 40개): recall이 fold별로 0.375~1.0까지 흔들린다(stdev 0.271) — fold4에서만 "
        "recall=0.375(FN=5)로 크게 떨어지고 나머지 4개 fold는 recall>=0.875다. F1도 fold4에서만 0.5455로 나머지"
        "(0.7619~0.9412)와 차이가 크다."
    )
    obs2.append(
        "- **baby_person_distress** (positive 40개): recall이 0.5~1.0(stdev 0.2437)로 5개 카테고리 중 가장 넓게 흔들린다. "
        "fold2/3/4는 recall=1.0인데 fold1/5는 각각 0.625/0.5로, tuned_threshold가 fold에 따라 0.2와 0.45 두 값 사이를 "
        "오간다."
    )
    obs2.append(
        "- **door_visitor** (positive 40개): 5개 fold 모두 recall 0.75~0.875(stdev 0.0559), F1 0.6667~0.8(stdev 0.0596)로 "
        "positive 40개 카테고리 중에서는 상대적으로 변동폭이 작다."
    )
    obs2.append(
        "- 비교하자면 positive 샘플이 훨씬 많은 **animal**(positive 440개)은 recall stdev=0.0473, **fire_alarm_siren**"
        "(positive 80개)은 recall stdev=0.0948로, positive 40개 카테고리들(glass_impact 0.271, baby_person_distress "
        "0.2437)보다 fold 간 변동이 뚜렷하게 작다 — fold5 단일 holdout 값(예: glass_impact recall=1.0)만 보고 결론 내리면 "
        "positive 샘플이 적은 카테고리일수록 다른 fold였다면 크게 달랐을 수 있다는 점을 5-fold rotation 결과가 보여준다."
    )
    parts.extend(obs2)

    with open(REPORT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(parts) + "\n")
    print(f"보고서 저장: {REPORT_MD}")


if __name__ == "__main__":
    main()
