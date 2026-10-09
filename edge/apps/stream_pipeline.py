"""

마이크 담당 코드
stream_pipeline.py — 마이크(또는 파일) 오디오 스트림 → YAMNet 추론 → event_rules 판정 → edge.emit()

    python -m edge.apps.stream_pipeline                          # 기본 마이크 장치로 실시간 캡처 (sounddevice 필요)
    python -m edge.apps.stream_pipeline --device 2                # 특정 입력 장치 지정
    python -m edge.apps.stream_pipeline --list-devices            # 사용 가능한 입력 장치 목록 출력 후 종료
    python -m edge.apps.stream_pipeline --wav-file clip.wav        # 마이크 없이 파일을 스트리밍처럼 흘려보냄(테스트용)
    python -m edge.apps.stream_pipeline --wav-file clip.wav --fast # 위와 동일하되 실시간 대기 없이 최대 속도로 처리

Plan.md §6 6단계. yamnet/core(추론·판정 로직)와 edge(전송)를 여기서 연결한다:

    마이크(또는 wav 파일) 16kHz mono 오디오
        │  hop(0.48초)마다 새 청크
        ▼
    StreamPipeline — 최근 0.96초 윈도우로 YAMNet 추론 → 프레임 점수 히스토리에 추가
        │
        ▼
    event_rules.evaluate_all(히스토리) — 카테고리별 판정 규칙 적용
        │  triggered=True인 카테고리만 (쿨다운 중이거나 이미 녹음 중이면 건너뜀)
        ▼
    감지 윈도우(0.96초) + 이후 CLIP_POST_SEC(5초) 오디오를 모아 wav로 저장
        │
        ▼
    edge.transport.emit.EventEmitter.emit(audio_path=wav) — 큐에 저장, 백그라운드로 백엔드 전송

카메라 연동(edge/transport/av_share.py, 마이크 모드에서만):
  - 매 청크를 공유 링버퍼에 써서 vision 이벤트 영상에 소리가 들어가게 한다.
  - 소리 이벤트 감지 시 vision이 켜져 있으면 녹화를 요청하고, 녹음이 끝난 뒤 최대 VIDEO_WAIT_SEC초
    영상(소리 포함 mp4)을 기다려 wav와 함께 전송한다. 못 받으면 지금처럼 wav만 보낸다.

yamnet/core 쪽 모듈(yamnet_core, category_map, event_rules)은 패키지가 아니라
verification/mediatest.py와 같은 방식으로 sys.path에 직접 추가해서 가져온다
(README의 Pi sparse-checkout이 `edge yamnet/core` 두 폴더만 받는 것과 맞춤).

TensorFlow(`tensorflow_hub`)/`sounddevice`/`soundfile`는 실제로 필요한 시점(모델 로드,
마이크 열기, 파일 읽기)에만 import한다 — 이 파일 자체는 무거운 의존성 없이도 로드/테스트 가능하다.
"""

import argparse
import logging
import os
import queue
import sys
import tempfile
import time
import wave
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np

YAMNET_CORE_DIR = Path(__file__).resolve().parents[2] / "yamnet" / "core"  # edge/apps/ → 저장소 루트
sys.path.insert(0, str(YAMNET_CORE_DIR))

from yamnet_core import TARGET_SAMPLE_RATE, infer, load_class_names, load_yamnet, preprocess  # noqa: E402
from category_map import class_ids_for, get_category  # noqa: E402
import event_rules  # noqa: E402

from ..transport.config import ConfigError, load_config
from ..transport.emit import EventEmitter
from ..transport import heartbeat
from ..transport.av_share import AVShare
from ..transport.modes import ModeState

log = logging.getLogger("edge.stream_pipeline")

