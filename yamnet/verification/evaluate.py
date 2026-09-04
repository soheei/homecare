"""
evaluate.py — ESC-50 fold 기반 카테고리별 precision/recall 측정 (Plan.md 4단계)

event_rules.py의 threshold/window_frames 등은 전부 placeholder였다. 이 스크립트는
ESC-50에서 Plan.md §3 매칭표에 해당하는 클립만 뽑아 YAMNet으로 추론하고,
event_rules.CATEGORY_RULE_CONFIG를 category_id별로 실제 클립에 적용해본다.

방법론 (참고.md/Plan.md §1의 fold 분리 정신을 재사용하되, kNN 메모리 방식이 아니라
threshold sweep 방식으로 적용 — 우리 방법은 "정상음을 기억"하는 게 아니라 카테고리별
class score threshold이므로 그대로 이식할 수 없어 다음과 같이 조정함):
  - fold 1~4: threshold 후보(THRESHOLD_GRID)를 스윕해서 F1이 가장 높은 threshold 선택
  - fold 5: 위에서 고른 threshold로 **한 번만** precision/recall/F1 측정 (holdout,
    fold 5는 튜닝에 전혀 쓰지 않음 — 참고.md "fold 5를 보면서 조정하지 않았다"는 원칙 유지)

negative(음성) 예시의 범위: ESC-50 전체 50개 카테고리가 아니라, Plan.md §3에서 홈톡
카테고리에 매핑해둔 카테고리들끼리만 서로의 negative가 된다 (예: glass_impact 평가 시
negative = siren/crying_baby/door_wood_knock/dog/... 등 다른 홈톡 카테고리 클립).
즉 "전체 오탐률"이 아니라 "홈톡이 실제로 구분해야 하는 소리들 사이의 혼동 정도"를 재는
좁은 의미의 precision/recall이다 — rain/wind 같은 배경음 전체를 negative pool에 넣는
전수 평가는 이 스크립트 범위 밖이다 (필요하면 별도 확장 필요, §9에 기록).

duration(kitchen_risk)/meta_absence(long_silence)/combo_sequential(fall_suspect)는
각각 30분 지속·수 시간 활동 부재·낙상 시퀀스가 전제라 ESC-50의 5초 단일 클립 구조로는
평가 자체가 불가능해 제외한다 (UNSUPPORTED_CATEGORIES).

log_only(household_activity_log)/frequency_count(health_signal)는 rule_type 설계상
triggered가 항상 False라 precision/recall 계산이 성립하지 않는다 — 대신 "점수가 한 번이라도
threshold를 넘었는가(탐지율)"만 참고용으로 집계한다 (DETECTION_ONLY_CATEGORIES).

ambient_log(class_ids=TV/Music/Speech)는 ESC-50에 대응하는 카테고리 자체가 없어 평가할 수
없다 (UNSUPPORTED_CATEGORIES) — 2026-09-04, ambient_log/household_activity_log 분리 이후.
"""

import csv
import os
import sys

import numpy as np
import soundfile as sf

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, os.path.join(PROJECT_ROOT, "core"))

from category_map import SOUND_CATEGORIES  # noqa: E402,F401 (참고용 — 전체 카테고리 목록 확인)
from event_rules import CATEGORY_RULE_CONFIG  # noqa: E402
from yamnet_core import infer, load_yamnet, preprocess  # noqa: E402

ESC50_AUDIO_DIR = os.path.join(PROJECT_ROOT, "ESC-50", "audio")
ESC50_META_CSV = os.path.join(PROJECT_ROOT, "ESC-50", "meta", "esc50.csv")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
THRESHOLD_SWEEP_CSV = os.path.join(OUTPUT_DIR, "threshold_sweep.csv")
DETECTION_SWEEP_CSV = os.path.join(OUTPUT_DIR, "detection_rate_sweep.csv")

