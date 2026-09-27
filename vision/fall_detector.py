class FallDetector:
    def __init__(
        self,
        vertical_threshold=15,
        aspect_ratio_threshold=1.2,
        required_frames=1,
    ):
        self.previous = None

        self.vertical_threshold = vertical_threshold
        self.aspect_ratio_threshold = aspect_ratio_threshold
        self.required_frames = required_frames

        self.candidate_count = 0

    def update(self, person):
        if person is None:
            self.previous = None
            self.candidate_count = 0
            return False

        if self.previous is None:
            self.previous = person
            return False

        previous_y = self.previous["center_y"]
        current_y = person["center_y"]

        dy = current_y - previous_y

        width = person["width"]
        height = person["height"]

        if height <= 0:
            self.previous = person
            self.candidate_count = 0
            return False

        aspect_ratio = width / height

        vertical_motion = dy > self.vertical_threshold
        horizontal_shape = (
            aspect_ratio > self.aspect_ratio_threshold
        )

        fall_candidate = (
            vertical_motion
            and horizontal_shape
        )

        if fall_candidate:
            self.candidate_count += 1
        else:
            self.candidate_count = 0

        self.previous = person

        print(
            f"[FALL CHECK] "
            f"dy={dy:.1f}, "
            f"aspect_ratio={aspect_ratio:.2f}, "
            f"candidate={fall_candidate}, "
            f"count={self.candidate_count}"
        )

        if self.candidate_count >= self.required_frames:
            self.candidate_count = 0

            print("[FALL DETECTED]")

            return True

        return False
