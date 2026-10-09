"""카메라 서비스의 모드 연결 테스트 — 하트비트 응답이 영상용 상태로 전달되는지.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import threading
import unittest
from pathlib import Path
from unittest import mock

from edge.transport.config import Config
from vision.intrusion_detector import DetectionModeState
from vision import camera_service


class ModeWiringTest(unittest.TestCase):
    def _start(self, **kwargs):
        cfg = Config("http://backend.test", "cam-uuid", "s", 5, Path("."))
        latest = camera_service.LatestFrame()
        with mock.patch.object(camera_service.heartbeat, "start_background",
                               return_value=(None, threading.Event())) as hb, \
                mock.patch.object(camera_service.camera_monitor, "start_capture_listener",
                                  return_value=(None, threading.Event())):
            camera_service.start(cfg, latest, interval_sec=20, **kwargs)
        return hb

    def test_heartbeat_response_updates_mode_state(self):
        state = DetectionModeState()
        hb = self._start(mode_state=state)

        hb.call_args.kwargs["on_response"]({"success": True, "mode": "entrance", "securityArmed": True})

        self.assertEqual(state.snapshot(), ("entrance", True))

    def test_without_mode_state_no_callback(self):
        hb = self._start()
        self.assertIsNone(hb.call_args.kwargs["on_response"])


if __name__ == "__main__":
    unittest.main()
