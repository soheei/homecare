"""사람 박스의 급하강·형태 변화·낮은 자세 유지를 조합한 낙상 의심 판정.

관절 추정이나 실제 바닥 위치를 사용하지 않는 휴리스틱이다. 정면 낙상,
가림, 의도적으로 눕기는 구분을 보장하지 않는다. 임계값은 현장 검증 필요.
"""
from collections import deque
from math import isfinite
import time
from uuid import uuid4


class ProneAppearanceDetector:
    """1초 이상 미검출 뒤 가로로 긴 사람이 2초 유지되면 낙상 의심.

    바닥/관절을 확인하지 않는 박스 기반 추정이다. 가림 뒤 누운 사람이
    드러나는 경우도 경보 대상이며, 실제 사고 여부를 확정하지 않는다.
    """
    def __init__(self):
        self.reset()

    def reset(self):
        self.last_time = None
        self.absent_since = None
        self.candidate_since = None
        self.count = 0

    def update(self, person, timestamp, target_changed=False):
        if not isinstance(timestamp, (int, float)) or not isfinite(timestamp):
            self.reset()
            return False
        if self.last_time is not None and (
                timestamp <= self.last_time or timestamp - self.last_time > 0.6 + 1e-9):
            self.reset()
        self.last_time = timestamp
        if person is None:
            if self.absent_since is None:
                self.absent_since = timestamp
            self.candidate_since = None
            self.count = 0
            return False
        sample = FallDetector._sample(person, timestamp)
        eligible = self.absent_since is not None and timestamp - self.absent_since >= 1.0 - 1e-9
        self.absent_since = None
        if target_changed:
            self.candidate_since = None
            self.count = 0
        if sample is None or sample['w'] / sample['h'] < 1.2:
            self.candidate_since = None
            self.count = 0
            return False
        if self.candidate_since is None:
            if not eligible:
                return False
            self.candidate_since = timestamp
            self.count = 1
            return False
        self.count += 1
        if timestamp - self.candidate_since >= 2.0 - 1e-9 and self.count >= 3:
            self.candidate_since = None
            self.count = 0
            return True
        return False


