from collections import deque


class FallDetector:
    def __init__(
        self,
        history_frames=4,
        drop_threshold=35,
        candidate_frames=2,
        movement_threshold=8,
    ):
        if history_frames < 2:
            raise ValueError("history_frames must be at least 2")
        # 최근 center_y 저장
        self.history = deque(
            maxlen=history_frames
        )

        # 최근 몇 프레임 동안의 하강량
        self.drop_threshold = drop_threshold

        # 낙상 후보 후 안정 상태 확인 프레임
        self.candidate_frames = candidate_frames

        # 낙상 후 움직임이 이 값보다 작으면
        # 움직임이 멈췄다고 판단
        self.movement_threshold = movement_threshold

        # 현재 낙상 후보 상태인지
        self.fall_candidate = False

        # 후보 상태가 몇 프레임 유지됐는지
        self.candidate_count = 0
        self.candidate_origin_y = None

    def reset(self):
        self.history.clear()
        self.fall_candidate = False
        self.candidate_count = 0
        self.candidate_origin_y = None

    def update(self, person):
        """
        person:
        {
            "center_x": ...,
            "center_y": ...,
            "width": ...,
            "height": ...,
            "confidence": ...
        }

        반환:
            True  -> 낙상 감지
            False -> 정상
        """

        # -----------------------------------
        # 사람이 사라짐
        # -----------------------------------

        if person is None:
            self.reset()

            return False

        current_y = person["center_y"]

        # 현재 위치 저장
        self.history.append(current_y)

        # -----------------------------------
        # 충분한 프레임이 모이지 않았으면
        # 판단하지 않음
        # -----------------------------------

        if len(self.history) < self.history.maxlen:
            return False

        # -----------------------------------
        # 최근 구간의 하강량
        # -----------------------------------

        old_y = self.history[0]

        drop = current_y - old_y

        # -----------------------------------
        # 현재 프레임과 이전 프레임의 이동량
        # -----------------------------------

        previous_y = self.history[-2]

        frame_dy = current_y - previous_y

        # -----------------------------------
        # 1단계:
        # 짧은 시간에 크게 아래로 이동
        # -----------------------------------

        rapid_downward_motion = (
            drop > self.drop_threshold
        )

        # -----------------------------------
        # 낙상 후보가 아니라면
        # -----------------------------------

        if not self.fall_candidate:

            if rapid_downward_motion:

                self.fall_candidate = True
                self.candidate_count = 0
                self.candidate_origin_y = old_y

                print(
                    f"[FALL CANDIDATE] "
                    f"drop={drop:.1f}, "
                    f"frame_dy={frame_dy:.1f}"
                )

        # -----------------------------------
        # 낙상 후보 상태
        # -----------------------------------

        else:
            # 하강 전 높이 근처로 복귀하면 정상 자세 회복으로 취급한다.
            if current_y - self.candidate_origin_y <= self.drop_threshold:
                self.reset()
                self.history.append(current_y)
                return False

            # 낙상 직후 움직임이 크게 줄었는지 확인
            movement_stopped = (
                abs(frame_dy)
                <= self.movement_threshold
            )

            if movement_stopped:

                self.candidate_count += 1

            else:

                self.candidate_count = 0

            # --------------------------------
            # 일정 프레임 동안 움직임이
            # 줄어들었다면 실제 낙상으로 판단
            # --------------------------------

            if (
                self.candidate_count
                >= self.candidate_frames
            ):

                self.fall_candidate = False
                self.candidate_count = 0

                print(
                    "[FALL DETECTED] "
                    f"drop={drop:.1f}"
                )

                # 다음 이벤트를 위해 초기화
                self.reset()

                return True

        # -----------------------------------
        # 디버깅 로그
        # -----------------------------------

        print(
            f"[FALL CHECK] "
            f"drop={drop:.1f}, "
            f"frame_dy={frame_dy:.1f}, "
            f"candidate={self.fall_candidate}, "
            f"count={self.candidate_count}"
        )

        return False
