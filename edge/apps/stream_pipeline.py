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


@dataclass
class PendingClip:
    """감지 후 CLIP_POST_SEC초가 찰 때까지 오디오를 모으는 중인 이벤트."""
    category_id: str
    score: float
    extra: dict
    occurred_at: datetime
    target_samples: int
    chunks: List[np.ndarray] = field(default_factory=list)

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
        self._q: "queue.Queue[np.ndarray]" = queue.Queue()

    def _callback(self, indata, frames, time_info, status):
        if status:
            log.warning("sounddevice status: %s", status)
        chunk = indata[:, 0] if self.channels == 1 else indata.mean(axis=1)
        self._q.put(chunk.astype(np.float32).copy())

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
                chunk = self._q.get()
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
    ):
        self.model = model
        self.class_names = class_names
        self.emitter = emitter
        self.source = source
        self._infer_fn = infer_fn
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
            self._pending_clips[cid] = PendingClip(
                category_id=cid, score=score, extra=extra, occurred_at=occurred_at,
                target_samples=len(pre) + post_samples, chunks=[pre],
            )
            log.info("이벤트 감지 category=%s score=%.3f → %.0f초 녹음 후 전송", cid, score, CLIP_POST_SEC)

    def _feed_clips(self, chunk: np.ndarray) -> None:
        for cid in list(self._pending_clips):
            clip = self._pending_clips[cid]
            clip.chunks.append(chunk)
            if clip.collected() >= clip.target_samples:
                self._finish_clip(cid)

    def _finish_clip(self, cid: str) -> None:
        """녹음 중인 클립을 wav로 저장해 이벤트와 함께 전송 (모자라도 모인 만큼)."""
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
            self._emit(cid, clip.score, extra, clip.occurred_at, audio_path=path)
        finally:
            if path:
                os.unlink(path)  # 큐 폴더로 복사됐으므로 원본은 지움

    def flush_pending_clips(self) -> None:
        """종료 시 녹음 중이던 클립을 모인 만큼이라도 전송 (이벤트 유실 방지)."""
        for cid in list(self._pending_clips):
            self._finish_clip(cid)

    def _emit(self, cid: str, score: float, extra: dict, occurred_at: datetime, audio_path: Optional[str] = None) -> None:
        uid = self.emitter.emit(cid, source=SOURCE, score=score, extra=extra,
                                audio_path=audio_path, occurred_at=occurred_at)
        if uid:
            log.info(
                "이벤트 판정 category=%s score=%.3f top5=%s audio=%s uid=%s (전송 대기열에 저장됨, 아직 백엔드로 안 나감)",
                cid, score, extra.get("top5"), "있음" if audio_path else "없음", uid,
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
    hb_thread = hb_stop = None
    if not args.wav_file:
        hb_thread, hb_stop = heartbeat.start_background(
            cfg.backend_url, cfg.device_id, cfg.device_secret, interval_sec=HEARTBEAT_INTERVAL_SEC
        )

    hop_samples = int(round(HOP_SEC * TARGET_SAMPLE_RATE))
    if args.wav_file:
        source: AudioSource = WavFileSource(args.wav_file, hop_samples, realtime=not args.fast)
    else:
        device = int(args.device) if args.device and args.device.isdigit() else args.device
        source = MicSource(hop_samples, samplerate=args.samplerate, device=device, channels=args.channels)

    pipeline = StreamPipeline(model, class_names, emitter, source)
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
