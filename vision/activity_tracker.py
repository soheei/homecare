import time
from math import hypot, isfinite


class FallPersonTracker:
    """박스 겹침/단일 인물 거리로 한 명을 잇고 짧은 미검출은 보류한다.

    외형/신원 추적은 아니므로 겹치는 사람이나 큰 프레임 간 이동은 놓칠 수 있다.
    """

    def __init__(self, missing_grace_sec=1.0):
        if not isfinite(missing_grace_sec) or missing_grace_sec <= 0:
            raise ValueError("missing_grace_sec must be positive and finite")
        self.missing_grace_sec = missing_grace_sec
        self.reset()

    def reset(self):
        self.previous = None
        self.last_seen = None
        self.last_update = None
        self.was_single = False

    @staticmethod
    def _iou(a, b):
        width = max(0, min(a["x2"], b["x2"]) - max(a["x1"], b["x1"]))
        height = max(0, min(a["y2"], b["y2"]) - max(a["y1"], b["y1"]))
        intersection = width * height
        area_a = max(0, a["x2"] - a["x1"]) * max(0, a["y2"] - a["y1"])
        area_b = max(0, b["x2"] - b["x1"]) * max(0, b["y2"] - b["y1"])
        union = area_a + area_b - intersection
        return intersection / union if union > 0 else 0

    def update(self, detections, timestamp=None):
        """(선택한 사람, 대상 변경 여부). 변경 시 낙상 이력을 초기화해야 한다."""
        now = time.monotonic() if timestamp is None else timestamp
        if not isinstance(now, (int, float)) or not isfinite(now):
            self.reset()
            return None, True
        if ((self.last_update is not None and now <= self.last_update)
                or (self.last_seen is not None
                    and now - self.last_seen > self.missing_grace_sec + 1e-9)):
            self.reset()
        self.last_update = now
        people = [d for d in detections if d["class_id"] == 0]
        if not people:
            return None, self.previous is None
        if self.previous is not None:
            matches = [p for p in people if self._iou(self.previous, p) >= 0.1]
            # 한 명만 보였던 장면에 한해 낙상으로 박스가 겹치지 않는 변화도 연결.
            if not matches and self.was_single and len(people) == 1:
                p = people[0]
                height = self.previous["y2"] - self.previous["y1"]
                distance = hypot(p["center_x"] - self.previous["center_x"],
                                 p["center_y"] - self.previous["center_y"])
                if distance <= height * 0.75:
                    matches = [p]
            if len(matches) == 1:
                self.previous = matches[0]
                self.last_seen = now
                self.was_single = len(people) == 1
                return self.previous, False
            if len(matches) > 1:
                self.reset()
                return None, True
        self.previous = max(people, key=lambda p: p["confidence"])
        self.last_seen = now
        self.was_single = len(people) == 1
        return self.previous, True


class ActivityTracker:
    """
    화면 속 사람의 행동을 프레임 단위 상태로 추적한다.

        없음 ──(appear_frames 연속 보임)──▶ 등장 ──(dwell_frames 보임)──▶ 머무름
          ▲                                  │                          │
          └──(lost_frames 연속 안 보임)── 지나감(passed)          퇴장(left)

    YOLO가 한두 프레임 사람을 놓쳐도 퇴장으로 보지 않도록
    lost_frames 동안은 유예한다.

    update() 반환값 (상태가 바뀌는 순간에만, 그 외 None):
        "appeared" : 사람이 새로 등장
        "dwelling" : 등장 후 dwell_frames만큼 머묾 (한 번 머무는 동안 1회)
        "left"     : 머문 뒤 떠남
        "passed"   : 머물기 전에 떠남 (그냥 지나감)
    """

    def __init__(
        self,
        dwell_frames=15,
        appear_frames=2,
        lost_frames=5,
    ):
        self.dwell_frames = dwell_frames
        self.appear_frames = appear_frames
        self.lost_frames = lost_frames

        self.present = False
        self.seen_frames = 0
        self.missing_frames = 0
        self.dwell_reported = False

        # 마지막으로 본 사람 박스 (택배 등에서 사람이 있던 자리로 사용)
        self.last_person = None

    def update(self, person):
        if person is not None:
            self.missing_frames = 0
            self.seen_frames += 1
            self.last_person = person

            if not self.present:
                if self.seen_frames >= self.appear_frames:
                    self.present = True
                    return "appeared"
                return None

            if (
                not self.dwell_reported
                and self.seen_frames >= self.dwell_frames
            ):
                self.dwell_reported = True
                return "dwelling"

            return None

        # 사람이 안 보이는 프레임
        if not self.present:
            self.seen_frames = 0
            return None

        self.missing_frames += 1

        if self.missing_frames < self.lost_frames:
            return None

        event = "left" if self.dwell_reported else "passed"
        self._reset()
        return event

    def _reset(self):
        self.present = False
        self.seen_frames = 0
        self.missing_frames = 0
        self.dwell_reported = False
