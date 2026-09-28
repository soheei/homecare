"""
camera_service.py — vision 파이프라인을 "카메라 서비스"로 만드는 부분

카메라는 한 프로그램만 열 수 있어서(libcamera), vision이 카메라를 여는 동안
rpicam-hello/rpicam-still을 쓰는 edge/apps/camera_monitor.py는 동시에 돌 수 없다.
그래서 vision이 직접:
  - 하트비트: 최근 FRAME_STALE_SEC 안에 프레임이 들어왔을 때만 전송
              (카메라가 멈추면 전송이 끊겨 앱에서 "꺼짐"으로 표시됨)
  - "현재 화면 보기": 메인 루프가 보관한 최신 프레임을 JPEG로 바로 업로드
                     (롱폴링/업로드는 camera_monitor의 함수를 그대로 재사용)
"""

import threading
import time

import cv2

from edge.apps import camera_monitor
from edge.transport import heartbeat

FRAME_STALE_SEC = 10
JPEG_QUALITY = 85


class LatestFrame:
    """메인 루프가 매 프레임 set()하고, 다른 스레드가 읽어 가는 최신 프레임 보관함."""

    def __init__(self, stale_sec=FRAME_STALE_SEC, clock=time.monotonic):
        self._lock = threading.Lock()
        self._frame = None
        self._at = 0.0
        self._stale_sec = stale_sec
        self._clock = clock

    def set(self, frame):
        with self._lock:
            self._frame = frame
            self._at = self._clock()

    def is_fresh(self):
        with self._lock:
            return (
                self._frame is not None
                and self._clock() - self._at < self._stale_sec
            )

    def capture_jpeg(self):
        """(JPEG bytes, None) 또는 (None, 'camera_not_detected' | 'capture_failed') — camera_monitor 캡처 함수 형식."""

        with self._lock:
            frame = self._frame
            fresh = frame is not None and self._clock() - self._at < self._stale_sec

        if not fresh:
            return None, "camera_not_detected"

        ok, buf = cv2.imencode(
            ".jpg",
            frame,
            [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY],
        )

        if not ok:
            return None, "capture_failed"

        return buf.tobytes(), None


def start(cfg, latest, interval_sec=20.0):
    """하트비트 + 캡처 요청 대기 스레드 시작. 멈출 때 set()할 stop 이벤트 목록을 반환.

    cfg: 카메라 기기 id가 들어간 edge Config
    """

    _, hb_stop = heartbeat.start_background(
        cfg.backend_url,
        cfg.device_id,
        cfg.device_secret,
        interval_sec=interval_sec,
        timeout=cfg.request_timeout,
        should_send=latest.is_fresh,
        get_metrics=lambda: {"hardware_detected": True, "pipeline": "vision"},
    )

    _, capture_stop = camera_monitor.start_capture_listener(
        cfg.backend_url,
        cfg.device_id,
        cfg.device_secret,
        capture_fn=latest.capture_jpeg,
    )

    return [hb_stop, capture_stop]
