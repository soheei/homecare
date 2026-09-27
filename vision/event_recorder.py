import cv2
import os
import uuid

from datetime import datetime
from collections import deque


class EventRecorder:
    def __init__(
        self,
        base_dir="/mnt/ssd/events",
        camera_id="camera_01",
        fps=5,
        pre_seconds=3,
        post_seconds=3,
    ):
        self.base_dir = base_dir
        self.camera_id = camera_id

        self.fps = fps

        self.pre_frame_count = int(
            fps * pre_seconds
        )

        self.post_frame_count = int(
            fps * post_seconds
        )

        self.pre_buffer = deque(
            maxlen=self.pre_frame_count
        )

        self.recording = False

        self.post_frames = []
        self.remaining_post_frames = 0

        self.event_type = None
        self.event_time = None
        self.event_frame = None
        self.event_score = None

    def update(self, frame):
        if not self.recording:
            self.pre_buffer.append(frame.copy())
            return None

        self.post_frames.append(frame.copy())

        self.remaining_post_frames -= 1

        if self.remaining_post_frames <= 0:
            return self._save_event()

        return None

    def start_event(
        self,
        event_type,
        frame,
        score=None,
    ):
        if self.recording:
            return

        self.recording = True

        self.event_type = event_type
        self.event_time = datetime.now()
        self.event_frame = frame.copy()
        self.event_score = score

        self.post_frames = []
        self.remaining_post_frames = (
            self.post_frame_count
        )

        print(
            f"[EVENT START] "
            f"type={event_type}, "
            f"score={score}"
        )

    def _save_event(self):
        event_id = str(uuid.uuid4())

        timestamp = self.event_time.strftime(
            "%Y%m%dT%H%M%S"
        )

        event_dir = os.path.join(
            self.base_dir,
            self.camera_id,
            self.event_time.strftime("%Y"),
            self.event_time.strftime("%m"),
            self.event_time.strftime("%d"),
        )

        os.makedirs(
            event_dir,
            exist_ok=True,
        )

        video_path = os.path.join(
            event_dir,
            f"{timestamp}_{event_id}.mp4",
        )

        thumbnail_path = os.path.join(
            event_dir,
            f"{timestamp}_{event_id}_thumb.jpg",
        )

        frames = (
            list(self.pre_buffer)
            + self.post_frames
        )

        if not frames:
            print(
                "[EVENT SAVE FAILED] "
                "no frames"
            )
            self._reset()
            return None

        height, width = frames[0].shape[:2]

        # H.264 우선
        fourcc = cv2.VideoWriter_fourcc(
            *"avc1"
        )

        writer = cv2.VideoWriter(
            video_path,
            fourcc,
            self.fps,
            (width, height),
        )

        # 실패하면 mp4v
        if not writer.isOpened():
            print(
                "[WARN] avc1 writer failed. "
                "fallback to mp4v"
            )

            writer.release()

            fourcc = cv2.VideoWriter_fourcc(
                *"mp4v"
            )

            writer = cv2.VideoWriter(
                video_path,
                fourcc,
                self.fps,
                (width, height),
            )

        if not writer.isOpened():
            print(
                "[EVENT SAVE FAILED] "
                "video writer failed"
            )

            self._reset()
            return None

        for frame in frames:
            writer.write(frame)

        writer.release()

        if self.event_frame is not None:
            cv2.imwrite(
                thumbnail_path,
                self.event_frame,
            )

        if not os.path.exists(video_path):
            print(
                "[EVENT SAVE FAILED] "
                "video file not found"
            )

            self._reset()
            return None

        file_size = os.path.getsize(
            video_path
        )

        print(
            "[EVENT SAVED]\n"
            f"  type       : {self.event_type}\n"
            f"  score      : {self.event_score}\n"
            f"  video      : {video_path}\n"
            f"  thumbnail  : {thumbnail_path}\n"
            f"  frames     : {len(frames)}\n"
            f"  size       : "
            f"{file_size / 1024:.1f} KB"
        )

        result = {
            "video_path": video_path,
            "thumbnail_path": thumbnail_path,
            "event_type": self.event_type,
            "event_time": self.event_time,
            "score": self.event_score,
        }

        self._reset()

        return result

    def _reset(self):
        self.recording = False

        self.post_frames = []
        self.remaining_post_frames = 0

        self.event_type = None
        self.event_time = None
        self.event_frame = None
        self.event_score = None

        self.pre_buffer.clear()
