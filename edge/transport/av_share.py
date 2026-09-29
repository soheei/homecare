"""
av_share.py — 마이크(stream_pipeline)와 카메라(vision_pipeline) 프로세스가 소리/영상을 주고받는 공유 폴더

마이크는 한 프로세스만 열 수 있어서(ALSA hw 장치) vision이 직접 녹음할 수 없다. 대신:

  1) 소리 링버퍼: 마이크 프로세스가 최근 RING_SEC초 오디오를 audio_ring.npz로 계속 덮어쓴다.
     vision은 영상 저장 시 프레임 시각(time.time()) 구간만큼 잘라 mp4에 합친다.
  2) 소리 이벤트 → 녹화 요청: 마이크가 이벤트를 감지하면 requests/<id>.json을 쓰고,
     vision이 녹화(소리 포함)해 results/<id>.mp4로 돌려준다(실패 시 <id>.fail).
     마이크는 그 영상을 wav와 함께 한 이벤트로 전송한다.
  3) vision 생존 표시: vision이 vision_alive 파일을 주기적으로 touch — 꺼져 있으면 마이크가 요청하지 않는다.

기본 위치는 /dev/shm/homecare-av(RAM, SD카드 쓰기 없음). 두 서비스가 같은 사용자로 돌아야 한다.
HOMECARE_AV_SHARE_DIR로 바꿀 수 있고, /dev/shm이 없으면(PC) 임시 폴더를 쓴다.
"""

import json
import logging
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

log = logging.getLogger("edge.av_share")

RING_SEC = 20.0               # 링버퍼 길이 — vision 영상(사전 3초 + 사후 5초) + 인코딩 지연보다 넉넉히
RING_STALE_SEC = 3.0          # 링버퍼가 이보다 오래 갱신 안 됐으면 마이크 꺼짐으로 판단
VISION_ALIVE_SEC = 5.0        # vision_alive가 이보다 오래됐으면 카메라 꺼짐으로 판단
ALIVE_TOUCH_INTERVAL_SEC = 1.0
STALE_FILE_SEC = 300.0        # 가져가지 않은 결과/요청 파일 정리 기준


def default_dir() -> Path:
    env = os.environ.get("HOMECARE_AV_SHARE_DIR")
    if env:
        return Path(env)
    shm = Path("/dev/shm")
    return (shm if shm.is_dir() else Path(tempfile.gettempdir())) / "homecare-av"