WINDOW_SEC = 0.96                       # YAMNet 1프레임 윈도우
HOP_SEC = event_rules.FRAME_HOP_SEC     # 0.48초 — 새 프레임 생성 주기
HISTORY_SEC = 3 * 3600                  # long_silence 규칙(3시간 무활동)까지 커버할 점수 히스토리 길이
MAX_HISTORY_FRAMES = int(HISTORY_SEC / HOP_SEC) + 10
HEARTBEAT_INTERVAL_SEC = 20.0           # 이 파이프라인이 살아있는 동안 주기적으로 보낼 하트비트 간격
RECENT_TRIGGER_FRAMES = 12              # 점수/시각을 뽑을 최근 트리거 구간(약 6초) — 가장 긴 조합 시간창(순차 6프레임)보다 넉넉히
SOURCE = "yamnet"

# 이벤트에 붙일 소리 클립: 감지를 일으킨 윈도우(0.96초) + 감지 후 CLIP_POST_SEC초
# 녹음이 끝나야 전송하므로 알림이 CLIP_POST_SEC초 늦어진다. 0이면 녹음 없이 바로 전송.
CLIP_POST_SEC = 5.0
CLIP_INCLUDE_TRIGGER_WINDOW = True      # 초인종처럼 짧은 소리는 감지 시점에 거의 끝나 있어 앞부분을 붙여야 들림
NO_CLIP_CATEGORIES = {"long_silence"}   # '소리가 없음'이 이벤트라 녹음할 게 없음
# 소리로는 판정하지 않는 카테고리 — fall_suspect는 카메라(vision)와 SPECS를 공유해 send=False로 끌 수 없어 여기서 거름
AUDIO_DISABLED_CATEGORIES = {"fall_suspect"}

# 녹음이 끝난 뒤 vision 영상을 기다리는 최대 시간 — 영상(사후 CLIP_POST_SEC초)은 소리와 거의 같이 끝나고
# ffmpeg 인코딩에 몇 초 걸린다. 넘으면 영상 없이 wav만 전송.
VIDEO_WAIT_SEC = 20.0


@dataclass
class PendingClip:
    """감지 후 CLIP_POST_SEC초가 찰 때까지 오디오를 모으는 중인 이벤트."""
    category_id: str
    score: float
    extra: dict
    occurred_at: datetime
    target_samples: int
    chunks: List[np.ndarray] = field(default_factory=list)
    video_request: Optional[str] = None     # vision에 보낸 녹화 요청 id
    video_deadline: Optional[float] = None  # 녹음 완료 후 영상 대기 마감(monotonic)

    def collected(self) -> int:
        return sum(len(c) for c in self.chunks)


def write_wav(path: str, audio: np.ndarray, samplerate: int = TARGET_SAMPLE_RATE) -> None:
    """float32(-1~1) 모노 → 16bit PCM wav."""
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(samplerate)
        w.writeframes(pcm.tobytes())


class AudioSource:
    """16kHz mono float32 청크를 hop 간격으로 내보내는 제너레이터. frames()만 구현하면 됨."""

    def frames(self):
        raise NotImplementedError


