"""vision 카메라 서비스(하트비트 / 현재 화면 보기) 테스트 — 카메라/네트워크 없이 검증.
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import threading
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from edge.apps import camera_monitor
from edge.transport.config import Config
from vision import camera_service

FRAME = np.full((480, 640, 3), 120, dtype=np.uint8)


class FakeResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body
        self.text = ""

    def json(self):
        return self._body


class LatestFrameTest(unittest.TestCase):
    def test_no_frame_yet_means_camera_not_detected(self):
        latest = camera_service.LatestFrame()
        self.assertFalse(latest.is_fresh())
        self.assertEqual(latest.capture_jpeg(), (None, "camera_not_detected"))

    def test_latest_frame_is_encoded_as_jpeg(self):
        latest = camera_service.LatestFrame()
        latest.set(FRAME)
        image, reason = latest.capture_jpeg()
        self.assertTrue(latest.is_fresh())
        self.assertIsNone(reason)
        self.assertTrue(image.startswith(b"\xff\xd8"))  # JPEG 시작 바이트

    def test_stale_frame_stops_heartbeat_and_capture(self):
        # 카메라가 멈춰 프레임이 10초 넘게 안 들어오면 하트비트 중단 → 앱에서 "꺼짐"
        now = [0.0]
        latest = camera_service.LatestFrame(stale_sec=10, clock=lambda: now[0])
        latest.set(FRAME)
        now[0] = 11.0
        self.assertFalse(latest.is_fresh())
        self.assertEqual(latest.capture_jpeg(), (None, "camera_not_detected"))


class CameraServiceTest(unittest.TestCase):
    def test_capture_request_uploads_latest_frame(self):
        latest = camera_service.LatestFrame()
        latest.set(FRAME)
        stop = threading.Event()

        class Session:
            posts = []

            def get(self, url, **kw):
                stop.set()
                return FakeResponse(200, {"data": {"requestId": "r1"}})

            def post(self, url, **kw):
                self.posts.append((url, kw))
                return FakeResponse(200, {"success": True})

        session = Session()
        with mock.patch.object(camera_monitor, "capture_current_frame",
                               side_effect=AssertionError("rpicam-still을 쓰면 안 됨")):
            camera_monitor.run_capture_listener("http://backend.test", "cam-uuid", "s", stop, session,
                                                capture_fn=latest.capture_jpeg)

        (url, kw), = session.posts
        self.assertEqual(url, "http://backend.test/api/devices/cam-uuid/capture-requests/r1")
        name, data, mime = kw["files"]["image"]
        self.assertEqual(mime, "image/jpeg")
        self.assertTrue(data.startswith(b"\xff\xd8"))

    def test_start_uses_camera_device_and_latest_frame(self):
        cfg = Config("http://backend.test", "cam-uuid", "s", 5, Path("."))
        latest = camera_service.LatestFrame()
        hb_stop, cap_stop = threading.Event(), threading.Event()

        with mock.patch.object(camera_service.heartbeat, "start_background",
                               return_value=(None, hb_stop)) as hb, \
                mock.patch.object(camera_service.camera_monitor, "start_capture_listener",
                                  return_value=(None, cap_stop)) as cap:
            stops = camera_service.start(cfg, latest, interval_sec=20)

        self.assertEqual(stops, [hb_stop, cap_stop])
        self.assertEqual(hb.call_args.args[1], "cam-uuid")
        self.assertEqual(hb.call_args.kwargs["should_send"], latest.is_fresh)
        self.assertEqual(cap.call_args.args[1], "cam-uuid")
        self.assertEqual(cap.call_args.kwargs["capture_fn"], latest.capture_jpeg)


if __name__ == "__main__":
    unittest.main()
