"""백엔드 주소 검증 — 암호화되지 않은(http) 주소는 거부 (영상·음성·기기 시크릿 보호)"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from edge.transport.config import ConfigError, load_config

BASE = {"HOMECARE_DEVICE_ID": "dev", "EDGE_DEVICE_SECRET": "s"}


def load(url, **extra):
    with tempfile.TemporaryDirectory() as tmp, \
            mock.patch.dict(os.environ, {**BASE, "HOMECARE_BACKEND_URL": url, **extra}, clear=True):
        return load_config(Path(tmp) / "no.env")


class BackendUrlTest(unittest.TestCase):
    def test_https_is_accepted(self):
        self.assertEqual(load("https://homecare.example.com/").backend_url, "https://homecare.example.com")

    def test_http_is_rejected(self):
        with self.assertRaises(ConfigError):
            load("http://homecare.example.com")

    def test_http_localhost_is_allowed(self):
        self.assertEqual(load("http://localhost:3000").backend_url, "http://localhost:3000")

    def test_http_allowed_only_with_explicit_opt_in(self):
        self.assertEqual(load("http://10.0.0.5:3000", EDGE_ALLOW_INSECURE="1").backend_url, "http://10.0.0.5:3000")

    def test_url_without_scheme_is_rejected(self):
        with self.assertRaises(ConfigError):
            load("homecare.example.com")


if __name__ == "__main__":
    unittest.main()