class MicSource(AudioSource):
    """sounddevice로 마이크를 열어 실시간 캡처."""

    def __init__(self, hop_samples: int, samplerate: int = TARGET_SAMPLE_RATE, device=None, channels: Optional[int] = None):
        import sounddevice as sd  # 마이크를 실제로 열 때만 필요

        self._sd = sd
        self.hop_samples = hop_samples
        self.samplerate = samplerate
        # 장치가 16kHz 캡처를 지원하지 않으면 --samplerate로 다른 값을 캡처한 뒤 여기서 16kHz로 리샘플
        self.capture_hop = int(round(hop_samples * samplerate / TARGET_SAMPLE_RATE))
        self.device = device
        # Seeed 2-Mic HAT처럼 raw ALSA(hw:) 장치는 모노(channels=1) 오픈을 거부하고
        # 하드웨어가 노출하는 채널 수로만 열리는 경우가 있어, 기본은 장치가 보고하는
        # max_input_channels로 열고 콜백에서 평균 내 모노로 합친다.
        if channels is None:
            info = sd.query_devices(device) if device is not None else sd.query_devices(kind="input")
            channels = max(1, int(info["max_input_channels"]))
        self.channels = channels
        self._q: "queue.Queue" = queue.Queue()
        # 마지막으로 내보낸 청크의 캡처 시각(time.time()) — 추론이 밀려도 영상과 소리 싱크는 캡처 시각 기준
        self.last_chunk_time: Optional[float] = None

    def _callback(self, indata, frames, time_info, status):
        if status:
            log.warning("sounddevice status: %s", status)
        chunk = indata[:, 0] if self.channels == 1 else indata.mean(axis=1)
        self._q.put((chunk.astype(np.float32).copy(), time.time()))

    def frames(self):
        with self._sd.InputStream(
            samplerate=self.samplerate,
            channels=self.channels,
            dtype="float32",
            blocksize=self.capture_hop,
            device=self.device,
            callback=self._callback,
        ):
            while True:
                chunk, self.last_chunk_time = self._q.get()
                if self.samplerate != TARGET_SAMPLE_RATE:
                    chunk = preprocess(chunk, self.samplerate)
                yield chunk


class WavFileSource(AudioSource):
    """마이크 대신 wav/flac 등 파일을 hop 단위로 잘라 흘려보낸다 (마이크 없는 환경에서 파이프라인 검증용)."""

    def __init__(self, path: str, hop_samples: int, realtime: bool = True):
        import soundfile as sf  # 파일을 실제로 읽을 때만 필요

        audio, sr = sf.read(path, dtype="float32", always_2d=False)
        self.audio = preprocess(audio, sr)
        self.hop_samples = hop_samples
        self.realtime = realtime

    def frames(self):
        n = len(self.audio)
        for start in range(0, n, self.hop_samples):
            chunk = self.audio[start:start + self.hop_samples]
            if len(chunk) < self.hop_samples:
                chunk = np.pad(chunk, (0, self.hop_samples - len(chunk)))
            if self.realtime:
                time.sleep(self.hop_samples / TARGET_SAMPLE_RATE)
            yield chunk


