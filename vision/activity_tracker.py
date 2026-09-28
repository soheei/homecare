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
