"""
event_mapper.py — 감지기 판정(category_id) → 백엔드 이벤트 스펙 변환표

백엔드가 받는 값은 고정이다 (src/controllers/event.controller.js):
  type         : visitor | motion | sound | danger | other
  dangerLevel  : normal | warning | danger

yamnet/core/category_map.py의 default_risk_level(높음/중간/낮음/…)을 아래처럼 대응시켰다:
  높음 → danger, 중간 → warning, 낮음 → normal, 정보성/로그전용 → 전송 안 함

※ 이 표는 기본안이다 (확정 아님, 팀 결정 필요). 바꾸려면 SPECS만 수정하면 된다.
  - fall_suspect / baby_person_distress: Plan.md §2.4는 각각 '중간' / '낮음'으로 적혀 있으나
    category_map.py의 현재 값은 둘 다 '높음'이라 코드 쪽 값을 따랐다.
  - 쿨다운: Plan.md §2.4는 '높음'을 쿨다운 없이 매번 알린다고 했으나, 같은 소리가 연속 프레임에서
    중복 이벤트로 쌓이는 것을 막기 위해 10초 하한만 뒀다.
YOLO 등 다른 감지기는 category_id를 여기에 추가하면 같은 경로로 전송된다.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class EventSpec:
    label: str            # description에 쓰이는 한글 이름
    type: str             # 백엔드 type
    danger_level: str     # 백엔드 dangerLevel
    cooldown_sec: int     # 같은 (source, category) 재전송 억제 시간
    send: bool = True     # False면 전송하지 않음 (로그전용/집계전용/기본 OFF)


SPECS = {
    # 높음
    "fire_alarm_siren":      EventSpec("경보음/사이렌", "danger", "danger", 10),
    "glass_impact":          EventSpec("파손/충격음", "danger", "danger", 10),
    "fall_suspect":          EventSpec("낙상 의심", "danger", "danger", 10),
    "baby_person_distress":  EventSpec("아기/사람 위급 소리", "sound", "danger", 30),
    # 낮음 (Plan.md §2.4: 5~10분 쿨다운)
    "door_visitor":          EventSpec("초인종/방문", "visitor", "normal", 300),
    "door_security":         EventSpec("문 소리", "sound", "normal", 300),
    # 중간
    "long_silence":          EventSpec("장시간 무음/무활동", "other", "warning", 3600),
    "kitchen_risk":          EventSpec("주방 위험 전조", "other", "warning", 600),
    # 전송하지 않음 — 즉시 알림 없음(집계) / 기본 OFF / 로그전용
    "health_signal":         EventSpec("건강 이상 신호음", "sound", "normal", 0, send=False),
    "animal":                EventSpec("동물 소리", "sound", "normal", 0, send=False),
    "ambient_log":           EventSpec("생활 소음", "other", "normal", 0, send=False),
    "household_activity_log": EventSpec("생활 소음(가전/행동)", "other", "normal", 0, send=False),
}


def get_spec(category_id: str) -> Optional[EventSpec]:
    """알 수 없는 category_id면 None."""
    return SPECS.get(category_id)
