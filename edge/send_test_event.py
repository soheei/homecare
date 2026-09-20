"""
send_test_event.py — 엣지 → 백엔드 전송 경로 점검용 (실제 감지기 없이 가짜 이벤트 1건 전송)

    python -m edge.send_test_event                 # door_visitor(초인종) 테스트 이벤트
    python -m edge.send_test_event glass_impact    # 다른 category_id로

성공하면 웹 "최근 이벤트"에 '[테스트] 엣지 전송 확인' 이벤트가 보인다 (확인 후 지워도 된다).
백엔드가 잠들어 있거나 오류면 재시도하며 최대 3분 기다린다.
"""

import logging
import sys
import time

from . import sender
from .config import ConfigError, load_config
from .emit import EventEmitter

WAIT_LIMIT_SEC = 180


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    category = sys.argv[1] if len(sys.argv) > 1 else "door_visitor"

    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"설정 오류: {e}")
        return 2

    emitter = EventEmitter(cfg)
    uid = emitter.emit(category, source="test", description="[테스트] 엣지 전송 확인", score=1.0)
    if uid is None:
        print(f"'{category}'는 전송 대상이 아니거나 알 수 없는 category_id입니다 (edge/event_mapper.py 참고)")
        return 2

    print(f"대상: {cfg.events_url}  (기기 {cfg.device_id})")
    deadline = time.time() + WAIT_LIMIT_SEC
    while time.time() < deadline:
        result = sender.flush_once(cfg, emitter.outbox)
        counts = emitter.outbox.counts()
        if result["sent"]:
            print("성공: 백엔드에 저장됨")
            return 0
        if counts["dead"]:
            print("실패: 백엔드가 이벤트를 거절했습니다 (위 로그의 HTTP 코드 확인)")
            return 1
        time.sleep(1)

    print("시간 초과: 전송되지 않았습니다 (위 로그 확인, 이벤트는 큐에 남아 있음)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