class AVShare:
    def __init__(self, root=None, clock=time.time):
        self.root = Path(root) if root else default_dir()
        self._clock = clock
        self.requests_dir = self.root / "requests"
        self.results_dir = self.root / "results"
        for d in (self.requests_dir, self.results_dir):
            d.mkdir(parents=True, exist_ok=True)
        self.ring_path = self.root / "audio_ring.npz"
        self.alive_path = self.root / "vision_alive"
        self._ring = np.zeros(0, dtype=np.int16)
        self._ring_sr = None
        self._last_touch = 0.0

    # ------------------------------------------------------------------
    # 마이크 쪽
    # ------------------------------------------------------------------

    def push_audio(self, chunk: np.ndarray, samplerate: int, end_time: float) -> None:
        """float32(-1~1) 모노 청크를 링버퍼에 추가하고 파일로 덮어쓴다. end_time = 청크 마지막 샘플 시각."""
        pcm = (np.clip(chunk, -1.0, 1.0) * 32767).astype(np.int16)
        if self._ring_sr != samplerate:
            self._ring = np.zeros(0, dtype=np.int16)
            self._ring_sr = samplerate
        self._ring = np.concatenate([self._ring, pcm])[-int(RING_SEC * samplerate):]
        tmp = self.ring_path.with_name(self.ring_path.name + ".tmp")
        try:
            with open(tmp, "wb") as f:
                np.savez(f, audio=self._ring, samplerate=samplerate, end_time=end_time)
            os.replace(tmp, self.ring_path)
        except OSError as e:
            log.warning("소리 링버퍼 저장 실패: %s", e)

    def vision_alive(self) -> bool:
        try:
            return self._clock() - self.alive_path.stat().st_mtime < VISION_ALIVE_SEC
        except OSError:
            return False

    def request_video(self, category_id: str, trigger_time: float, post_sec: float,
                      score: Optional[float] = None) -> str:
        """vision에 녹화를 요청하고 요청 id를 반환."""
        self._cleanup_stale()
        request_id = uuid.uuid4().hex
        data = {"id": request_id, "category_id": category_id, "trigger_time": trigger_time,
                "post_sec": post_sec, "score": score}
        tmp = self.requests_dir / f"{request_id}.json.tmp"
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, self.requests_dir / f"{request_id}.json")
        return request_id

    def take_video_result(self, request_id: str) -> Tuple[Optional[str], Optional[str]]:
        """("ready", mp4 경로) / ("failed", None) / (None, None)=아직 없음. 가져간 mp4는 호출자가 지운다."""
        video = self.results_dir / f"{request_id}.mp4"
        if video.exists():
            return "ready", str(video)
        fail = self.results_dir / f"{request_id}.fail"
        if fail.exists():
            fail.unlink(missing_ok=True)
            return "failed", None
        return None, None

    def cancel_request(self, request_id: str) -> None:
        """기다리다 포기한 요청 — 아직 안 읽힌 요청/늦게 온 결과를 지운다."""
        for p in (self.requests_dir / f"{request_id}.json", self.results_dir / f"{request_id}.mp4",
                  self.results_dir / f"{request_id}.fail"):
            p.unlink(missing_ok=True)

    def _cleanup_stale(self) -> None:
        now = self._clock()
        for d in (self.requests_dir, self.results_dir):
            for p in d.iterdir():
                try:
                    if now - p.stat().st_mtime > STALE_FILE_SEC:
                        p.unlink()
                except OSError:
                    pass

    # ------------------------------------------------------------------
    # vision 쪽
    # ------------------------------------------------------------------

    def mark_vision_alive(self) -> None:
        now = self._clock()
        if now - self._last_touch < ALIVE_TOUCH_INTERVAL_SEC:
            return
        self._last_touch = now
        try:
            self.alive_path.touch()
        except OSError as e:
            log.warning("vision_alive 갱신 실패: %s", e)

    def poll_video_requests(self) -> List[dict]:
        """쌓인 녹화 요청을 꺼낸다(파일은 지움). 오래된 순."""
        requests = []
        for p in sorted(self.requests_dir.glob("*.json"), key=lambda x: x.stat().st_mtime):
            try:
                requests.append(json.loads(p.read_text(encoding="utf-8")))
            except (OSError, ValueError) as e:
                log.warning("녹화 요청 읽기 실패 %s: %s", p.name, e)
            p.unlink(missing_ok=True)
        return requests

    def publish_video_result(self, request_id: str, video_path: Optional[str]) -> None:
        """녹화 결과를 마이크에 넘긴다. video_path가 None이면 실패로 알림. 원본 파일은 이동된다."""
        try:
            if video_path:
                part = self.results_dir / f"{request_id}.mp4.part"
                shutil.move(video_path, part)  # /mnt/ssd → /dev/shm처럼 파일시스템이 달라도 되게
                os.replace(part, self.results_dir / f"{request_id}.mp4")
            else:
                (self.results_dir / f"{request_id}.fail").touch()
        except OSError as e:
            log.warning("녹화 결과 전달 실패 request=%s: %s", request_id, e)

    def read_audio(self, start: float, end: float, wait_sec: float = 2.0,
                   sleep=time.sleep) -> Optional[Tuple[np.ndarray, int]]:
        """[start, end] 시각의 소리를 int16 모노로 반환. 링버퍼에 없는 앞뒤는 무음으로 채워 영상과 길이를 맞춤.
        마이크가 꺼져 있거나(링버퍼 오래됨) 구간이 전혀 안 겹치면 None."""
        deadline = self._clock() + wait_sec
        while True:
            ring = self._load_ring()
            if ring is None:
                return None
            audio, sr, ring_end = ring
            if self._clock() - ring_end > RING_STALE_SEC:
                return None  # 마이크 꺼짐
            # 링버퍼 갱신 주기(0.48초)만큼 끝부분이 아직 안 들어왔을 수 있어 잠깐 기다림
            if ring_end >= end or self._clock() >= deadline:
                break
            sleep(0.2)

        ring_start = ring_end - len(audio) / sr
        n = int(round((end - start) * sr))
        if n <= 0 or ring_end <= start or ring_start >= end:
            return None
        out = np.zeros(n, dtype=np.int16)
        src_from = max(0, int(round((start - ring_start) * sr)))
        dst_from = max(0, int(round((ring_start - start) * sr)))
        count = min(len(audio) - src_from, n - dst_from)
        if count <= 0:
            return None
        out[dst_from:dst_from + count] = audio[src_from:src_from + count]
        return out, sr

    def _load_ring(self):
        try:
            with np.load(self.ring_path) as data:
                return data["audio"], int(data["samplerate"]), float(data["end_time"])
        except (OSError, ValueError, KeyError):
            return None
