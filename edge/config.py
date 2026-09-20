"""
config.py — 엣지 설정 로더

값은 환경변수(또는 edge/.env)에서만 읽는다. 코드/git에는 값을 두지 않는다.
이미 설정된 환경변수(systemd EnvironmentFile 등)가 .env 파일보다 우선한다.

필수:
  HOMECARE_BACKEND_URL   백엔드 주소 (예: https://homecare-xxxx.onrender.com)
  HOMECARE_DEVICE_ID     Supabase devices 테이블에 등록한 기기 UUID (X-Device-Id)
  EDGE_DEVICE_SECRET     백엔드 EDGE_DEVICE_SECRET과 같은 값 (X-Device-Secret)
선택:
  EDGE_REQUEST_TIMEOUT   전송 타임아웃(초), 기본 60 — Render 무료 플랜은 유휴 후 첫 요청이 느림
  EDGE_OUTBOX_DIR        전송 대기 큐/첨부 저장 폴더, 기본 edge/data
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

EDGE_DIR = Path(__file__).resolve().parent


class ConfigError(RuntimeError):
    pass


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Config:
    backend_url: str
    device_id: str
    device_secret: str = field(repr=False)  # 로그/출력에 찍히지 않게
    request_timeout: float = 60.0
    outbox_dir: Path = EDGE_DIR / "data"

    @property
    def events_url(self) -> str:
        return f"{self.backend_url}/api/events"


def load_config(env_file: Path = EDGE_DIR / ".env") -> Config:
    _load_env_file(env_file)

    required = ["HOMECARE_BACKEND_URL", "HOMECARE_DEVICE_ID", "EDGE_DEVICE_SECRET"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise ConfigError(f"필수 환경변수 누락: {', '.join(missing)} (edge/.env.example 참고)")

    return Config(
        backend_url=os.environ["HOMECARE_BACKEND_URL"].rstrip("/"),
        device_id=os.environ["HOMECARE_DEVICE_ID"],
        device_secret=os.environ["EDGE_DEVICE_SECRET"],
        request_timeout=float(os.environ.get("EDGE_REQUEST_TIMEOUT", "60")),
        outbox_dir=Path(os.environ.get("EDGE_OUTBOX_DIR", str(EDGE_DIR / "data"))),
    )
