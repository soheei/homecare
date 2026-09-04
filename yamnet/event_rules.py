"""
event_rules.py — YAMNet 프레임 스코어에 대한 후처리 판정 규칙 (Plan.md §2.3, 3단계)

입력은 YAMNet model(audio)가 반환하는 프레임 단위 scores 행렬
(shape: [num_frames, 521]). mediatest.py의 classify_audio()는 지금 이걸 프레임
평균으로 뭉개버리므로, 이 모듈을 실제로 쓰려면 평균 내기 전의 원본 scores를 그대로
넘겨야 한다 (1단계 "기반 함수 분리" 시 반영 필요 — 아직 안 함, Plan.md 참고).

프레임 타이밍: YAMNet은 0.96초 window를 0.48초 hop으로 슬라이딩한다 (참고.md).
프레임 i는 대략 i * FRAME_HOP_SEC 지점을 나타내는 근사치다 (모델이 정확한
타임스탬프를 별도로 주지 않음).

카테고리별 rule_type 배정은 category_map.py의 SOUND_CATEGORIES를 따른다.
threshold/window_frames 등 수치는 전부 placeholder 기본값 — Plan.md 4단계
(evaluate.py)에서 ESC-50 fold 4(정상음 기준)로 실측 튜닝하기 전까지는 확정값이 아니다.
"""

from dataclasses import dataclass, field
from typing import List, Optional
import numpy as np

from category_map import SOUND_CATEGORIES, get_category

FRAME_HOP_SEC = 0.48


@dataclass
class RuleResult:
    category_id: str
    triggered: bool
    trigger_frames: List[int] = field(default_factory=list)
    detail: str = ""

    def trigger_times_sec(self) -> List[float]:
        return [round(f * FRAME_HOP_SEC, 2) for f in self.trigger_frames]


def _group_score(scores: np.ndarray, class_ids: List[int]) -> np.ndarray:
    """프레임별로 class_ids 중 최댓값 점수. shape (num_frames,)"""
    return scores[:, class_ids].max(axis=1)


def _collapse(frame_indices: List[int]) -> List[int]:
    return sorted(set(frame_indices))


# ---------------------------------------------------------------------------
# 1. 단일 임계값 (threshold) — 구현 쉬우나 오탐 많음. 저위험 카테고리에 적합
#    (door_visitor, door_security, animal)
# ---------------------------------------------------------------------------

def rule_threshold(scores, class_ids, threshold=0.3) -> RuleResult:
    s = _group_score(scores, class_ids)
    frames = np.where(s >= threshold)[0].tolist()
    return RuleResult("threshold", len(frames) > 0, frames)


# ---------------------------------------------------------------------------
# 2. N-프레임 다수결 (majority_vote) — 지속형 이벤트에 적합 (아기 울음 등)
# ---------------------------------------------------------------------------

def rule_majority_vote(scores, class_ids, threshold=0.3, window_frames=5, min_votes=3) -> RuleResult:
    s = _group_score(scores, class_ids)
    hits = s >= threshold
    n = len(hits)
    frames = []
    for start in range(max(n - window_frames + 1, 1)):
        window = hits[start:start + window_frames]
        if window.sum() >= min_votes:
            frames.extend(range(start, start + len(window)))
    return RuleResult("majority_vote", len(frames) > 0, _collapse(frames))


# ---------------------------------------------------------------------------
# 3a. 클래스 조합(동시 발생, combo_window) — 유리 파손:
#     Glass/Crack 그룹 + Shatter/Breaking 그룹이 짧은 시간창 안에서 함께 상승
# ---------------------------------------------------------------------------

def rule_combo_cooccurrence(scores, class_id_groups, threshold=0.3, window_frames=3, min_groups=None) -> RuleResult:
    """class_id_groups: [[group1 idx...], [group2 idx...], ...].
    window_frames 안에서 min_groups개 이상의 그룹이 각각 threshold를 넘으면 트리거.
    min_groups 기본값 = len(class_id_groups) (전부 필요)."""
    if min_groups is None:
        min_groups = len(class_id_groups)

    group_hits = [_group_score(scores, g) >= threshold for g in class_id_groups]
    n = len(scores)
    frames = []
    for start in range(max(n - window_frames + 1, 1)):
        end = min(start + window_frames, n)
        hit_count = sum(1 for h in group_hits if h[start:end].any())
        if hit_count >= min_groups:
            frames.extend(range(start, end))
    return RuleResult("combo_cooccurrence", len(frames) > 0, _collapse(frames))


