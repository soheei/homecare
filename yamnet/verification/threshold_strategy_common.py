"""
threshold_strategy_common.py — evaluate.py 후속 분석(F-beta 비교, 5-fold rotation)이
공유하는 데이터 준비 로직.

evaluate.py 자체는 건드리지 않고 그 안의 판정 로직(run_rule/confusion_counts/
precision_recall_f1/THRESHOLD_GRID/POSITIVE_ESC50_CATEGORIES/load_esc50_meta/
build_scores_cache/load_yamnet)을 그대로 import해서 재사용한다.

YAMNet 추론은 (파일, 모델) 조합에만 의존하고 threshold/fold 선택과는 무관하므로,
F1 계산이 가능한 6개 카테고리(glass_impact/fire_alarm_siren/baby_person_distress/
door_visitor/door_security/animal)에 필요한 클립만 한 번 추론해서 로컬에 캐시해두고
두 분석 스크립트(threshold_strategy_fbeta.py, fold_rotation_holdout.py)가 재사용한다.
"""

import os
import pickle

from evaluate import (
    DETECTION_ONLY_CATEGORIES,
    POSITIVE_ESC50_CATEGORIES,
    OUTPUT_DIR,
    build_scores_cache,
    load_esc50_meta,
    load_yamnet,
)

# F1(precision/recall) 계산이 가능한 6개 카테고리 — DETECTION_ONLY_CATEGORIES(health_signal,
# household_activity_log) 제외. evaluate.py의 UNSUPPORTED_CATEGORIES는 애초에
# POSITIVE_ESC50_CATEGORIES에 없으므로 여기 대상에서 자연히 빠진다.
F1_CATEGORY_IDS = [
    cat_id for cat_id in POSITIVE_ESC50_CATEGORIES if cat_id not in DETECTION_ONLY_CATEGORIES
]

SCORES_CACHE_PATH = os.path.join(OUTPUT_DIR, "_scores_cache_f1_categories.pkl")


def load_relevant_rows():
    """ESC-50 메타 중 evaluate.py의 main()과 동일한 negative pool을 반환.

    주의: F1_CATEGORY_IDS(6개)만 스코어링하더라도, negative pool은 evaluate.py의
    main()처럼 POSITIVE_ESC50_CATEGORIES 전체(health_signal/household_activity_log
    포함, 8개 카테고리)를 union해야 한다 — 그래야 confusion_counts에서 각 카테고리의
    negative 샘플 구성이 evaluate.py가 만든 threshold_sweep.csv와 동일해진다.
    (health_signal/household_activity_log의 ESC-50 클립도 다른 카테고리 입장에선
    negative이므로 이 둘을 negative pool에서 빼면 FP 분모가 줄어 precision이 부풀려진다.)
    """
    meta_rows = load_esc50_meta()
    needed_categories = set()
    for names in POSITIVE_ESC50_CATEGORIES.values():
        needed_categories.update(names)
    return [r for r in meta_rows if r["category"] in needed_categories]


def get_scores_cache(relevant_rows, use_disk_cache=True):
    """scores_cache를 로컬 pickle에서 로드하거나, 없으면 YAMNet 추론 후 저장.

    threshold_strategy_fbeta.py와 fold_rotation_holdout.py가 같은 캐시 파일을
    공유하므로, 두 스크립트를 각각 실행해도 YAMNet 추론은 처음 한 번만 일어난다.
    """
    filenames = [r["filename"] for r in relevant_rows]

    if use_disk_cache and os.path.exists(SCORES_CACHE_PATH):
        print(f"scores_cache 로컬 캐시 발견: {SCORES_CACHE_PATH} (YAMNet 추론 생략)")
        with open(SCORES_CACHE_PATH, "rb") as f:
            cache = pickle.load(f)
        missing = [fn for fn in filenames if fn not in cache]
        if not missing:
            return cache
        print(f"  캐시에 없는 클립 {len(missing)}개 발견 — 해당 클립만 추가 추론")
        model = load_yamnet()
        cache.update(build_scores_cache(model, missing))
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        with open(SCORES_CACHE_PATH, "wb") as f:
            pickle.dump(cache, f)
        return cache

    print(f"YAMNet 로드 및 {len(filenames)}개 클립 추론...")
    model = load_yamnet()
    cache = build_scores_cache(model, filenames)
    if use_disk_cache:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        with open(SCORES_CACHE_PATH, "wb") as f:
            pickle.dump(cache, f)
        print(f"scores_cache 저장: {SCORES_CACHE_PATH}")
    return cache