# Plan.md §3 매칭표 — 홈톡 category_id -> 대응하는 ESC-50 category 이름들
POSITIVE_ESC50_CATEGORIES = {
    "glass_impact": ["glass_breaking"],
    "fire_alarm_siren": ["siren", "clock_alarm"],  # clock_alarm은 §3에서 명시한 대리 신호
    "baby_person_distress": ["crying_baby"],
    "door_visitor": ["door_wood_knock"],
    "door_security": ["door_wood_knock", "door_wood_creaks"],
    "animal": [
        "dog", "cat", "cow", "hen", "rooster", "sheep", "pig", "frog", "crow",
        "chirping_birds", "insects",
    ],
    "health_signal": ["coughing", "sneezing", "snoring", "breathing"],
    # household_activity_log: washing_machine/mouse_click/can_opening은 대응하는 YAMNet
    # 클래스가 없어 제외 (category_map.py 참고)
    "household_activity_log": [
        "vacuum_cleaner", "keyboard_typing", "clapping", "brushing_teeth",
        "drinking_sipping", "footsteps", "laughing", "toilet_flush",
    ],
}

DETECTION_ONLY_CATEGORIES = {"household_activity_log", "health_signal"}

UNSUPPORTED_CATEGORIES = {
    "kitchen_risk": "duration 규칙(min_duration_sec=1800)은 ESC-50 5초 클립으로 평가 불가",
    "long_silence": "meta_absence 규칙(수 시간 활동 부재)은 ESC-50 5초 클립으로 평가 불가",
    "fall_suspect": "ESC-50에 Thud→Scream 순차 시퀀스 샘플이 없음",
    "ambient_log": "class_ids가 TV/Music/Speech인데 ESC-50엔 이 세 카테고리가 없어 평가 불가",
}

THRESHOLD_GRID = [round(x, 2) for x in np.arange(0.10, 0.95, 0.05)]


