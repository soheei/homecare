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

    def is_blocked(self, key: str, seconds: float) -> bool:
        """쿨다운 중이면 True. allow()와 달리 시각을 기록하지 않는다."""
        if seconds <= 0:
            return False
        with self._lock:
            last = self._last.get(key)
            return last is not None and self._clock() - last < seconds

    def claim(self, key: str, seconds: float):
        """(허용 여부, 이전 기록)을 반환. 허용되면 시각을 기록한다.

        뒤이은 작업이 실패하면 이전 기록을 restore()에 넘겨 쿨다운을 되돌릴 수 있다.
        """
        if seconds <= 0:
            return True, None
        now = self._clock()
        with self._lock:
            last = self._last.get(key)
            if last is not None and now - last < seconds:
                return False, last
            self._last[key] = now
            return True, last

    def restore(self, key: str, previous) -> None:
        """claim()으로 기록한 시각을 claim 이전 상태로 되돌린다."""
        with self._lock:
            if previous is None:
                self._last.pop(key, None)
            else:
                self._last[key] = previous

    def allow(self, key: str, seconds: float) -> bool:
        """허용되면 True(그리고 시각 기록), 쿨다운 중이면 False."""
        return self.claim(key, seconds)[0]