# ---------------------------------------------------------------------------
# 3b. 클래스 조합(순차 발생, combo_window) — 낙상 의심:
#     Thud 발생 후 window_frames 이내에 Groan/Screaming/Shout가 뒤이어야 트리거
# ---------------------------------------------------------------------------

def rule_combo_sequential(scores, ordered_class_id_groups, threshold=0.3, window_frames=6) -> RuleResult:
    """ordered_class_id_groups[0]이 발생한 프레임 이후 window_frames 이내에
    ordered_class_id_groups[1]이 발생해야 트리거 (그룹이 3개 이상이면 순서대로 연쇄 검사)."""
    hits = [_group_score(scores, g) >= threshold for g in ordered_class_id_groups]
    n = len(scores)
    frames = []

    anchors = np.where(hits[0])[0].tolist()
    for i in anchors:
        cur = i
        chain = [i]
        ok = True
        for nxt_hits in hits[1:]:
            end = min(cur + window_frames, n)
            following = np.where(nxt_hits[cur:end])[0]
            if len(following) == 0:
                ok = False
                break
            cur = cur + int(following[0])
            chain.append(cur)
        if ok:
            frames.extend(chain)

    return RuleResult("combo_sequential", len(frames) > 0, _collapse(frames))


# ---------------------------------------------------------------------------
# 4. 지속시간 기반 (duration) — 주방 위험 전조: 물소리 등이 오래 이어질 때만 트리거
# ---------------------------------------------------------------------------

def rule_duration(scores, class_ids, threshold=0.3, min_duration_sec=1800, max_gap_frames=2) -> RuleResult:
    """짧은 끊김(max_gap_frames 이하)은 무시하고, threshold 이상 구간이
    min_duration_sec 이상 이어지면 트리거."""
    s = _group_score(scores, class_ids)
    hits = s >= threshold
    n = len(hits)
    min_duration_frames = max(int(round(min_duration_sec / FRAME_HOP_SEC)), 1)

    frames = []
    run_start = None
    gap = 0
    for i in range(n):
        if hits[i]:
            if run_start is None:
                run_start = i
            gap = 0
        elif run_start is not None:
            gap += 1
            if gap > max_gap_frames:
                run_end = i - gap
                if run_end - run_start >= min_duration_frames:
                    frames.extend(range(run_start, run_end))
                run_start = None
                gap = 0
    if run_start is not None and n - run_start >= min_duration_frames:
        frames.extend(range(run_start, n))

    return RuleResult("duration", len(frames) > 0, _collapse(frames))


# ---------------------------------------------------------------------------
# 5. 빈도 집계 (frequency_count) — 건강 이상 신호음: 즉시 알림 없이 횟수만 집계
# ---------------------------------------------------------------------------

def rule_frequency_count(scores, class_ids, threshold=0.3, min_gap_frames=2) -> RuleResult:
    """threshold를 넘는 연속 구간을 '사건' 1건으로 묶어 횟수를 센다.
    triggered는 항상 False — 알림이 아니라 집계용 (일일 브리핑 반영)."""
    s = _group_score(scores, class_ids)
    hits = s >= threshold
    frames = np.where(hits)[0].tolist()

    count = 0
    gap = min_gap_frames + 1
    for h in hits:
        if h:
            if gap > min_gap_frames:
                count += 1
            gap = 0
        else:
            gap += 1

    return RuleResult("frequency_count", False, frames, detail=f"count={count}")


# ---------------------------------------------------------------------------
# 6. 메타 규칙: 활동 부재 (meta_absence) — 장시간 무음/무활동
# ---------------------------------------------------------------------------

def rule_meta_absence(scores, activity_class_ids, threshold=0.2, min_absence_sec=3 * 3600) -> RuleResult:
    """activity_class_ids(Speech, Walk/footsteps 등)가 threshold를 넘는 프레임이
    min_absence_sec 동안 한 번도 없으면 트리거. 'Silence 클래스가 뜨는가'가 아니라
    '활동 신호가 부재한가'가 기준 (category_map.py의 rule_type 노트 참고)."""
    s = _group_score(scores, activity_class_ids)
    active = s >= threshold
    n = len(active)
    min_absence_frames = max(int(round(min_absence_sec / FRAME_HOP_SEC)), 1)

    frames = []
    run_start = 0
    for i in range(n):
        if active[i]:
            if i - run_start >= min_absence_frames:
                frames.extend(range(run_start, i))
            run_start = i + 1
    if n - run_start >= min_absence_frames:
        frames.extend(range(run_start, n))

    return RuleResult("meta_absence", len(frames) > 0, _collapse(frames))


