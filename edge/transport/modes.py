"""
modes.py — 거실/현관 감지 모드 (마이크·카메라 프로세스가 같이 쓴다)

Pi가 1대라 같은 마이크·카메라로 "거실"과 "현관"을 번갈아 감시한다. 어느 모드인지는 앱에서 정하고
백엔드가 하트비트 응답({mode, securityArmed})으로 알려준다 → ModeState.update_from_heartbeat가 받는다.
모드에 속하지 않는 카테고리의 이벤트는 만들지 않고 버린다(마이크: stream_pipeline, 카메라: vision_pipeline).

백엔드 devices.mode 값과 같은 문자열을 쓴다: 'living'(거실) | 'entrance'(현관)
"""

import logging
import threading

log = logging.getLogger("edge.modes")

LIVING = "living"
ENTRANCE = "entrance"
DEFAULT_MODE = LIVING   # 백엔드 devices.mode 기본값. 첫 하트비트 응답 전·백엔드 연결 실패 시에도 이 모드로 동작

# 모드별로 감지할 카테고리 (event_mapper.py / yamnet category_id 와 같은 이름)
MODE_CATEGORIES = {
    LIVING: frozenset({"scream_shout", "animal", "baby_cry", "fire_alarm_siren", "fall_suspect"}),
    ENTRANCE: frozenset({"door_visitor", "visitor_detected", "door_security", "delivery_suspect"}),
}

# 모드와 무관하게 항상 감지하는 안전 이벤트
ALWAYS_ON = frozenset({"fire_alarm_siren", "glass_impact"})


def is_allowed(mode: str, category_id: str) -> bool:
    """이 모드에서 category_id 이벤트를 만들어도 되는지. 알 수 없는 모드는 기본 모드로 취급."""
    if category_id in ALWAYS_ON:
        return True
    return category_id in MODE_CATEGORIES.get(mode, MODE_CATEGORIES[DEFAULT_MODE])


class ModeState:
    """현재 모드·경비 상태를 담는 스레드 안전 홀더. 하트비트 스레드가 쓰고 감지 루프가 읽는다."""

    def __init__(self, mode: str = DEFAULT_MODE, security_armed: bool = False):
        self._lock = threading.Lock()
        self._mode = mode if mode in MODE_CATEGORIES else DEFAULT_MODE
        self._security_armed = bool(security_armed)

    @property
    def mode(self) -> str:
        with self._lock:
            return self._mode

    @property
    def security_armed(self) -> bool:
        with self._lock:
            return self._security_armed

    def allows(self, category_id: str) -> bool:
        return is_allowed(self.mode, category_id)

    def update_from_heartbeat(self, data) -> None:
        """하트비트 응답 JSON에서 mode/securityArmed를 읽어 반영한다. 없거나 이상한 값은 무시(현재 값 유지)."""
        if not isinstance(data, dict):
            return

        mode = data.get("mode")
        armed = data.get("securityArmed")

        with self._lock:
            if mode in MODE_CATEGORIES and mode != self._mode:
                log.info("감지 모드 변경: %s → %s", self._mode, mode)
                self._mode = mode
            if isinstance(armed, bool) and armed != self._security_armed:
                log.info("경비 모드 %s", "켜짐" if armed else "꺼짐")
                self._security_armed = armed
