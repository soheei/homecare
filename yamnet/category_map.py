"""
category_map.py — 키워드 그룹(sound_categories) 마스터 데이터

Plan.md §3-1 마스터 테이블을 코드화한 것. 각 class_id는 tensorflow/models
yamnet_class_map.csv(2026-09-04, yamnet_class_map.csv 파일로 저장해둔 버전) 기준으로
verify_against_class_map()을 통해 실제 검증했다.

검증 중 발견한 Plan.md 대비 차이점 (Plan.md도 함께 갱신함):
- Glass의 index는 35가 아니라 435. 35는 "Whistling"이었음 (오타로 추정, 수정함).
- Smoke detector, smoke alarm(393)이 fire_alarm_siren에 빠져있어 추가.
- Breaking(464)이 glass_impact에 빠져있어 추가 (Crack(434)과 별개 클래스로 존재).
"""

from dataclasses import dataclass, field
from typing import List

# index: display_name (yamnet_class_map.csv에서 검증한 값)
CLASS_NAMES = {
    0: "Speech",
    6: "Shout",
    11: "Screaming",
    19: "Crying, sobbing",
    20: "Baby cry, infant cry",
    33: "Groan",
    37: "Wheeze",
    38: "Snoring",
    42: "Cough",
    44: "Sneeze",
    48: "Walk, footsteps",
    70: "Bark",
    78: "Meow",
    132: "Music",
    348: "Door",
    349: "Doorbell",
    350: "Ding-dong",
    352: "Slam",
    353: "Knock",
    358: "Dishes, pots, and pans",
    362: "Microwave oven",
    364: "Water tap, faucet",
    382: "Alarm",
    390: "Siren",
    393: "Smoke detector, smoke alarm",
    394: "Fire alarm",
    434: "Crack",
    435: "Glass",
    437: "Shatter",
    450: "Boiling",
    454: "Thump, thud",
    464: "Breaking",
    494: "Silence",
    518: "Television",
}


@dataclass(frozen=True)
class SoundCategory:
    category_id: str
    label: str
    class_ids: List[int]
    default_risk_level: str  # "높음" | "중간" | "낮음" | "정보성" | "로그전용"
    locked: bool             # True면 완전 무음/OFF 설정 불가 (Plan.md §2.6)
    rule_type: str           # Plan.md §2.3 후처리 전략: threshold | majority_vote | combo_window | duration | frequency_count | meta_absence | log_only
    notes: str = ""