class PostureLossDetector:
    """화면 안쪽의 짧은 하강·형태 변화 뒤 연속 미검출을 주의로 판정.

    급하강 확정과 독립된 보조 경로다. 가림의 의미를 알아내는 모델은
    아니므로, 앉거나 숙인 직후 완전히 가려지는 경우까지 구별하지 못한다.
    frame_size=(width, height)가 없으면 경계 이탈 검증 불가로 비활성화한다.
    """
    def __init__(self):
        self.reset()

    def reset(self):
        self.history = deque()
        self.last_time = None
        self.frame_size = None
        self.origin = None
        self.low_since = None
        self.low_count = 0
        self.missing_since = None

    @staticmethod
    def _interior(sample, frame_size):
        width, height = frame_size
        # 머리는 화면 위쪽에 잘려 있어도 허용하되 좌우/아래 퇴장은 제외.
        return (sample['x'] - sample['w'] / 2 > width * .05
                and sample['x'] + sample['w'] / 2 < width * .95
                and sample['y'] + sample['h'] / 2 < height * .95)

    @staticmethod
    def _transition(current, origin):
        elapsed = current['time'] - origin['time']
        drop = (current['y'] - origin['y']) / origin['h']
        bottom_shift = abs((current['y'] + current['h'] / 2)
                           - (origin['y'] + origin['h'] / 2)) / origin['h']
        return (0 < elapsed <= .8 + 1e-9 and drop >= .20
                and drop / elapsed >= .25
                and current['h'] <= origin['h'] * .65
                and current['w'] / current['h'] >= 1.2
                and current['w'] >= origin['w'] * 1.25
                and abs(current['x'] - origin['x']) <= origin['h'] * .35
                and bottom_shift <= .15)

    def update(self, person, timestamp, changed, person_visible, frame_size):
        if (frame_size is None or len(frame_size) != 2
                or not all(isinstance(v, (int, float)) and isfinite(v) and v > 0
                           for v in frame_size)):
            self.reset()
            return False
        if (self.last_time is not None and
                (timestamp <= self.last_time or timestamp - self.last_time > .6 + 1e-9
                 or self.frame_size != frame_size)):
            self.reset()
        # tracker의 장기 미검출 reset(changed=True)은 이미 관측한 소실을 취소하지 않음.
        if (changed and person is not None) or (person is None and person_visible):
            self.reset()
        self.last_time, self.frame_size = timestamp, frame_size
        if person is None:
            if (person_visible or self.low_count < 2 or self.low_since is None
                    or not self.history or self.history[-1]['time'] - self.low_since < .2 - 1e-9):
                self.history.clear()
                return False
            if self.missing_since is None:
                # 변화 직후 소실만 허용. 오래 숙이고 있다가 사라진 경우는 제외.
                if timestamp - self.low_since > .8 + 1e-9:
                    self.reset()
                    return False
                self.missing_since = timestamp
            if timestamp - self.missing_since >= 1.0 - 1e-9:
                self.reset()
                return True
            return False
        current = FallDetector._sample(person, timestamp)
        if self.missing_since is not None:
            # 짧은 가림 뒤 복귀하면 이전 소실 후보를 재사용하지 않는다.
            self.reset()
            self.last_time, self.frame_size = timestamp, frame_size
        if current is None or not self._interior(current, frame_size):
            self.reset()
            return False
        while self.history and timestamp - self.history[0]['time'] > .8 + 1e-9:
            self.history.popleft()
        origins = [s for s in self.history if s['w'] / s['h'] <= .8]
        matches = [s for s in origins if self._transition(current, s)]
        if matches and len(origins) >= 2 and origins[-1]['time'] - origins[0]['time'] >= .2 - 1e-9:
            if self.low_since is None:
                self.low_since = timestamp
                self.origin = matches[-1]
            if self._transition(current, self.origin):
                self.low_count += 1
            else:
                self.low_since, self.origin, self.low_count = timestamp, matches[-1], 1
        else:
            self.low_since, self.origin, self.low_count = None, None, 0
        self.history.append(current)
        return False


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
        self.appearance = ProneAppearanceDetector()
        self.posture_loss = PostureLossDetector()
        self.reset()

    def reset(self):
        self.appearance.reset()
        self.posture_loss.reset()
        self.last_event = None
        self.pending_loss_since = None
        self.incident_id = None
        self.incident_time = None
        self.incident_level = None
        self._reset_motion()

    def update_tracked(self, person, timestamp, changed=False, person_visible=False, frame_size=None):
        """대상 변경 시 하강 이력은 버리고, 미검출 뒤 출현은 별도로 확인한다."""
        self.last_event = None
        if (not isinstance(timestamp, (int, float)) or not isfinite(timestamp)
                or (self.last_update is not None and timestamp <= self.last_update)):
            self.reset()
            return False
        if self.last_update is not None and timestamp - self.last_update > self.max_gap_sec + 1e-9:
            self.pending_loss_since = None
            self._reset_motion()
        if person is None and not person_visible:
            if self.fall_candidate and self.pending_loss_since is None:
                self.pending_loss_since = timestamp
        else:
            self.pending_loss_since = None
        lost_after_drop = (self.pending_loss_since is not None
                           and timestamp - self.pending_loss_since >= 1.0 - 1e-9)
        if changed:
            if person is not None:
                self.incident_id = self.incident_time = self.incident_level = None
            self._reset_motion()
        if person is None and person_visible:
            # 사람이 없던 장면과 여러 사람 중 대상을 고르지 못한 장면을 구분.
            self.appearance.reset()
            appearance_hit = False
        else:
            appearance_hit = self.appearance.update(person, timestamp, target_changed=changed)
        posture_loss_hit = self.posture_loss.update(person, timestamp, changed, person_visible, frame_size)
        motion_hit = self.update(person, timestamp)
        if motion_hit or appearance_hit or lost_after_drop or posture_loss_hit:
            self.appearance.reset()
            self.posture_loss.reset()
            self.pending_loss_since = None
            category = 'fall_detected' if motion_hit else 'fall_suspect'
            reason = ('rapid_drop_low_posture' if motion_hit else
                      'rapid_drop_person_lost' if lost_after_drop else
                      'posture_change_person_lost' if posture_loss_hit else 'prone_appearance')
            # 짧은 미검출 뒤 확인된 같은 추적 대상만 기존 의심 사건으로 승격.
            upgrade = (motion_hit and not changed and self.incident_level == 'fall_suspect'
                       and self.incident_time is not None and timestamp - self.incident_time <= 2.5)
            incident_id = self.incident_id if upgrade else uuid4().hex
            self.last_event = {'category': category, 'reason': reason,
                               'incident_id': incident_id, 'upgrade': upgrade}
            self.incident_id, self.incident_time, self.incident_level = incident_id, timestamp, category
            return True
        return False

    def _reset_motion(self):
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
            self._reset_motion()
            return False
        if self.last_update is not None and now <= self.last_update:
            self._reset_motion()
        update_gap = 0 if self.last_update is None else now - self.last_update
        was_missing = self.observation_missing
        self.last_update = now
        if person is None:
            if self.last_seen is None or now - self.last_seen > self.missing_grace_sec + 1e-9:
                self._reset_motion()
            else:
                self.observation_missing = True
            return False
        current = self._sample(person, now)
        if current is None:
            self._reset_motion()
            return False
        gap = 0 if self.last_seen is None else now - self.last_seen
        interrupted = self.observation_missing or gap > self.max_gap_sec + 1e-9
        if self.last_seen is not None:
            if gap > self.missing_grace_sec + 1e-9:
                self._reset_motion()
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
                self._reset_motion()
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
                elif was_missing and gap <= self.max_gap_sec + 1e-9:
                    # 짧은 누락 뒤 낮은 자세를 다시 실제 검출했다. 누락된
                    # 프레임들의 시간은 빼고 이번 샘플 간격만 반영한다.
                    # 누락 구간보다 긴 관측 시간을 추정해 채우지는 않는다.
                    self.observed_low_sec += min(update_gap, gap - update_gap)
            if (self.observed_low_sec + 1e-9 >= self.stable_sec
                    and self.candidate_count >= self.min_stable_samples):
                self._reset_motion()
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