# ---------------------------------------------------------------------------
# 7. 로그 전용 (log_only) — 생활 소음: 알림 없이 로그만 (오탐 디버깅용)
# ---------------------------------------------------------------------------

def rule_log_only(scores, class_ids, threshold=0.3) -> RuleResult:
    s = _group_score(scores, class_ids)
    frames = np.where(s >= threshold)[0].tolist()
    return RuleResult("log_only", False, frames)


# ---------------------------------------------------------------------------
# 카테고리 → 규칙 함수/파라미터 배정
#
# class_ids는 가능한 한 category_map.py를 단일 출처로 재사용한다. combo 계열은
# category_map.py에 없는 "그룹핑/순서" 정보가 추가로 필요해 여기서 직접 명시했다.
# ---------------------------------------------------------------------------

def _cat_class_ids(category_id: str) -> List[int]:
    return get_category(category_id).class_ids


CATEGORY_RULE_CONFIG = {
    "fire_alarm_siren": dict(
        fn=rule_combo_cooccurrence,
        kwargs=dict(
            class_id_groups=[[i] for i in _cat_class_ids("fire_alarm_siren")],
            threshold=0.3,
            window_frames=3,
            min_groups=1,  # locked, 즉시 알림 정책 — 클래스 1개만 넘어도 트리거.
                           # 2개 이상 동시 상승은 신뢰도를 높이는 참고 정보로만 활용 (evidence).
        ),
    ),
    "glass_impact": dict(
        fn=rule_combo_cooccurrence,
        kwargs=dict(
            class_id_groups=[[435, 434], [437, 464]],  # Glass/Crack 그룹 vs Shatter/Breaking 그룹
            threshold=0.3,
            window_frames=3,
            min_groups=2,  # Plan §2.2: "동시 상승 시 신뢰도 ↑" → 두 그룹 다 필요
        ),
    ),
    "fall_suspect": dict(
        fn=rule_combo_sequential,
        kwargs=dict(
            ordered_class_id_groups=[[454], [33, 11, 6]],  # Thud -> Groan/Screaming/Shout
            threshold=0.3,
            window_frames=6,
        ),
    ),
    "baby_person_distress": dict(
        fn=rule_majority_vote,
        kwargs=dict(
            class_ids=_cat_class_ids("baby_person_distress"),
            threshold=0.3,
            window_frames=5,
            min_votes=3,
        ),
    ),
    "door_visitor": dict(
        fn=rule_threshold,
        kwargs=dict(class_ids=_cat_class_ids("door_visitor"), threshold=0.3),
    ),
    "door_security": dict(
        fn=rule_threshold,
        kwargs=dict(class_ids=_cat_class_ids("door_security"), threshold=0.3),
    ),
    "long_silence": dict(
        fn=rule_meta_absence,
        kwargs=dict(
            activity_class_ids=[0, 48],  # Speech, Walk/footsteps — Silence(494) 자체는 제외
            threshold=0.2,
            min_absence_sec=3 * 3600,
        ),
    ),
    "health_signal": dict(
        fn=rule_frequency_count,
        kwargs=dict(class_ids=_cat_class_ids("health_signal"), threshold=0.3),
    ),
    "kitchen_risk": dict(
        fn=rule_duration,
        kwargs=dict(class_ids=_cat_class_ids("kitchen_risk"), threshold=0.3, min_duration_sec=1800),
    ),
    "animal": dict(
        fn=rule_threshold,
        kwargs=dict(class_ids=_cat_class_ids("animal"), threshold=0.3),
    ),
    "ambient_log": dict(
        fn=rule_log_only,
        kwargs=dict(class_ids=_cat_class_ids("ambient_log"), threshold=0.3),
    ),
}


def evaluate_category(category_id: str, scores: np.ndarray) -> RuleResult:
    config = CATEGORY_RULE_CONFIG.get(category_id)
    if config is None:
        raise KeyError(f"CATEGORY_RULE_CONFIG에 없는 category_id: {category_id}")
    result = config["fn"](scores, **config["kwargs"])
    result.category_id = category_id
    return result