def load_esc50_meta():
    with open(ESC50_META_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def infer_clip_scores(model, filename):
    path = os.path.join(ESC50_AUDIO_DIR, filename)
    audio, sample_rate = sf.read(path)
    audio = preprocess(audio, sample_rate)
    scores, _embeddings, _spectrogram = infer(model, audio)
    return scores


def build_scores_cache(model, filenames):
    cache = {}
    total = len(filenames)
    for i, filename in enumerate(filenames, start=1):
        cache[filename] = infer_clip_scores(model, filename)
        if i % 100 == 0 or i == total:
            print(f"  ...{i}/{total} clips inferred")
    return cache


def run_rule(category_id, scores, threshold):
    config = CATEGORY_RULE_CONFIG[category_id]
    kwargs = dict(config["kwargs"])
    kwargs["threshold"] = threshold
    return config["fn"](scores, **kwargs)


def precision_recall_f1(tp, fp, fn):
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    return precision, recall, f1


def confusion_counts(category_id, rows, scores_cache, threshold, positive_names):
    tp = fp = fn = tn = 0
    for row in rows:
        label = 1 if row["category"] in positive_names else 0
        pred = 1 if run_rule(category_id, scores_cache[row["filename"]], threshold).triggered else 0
        if pred == 1 and label == 1:
            tp += 1
        elif pred == 1 and label == 0:
            fp += 1
        elif pred == 0 and label == 1:
            fn += 1
        else:
            tn += 1
    return tp, fp, fn, tn


def evaluate_category(category_id, relevant_rows, scores_cache):
    positive_names = set(POSITIVE_ESC50_CATEGORIES[category_id])

    tuning_rows = [r for r in relevant_rows if int(r["fold"]) <= 4]
    holdout_rows = [r for r in relevant_rows if int(r["fold"]) == 5]

    threshold_sweep = []
    best_threshold, best_f1 = THRESHOLD_GRID[0], -1.0
    for threshold in THRESHOLD_GRID:
        tp, fp, fn, _tn = confusion_counts(category_id, tuning_rows, scores_cache, threshold, positive_names)
        precision, recall, f1 = precision_recall_f1(tp, fp, fn)
        threshold_sweep.append(dict(
            threshold=threshold,
            precision=round(precision, 3),
            recall=round(recall, 3),
            f1=round(f1, 3),
        ))
        if f1 > best_f1:
            best_f1 = f1
            best_threshold = threshold

    tp, fp, fn, tn = confusion_counts(category_id, holdout_rows, scores_cache, best_threshold, positive_names)
    precision, recall, f1 = precision_recall_f1(tp, fp, fn)

    return dict(
        category_id=category_id,
        tuned_threshold=best_threshold,
        tuning_f1=round(best_f1, 3),
        threshold_sweep=threshold_sweep,
        holdout_tp=tp,
        holdout_fp=fp,
        holdout_fn=fn,
        holdout_tn=tn,
        precision=round(precision, 3),
        recall=round(recall, 3),
        f1=round(f1, 3),
    )


def evaluate_detection_only(category_id, relevant_rows, scores_cache):
    positive_names = set(POSITIVE_ESC50_CATEGORIES[category_id])
    config = CATEGORY_RULE_CONFIG[category_id]

    positive_rows = [r for r in relevant_rows if r["category"] in positive_names]
    total = len(positive_rows)

    def detection_rate_at(threshold):
        detected = sum(
            1 for row in positive_rows
            if len(run_rule(category_id, scores_cache[row["filename"]], threshold).trigger_frames) > 0
        )
        return detected, round(detected / total, 3) if total else 0.0

    detection_sweep = []
    for threshold in THRESHOLD_GRID:
        _detected, rate = detection_rate_at(threshold)
        detection_sweep.append(dict(threshold=threshold, detection_rate=rate))

    default_threshold = config["kwargs"].get("threshold", 0.3)
    detected, detection_rate = detection_rate_at(default_threshold)

    return dict(
        category_id=category_id,
        total_positive_clips=total,
        detected=detected,
        detection_rate=detection_rate,
        detection_sweep=detection_sweep,
    )


def save_threshold_sweep_csv(results, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["category_id", "threshold", "precision", "recall", "f1"])
        for category_id, r in results.items():
            for point in r.get("threshold_sweep", []):
                writer.writerow([
                    category_id,
                    point["threshold"],
                    point["precision"],
                    point["recall"],
                    point["f1"],
                ])


def save_detection_sweep_csv(results, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["category_id", "threshold", "detection_rate"])
        for category_id, r in results.items():
            for point in r.get("detection_sweep", []):
                writer.writerow([category_id, point["threshold"], point["detection_rate"]])


def main():
    print("Loading ESC-50 metadata...")
    meta_rows = load_esc50_meta()

    needed_categories = set()
    for names in POSITIVE_ESC50_CATEGORIES.values():
        needed_categories.update(names)

    relevant_rows = [r for r in meta_rows if r["category"] in needed_categories]
    filenames = [r["filename"] for r in relevant_rows]

    print(
        f"Loading YAMNet and running inference on {len(filenames)} clips "
        f"({len(needed_categories)} ESC-50 categories used)..."
    )
    model = load_yamnet()
    scores_cache = build_scores_cache(model, filenames)

    print()
    print("=" * 70)
    print("정량 평가 결과 (threshold는 fold 1~4로 튜닝, precision/recall은 fold 5 holdout)")
    print("=" * 70)

    results = {}
    for category_id in POSITIVE_ESC50_CATEGORIES:
        if category_id in DETECTION_ONLY_CATEGORIES:
            r = evaluate_detection_only(category_id, relevant_rows, scores_cache)
            results[category_id] = r
            print(f"\n[{category_id}]  (log_only/frequency_count — 탐지율만 집계, precision/recall 아님)")
            print(
                f"  positive_clips={r['total_positive_clips']}  detected={r['detected']}  "
                f"detection_rate={r['detection_rate']}"
            )
        else:
            r = evaluate_category(category_id, relevant_rows, scores_cache)
            results[category_id] = r
            print(f"\n[{category_id}]")
            print(f"  tuned_threshold(fold1-4, F1 기준)={r['tuned_threshold']}  (tuning_f1={r['tuning_f1']})")
            print(
                f"  holdout(fold5): TP={r['holdout_tp']} FP={r['holdout_fp']} "
                f"FN={r['holdout_fn']} TN={r['holdout_tn']}"
            )
            print(f"  precision={r['precision']}  recall={r['recall']}  f1={r['f1']}")

    print()
    print("=" * 70)
    print("평가 불가 카테고리 (구조적 이유 — 이 스크립트 범위 밖):")
    for cat, reason in UNSUPPORTED_CATEGORIES.items():
        print(f"  - {cat}: {reason}")

    save_threshold_sweep_csv(results, THRESHOLD_SWEEP_CSV)
    save_detection_sweep_csv(results, DETECTION_SWEEP_CSV)
    print()
    print(f"Threshold sweep 결과 저장: {THRESHOLD_SWEEP_CSV}")
    print(f"Detection-rate sweep 결과 저장: {DETECTION_SWEEP_CSV}")

    return results


if __name__ == "__main__":
    main()
