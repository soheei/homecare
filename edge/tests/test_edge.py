"""엣지 전송 모듈 단위 테스트 — 실행: 저장소 루트에서 `python -m unittest discover -s edge/tests -t .`"""

import json
import tempfile
import unittest
from pathlib import Path

import requests

from edge.transport import event_mapper, sender
from edge.transport.config import Config
from edge.transport.cooldown import Cooldown
from edge.transport.emit import EventEmitter
from edge.transport.outbox import Outbox


class FakeResponse:
    def __init__(self, status, body=None, text=""):
        self.status_code = status
        self._body = body
        self.text = text or (json.dumps(body) if body is not None else "")

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeSession:
    """post()가 미리 정한 응답(또는 예외)을 돌려주고 호출 내용을 기록한다."""

    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def make_cfg(tmp):
    return Config(
        backend_url="http://backend.test",
        device_id="dev-uuid",
        device_secret="s3cret",
        request_timeout=5,
        outbox_dir=Path(tmp) / "data",
    )


OK = FakeResponse(201, {"success": True, "data": {"id": "real-uuid"}})


class CooldownTest(unittest.TestCase):
    def test_blocks_within_window_and_allows_after(self):
        now = [0.0]
        cd = Cooldown(clock=lambda: now[0])
        self.assertTrue(cd.allow("k", 10))
        now[0] = 5
        self.assertFalse(cd.allow("k", 10))
        now[0] = 10.1
        self.assertTrue(cd.allow("k", 10))

    def test_zero_seconds_always_allows_and_keys_are_independent(self):
        cd = Cooldown()
        self.assertTrue(cd.allow("a", 0))
        self.assertTrue(cd.allow("a", 0))
        self.assertTrue(cd.allow("a", 60))
        self.assertTrue(cd.allow("b", 60))


class MapperTest(unittest.TestCase):
    def test_values_match_backend_enums(self):
        types = {"visitor", "motion", "sound", "danger", "other"}
        levels = {"normal", "warning", "danger"}
        for cid, spec in event_mapper.SPECS.items():
            self.assertIn(spec.type, types, cid)
            self.assertIn(spec.danger_level, levels, cid)

    def test_log_only_not_sent_and_unknown_is_none(self):
        self.assertFalse(event_mapper.get_spec("ambient_log").send)
        self.assertIsNone(event_mapper.get_spec("nope"))


class OutboxTest(unittest.TestCase):
    def test_attachment_copied_wav_mime_and_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "clip.wav"
            src.write_bytes(b"RIFFdata")
            box = Outbox(Path(tmp) / "data")
            box.enqueue("u1", {"type": "sound"}, {"audio": str(src)})
            src.unlink()  # 호출한 쪽이 원본을 지워도 큐는 유지

            (row,) = box.fetch_due()
            att = row["attachments"][0]
            self.assertEqual(att["mime"], "audio/wav")
            self.assertTrue(Path(att["path"]).is_file())

            box.mark_sent(row)
            self.assertFalse(Path(att["path"]).exists())
            self.assertEqual(box.counts(), {"pending": 0, "dead": 0})

    def test_survives_restart_and_rejects_bad_attachment(self):
        with tempfile.TemporaryDirectory() as tmp:
            Outbox(Path(tmp)).enqueue("u1", {"type": "sound"})
            self.assertEqual(len(Outbox(Path(tmp)).fetch_due()), 1)
            bad = Path(tmp) / "x.exe"
            bad.write_bytes(b"x")
            with self.assertRaises(ValueError):
                Outbox(Path(tmp)).enqueue("u2", {}, {"image": str(bad)})


