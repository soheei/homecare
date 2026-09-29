"""stream_pipeline.py 로직 테스트 — TensorFlow/sounddevice 없이 검증(가짜 infer_fn 주입).
실행: 저장소 루트에서 `python -m unittest discover -s edge/tests -t .`"""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from edge.apps import stream_pipeline as sp
from edge.transport.config import Config
from edge.transport.cooldown import Cooldown
from edge.transport.emit import EventEmitter


def make_cfg(tmp):
    return Config(
        backend_url="http://backend.test",
        device_id="dev-uuid",
        device_secret="s3cret",
        request_timeout=5,
        outbox_dir=Path(tmp) / "data",
    )


class FakeSource(sp.AudioSource):
    def __init__(self, n_chunks, hop_samples):
        self.n_chunks = n_chunks
        self.hop_samples = hop_samples

    def frames(self):
        for _ in range(self.n_chunks):
            yield np.zeros(self.hop_samples, dtype=np.float32)


def make_fake_infer(trigger_at_call, class_id, score=0.9):
    """trigger_at_call번째 호출에서만 class_id 점수를 올린 프레임(1, 521)을 반환."""
    call = [0]

    def infer_fn(model, window):
        call[0] += 1
        frame = np.zeros((1, 521), dtype=np.float32)
        if call[0] == trigger_at_call:
            frame[0, class_id] = score
        return frame, None, None

    return infer_fn


