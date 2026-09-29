import cv2
import os
import subprocess
import tempfile
import time
import uuid
import wave

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
        audio_source=None,
    ):
        """
        audio_source: (start, end) 시각(time.time())을 받아 그 구간 소리 (int16 모노 배열, 샘플레이트)
                      또는 None을 돌려주는 함수 (edge.transport.av_share.AVShare.read_audio).
                      None이면 소리 없는 영상.
        """
        self.base_dir = base_dir
        self.camera_id = camera_id
        self.audio_source = audio_source

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
        self.request_id = None

    def update(self, frame, frame_time=None):
        """
        frame_time: 프레임 캡처 시각(time.time()). 소리를 같은 구간으로 자르고
                    실제 fps를 계산하는 데 쓴다 (YOLO가 느리면 5fps보다 덜 들어옴).
        pre_buffer/post_frames에는 (프레임, 시각)을 담는다.
        """
        item = (frame.copy(), frame_time if frame_time is not None else time.time())

        if not self.recording:
            self.pre_buffer.append(item)
            return None

        self.post_frames.append(item)

        self.remaining_post_frames -= 1

        if self.remaining_post_frames <= 0:
            return self._save_event()

        return None

    def start_event(
        self,
        event_type,
        frame,
        score=None,
        post_seconds=None,
        request_id=None,
    ):
        """
        post_seconds: 이번 이벤트만 사후 녹화 길이를 바꿀 때 (소리 이벤트 녹화 요청은 마이크 클립 길이에 맞춤)
        request_id: 마이크(av_share)의 녹화 요청 id — 결과에 그대로 담아 돌려준다
        """
        if self.recording:
            return

        self.recording = True

        self.event_type = event_type
        # 시간대 없는 now()를 보내면 백엔드가 UTC로 해석해 앱에서 +9시간으로 보임 → 로컬 시간대(+09:00)를 붙인다
        self.event_time = datetime.now().astimezone()
        self.event_frame = frame.copy()
        self.event_score = score
        self.request_id = request_id

        self.post_frames = []
        self.remaining_post_frames = (
            self.post_frame_count
            if post_seconds is None
            else max(1, int(self.fps * post_seconds))
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

        items = (
            list(self.pre_buffer)
            + self.post_frames
        )

        if not items:
            print(
                "[EVENT SAVE FAILED] "
                "no frames"
            )
            self._reset()
            return None

        frames = [frame for frame, _ in items]
        times = [t for _, t in items]

        # 실제로 들어온 프레임 간격으로 fps를 정한다 — 설정값(5fps)으로 쓰면
        # YOLO가 느릴 때 영상이 실제보다 빨리 재생돼 소리와 어긋난다
        fps = self.fps
        span = times[-1] - times[0]
        if len(times) >= 2 and span > 0:
            fps = (len(times) - 1) / span

        height, width = frames[0].shape[:2]

        # H.264 우선
        fourcc = cv2.VideoWriter_fourcc(
            *"avc1"
        )

        writer = cv2.VideoWriter(
            video_path,
            fourcc,
            fps,
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
                fps,
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

        # 마이크 링버퍼에서 영상과 같은 시각 구간의 소리를 가져와 합친다 (마이크가 꺼져 있으면 영상만)
        has_audio = False
        audio = self._read_audio(times[0], times[-1] + 1.0 / fps)

        if audio is not None:
            has_audio = self._mux_audio(video_path, audio, used_h264)

        # mp4v는 브라우저에서 재생되지 않음 → H.264로 변환
        # (Pi 5엔 H.264 하드웨어 인코더가 없어 OpenCV의 avc1이 실패함)
        # 소리 합치기에 성공했으면 그 과정에서 이미 H.264로 바뀜
        if not used_h264 and not has_audio:
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
            f"  frames     : {len(frames)} ({fps:.1f} fps)\n"
            f"  audio      : {'yes' if has_audio else 'no'}\n"
            f"  size       : "
            f"{file_size / 1024:.1f} KB"
        )

        result = {
            "video_path": video_path,
            "thumbnail_path": thumbnail_path,
            "event_type": self.event_type,
            "event_time": self.event_time,
            "score": self.event_score,
            "has_audio": has_audio,
            "request_id": self.request_id,
        }

        self._reset()

        return result

    def _read_audio(self, start, end):
        if self.audio_source is None:
            return None

        try:
            return self.audio_source(start, end)
        except Exception as e:  # 소리를 못 가져와도 영상 이벤트는 보낸다
            print(f"[WARN] audio read failed ({type(e).__name__}: {e}) - video only")
            return None

    def _mux_audio(self, video_path, audio, used_h264):
        """
        ffmpeg로 영상에 소리(AAC)를 합친다. 영상이 mp4v면 같은 명령에서 H.264로도 바꾼다.
        성공하면 True. 실패하면 원본을 그대로 두고 False (호출한 쪽이 H.264 변환만 따로 함).
        """

        samples, samplerate = audio
        tmp_path = video_path + ".av.mp4"

        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

        try:
            with wave.open(wav_path, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(samplerate)
                w.writeframes(samples.astype("<i2").tobytes())

            video_codec = (
                ["-c:v", "copy"]
                if used_h264
                else ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
            )

            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", video_path,
                "-i", wav_path,
                "-map", "0:v:0", "-map", "1:a:0",
                *video_codec,
                "-c:a", "aac", "-b:a", "64k",
                "-shortest",
                "-movflags", "+faststart",
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
                    f"[WARN] audio mux skipped ({type(e).__name__}) - video only"
                )
                return False

            if result.returncode != 0 or not os.path.exists(tmp_path):
                print(
                    "[WARN] audio mux failed - video only: "
                    f"{(result.stderr or '').strip()[-200:]}"
                )
                return False

            os.replace(tmp_path, video_path)

            print("[EVENT VIDEO] audio muxed (H.264 + AAC)")

            return True

        finally:
            for p in (wav_path, tmp_path):
                try:
                    os.remove(p)
                except OSError:
                    pass

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
        self.request_id = None

        self.pre_buffer.clear()
