"""마이크 모델 의존성 없이 낙상 전송 스펙과 모드를 검증한다."""
import unittest
from edge.transport.event_mapper import get_spec
from edge.transport.modes import is_allowed, LIVING, ENTRANCE


class FallSpecsTest(unittest.TestCase):
    def test_fall_levels_have_distinct_risk(self):
        for category in ('fall_detected', 'fall_suspect'):
            with self.subTest(category=category):
                spec = get_spec(category)
                self.assertTrue(spec.send)
                risk = 'danger' if category == 'fall_detected' else 'warning'
                self.assertEqual((spec.type, spec.danger_level, spec.cooldown_sec), ('danger', risk, 10))

    def test_labels_are_distinct(self):
        self.assertEqual(get_spec('fall_detected').label, '낙상')
        self.assertEqual(get_spec('fall_suspect').label, '낙상 의심')

    def test_falls_only_allowed_in_living(self):
        for category in ('fall_detected', 'fall_suspect'):
            self.assertTrue(is_allowed(LIVING, category))
            self.assertFalse(is_allowed(ENTRANCE, category))
