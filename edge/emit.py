"""
emit.py — 모든 감지기(YAMNet, 이후 YOLO 등)가 이벤트를 내보내는 공통 진입점

    from edge.config import load_config
    from edge.emit import EventEmitter

    emitter = EventEmitter(load_config())
    emitter.start()                      # 백그라운드 전송 스레드 시작
    emitter.emit("glass_impact", source="yamnet", score=0.87, audio_path="/tmp/clip.wav")

emit()이 하는 일: category_id → 백엔드 type/dangerLevel 변환 → 쿨다운 → 로컬 큐에 저장.
실제 전송은 sender 스레드가 큐에서 꺼내 처리하므로 emit()은 네트워크를 기다리지 않는다.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from . import event_mapper, sender
from .config import Config
from .cooldown import Cooldown
from .outbox import Outbox

log = logging.getLogger("edge.emit")


class EventEmitter:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.outbox = Outbox(cfg.outbox_dir)
        self._cooldown = Cooldown()
        self._thread = None
        self._stop = None

    def start(self) -> None:
        if self._thread is None:
            self._thread, self._stop = sender.start_background(self.cfg, self.outbox)

    def stop(self) -> None:
        if self._stop is not None:
            self._stop.set()
            self._thread.join(timeout=5)
            self._thread = self._stop = None

    def emit(
        self,
        category_id: str,
        source: str,
        score: Optional[float] = None,
        description: Optional[str] = None,
        image_path: Optional[str] = None,
        audio_path: Optional[str] = None,
        video_path: Optional[str] = None,
        extra: Optional[dict] = None,
        occurred_at: Optional[datetime] = None,
    ) -> Optional[str]:
        """큐에 저장하면 event_uid를, 전송 대상이 아니거나 쿨다운 중이면 None을 반환."""
        spec = event_mapper.get_spec(category_id)
        if spec is None:
            log.warning("알 수 없는 category_id, 무시: %s", category_id)
            return None
        if not spec.send:
            log.debug("전송 대상 아님(로그전용/집계전용): %s", category_id)
            return None
        if not self._cooldown.allow(f"{source}:{category_id}", spec.cooldown_sec):
            log.debug("쿨다운 중, 건너뜀: %s:%s", source, category_id)
            return None

        uid = uuid.uuid4().hex
        metadata = {"source": source, "category_id": category_id, "event_uid": uid}
        if score is not None:
            metadata["score"] = round(float(score), 4)
        metadata.update(extra or {})

        text = description or spec.label + " 감지"
        if description is None and score is not None:
            text += f" (신뢰도 {score:.2f})"

        payload = {
            "type": spec.type,
            "description": text,
            "dangerLevel": spec.danger_level,
            "timestamp": (occurred_at or datetime.now(timezone.utc)).isoformat(),
            "metadata": metadata,
        }
        attachments = {
            k: v for k, v in (("image", image_path), ("audio", audio_path), ("video", video_path)) if v
        }
        self.outbox.enqueue(uid, payload, attachments)
        log.info("이벤트 큐 저장 uid=%s type=%s level=%s", uid, spec.type, spec.danger_level)
        return uid