class StreamPipelineTest(unittest.TestCase):
    def _hop_samples(self):
        return int(round(sp.HOP_SEC * sp.TARGET_SAMPLE_RATE))

    def test_threshold_category_triggers_and_is_emitted(self):
        with tempfile.TemporaryDirectory() as tmp:
            emitter = EventEmitter(make_cfg(tmp))
            source = FakeSource(n_chunks=6, hop_samples=self._hop_samples())
            infer_fn = make_fake_infer(trigger_at_call=6, class_id=349)  # Doorbell

            pipeline = sp.StreamPipeline(
                model=None, class_names=[], emitter=emitter, source=source, infer_fn=infer_fn
            )
            pipeline.run()

            rows = {r["payload"]["metadata"]["category_id"]: r for r in emitter.outbox.fetch_due()}
            self.assertIn("door_visitor", rows)
            payload = rows["door_visitor"]["payload"]
            self.assertEqual(payload["type"], "visitor")
            self.assertAlmostEqual(payload["metadata"]["score"], 0.9, places=3)

    def test_no_trigger_when_scores_stay_low(self):
        with tempfile.TemporaryDirectory() as tmp:
            emitter = EventEmitter(make_cfg(tmp))
            source = FakeSource(n_chunks=4, hop_samples=self._hop_samples())
            infer_fn = make_fake_infer(trigger_at_call=99, class_id=349)  # 이번 실행에선 절대 안 켜짐

            pipeline = sp.StreamPipeline(
                model=None, class_names=[], emitter=emitter, source=source, infer_fn=infer_fn
            )
            pipeline.run()

            self.assertEqual(emitter.outbox.counts(), {"pending": 0, "dead": 0})

    def test_log_only_category_never_emits_even_if_scores_high(self):
        with tempfile.TemporaryDirectory() as tmp:
            emitter = EventEmitter(make_cfg(tmp))
            source = FakeSource(n_chunks=3, hop_samples=self._hop_samples())
            infer_fn = make_fake_infer(trigger_at_call=3, class_id=518)  # Television (ambient_log)

            pipeline = sp.StreamPipeline(
                model=None, class_names=[], emitter=emitter, source=source, infer_fn=infer_fn
            )
            pipeline.run()

            # ambient_log는 rule_log_only라서 triggered=False로 남고, emit() 대상도 아님
            self.assertEqual(emitter.outbox.counts(), {"pending": 0, "dead": 0})

    def test_single_sound_is_not_re_emitted_after_cooldown(self):
        """유리 파손 소리 1번 → 쿨다운(10초)이 여러 번 지나도 이벤트는 1건, 점수는 트리거 프레임 값.
        (예전: 히스토리 전체를 매번 다시 판정해 쿨다운마다 같은 이벤트가 최대 3시간 반복 전송됨)"""
        now = [0.0]

        class TimedSource(FakeSource):
            def frames(self):
                for chunk in super().frames():
                    now[0] += sp.HOP_SEC  # 청크 하나 = 실제 0.48초 경과
                    yield chunk

        call = [0]

        def infer_fn(model, window):
            call[0] += 1
            frame = np.zeros((1, 521), dtype=np.float32)
            if call[0] == 3:
                frame[0, 435] = 0.8  # Glass
                frame[0, 437] = 0.7  # Shatter
            return frame, None, None

        with tempfile.TemporaryDirectory() as tmp:
            emitter = EventEmitter(make_cfg(tmp))
            emitter._cooldown = Cooldown(clock=lambda: now[0])
            n_chunks = int(60 / sp.HOP_SEC)  # 1분 = glass_impact 쿨다운(10초)의 6배
            pipeline = sp.StreamPipeline(
                model=None, class_names=[], emitter=emitter,
                source=TimedSource(n_chunks, self._hop_samples()), infer_fn=infer_fn,
            )
            pipeline.run()

            glass = [r for r in emitter.outbox.fetch_due(limit=1000)
                     if r["payload"]["metadata"]["category_id"] == "glass_impact"]
            self.assertEqual(len(glass), 1)
            self.assertAlmostEqual(glass[0]["payload"]["metadata"]["score"], 0.8, places=3)

    def test_sound_event_waits_for_clip_and_attaches_wav(self):
        """감지 후 CLIP_POST_SEC초가 찰 때까지 전송을 미루고, 감지 윈도우+5초 wav를 첨부. 녹음 중 재감지는 무시."""
        import wave

        hop = self._hop_samples()
        post_chunks = int(np.ceil(sp.CLIP_POST_SEC / sp.HOP_SEC))
        call = [0]

        def infer_fn(model, window):
            call[0] += 1
            frame = np.zeros((1, 521), dtype=np.float32)
            if call[0] in (3, 5):  # 녹음 중(5번째)에 또 울려도 이벤트는 1건
                frame[0, 349] = 0.9  # Doorbell
            return frame, None, None

        with tempfile.TemporaryDirectory() as tmp:
            emitter = EventEmitter(make_cfg(tmp))
            pipeline = sp.StreamPipeline(
                model=None, class_names=[], emitter=emitter,
                source=FakeSource(3 + post_chunks - 1, hop), infer_fn=infer_fn,
            )
            # 5초가 차기 직전까지만 흘려 보내면 아직 전송 전(녹음 중)
            for i, chunk in enumerate(pipeline.source.frames()):
                pipeline._audio_buf = np.concatenate([pipeline._audio_buf, chunk])[-pipeline.window_samples:]
                pipeline._feed_clips(chunk)
                pipeline._append_history(pipeline._infer_latest_frame())
                pipeline._handle_triggers()
            self.assertEqual(emitter.outbox.counts()["pending"], 0)
            self.assertIn("door_visitor", pipeline._pending_clips)

            pipeline._feed_clips(np.zeros(hop, dtype=np.float32))  # 마지막 청크 → 5초 완성 → 전송
            rows = emitter.outbox.fetch_due()
            self.assertEqual(len(rows), 1)
            audio = [a for a in rows[0]["attachments"] if a["field"] == "audio"]
            self.assertEqual(audio[0]["mime"], "audio/wav")
            with wave.open(audio[0]["path"]) as w:
                self.assertEqual(w.getframerate(), sp.TARGET_SAMPLE_RATE)
                expected = pipeline.window_samples + int(round(sp.CLIP_POST_SEC * sp.TARGET_SAMPLE_RATE))
                self.assertEqual(w.getnframes(), expected)
            self.assertEqual(pipeline._pending_clips, {})

    def test_pending_clip_is_flushed_when_stream_ends(self):
        with tempfile.TemporaryDirectory() as tmp:
            emitter = EventEmitter(make_cfg(tmp))
            pipeline = sp.StreamPipeline(
                model=None, class_names=[], emitter=emitter,
                source=FakeSource(3, self._hop_samples()), infer_fn=make_fake_infer(3, 349),
            )
            pipeline.run()  # 5초가 차기 전에 끝나도 모인 만큼 보냄
            rows = emitter.outbox.fetch_due()
            self.assertEqual(len(rows), 1)
            self.assertTrue(any(a["field"] == "audio" for a in rows[0]["attachments"]))
            self.assertLess(rows[0]["payload"]["metadata"]["clip_sec"], sp.CLIP_POST_SEC)


if __name__ == "__main__":
    unittest.main()
