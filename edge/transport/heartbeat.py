"""
heartbeat.py — 주기적으로 POST /api/devices/:id/heartbeat 전송하는 공용 헬퍼

이벤트 전송(outbox/sender.py)과는 별개 경로다: 재시도 큐가 필요 없다 — 이번 주기 전송이
실패해도 다음 주기(interval_sec 후)에 다시 시도하면 되므로, 실패는 로그만 남기고 넘어간다.
device.service.js가 last_heartbeat 최신 여부로 online/offline을 판단하므로, "꺼짐" 상태를
표현하려면 이 함수를 호출하는 쪽에서 하트비트 자체를 보내지 않으면 된다(should_send=False).
"""

import logging
import threading

import requests

log = logging.getLogger("edge.heartbeat")


def send_once(
    session, backend_url: str, device_id: str, device_secret: str, timeout: float, metrics: dict = None, on_response=None
) -> bool:
    """on_response: 성공(200) 시 응답 JSON(dict)을 받는 콜백 — 백엔드가 실어 보내는 mode/securityArmed 수신용."""
    url = f"{backend_url}/api/devices/{device_id}/heartbeat"
    headers = {"X-Device-Id": device_id, "X-Device-Secret": device_secret}
    try:
        resp = session.post(url, json={"status": "online", "metrics": metrics or {}}, headers=headers, timeout=timeout)
    except requests.RequestException as e:
        log.warning("하트비트 전송 오류(device=%s): %s", device_id, type(e).__name__)
        return False

    if resp.status_code == 200:
        if on_response is not None:
            try:
                on_response(resp.json())
            except Exception as e:  # 응답 해석 실패가 하트비트(=켜짐 표시)를 막으면 안 됨
                log.warning("하트비트 응답 처리 실패(device=%s): %s", device_id, type(e).__name__)
        return True
    log.warning("하트비트 실패(device=%s) HTTP %s: %s", device_id, resp.status_code, resp.text[:150])
    return False


def start_background(
    backend_url: str,
    device_id: str,
    device_secret: str,
    interval_sec: float = 20.0,
    timeout: float = 10.0,
    should_send=None,
    get_metrics=None,
    on_response=None,
):
    """주기적으로 하트비트를 보내는 데몬 스레드를 시작하고 (thread, stop_event)를 반환한다.

    should_send: 매 주기 호출, False를 반환하면 이번 주기는 전송을 건너뛴다(하드웨어 미감지 등).
    get_metrics: 매 전송 시 함께 보낼 metrics dict를 반환.
    on_response: 하트비트 성공 시 응답 JSON을 받는 콜백(감지 모드 수신용, send_once 참고).
    """
    stop = threading.Event()
    session = requests.Session()

    def _loop():
        while not stop.is_set():
            if should_send is None or should_send():
                metrics = get_metrics() if get_metrics else {}
                send_once(session, backend_url, device_id, device_secret, timeout, metrics, on_response)
            stop.wait(interval_sec)

    thread = threading.Thread(target=_loop, name=f"heartbeat-{device_id[:8]}", daemon=True)
    thread.start()
    return thread, stop