class StreamPipeline:
    """오디오 청크를 받아 YAMNet 추론 → 점수 히스토리 누적 → event_rules 판정 → emit()까지 연결."""

    def __init__(
        self,
        model,
        class_names: List[str],
        emitter: EventEmitter,
        source: AudioSource,
        infer_fn: Callable = infer,
        av_share: Optional[AVShare] = None,
        clock: Callable[[], float] = time.monotonic,
        mode_state: Optional[ModeState] = None,
    ):
        self.model = model
        self.mode_state = mode_state  # None이면 모드 필터 없음(wav 파일 테스트 모드, 유닛 테스트)
        self.class_names = class_names
        self.emitter = emitter
        self.source = source
        self._infer_fn = infer_fn
        self.av_share = av_share  # None이면 카메라 연동 없음(wav 파일 테스트 모드, 유닛 테스트)
        self._clock = clock
        self.hop_samples = int(round(HOP_SEC * TARGET_SAMPLE_RATE))
        self.window_samples = int(round(WINDOW_SEC * TARGET_SAMPLE_RATE))
        self._audio_buf = np.zeros(0, dtype=np.float32)
        self._score_history = np.zeros((0, 521), dtype=np.float32)
        self._pending_clips: Dict[str, PendingClip] = {}  # category_id → 녹음 중인 클립

    def _infer_latest_frame(self) -> np.ndarray:
        if len(self._audio_buf) < self.window_samples:
            window = np.pad(self._audio_buf, (self.window_samples - len(self._audio_buf), 0))
        else:
            window = self._audio_buf[-self.window_samples:]
        scores, _, _ = self._infer_fn(self.model, window)
        return scores[-1]

    def _append_history(self, frame_scores: np.ndarray) -> None:
        self._score_history = np.vstack([self._score_history, frame_scores[None, :]])
        if len(self._score_history) > MAX_HISTORY_FRAMES:
            # Pi 실측(Plan.md 7단계) 전까지는 단순 구현 우선 — 성능 이슈 있으면 그때 원형 버퍼로 교체
            self._score_history = self._score_history[-MAX_HISTORY_FRAMES:]

    def _handle_triggers(self) -> None:
        latest_idx = len(self._score_history) - 1
        for result in event_rules.evaluate_all(self._score_history):
            # 규칙은 히스토리 전체(최대 3시간)를 매번 다시 보므로, 예전 트리거 프레임이 남아 있는 동안
            # 계속 triggered=True가 된다 → 이번에 들어온 최신 프레임이 트리거에 포함될 때만 새 이벤트로 본다.
            # (지속형 규칙 kitchen_risk/long_silence는 상태가 이어지는 동안 최신 프레임을 포함하므로 쿨다운 간격으로 전송)
            if not result.triggered or latest_idx not in result.trigger_frames:
                continue
            cid = result.category_id
            if cid in AUDIO_DISABLED_CATEGORIES:
                continue
            # 거실/현관 모드에 속하지 않는 소리는 이벤트·녹음·영상 요청 모두 만들지 않음
            if self.mode_state is not None and not self.mode_state.allows(cid):
                continue
            # 같은 소리가 이어지는 동안 녹음 중인 클립을 또 만들지 않음 / 쿨다운 중이면 녹음할 필요도 없음
            if cid in self._pending_clips or not self.emitter.can_emit(cid, SOURCE):
                continue
            recent = [f for f in result.trigger_frames if f >= latest_idx - RECENT_TRIGGER_FRAMES]
            recent_scores = self._score_history[recent][:, class_ids_for(cid)]
            score = float(recent_scores.max())
            peak = self._score_history[recent[int(recent_scores.max(axis=1).argmax())]]
            top5 = self._top_labels(peak, k=5)
            # Plan.md §8: YAMNet top label 신뢰도가 낮으므로 "확정된 사실"이 아니라 참고용으로 metadata에 보존
            extra = {"trigger_times_sec": [round(f * HOP_SEC, 2) for f in recent][-5:], "top5": top5}
            occurred_at = datetime.now(timezone.utc)

            if CLIP_POST_SEC <= 0 or cid in NO_CLIP_CATEGORIES:
                self._emit(cid, score, extra, occurred_at)
                continue

            pre = self._audio_buf.copy() if CLIP_INCLUDE_TRIGGER_WINDOW else np.zeros(0, dtype=np.float32)
            post_samples = int(round(CLIP_POST_SEC * TARGET_SAMPLE_RATE))
            video_request = self._request_video(cid, score)
            self._pending_clips[cid] = PendingClip(
                category_id=cid, score=score, extra=extra, occurred_at=occurred_at,
                target_samples=len(pre) + post_samples, chunks=[pre], video_request=video_request,
            )
            log.info("이벤트 감지 category=%s score=%.3f → %.0f초 녹음 후 전송 (영상 %s)",
                     cid, score, CLIP_POST_SEC, "요청함" if video_request else "없음")

    def _request_video(self, cid: str, score: float) -> Optional[str]:
        """카메라(vision)가 켜져 있으면 소리 포함 녹화를 요청하고 요청 id를 반환."""
        if self.av_share is None or not self.av_share.vision_alive():
            return None
        try:
            return self.av_share.request_video(cid, trigger_time=self._chunk_time(),
                                               post_sec=CLIP_POST_SEC, score=score)
        except OSError as e:
            log.warning("영상 녹화 요청 실패 category=%s: %s — 소리만 전송", cid, e)
            return None

    def _chunk_time(self) -> float:
        return getattr(self.source, "last_chunk_time", None) or time.time()

    def _feed_clips(self, chunk: np.ndarray) -> None:
        for cid in list(self._pending_clips):
            clip = self._pending_clips[cid]
            if clip.collected() < clip.target_samples:
                clip.chunks.append(chunk)
                if clip.collected() < clip.target_samples:
                    continue
            video_path = None
            if clip.video_request:
                # 녹음은 끝났고 vision 영상을 기다리는 중 — 청크마다(0.48초) 확인
                if clip.video_deadline is None:
                    clip.video_deadline = self._clock() + VIDEO_WAIT_SEC
                status, video_path = self.av_share.take_video_result(clip.video_request)
                if status is None and self._clock() < clip.video_deadline:
                    continue
                if status != "ready":
                    log.warning("영상 못 받음(%s) category=%s — 소리만 전송", status or "시간 초과", cid)
                    self.av_share.cancel_request(clip.video_request)
            self._finish_clip(cid, video_path)

    def _finish_clip(self, cid: str, video_path: Optional[str] = None) -> None:
        """녹음 중인 클립을 wav로 저장해 이벤트와 함께 전송 (모자라도 모인 만큼). video_path는 전송 후 지운다."""
        clip = self._pending_clips.pop(cid)
        audio = np.concatenate(clip.chunks)[:clip.target_samples]
        extra = {**clip.extra, "clip_sec": round(len(audio) / TARGET_SAMPLE_RATE, 2)}

        fd, path = tempfile.mkstemp(suffix=".wav", prefix=f"{cid}_")
        os.close(fd)
        try:
            write_wav(path, audio)
        except Exception:
            # 녹음 저장에 실패해도 이벤트 자체는 보냄
            log.exception("소리 클립 저장 실패 category=%s — 소리 없이 전송", cid)
            os.unlink(path)
            path = None
        try:
            self._emit(cid, clip.score, extra, clip.occurred_at, audio_path=path, video_path=video_path)
        finally:
            # 큐 폴더로 복사됐으므로 원본은 지움
            for p in (path, video_path):
                if p:
                    Path(p).unlink(missing_ok=True)

    def flush_pending_clips(self) -> None:
        """종료 시 녹음 중이던 클립을 모인 만큼이라도 전송 (이벤트 유실 방지). 영상은 이미 와 있을 때만 붙임."""
        for cid in list(self._pending_clips):
            clip = self._pending_clips[cid]
            video_path = None
            if clip.video_request:
                status, video_path = self.av_share.take_video_result(clip.video_request)
                if status != "ready":
                    self.av_share.cancel_request(clip.video_request)
            self._finish_clip(cid, video_path)

    def _emit(self, cid: str, score: float, extra: dict, occurred_at: datetime, audio_path: Optional[str] = None,
              video_path: Optional[str] = None) -> None:
        uid = self.emitter.emit(cid, source=SOURCE, score=score, extra=extra,
                                audio_path=audio_path, video_path=video_path, occurred_at=occurred_at)
        if uid:
            log.info(
                "이벤트 판정 category=%s score=%.3f top5=%s audio=%s video=%s uid=%s (전송 대기열에 저장됨, 아직 백엔드로 안 나감)",
                cid, score, extra.get("top5"), "있음" if audio_path else "없음", "있음" if video_path else "없음", uid,
            )

    def _top_labels(self, frame_scores: np.ndarray, k: int = 5) -> List[str]:
        if not self.class_names:
            return []
        top = np.argsort(frame_scores)[::-1][:k]
        return [f"{self.class_names[i]}:{frame_scores[i]:.2f}" for i in top]

    def _log_top_frame(self, frame_scores: np.ndarray) -> None:
        if not log.isEnabledFor(logging.DEBUG):
            return
        log.debug("프레임 top3: %s", ", ".join(self._top_labels(frame_scores, k=3)))

    def run(self) -> None:
        try:
            for chunk in self.source.frames():
                if self.av_share is not None:
                    self.av_share.push_audio(chunk, TARGET_SAMPLE_RATE, self._chunk_time())
                self._audio_buf = np.concatenate([self._audio_buf, chunk])[-self.window_samples:]
                # 새 클립은 _handle_triggers에서 이 청크가 든 _audio_buf로 시작하므로, 기존 클립부터 먼저 채움
                self._feed_clips(chunk)
                frame_scores = self._infer_latest_frame()
                self._log_top_frame(frame_scores)
                self._append_history(frame_scores)
                self._handle_triggers()
        finally:
            self.flush_pending_clips()


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--wav-file", help="마이크 대신 이 파일을 스트리밍처럼 흘려보낸다 (테스트용)")
    p.add_argument("--fast", action="store_true", help="--wav-file일 때 실시간 대기 없이 최대 속도로 처리")
    p.add_argument("--device", help="sounddevice 입력 장치(인덱스 또는 이름). --list-devices로 확인")
    p.add_argument("--samplerate", type=int, default=TARGET_SAMPLE_RATE, help="마이크 캡처 샘플레이트(장치가 16000Hz를 지원 안 할 때 조정)")
    p.add_argument("--channels", type=int, default=None, help="마이크 캡처 채널 수(기본: 장치가 보고하는 채널 수 자동 감지 후 모노로 다운믹스)")
    p.add_argument("--list-devices", action="store_true", help="사용 가능한 오디오 입력 장치를 출력하고 종료")
    p.add_argument("--log-level", default="INFO")
    return p


