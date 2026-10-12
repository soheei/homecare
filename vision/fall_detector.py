"""사람 박스의 급하강·형태 변화·낮은 자세 유지를 조합한 낙상 의심 판정.

관절 추정이나 실제 바닥 위치를 사용하지 않는 휴리스틱이다. 정면 낙상,
가림, 의도적으로 눕기는 구분을 보장하지 않는다. 임계값은 현장 검증 필요.
"""
from collections import deque
from math import isfinite
import time


class FallDetector:
    """비율의 기준은 하강 전 사람 높이, 속도 단위는 사람 높이/초다.

    stable_sec 동안 낮은 자세를 확인한다. 움직임은 낙상 제외 근거가 아니다.
    movement_ratio는 호출 호환용이며 판정에는 사용하지 않는다.
    """
    def __init__(
        self,
        drop_window_sec=0.8,
        drop_ratio=0.25,
        min_drop_speed=0.5,
        max_height_ratio=0.65,
        min_aspect_ratio=0.9,
        min_aspect_growth=1.5,
        stable_sec=0.8,
        candidate_timeout_sec=2.5,
        max_gap_sec=0.6,
        movement_ratio=0.05,
        min_stable_samples=3,
        missing_grace_sec=1.0,
    ):
        values = (drop_window_sec, drop_ratio, min_drop_speed, max_height_ratio,
                  min_aspect_ratio, min_aspect_growth, stable_sec,
                  candidate_timeout_sec, max_gap_sec, movement_ratio, missing_grace_sec)
        if any(not isfinite(v) or v <= 0 for v in values):
            raise ValueError("fall thresholds must be positive and finite")
        if not 0 < max_height_ratio < 1 or min_aspect_growth <= 1:
            raise ValueError("posture must shrink in height and grow in aspect ratio")
        if (candidate_timeout_sec <= stable_sec or max_gap_sec > drop_window_sec
                or missing_grace_sec < max_gap_sec):
            raise ValueError("invalid fall timing windows")
        if not isinstance(min_stable_samples, int) or min_stable_samples < 2:
            raise ValueError("min_stable_samples must be an integer >= 2")
        self.drop_window_sec = drop_window_sec
        self.drop_ratio = drop_ratio
        self.min_drop_speed = min_drop_speed
        self.max_height_ratio = max_height_ratio
        self.min_aspect_ratio = min_aspect_ratio
        self.min_aspect_growth = min_aspect_growth
        self.stable_sec = stable_sec
        self.candidate_timeout_sec = candidate_timeout_sec
        self.max_gap_sec = max_gap_sec
        self.movement_ratio = movement_ratio
        self.min_stable_samples = min_stable_samples
        self.missing_grace_sec = missing_grace_sec
        self.reset()

    def reset(self):
        self.history = deque()
        self.fall_candidate = False
        self.origin = None
        self.candidate_since = None
        self.stable_anchor = None
        self.candidate_count = 0
        self.last_update = None
        self.last_seen = None
        self.observation_missing = False
        self.observed_low_sec = 0.0

    @staticmethod
    def _sample(person, timestamp):
        try:
            x, y = float(person["center_x"]), float(person["center_y"])
            width = float(person["width"] if "width" in person
                          else person["x2"] - person["x1"])
            height = float(person["height"] if "height" in person
                           else person["y2"] - person["y1"])
            if not all(isfinite(v) for v in (timestamp, x, y, width, height)):
                return None
            if width <= 0 or height <= 0:
                return None
            return {"time": timestamp, "x": x, "y": y, "w": width, "h": height}
        except (KeyError, TypeError, ValueError):
            return None

    def _low_posture(self, current, origin):
        aspect = current["w"] / current["h"]
        return (
            current["h"] <= origin["h"] * self.max_height_ratio
            or (aspect >= self.min_aspect_ratio
                and aspect >= origin["w"] / origin["h"] * self.min_aspect_growth)
        )

    def update(self, person, timestamp=None):
        """동일 인물 박스를 입력받아 bool 반환. timestamp는 단조 증가 초 단위.

        생략하면 monotonic 시계를 사용한다. 사람 교체 시 호출자가 reset한다.
        좌표/크기가 불완전하거나 관측 간격이 크면 이전 움직임과 연결하지 않는다.
        """
        now = time.monotonic() if timestamp is None else timestamp
        if not isinstance(now, (int, float)) or not isfinite(now):
            self.reset()
            return False
        if self.last_update is not None and now <= self.last_update:
            self.reset()
        self.last_update = now
        if person is None:
            if self.last_seen is None or now - self.last_seen > self.missing_grace_sec + 1e-9:
                self.reset()
            else:
                self.observation_missing = True
            return False
        current = self._sample(person, now)
        if current is None:
            self.reset()
            return False
        gap = 0 if self.last_seen is None else now - self.last_seen
        interrupted = self.observation_missing or gap > self.max_gap_sec + 1e-9
        if self.last_seen is not None:
            if gap > self.missing_grace_sec + 1e-9:
                self.reset()
                gap = 0
        self.last_update = now
        self.last_seen = now
        self.observation_missing = False
        self.history.append(current)
        while self.history and now - self.history[0]["time"] > self.drop_window_sec + 1e-9:
            self.history.popleft()

        if self.fall_candidate:
            # 오래된 후보, 하강 전 높이로 회복한 동작은 새 이벤트에 쓰지 않는다.
            if (now - self.candidate_since >= self.candidate_timeout_sec
                    or current["y"] - self.origin["y"] <= self.origin["h"] * self.drop_ratio):
                self.reset()
                self.history.append(current)
                return False
            if not self._low_posture(current, self.origin):
                self.stable_anchor = None
                self.candidate_count = 0
                self.observed_low_sec = 0.0
                return False

            # 뒤척임은 허용한다. 미검출/긴 처리 공백은 관측 시간에 더하지 않는다.
            if self.stable_anchor is None:
                self.stable_anchor = current
                self.candidate_count = 1
            else:
                self.candidate_count += 1
                if not interrupted:
                    self.observed_low_sec += gap
            if (self.observed_low_sec + 1e-9 >= self.stable_sec
                    and self.candidate_count >= self.min_stable_samples):
                self.reset()
                return True
            return False

        # 시간 구간 안의 서 있는 박스를 기준으로 크기 정규화 하강량/속도 검사.
        # 이미 낮은 자세로 등장한 사람에게 새 낙상을 만들지 않는다.
        for origin in self.history:
            elapsed = now - origin["time"]
            if elapsed <= 0 or origin["w"] / origin["h"] > 0.8:
                continue
            drop = (current["y"] - origin["y"]) / origin["h"]
            if (drop > self.drop_ratio and drop / elapsed >= self.min_drop_speed
                    and self._low_posture(current, origin)):
                self.fall_candidate = True
                self.origin = origin
                self.candidate_since = now
                self.stable_anchor = current
                self.candidate_count = 1
                break
        return False
