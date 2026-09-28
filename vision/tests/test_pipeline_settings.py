"""vision_pipeline 설정값 테스트 — edge/.env에 적은 값이 실제로 반영되는지 (카메라/YOLO 없이).
실행: 저장소 루트에서 `python -m unittest discover -s vision/tests -t .`"""

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

# picamera2/ultralytics가 없는 PC에서도 vision_pipeline을 import할 수 있게 빈 모듈로 대체 (Pi에선 실제 모듈 사용)
for _name, _attr in (("picamera2", "Picamera2"), ("ultralytics", "YOLO")):
    try:
        __import__(_name)
    except ImportError:
        sys.modules[_name] = types.SimpleNamespace(**{_attr: object})

from edge.transport.config import load_config  # noqa: E402
from vision import vision_pipeline as vp  # noqa: E402

REPO_ROOT = Path(vp.__file__).resolve().parent.parent
REQUIRED = {"HOMECARE_BACKEND_URL": "http://backend.test", "HOMECARE_DEVICE_ID": "mic", "EDGE_DEVICE_SECRET": "s"}


class PipelineSettingsTest(unittest.TestCase):
    def load_with_env_file(self, text):
        """임시 .env 파일로 load_config() → read_settings() (실제 main()과 같은 순서)."""
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text(text, encoding="utf-8")
            with mock.patch.dict(os.environ, REQUIRED, clear=True):
                load_config(env_file)
                return vp.read_settings()

    def test_env_file_values_are_used(self):
        # 예전 버그: 이 값들을 .env 로드 전에 읽어서 무시되고 /mnt/ssd/events가 쓰였음
        s = self.load_with_env_file(
            "HOMECARE_EVENT_DIR=edge/data/events\n"
            "HOMECARE_CAMERA_ID=front_door\n"
            "HOMECARE_CAMERA_CHECK_INTERVAL_SEC=15\n"
        )
        self.assertEqual(Path(s["event_dir"]), REPO_ROOT / "edge" / "data" / "events")  # 저장소 루트 기준
        self.assertEqual(s["camera_id"], "front_door")
        self.assertEqual(s["heartbeat_interval_sec"], 15.0)

    def test_absolute_path_is_kept(self):
        absolute = str(Path(tempfile.gettempdir()) / "homecare_events")
        s = self.load_with_env_file(f"HOMECARE_EVENT_DIR={absolute}\n")
        self.assertEqual(s["event_dir"], absolute)

    def test_defaults_when_not_set(self):
        s = self.load_with_env_file("")
        # Pi(리눅스)에선 그대로 /mnt/ssd/events. 윈도우는 드라이브 문자가 붙음(C:\mnt\ssd\events)
        self.assertTrue(Path(s["event_dir"]).as_posix().endswith(vp.DEFAULT_EVENT_DIR))
        self.assertEqual(s["camera_id"], "camera_01")
        self.assertEqual(s["heartbeat_interval_sec"], 20.0)


if __name__ == "__main__":
    unittest.main()
