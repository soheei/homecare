"""stream_pipeline.py 로직 테스트 — TensorFlow/sounddevice 없이 검증(가짜 infer_fn 주입).
실행: 저장소 루트에서 `python -m unittest discover -s edge/tests -t .`"""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from edge import stream_pipeline as sp
from edge.config import Config
from edge.emit import EventEmitter


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


if __name__ == "__main__":
    unittest.main()
