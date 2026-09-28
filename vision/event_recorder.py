import cv2
import os
import subprocess
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

        used_h264 = writer.isOpened()

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

        # mp4v는 브라우저에서 재생되지 않음 → H.264로 변환
        # (Pi 5엔 H.264 하드웨어 인코더가 없어 OpenCV의 avc1이 실패함)
        if not used_h264:
            self._convert_to_h264(video_path)

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

    def _convert_to_h264(self, video_path):
        """
        ffmpeg(libx264, 소프트웨어 인코딩)로 video_path를 H.264로 바꾼다.
        ffmpeg가 없거나 실패하면 원본(mp4v)을 그대로 둔다 — 이벤트 전송은 계속되고,
        영상만 브라우저에서 재생되지 않을 수 있다.
        """

        tmp_path = video_path + ".h264.mp4"

        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", video_path,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-pix_fmt", "yuv420p",        # 브라우저 호환 색 형식
            "-movflags", "+faststart",    # 다 받기 전에 재생 시작
            tmp_path,
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired) as e:
            print(
                f"[WARN] H.264 conversion skipped ({type(e).__name__}) "
                "- keeping mp4v (may not play in browser)"
            )
            return

        if result.returncode != 0 or not os.path.exists(tmp_path):
            print(
                "[WARN] H.264 conversion failed - keeping mp4v: "
                f"{(result.stderr or '').strip()[-200:]}"
            )

            if os.path.exists(tmp_path):
                os.remove(tmp_path)

            return

        os.replace(tmp_path, video_path)

        print("[EVENT VIDEO] converted to H.264")

    def _reset(self):
        self.recording = False

        self.post_frames = []
        self.remaining_post_frames = 0

        self.event_type = None
        self.event_time = None
        self.event_frame = None
        self.event_score = None

        self.pre_buffer.clear()