class SenderTest(unittest.TestCase):
    def run_one(self, outcome, attachments=None):
        tmp = tempfile.mkdtemp()
        cfg = make_cfg(tmp)
        box = Outbox(cfg.outbox_dir)
        payload = {"type": "sound", "description": "d", "dangerLevel": "normal",
                   "timestamp": "2026-01-01T00:00:00+00:00", "metadata": {"event_uid": "u1"}}
        box.enqueue("u1", payload, attachments)
        session = FakeSession(outcome)
        (row,) = box.fetch_due()
        return sender.send_row(session, cfg, box, row), box, session

    def test_success_removes_from_queue_and_sends_auth_headers(self):
        result, box, session = self.run_one(OK)
        self.assertEqual(result, "sent")
        self.assertEqual(box.counts(), {"pending": 0, "dead": 0})
        url, kw = session.calls[0]
        self.assertEqual(url, "http://backend.test/api/events")
        self.assertEqual(kw["headers"], {"X-Device-Id": "dev-uuid", "X-Device-Secret": "s3cret"})
        self.assertEqual(kw["json"]["type"], "sound")

    def test_server_error_and_network_error_retry_later(self):
        for outcome in (FakeResponse(500, text="boom"), requests.ConnectionError("down"),
                        FakeResponse(429), FakeResponse(408)):
            result, box, _ = self.run_one(outcome)
            self.assertEqual(result, "retry")
            self.assertEqual(box.counts()["pending"], 1)
            self.assertEqual(box.fetch_due(), [])  # 백오프로 미뤄져 바로는 다시 안 나옴

    def test_auth_failure_keeps_event_for_retry(self):
        for status in (401, 403):
            result, box, _ = self.run_one(FakeResponse(status))
            self.assertEqual(result, "retry")
            self.assertEqual(box.counts()["pending"], 1)

    def test_client_error_goes_dead(self):
        result, box, _ = self.run_one(FakeResponse(400, text="bad"))
        self.assertEqual(result, "dead")
        self.assertEqual(box.counts(), {"pending": 0, "dead": 1})

    def test_temp_id_response_is_not_treated_as_saved(self):
        result, box, _ = self.run_one(FakeResponse(201, {"data": {"id": "temp_123"}}))
        self.assertEqual(result, "retry")
        self.assertEqual(box.counts()["pending"], 1)

    def test_max_attempts_goes_dead(self):
        tmp = tempfile.mkdtemp()
        cfg = make_cfg(tmp)
        box = Outbox(cfg.outbox_dir)
        box.enqueue("u1", {"type": "sound", "metadata": {}})
        (row,) = box.fetch_due()
        row["attempts"] = sender.MAX_ATTEMPTS - 1
        self.assertEqual(sender.send_row(FakeSession(FakeResponse(500)), cfg, box, row), "dead")

    def test_multipart_when_attachment_present(self):
        tmp = tempfile.mkdtemp()
        clip = Path(tmp) / "c.wav"
        clip.write_bytes(b"RIFF")
        result, _, session = self.run_one(OK, {"audio": str(clip)})
        self.assertEqual(result, "sent")
        kw = session.calls[0][1]
        self.assertNotIn("json", kw)
        self.assertEqual(kw["files"]["audio"][2], "audio/wav")
        self.assertEqual(json.loads(kw["data"]["metadata"])["event_uid"], "u1")


class EmitterTest(unittest.TestCase):
    def test_emit_queues_payload_and_applies_cooldown(self):
        with tempfile.TemporaryDirectory() as tmp:
            em = EventEmitter(make_cfg(tmp))
            uid = em.emit("door_visitor", source="yamnet", score=0.91)
            self.assertIsNotNone(uid)
            self.assertIsNone(em.emit("door_visitor", source="yamnet", score=0.95))  # 5분 쿨다운
            self.assertIsNotNone(em.emit("glass_impact", source="yamnet", score=0.9))  # 다른 카테고리

            rows = {r["payload"]["metadata"]["category_id"]: r for r in em.outbox.fetch_due()}
            p = rows["door_visitor"]["payload"]
            self.assertEqual((p["type"], p["dangerLevel"]), ("visitor", "normal"))
            self.assertEqual(p["metadata"]["event_uid"], uid)
            self.assertEqual(p["metadata"]["score"], 0.91)
            self.assertIn("초인종", p["description"])
            self.assertEqual(rows["glass_impact"]["payload"]["dangerLevel"], "danger")

    def test_log_only_and_unknown_are_not_queued(self):
        with tempfile.TemporaryDirectory() as tmp:
            em = EventEmitter(make_cfg(tmp))
            self.assertIsNone(em.emit("ambient_log", source="yamnet"))
            self.assertIsNone(em.emit("unknown_cat", source="yamnet"))
            self.assertEqual(em.outbox.counts()["pending"], 0)


class MissingUrlWarningTest(unittest.TestCase):
    def test_warns_when_backend_saved_without_image_url(self):
        tmp = tempfile.mkdtemp()
        img = Path(tmp) / "p.jpg"
        img.write_bytes(b"\xff\xd8")
        cfg = make_cfg(tmp)
        box = Outbox(cfg.outbox_dir)
        box.enqueue("u1", {"type": "other", "metadata": {}}, {"image": str(img)})
        (row,) = box.fetch_due()
        no_url = FakeResponse(201, {"data": {"id": "real-uuid", "image_url": None}})
        with self.assertLogs("edge.sender", "WARNING"):
            self.assertEqual(sender.send_row(FakeSession(no_url), cfg, box, row), "sent")


