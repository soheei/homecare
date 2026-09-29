class FallDetector:
    def __init__(
        self,
        vertical_threshold=25,
        previous_aspect_threshold=0.9,
        fall_aspect_threshold=1.3,
        required_frames=3,
    ):
        self.previous = None

        self.vertical_threshold = vertical_threshold

        # 낙상 직전의 세로형 상태 기준
        self.previous_aspect_threshold = (
            previous_aspect_threshold
        )

        # 낙상 후의 가로형 상태 기준
        self.fall_aspect_threshold = (
            fall_aspect_threshold
        )

        # 최종 자세가 몇 프레임 유지되어야 하는가
        self.required_frames = required_frames

        self.candidate_count = 0

    def update(self, person):
        # 사람이 사라지면 상태 초기화
        if person is None:
            self.previous = None
            self.candidate_count = 0
            return False

        # 첫 번째 프레임
        if self.previous is None:
            self.previous = person
            return False

        # ---------------------------------
        # 현재 위치 변화
        # ---------------------------------

        previous_y = self.previous["center_y"]
        current_y = person["center_y"]

        dy = current_y - previous_y

        # ---------------------------------
        # 이전 프레임 자세
        # ---------------------------------

        previous_width = self.previous["width"]
        previous_height = self.previous["height"]

        if previous_height <= 0:
            self.previous = person
            self.candidate_count = 0
            return False

        previous_ratio = (
            previous_width / previous_height
        )

        # ---------------------------------
        # 현재 프레임 자세
        # ---------------------------------

        width = person["width"]
        height = person["height"]

        if height <= 0:
            self.previous = person
            self.candidate_count = 0
            return False

        current_ratio = width / height

        # ---------------------------------
        # 조건 1
        # 낙상 직전에는 세로형이어야 함
        # ---------------------------------

        was_upright = (
            previous_ratio
            < self.previous_aspect_threshold
        )

        # ---------------------------------
        # 조건 2
        # 아래로 충분히 이동
        # ---------------------------------

        rapid_downward_motion = (
            dy > self.vertical_threshold
        )

        # ---------------------------------
        # 조건 3
        # 현재 몸이 확실히 가로형
        # ---------------------------------

        horizontal_posture = (
            current_ratio
            > self.fall_aspect_threshold
        )

        # ---------------------------------
        # 낙상 후보
        # ---------------------------------

        fall_candidate = (
            was_upright
            and rapid_downward_motion
            and horizontal_posture
        )

        # 1단계: 세로형 → 급하강 → 가로형이면 낙상 의심 시작
        # 2단계: 이후 가로형이 유지되는 프레임 수를 센다
        # (다음 프레임부터는 직전 프레임이 이미 가로형이라
        #  fall_candidate가 다시 참이 될 수 없으므로 따로 센다)
        if fall_candidate:
            self.candidate_count = 1
        elif (
            self.candidate_count > 0
            and horizontal_posture
        ):
            self.candidate_count += 1
        else:
            # 다시 일어났으면 의심 취소
            self.candidate_count = 0

        # 다음 프레임과 비교하기 위해 저장
        self.previous = person

        print(
            f"[FALL CHECK] "
            f"dy={dy:.1f}, "
            f"prev_ratio={previous_ratio:.2f}, "
            f"ratio={current_ratio:.2f}, "
            f"candidate={fall_candidate}, "
            f"count={self.candidate_count}"
        )

        # ---------------------------------
        # 최종 낙상 판정
        # ---------------------------------

        if (
            self.candidate_count
            >= self.required_frames
        ):
            self.candidate_count = 0

            print("[FALL DETECTED]")

            return True

        return False