SOUND_CATEGORIES: List[SoundCategory] = [
    SoundCategory(
        category_id="fire_alarm_siren",
        label="경보음/사이렌",
        class_ids=[394, 382, 390, 393],  # Fire alarm, Alarm, Siren, Smoke detector·smoke alarm
        default_risk_level="높음",
        locked=True,
        rule_type="combo_window",
        notes="'화재 경보음' 감지이지 실제 불소리 아님에 유의. Fire(292)/Crackle(293) 실제 불소리 "
              "클래스는 존재 확인했으나 아직 미채택 (Plan.md §9).",
    ),
    SoundCategory(
        category_id="glass_impact",
        label="파손/충격음",
        class_ids=[435, 437, 454, 434, 464],  # Glass, Shatter, Thump/thud, Crack, Breaking
        default_risk_level="높음",
        locked=True,  # 제안, 확인 필요 — Plan.md §9
        rule_type="combo_window",
        notes="Glass+Shatter(또는 Breaking) 동시 상승 시 신뢰도 상승 (event_rules.py에서 조합 판정)",
    ),
    SoundCategory(
        category_id="fall_suspect",
        label="낙상 의심",
        class_ids=[454, 33, 11, 6],  # Thump/thud -> Groan / Screaming / Shout 순차 조합
        default_risk_level="높음",
        locked=False,
        rule_type="combo_window",
        notes="Thud 이후 Groan/Screaming/Shout가 순차로 발생할 때만 트리거 (순서 검증 필요)",
    ),
    SoundCategory(
        category_id="baby_person_distress",
        label="아기/사람 위급 소리",
        class_ids=[20, 19, 11, 6, 33],
        default_risk_level="높음",
        locked=False,
        rule_type="majority_vote",
    ),
    SoundCategory(
        category_id="door_visitor",
        label="출입/방문(초인종)",
        class_ids=[349, 350, 353],
        default_risk_level="낮음",
        locked=False,
        rule_type="threshold",
    ),
    SoundCategory(
        category_id="door_security",
        label="문/보안(확장)",
        class_ids=[348, 352, 353],
        default_risk_level="낮음",  # 제안, 확인 필요 — Plan.md §9
        locked=False,
        rule_type="threshold",
    ),
    SoundCategory(
        category_id="long_silence",
        label="장시간 무음/무활동",
        class_ids=[494, 0, 48],  # Silence, Speech, Walk·footsteps — '부재' 판정에 사용
        default_risk_level="중간",  # 제안, 확인 필요 — Plan.md §9
        locked=False,
        rule_type="meta_absence",
        notes="class_ids는 개별 탐지가 아니라 '지난 N시간 활동신호 부재' 메타 규칙 입력값으로 사용",
    ),
    SoundCategory(
        category_id="health_signal",
        label="건강 이상 신호음",
        class_ids=[42, 44, 38, 37],
        default_risk_level="정보성",
        locked=False,
        rule_type="frequency_count",
        notes="즉시 알림 없음 — 빈도 집계 후 일일 브리핑에 반영",
    ),
    SoundCategory(
        category_id="kitchen_risk",
        label="주방 위험 전조",
        class_ids=[364, 450, 362, 358],
        default_risk_level="중간",
        locked=False,
        rule_type="duration",
        notes="예: 물소리 30분 이상 지속 등 — 단일 프레임 감지로는 트리거하지 않음",
    ),
    SoundCategory(
        category_id="animal",
        label="동물 소리",
        class_ids=[70, 78],
        default_risk_level="낮음",
        locked=False,
        rule_type="threshold",
        notes="기본 OFF 대상 — sound_categories 마스터 스키마에는 enabled 필드가 없어 "
              "user_category_settings.enabled 기본값을 false로 두는 방식으로 구현 필요 (백엔드 확인 필요)",
    ),
    SoundCategory(
        category_id="ambient_log",
        label="생활 소음(로그용)",
        class_ids=[518, 132, 0],  # Television, Music, Speech
        default_risk_level="로그전용",
        locked=False,
        rule_type="log_only",
        notes="알림 대상 아님 — 오탐 디버깅용 로그만 남김",
    ),
]

EXCLUDED_CATEGORIES_NOTE = (
    "외부 사이렌(구급차/소방차/경찰차/민방위 — Ambulance(318), Police car(317), "
    "Fire engine(319), Civil defense siren(391))은 실내 마이크 기준 오탐 위험이 커 "
    "기본 목록에서 제외 (Plan.md §3-1 참고)."
)


def get_category(category_id: str) -> SoundCategory:
    for c in SOUND_CATEGORIES:
        if c.category_id == category_id:
            return c
    raise KeyError(f"Unknown category_id: {category_id}")


def class_ids_for(category_id: str) -> List[int]:
    return get_category(category_id).class_ids


def verify_against_class_map(csv_path: str) -> None:
    """yamnet_class_map.csv 실제 파일과 CLASS_NAMES를 대조해 index-라벨 불일치를 찾는다."""
    import csv as _csv

    official = {}
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = _csv.DictReader(f)
        for row in reader:
            official[int(row["index"])] = row["display_name"]

    mismatches = []
    for idx, expected in CLASS_NAMES.items():
        actual = official.get(idx)
        if actual != expected:
            mismatches.append((idx, expected, actual))

    if mismatches:
        lines = [
            f"  index {i}: 코드에는 '{exp}'로 되어있지만 실제는 '{act}'"
            for i, exp, act in mismatches
        ]
        raise AssertionError("CLASS_NAMES 불일치 발견:\n" + "\n".join(lines))

    print(f"OK — {len(CLASS_NAMES)}개 class index 전부 yamnet_class_map.csv와 일치")


if __name__ == "__main__":
    import sys

    csv_path = sys.argv[1] if len(sys.argv) > 1 else "yamnet_class_map.csv"
    verify_against_class_map(csv_path)

    print(f"\n등록된 카테고리: {len(SOUND_CATEGORIES)}개")
    for c in SOUND_CATEGORIES:
        names = ", ".join(CLASS_NAMES.get(i, f"?{i}") for i in c.class_ids)
        print(f"  [{c.default_risk_level:>4}] {c.category_id:<22} locked={str(c.locked):<5} -> {names}")
