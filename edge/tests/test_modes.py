"""거실/현관 모드 테스트 — 모드별 허용 카테고리, 하트비트 응답 수신, 마이크 파이프라인 필터.
실행: 저장소 루트에서 `python -m unittest discover -s edge/tests -t .`"""

import tempfile
import unittest

from edge.apps import stream_pipeline as sp
from edge.tests.test_edge import FakeResponse, FakeSession
from edge.tests.test_stream_pipeline import FakeSource, make_cfg, make_fake_infer
from edge.transport import event_mapper, heartbeat
from edge.transport.emit import EventEmitter
from edge.transport.modes import ENTRANCE, LIVING, ModeState, is_allowed


class IsAllowedTest(unittest.TestCase):
    def test_living_mode_categories(self):
        for cid in ("scream_shout", "animal", "baby_cry", "fire_alarm_siren", "glass_impact", "fall_suspect"):
            self.assertTrue(is_allowed(LIVING, cid), cid)
        for cid in ("door_visitor", "door_security", "delivery_suspect"):
            self.assertFalse(is_allowed(LIVING, cid), cid)

    def test_entrance_mode_categories(self):
        for cid in ("door_visitor", "visitor_detected", "delivery_suspect"):
            self.assertTrue(is_allowed(ENTRANCE, cid), cid)
        for cid in ("scream_shout", "animal", "baby_cry", "fire_alarm_siren", "glass_impact",
                    "door_security", "fall_suspect"):
            self.assertFalse(is_allowed(ENTRANCE, cid), cid)

    def test_unknown_mode_falls_back_to_living(self):
        self.assertTrue(is_allowed("kitchen", "scream_shout"))
        self.assertFalse(is_allowed("kitchen", "door_visitor"))


class SecurityEventSpecTest(unittest.TestCase):
    def test_intrusion_suspect_is_sent_as_danger(self):
        # 백엔드 notification.service.js의 SECURITY_CATEGORIES와 같은 이름이어야 "침입 의심" 푸시가 간다
        spec = event_mapper.get_spec("intrusion_suspect")
        self.assertIsNotNone(spec)
        self.assertTrue(spec.send)
        self.assertEqual((spec.type, spec.danger_level), ("danger", "danger"))


class ModeStateTest(unittest.TestCase):
    def test_defaults_to_living_and_unarmed(self):
        state = ModeState()
        self.assertEqual(state.mode, LIVING)
        self.assertFalse(state.security_armed)

    def test_updates_from_heartbeat_response(self):
        state = ModeState()
        state.update_from_heartbeat({"success": True, "mode": "entrance", "securityArmed": True})
        self.assertEqual(state.mode, ENTRANCE)
        self.assertTrue(state.security_armed)
        self.assertTrue(state.allows("door_visitor"))
        self.assertFalse(state.allows("scream_shout"))

    def test_ignores_missing_or_invalid_values(self):
        state = ModeState(ENTRANCE, True)
        state.update_from_heartbeat({"success": True})                       # 구버전 백엔드: 필드 없음
        state.update_from_heartbeat({"mode": "kitchen", "securityArmed": "yes"})
        state.update_from_heartbeat(None)
        state.update_from_heartbeat("not a dict")
        self.assertEqual(state.mode, ENTRANCE)
        self.assertTrue(state.security_armed)


class HeartbeatResponseTest(unittest.TestCase):
    def _send(self, response, on_response):
        session = FakeSession(response)
        return heartbeat.send_once(session, "http://backend.test", "dev", "s3cret", 5, on_response=on_response)

    def test_passes_response_json_to_callback(self):
        got = []
        ok = self._send(FakeResponse(200, {"success": True, "mode": "entrance", "securityArmed": False}), got.append)
        self.assertTrue(ok)
        self.assertEqual(got[0]["mode"], "entrance")

    def test_unreadable_response_does_not_fail_heartbeat(self):
        got = []
        ok = self._send(FakeResponse(200, None), got.append)   # json() 호출 시 ValueError
        self.assertTrue(ok)
        self.assertEqual(got, [])

    def test_callback_error_does_not_fail_heartbeat(self):
        def boom(_):
            raise RuntimeError("x")

        self.assertTrue(self._send(FakeResponse(200, {"mode": "living"}), boom))

    def test_callback_not_called_on_failure(self):
        got = []
        ok = self._send(FakeResponse(500, {"success": False}), got.append)
        self.assertFalse(ok)
        self.assertEqual(got, [])


class StreamPipelineModeFilterTest(unittest.TestCase):
    def _run(self, mode_state, class_id):
        with tempfile.TemporaryDirectory() as tmp:
            emitter = EventEmitter(make_cfg(tmp))
            hop = int(round(sp.HOP_SEC * sp.TARGET_SAMPLE_RATE))
            pipeline = sp.StreamPipeline(
                model=None, class_names=[], emitter=emitter,
                source=FakeSource(n_chunks=6, hop_samples=hop),
                infer_fn=make_fake_infer(trigger_at_call=6, class_id=class_id),
                mode_state=mode_state,
            )
            pipeline.run()
            return {r["payload"]["metadata"]["category_id"] for r in emitter.outbox.fetch_due()}

    def test_doorbell_emitted_in_entrance_mode(self):
        self.assertIn("door_visitor", self._run(ModeState(ENTRANCE), class_id=349))

    def test_doorbell_dropped_in_living_mode(self):
        self.assertNotIn("door_visitor", self._run(ModeState(LIVING), class_id=349))

    def test_no_mode_state_means_no_filter(self):
        self.assertIn("door_visitor", self._run(None, class_id=349))


if __name__ == "__main__":
    unittest.main()
