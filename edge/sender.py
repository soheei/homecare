"""
sender.py — outbox의 이벤트를 백엔드 POST /api/events로 전송

응답별 처리:
  200/201            → 성공, 큐에서 삭제
  401/403            → 재시도 (설정 오류일 수 있음: 기기 UUID/시크릿 확인 후 고치면 자동 복구), 로그는 error
  400/404/413 등 4xx → dead (payload 자체가 잘못됨, 재시도해도 소용없음)
  408/429/5xx/네트워크 오류/타임아웃 → 지수 백오프로 재시도 (5초→…→최대 15분)
  최대 시도 횟수 초과 → dead

이벤트마다 metadata.event_uid를 넣어 보낸다. 응답 유실 후 재시도로 중복 저장될 수 있는데
(백엔드에 중복 제거 없음) 나중에 이 값으로 걸러낼 수 있다.
"""

import json
import logging
import random
import threading
from contextlib import ExitStack
from pathlib import Path

import requests

from .config import Config
from .outbox import Outbox

log = logging.getLogger("edge.sender")

BACKOFF_BASE_SEC = 5
BACKOFF_CAP_SEC = 900
MAX_ATTEMPTS = 50
RETRYABLE_4XX = {408, 429}
AUTH_ERRORS = {401, 403}


def _backoff(attempts: int) -> float:
    return min(BACKOFF_CAP_SEC, BACKOFF_BASE_SEC * (2 ** attempts)) * random.uniform(0.8, 1.2)


def _post(session, cfg: Config, row: dict):
    headers = {"X-Device-Id": cfg.device_id, "X-Device-Secret": cfg.device_secret}
    payload = row["payload"]

    if not row["attachments"]:
        return session.post(cfg.events_url, json=payload, headers=headers, timeout=cfg.request_timeout)

    # 파일이 있으면 multipart — metadata는 JSON 문자열로 보낸다 (백엔드가 파싱)
    data = {
        k: json.dumps(v, ensure_ascii=False) if k == "metadata" else str(v)
        for k, v in payload.items()
    }
    with ExitStack() as stack:
        files = {}
        for att in row["attachments"]:
            path = Path(att["path"])
            if not path.is_file():
                log.warning("첨부 파일이 없어 제외하고 전송: %s", path.name)
                continue
            files[att["field"]] = (path.name, stack.enter_context(open(path, "rb")), att["mime"])
        return session.post(
            cfg.events_url, data=data, files=files or None, headers=headers, timeout=cfg.request_timeout
        )


def send_row(session, cfg: Config, outbox: Outbox, row: dict) -> str:
    """이벤트 1건 전송. 'sent' | 'retry' | 'dead' 반환."""
    uid = row["event_uid"]
    try:
        resp = _post(session, cfg, row)
    except requests.RequestException as e:
        return _retry(outbox, row, f"network: {type(e).__name__}")

    status = resp.status_code
    if status in (200, 201):
        try:
            saved_id = str(resp.json().get("data", {}).get("id", ""))
        except ValueError:
            saved_id = ""
        # 예전 백엔드는 저장 실패도 temp_ id로 성공 응답을 했다 — 저장되지 않은 것이므로 재시도
        if saved_id.startswith("temp_"):
            return _retry(outbox, row, "server returned temp id (not saved)")
        outbox.mark_sent(row)
        log.info("전송 완료 uid=%s id=%s", uid, saved_id)
        return "sent"

    detail = f"HTTP {status}: {resp.text[:150]}"
    if status in AUTH_ERRORS:
        log.error("인증 실패(HTTP %s) — HOMECARE_DEVICE_ID / EDGE_DEVICE_SECRET 확인 필요", status)
        return _retry(outbox, row, detail)
    if 400 <= status < 500 and status not in RETRYABLE_4XX:
        outbox.mark_dead(row, detail)
        log.error("백엔드가 영구 거절 uid=%s (%s)", uid, detail)
        return "dead"
    return _retry(outbox, row, detail)


def _retry(outbox: Outbox, row: dict, error: str) -> str:
    if row["attempts"] + 1 >= MAX_ATTEMPTS:
        outbox.mark_dead(row, f"max attempts: {error}")
        log.error("재시도 한도 초과 uid=%s (%s)", row["event_uid"], error)
        return "dead"
    attempts = outbox.mark_retry(row, error, _backoff(row["attempts"]))
    log.warning("전송 실패, 재시도 예정 uid=%s attempts=%d (%s)", row["event_uid"], attempts, error)
    return "retry"


def flush_once(cfg: Config, outbox: Outbox, session=None) -> dict:
    """지금 전송 가능한 이벤트를 한 번 처리하고 결과 개수를 반환."""
    session = session or requests.Session()
    result = {"sent": 0, "retry": 0, "dead": 0}
    for row in outbox.fetch_due():
        result[send_row(session, cfg, outbox, row)] += 1
    return result


def run_forever(cfg: Config, outbox: Outbox, stop: threading.Event, idle_sec: float = 2.0) -> None:
    session = requests.Session()
    while not stop.is_set():
        try:
            handled = sum(flush_once(cfg, outbox, session).values())
        except Exception:  # 예기치 못한 오류로 전송 스레드가 죽지 않게
            log.exception("전송 루프 오류")
            handled = 0
        if handled == 0:
            stop.wait(idle_sec)


def start_background(cfg: Config, outbox: Outbox):
    stop = threading.Event()
    thread = threading.Thread(target=run_forever, args=(cfg, outbox, stop), name="edge-sender", daemon=True)
    thread.start()
    return thread, stop
