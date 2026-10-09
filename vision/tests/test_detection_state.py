"""영상 모드는 한 응답 단위로 갱신하고 불완전한 응답은 무시한다."""
import unittest

from vision.intrusion_detector import DetectionModeState


class DetectionModeStateTest(unittest.TestCase):
    def test_unknown_until_first_complete_response(self):
        state = DetectionModeState()
        self.assertIsNone(state.snapshot())
        state.update_from_heartbeat({"mode": "living"})
        self.assertIsNone(state.snapshot())

    def test_complete_state_replaces_both_fields(self):
        state = DetectionModeState()
        state.update_from_heartbeat({"mode": "living", "securityArmed": False})
        old = state.snapshot()
        state.update_from_heartbeat({"mode": "entrance", "securityArmed": True})
        self.assertEqual(old, ("living", False))
        self.assertEqual(state.snapshot(), ("entrance", True))

    def test_invalid_or_partial_response_preserves_last_state(self):
        state = DetectionModeState()
        state.update_from_heartbeat({"mode": "entrance", "securityArmed": True})
        for data in (None, [], {"mode": "living"}, {"securityArmed": False},
                     {"mode": "living", "securityArmed": "false"},
                     {"mode": "bad", "securityArmed": False},
                     {"success": False, "mode": "living", "securityArmed": False}):
            with self.subTest(data=data):
                state.update_from_heartbeat(data)
                self.assertEqual(state.snapshot(), ("entrance", True))