def main() -> int:
    args = build_arg_parser().parse_args()
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.list_devices:
        import sounddevice as sd

        print(sd.query_devices())
        return 0

    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"설정 오류: {e}")
        return 2

    log.info("YAMNet 로드 중... (최초 실행 시 인터넷에서 모델 다운로드)")
    model = load_yamnet()
    class_names = load_class_names(model)
    log.info("YAMNet 로드 완료 (%d 클래스)", len(class_names))

    emitter = EventEmitter(cfg)
    emitter.start()

    # 마이크 파이프라인이 살아있는 동안(--wav-file 테스트 모드 제외) 하트비트 전송
    # → 홈 화면의 "마이크 켜짐/꺼짐" 표시가 이 값을 근거로 계산됨(device.service.js HEARTBEAT_STALE_MS)
    # 하트비트 응답에 실려 오는 거실/현관 모드로 감지할 소리를 거른다(wav 테스트 모드는 필터 없음)
    hb_thread = hb_stop = None
    mode_state = None
    if not args.wav_file:
        mode_state = ModeState()
        hb_thread, hb_stop = heartbeat.start_background(
            cfg.backend_url, cfg.device_id, cfg.device_secret, interval_sec=HEARTBEAT_INTERVAL_SEC,
            on_response=mode_state.update_from_heartbeat,
        )

    hop_samples = int(round(HOP_SEC * TARGET_SAMPLE_RATE))
    if args.wav_file:
        source: AudioSource = WavFileSource(args.wav_file, hop_samples, realtime=not args.fast)
    else:
        device = int(args.device) if args.device and args.device.isdigit() else args.device
        source = MicSource(hop_samples, samplerate=args.samplerate, device=device, channels=args.channels)

    # 카메라 연동(소리 링버퍼 공유 + 소리 이벤트 녹화 요청)은 실제 마이크 모드에서만
    av_share = None
    if not args.wav_file:
        try:
            av_share = AVShare()
            log.info("카메라 연동 공유 폴더: %s", av_share.root)
        except OSError as e:
            log.warning("카메라 연동 공유 폴더 생성 실패(%s) — 소리 이벤트는 wav만 전송", e)

    pipeline = StreamPipeline(model, class_names, emitter, source, av_share=av_share, mode_state=mode_state)
    log.info("스트리밍 시작 (Ctrl+C로 종료)")
    try:
        pipeline.run()
    except KeyboardInterrupt:
        log.info("종료 신호 받음")
    finally:
        if hb_stop:
            hb_stop.set()
        emitter.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
