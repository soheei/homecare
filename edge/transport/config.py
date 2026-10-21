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
  EDGE_ALLOW_INSECURE    1이면 http:// 백엔드 주소를 허용 (기본: https://만 허용, localhost는 예외)
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

EDGE_DIR = Path(__file__).resolve().parent.parent  # edge/ (이 파일은 edge/transport/에 있음)


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


_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _check_backend_url(url: str) -> None:
    """영상·음성·기기 시크릿이 지나가는 길이라 암호화(https)되지 않은 주소는 거부한다."""
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname:
        return
    if parsed.scheme == "http" and (parsed.hostname in _LOCAL_HOSTS or os.environ.get("EDGE_ALLOW_INSECURE") == "1"):
        return
    raise ConfigError(
        f"HOMECARE_BACKEND_URL은 https:// 주소여야 합니다 (받은 값의 방식: {parsed.scheme or '없음'}). "
        "로컬 테스트면 localhost 주소를 쓰거나 EDGE_ALLOW_INSECURE=1을 설정하세요."
    )


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

    backend_url = os.environ["HOMECARE_BACKEND_URL"].rstrip("/")
    _check_backend_url(backend_url)

    return Config(
        backend_url=backend_url,
        device_id=os.environ["HOMECARE_DEVICE_ID"],
        device_secret=os.environ["EDGE_DEVICE_SECRET"],
        request_timeout=float(os.environ.get("EDGE_REQUEST_TIMEOUT", "60")),
        outbox_dir=Path(os.environ.get("EDGE_OUTBOX_DIR", str(EDGE_DIR / "data"))),
    )