def evaluate_all(scores: np.ndarray) -> List[RuleResult]:
    return [evaluate_category(c.category_id, scores) for c in SOUND_CATEGORIES]


# ---------------------------------------------------------------------------
# 자체 테스트 (모델 불필요 — 합성 scores로 각 rule_type 동작 검증)
# ---------------------------------------------------------------------------

def _self_test():
    num_frames = 20
    num_classes = 521

    def blank():
        return np.zeros((num_frames, num_classes), dtype=np.float32)

    # 1) threshold
    s = blank()
    s[5, 349] = 0.9  # Doorbell
    r = rule_threshold(s, [349, 350, 353], threshold=0.5)
    assert r.triggered and r.trigger_frames == [5], r

    # 2) majority_vote
    s = blank()
    for f in (10, 11, 13):
        s[f, 19] = 0.6  # Crying, sobbing
    r = rule_majority_vote(s, [20, 19, 11, 6, 33], threshold=0.5, window_frames=5, min_votes=3)
    assert r.triggered, r
    r_no = rule_majority_vote(blank(), [20, 19, 11, 6, 33], threshold=0.5, window_frames=5, min_votes=3)
    assert not r_no.triggered, r_no

    # 3a) combo_cooccurrence: 한쪽 그룹만 있으면 미트리거, 둘 다 있으면 트리거
    s = blank()
    s[8, 435] = 0.8  # Glass
    r = rule_combo_cooccurrence(s, [[435, 434], [437, 464]], threshold=0.5, window_frames=3, min_groups=2)
    assert not r.triggered, r
    s[9, 437] = 0.8  # Shatter (3프레임 창 안)
    r = rule_combo_cooccurrence(s, [[435, 434], [437, 464]], threshold=0.5, window_frames=3, min_groups=2)
    assert r.triggered, r

    # 3b) combo_sequential: Thud만 있으면 미트리거, 이후 Scream이 따라오면 트리거
    s = blank()
    s[3, 454] = 0.8  # Thud
    r = rule_combo_sequential(s, [[454], [33, 11, 6]], threshold=0.5, window_frames=6)
    assert not r.triggered, r
    s[6, 11] = 0.8  # Screaming, window 안
    r = rule_combo_sequential(s, [[454], [33, 11, 6]], threshold=0.5, window_frames=6)
    assert r.triggered, r

    # 4) duration: 충분히 길게 이어지면 트리거, 기준을 올리면 미트리거
    s = blank()
    s[0:15, 364] = 0.8  # Water tap, faucet
    r = rule_duration(s, [364], threshold=0.5, min_duration_sec=5 * FRAME_HOP_SEC)
    assert r.triggered, r
    r_no = rule_duration(s, [364], threshold=0.5, min_duration_sec=100 * FRAME_HOP_SEC)
    assert not r_no.triggered, r_no

    # 5) frequency_count: 항상 triggered=False, count만 집계
    s = blank()
    s[2, 42] = 0.9
    s[10, 42] = 0.9
    r = rule_frequency_count(s, [42, 44, 38, 37], threshold=0.5)
    assert not r.triggered and r.detail == "count=2", r

    # 6) meta_absence: 앞부분에만 활동 신호, 이후로 계속 부재
    s = blank()
    s[0, 0] = 0.9  # Speech
    r = rule_meta_absence(s, [0, 48], threshold=0.5, min_absence_sec=10 * FRAME_HOP_SEC)
    assert r.triggered, r

    # 7) log_only: 항상 triggered=False
    s = blank()
    s[0, 518] = 0.9
    r = rule_log_only(s, [518, 132, 0], threshold=0.5)
    assert not r.triggered and r.trigger_frames == [0], r

    print("OK — 7가지 rule_type 자체 테스트(합성 데이터) 전부 통과")

    missing = [c.category_id for c in SOUND_CATEGORIES if c.category_id not in CATEGORY_RULE_CONFIG]
    if missing:
        raise AssertionError(f"CATEGORY_RULE_CONFIG 누락: {missing}")
    print(f"OK — SOUND_CATEGORIES {len(SOUND_CATEGORIES)}개 전부 CATEGORY_RULE_CONFIG에 등록됨")


if __name__ == "__main__":
    _self_test()
