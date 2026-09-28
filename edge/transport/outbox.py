"""
outbox.py — 전송 전 이벤트를 디스크에 먼저 적어두는 SQLite 큐

네트워크 단절/백엔드 유휴(Render 무료 플랜)/재부팅이 있어도 이벤트를 잃지 않기 위한 장치.
첨부(이미지/오디오/영상)는 큐 폴더로 복사해 두므로 호출한 쪽은 원본을 바로 지워도 된다.

status:
  pending — 전송 대기/재시도 중
  dead    — 백엔드가 영구 거절(4xx 등)했거나 재시도 한도 초과. 확인용으로 행만 남기고 첨부는 삭제
"""

import json
import shutil
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List, Optional

# 백엔드 multer 허용 MIME (src/routes/event.routes.js)과 맞춘다.
# mimetypes 모듈은 .wav를 audio/x-wav로 주기도 해서 백엔드에서 거절당하므로 직접 지정.
MIME_BY_EXT = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif",
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".webm": "video/webm",
}
ALLOWED_FIELDS = ("image", "audio", "video")

SCHEMA = """
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uid TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at REAL NOT NULL,
  last_error TEXT,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, next_attempt_at);
"""


class Outbox:
    def __init__(self, directory: Path):
        self.dir = Path(directory)
        self.attach_dir = self.dir / "attachments"
        self.attach_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.dir / "outbox.db"
        with self._conn() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        # 스레드마다 새 연결을 쓴다 (sender 스레드 + 감지 스레드가 동시에 접근)
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            yield conn
            conn.commit()
        finally:
            conn.close()

    def enqueue(self, uid: str, payload: dict, attachments: Optional[Dict[str, str]] = None) -> str:
        """attachments: {"image": "/path/a.jpg", "audio": "/path/b.wav"} — 큐 폴더로 복사해 보관."""
        saved = []
        for field, src in (attachments or {}).items():
            if field not in ALLOWED_FIELDS:
                raise ValueError(f"지원하지 않는 첨부 필드: {field}")
            src = Path(src)
            mime = MIME_BY_EXT.get(src.suffix.lower())
            if mime is None:
                raise ValueError(f"지원하지 않는 첨부 확장자: {src.suffix}")
            dest = self.attach_dir / f"{uid}_{field}{src.suffix.lower()}"
            shutil.copy2(src, dest)
            saved.append({"field": field, "path": str(dest), "mime": mime})

        now = time.time()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO outbox (event_uid, payload, attachments, next_attempt_at, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (uid, json.dumps(payload, ensure_ascii=False), json.dumps(saved), now, now),
            )
        return uid

    def fetch_due(self, limit: int = 10) -> List[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM outbox WHERE status='pending' AND next_attempt_at <= ?"
                " ORDER BY id LIMIT ?",
                (time.time(), limit),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "event_uid": r["event_uid"],
                "payload": json.loads(r["payload"]),
                "attachments": json.loads(r["attachments"]),
                "attempts": r["attempts"],
            }
            for r in rows
        ]

    def mark_sent(self, row: dict) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM outbox WHERE id=?", (row["id"],))
        self._delete_files(row)

    def mark_retry(self, row: dict, error: str, delay_sec: float) -> int:
        """시도 횟수를 올리고 delay 뒤로 미룬다. 새 시도 횟수를 반환."""
        attempts = row["attempts"] + 1
        with self._conn() as conn:
            conn.execute(
                "UPDATE outbox SET attempts=?, next_attempt_at=?, last_error=? WHERE id=?",
                (attempts, time.time() + delay_sec, error[:300], row["id"]),
            )
        return attempts

    def mark_dead(self, row: dict, error: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE outbox SET status='dead', attempts=attempts+1, last_error=? WHERE id=?",
                (error[:300], row["id"]),
            )
        self._delete_files(row)

    def counts(self) -> Dict[str, int]:
        with self._conn() as conn:
            rows = conn.execute("SELECT status, COUNT(*) AS n FROM outbox GROUP BY status").fetchall()
        result = {"pending": 0, "dead": 0}
        result.update({r["status"]: r["n"] for r in rows})
        return result

    @staticmethod
    def _delete_files(row: dict) -> None:
        for att in row.get("attachments", []):
            try:
                Path(att["path"]).unlink(missing_ok=True)
            except OSError:
                pass