class CaptureListenerTest(unittest.TestCase):
    """camera_monitor.py의 현재 화면 캡처 요청 처리 (백엔드 롱폴링 → 촬영 → 결과 제출)"""

    class Session:
        def __init__(self, polls, stop):
            self.polls = list(polls)
            self.stop = stop
            self.posts = []

        def get(self, url, **kw):
            if len(self.polls) == 1:
                self.stop.set()  # 마지막 응답 후 루프 종료
            return self.polls.pop(0)

        def post(self, url, **kw):
            self.posts.append((url, kw))
            return FakeResponse(200, {"success": True})

    def run_listener(self, polls, capture_result):
        import threading
        from unittest import mock
        from edge.apps import camera_monitor

        stop = threading.Event()
        session = self.Session(polls, stop)
        with mock.patch.object(camera_monitor, "capture_current_frame", return_value=capture_result):
            camera_monitor.run_capture_listener("http://backend.test", "cam-uuid", "s", stop, session)
        return session

    def test_uploads_jpeg_for_request(self):
        s = self.run_listener([FakeResponse(200, {"data": None}), FakeResponse(200, {"data": {"requestId": "r1"}})],
                              (b"\xff\xd8jpg", None))
        (url, kw), = s.posts
        self.assertEqual(url, "http://backend.test/api/devices/cam-uuid/capture-requests/r1")
        self.assertEqual(kw["files"]["image"][2], "image/jpeg")
        self.assertEqual(kw["headers"]["X-Device-Id"], "cam-uuid")

    def test_reports_failure_reason(self):
        s = self.run_listener([FakeResponse(200, {"data": {"requestId": "r2"}})], (None, "camera_not_detected"))
        (_, kw), = s.posts
        self.assertEqual(kw["json"], {"error": "camera_not_detected"})

    def test_capture_classifies_missing_camera(self):
        from unittest import mock
        from edge.apps import camera_monitor
        with mock.patch.object(camera_monitor.capture_photo, "capture", return_value=False), \
                mock.patch.object(camera_monitor, "camera_detected", return_value=False):
            self.assertEqual(camera_monitor.capture_current_frame(), (None, "camera_not_detected"))


class CapturePhotoTest(unittest.TestCase):
    def test_falls_back_to_libcamera_still(self):
        from unittest import mock
        from edge.apps import capture_photo

        def fake_run(cmd, **kw):
            if cmd[0] == "rpicam-still":
                raise FileNotFoundError
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"\xff\xd8jpg")
            return mock.Mock(returncode=0, stderr="")

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(capture_photo.subprocess, "run", side_effect=fake_run) as run:
            out = Path(tmp) / "c" / "a.jpg"
            self.assertTrue(capture_photo.capture(out, 640, 480))
            self.assertEqual(run.call_args[0][0][0], "libcamera-still")

    def test_sends_with_camera_device_id_and_separate_outbox(self):
        from unittest import mock
        from edge.apps import capture_photo

        tmp = tempfile.mkdtemp()
        posted = []

        def fake_capture(out, w, h):
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(b"\xff\xd8jpg")
            return True

        def fake_flush(cfg, outbox, session=None):
            posted.append(cfg)
            return {"sent": 1, "retry": 0, "dead": 0}

        env = {"HOMECARE_BACKEND_URL": "http://backend.test", "HOMECARE_DEVICE_ID": "mic-uuid",
               "EDGE_DEVICE_SECRET": "s", "HOMECARE_CAMERA_DEVICE_ID": "cam-uuid",
               "EDGE_OUTBOX_DIR": str(Path(tmp) / "data")}
        with mock.patch.dict("os.environ", env), \
                mock.patch.object(capture_photo, "capture", side_effect=fake_capture), \
                mock.patch.object(capture_photo.sender, "flush_once", side_effect=fake_flush):
            self.assertEqual(capture_photo.main([]), 0)

        cfg = posted[0]
        self.assertEqual(cfg.device_id, "cam-uuid")
        self.assertEqual(cfg.outbox_dir, Path(tmp) / "data" / "camera")
        (row,) = Outbox(cfg.outbox_dir).fetch_due()
        self.assertEqual(row["attachments"][0]["mime"], "image/jpeg")
        self.assertEqual(row["payload"]["metadata"]["category_id"], "camera_capture")


if __name__ == "__main__":
    unittest.main()
