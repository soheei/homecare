import logging
import threading
import time

import requests


logger = logging.getLogger(__name__)


class GuardModeClient:
    """
    백엔드에서 앱의 경비 모드 상태를 주기적으로 조회한다.

    API 응답 형식:
    {
        "success": true,
        "data": {
            "armed_mode": true
        }
    }

    API 연결에 실패하면 마지막으로 확인한 상태를 유지한다.
    최초 조회에 성공하지 못하면 기본값은 False(경비 해제)다.
    """

    def __init__(
        self,
        config,
        poll_interval_sec=3,
        request_timeout_sec=5,
    ):
        self.url = (
            f"{config.backend_url.rstrip('/')}"
            f"/api/devices/{config.device_id}/security-mode"
        )

        self.headers = {
            "X-Device-Id": config.device_id,
            "X-Device-Secret": config.device_secret,
        }

        self.poll_interval_sec = poll_interval_sec
        self.request_timeout_sec = request_timeout_sec

        self._armed_mode = False
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None
        self._last_error_log = 0.0

    def start(self):
        """경비 모드 조회를 백그라운드 스레드에서 시작한다."""
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()

        self._thread = threading.Thread(
            target=self._poll_loop,
            name="guard-mode-poller",
            daemon=True,
        )
        self._thread.start()

    def stop(self):
        """조회 스레드를 종료한다."""
        self._stop_event.set()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)

    def is_armed(self):
        """현재까지 확인한 경비 모드 상태를 반환한다."""
        with self._lock:
            return self._armed_mode

    def _poll_loop(self):
        while not self._stop_event.is_set():
            try:
                response = requests.get(
                    self.url,
                    headers=self.headers,
                    timeout=self.request_timeout_sec,
                )
                response.raise_for_status()

                body = response.json()
                data = body.get("data", {})
                armed_mode = data.get("armed_mode")

                if not isinstance(armed_mode, bool):
                    raise ValueError(
                        "API 응답에 boolean armed_mode가 없습니다."
                    )

                with self._lock:
                    previous_mode = self._armed_mode
                    self._armed_mode = armed_mode

                if previous_mode != armed_mode:
                    logger.info(
                        "[GUARD MODE] %s",
                        "ARMED" if armed_mode else "DISARMED",
                    )

            except (
                requests.RequestException,
                ValueError,
                TypeError,
            ) as exc:
                now = time.monotonic()

                # 오류 로그가 3초마다 반복되는 것을 방지한다.
                if now - self._last_error_log >= 30:
                    logger.warning(
                        "[GUARD MODE] 상태 조회 실패. "
                        "마지막 확인 상태를 유지합니다: %s",
                        exc,
                    )
                    self._last_error_log = now

            self._stop_event.wait(
                self.poll_interval_sec
            )


class IntrusionDetector:
    """
    경비 모드가 켜진 상태에서 사람을 감지하면 침입으로 판단한다.

    기본 조건:
    - 경비 모드 활성화
    - 사람 검출이 3프레임 연속 유지
    - 같은 사람이 화면에 계속 있는 동안 중복 이벤트 방지
    - 사람이 5프레임 연속 사라지면 다음 침입 감지 준비
    """

    def __init__(
        self,
        required_frames=3,
        missing_frames_to_reset=5,
    ):
        self.required_frames = required_frames
        self.missing_frames_to_reset = (
            missing_frames_to_reset
        )

        self.candidate_count = 0
        self.missing_count = 0

        self.triggered = False
        self.was_armed = False

    def reset(self):
        self.candidate_count = 0
        self.missing_count = 0
        self.triggered = False

    def update(self, person, armed_mode):
        """
        person:
            YOLO가 검출한 사람 정보 또는 None

        armed_mode:
            앱에서 설정한 경비 모드 boolean

        반환:
            True  -> 새로운 침입 이벤트
            False -> 이벤트 없음
        """

        # 경비 모드가 꺼져 있으면 감지 비활성화
        if not armed_mode:
            if self.was_armed:
                logger.info(
                    "[INTRUSION] 경비 모드 해제"
                )

            self.reset()
            self.was_armed = False

            return False

        # 경비 모드가 새롭게 켜진 경우 초기화
        if not self.was_armed:
            self.reset()
            self.was_armed = True

            logger.info(
                "[INTRUSION] 경비 모드 활성화"
            )

        # 사람이 검출되지 않은 경우
        if person is None:
            self.candidate_count = 0
            self.missing_count += 1

            # 사람이 일정 시간 사라져야
            # 다음 침입 이벤트를 감지할 수 있다.
            if (
                self.missing_count
                >= self.missing_frames_to_reset
            ):
                self.triggered = False

            return False

        # 사람이 다시 검출됨
        self.missing_count = 0

        # 이미 현재 출현에 대해 이벤트를 만들었다면 중복 방지
        if self.triggered:
            return False

        self.candidate_count += 1

        print(
            f"[INTRUSION CHECK] "
            f"armed={armed_mode}, "
            f"count={self.candidate_count}/"
            f"{self.required_frames}"
        )

        if self.candidate_count >= self.required_frames:
            self.triggered = True
            self.candidate_count = 0

            print("[INTRUSION DETECTED]")

            return True

        return False
