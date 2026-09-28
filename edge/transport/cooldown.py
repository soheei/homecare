"""
cooldown.py — 같은 이벤트가 연속으로 쌓이지 않게 억제 (Plan.md §2.4)

메모리에만 보관하므로 프로세스가 재시작되면 초기화된다.
"""

import threading
import time


class Cooldown:
    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._last = {}
        self._lock = threading.Lock()

    def allow(self, key: str, seconds: float) -> bool:
        """허용되면 True(그리고 시각 기록), 쿨다운 중이면 False."""
        if seconds <= 0:
            return True
        now = self._clock()
        with self._lock:
            last = self._last.get(key)
            if last is not None and now - last < seconds:
                return False
            self._last[key] = now
            return True
