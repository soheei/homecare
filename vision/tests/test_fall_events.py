import unittest
from vision.fall_detector import FallDetector
from vision.activity_tracker import FallPersonTracker
from vision.tests.test_fall_person_tracker import person


class FallEventsTest(unittest.TestCase):
    def events(self, boxes):
        f, t = FallDetector(), FallPersonTracker()
        result = []
        for i, box in enumerate(boxes):
            selected, changed = t.update([] if box is None else [box], timestamp=i*.2)
            if f.update_tracked(selected, i*.2, changed): result.append(f.last_event)
        return result

    def test_rapid_drop_and_hold_is_detected(self):
        events = self.events([person(200,100)]*3+[person(200,180,width=160,height=80)]*15)
        self.assertEqual([e['category'] for e in events], ['fall_detected'])
        self.assertEqual(events[0]['reason'], 'rapid_drop_low_posture')

    def test_loss_after_drop_is_suspect_once(self):
        events = self.events([person(200,100)]*3+[person(200,180,width=160,height=80)]+[None]*30)
        self.assertEqual([e['category'] for e in events], ['fall_suspect'])
        self.assertEqual(events[0]['reason'], 'rapid_drop_person_lost')

    def test_plain_exit_does_not_raise_suspect(self):
        self.assertEqual(self.events([person(200,100)]*10+[None]*30), [])

    def test_short_loss_then_recovery_is_not_suspect(self):
        self.assertEqual(self.events([person(200,100)]*3+
            [person(200,180,width=160,height=80)]+[None]*2+[person(200,100)]*20), [])

    def test_prone_appearance_is_suspect(self):
        events = self.events([None]*6+[person(200,180,width=160,height=80)]*20)
        self.assertEqual([e['category'] for e in events], ['fall_suspect'])
        self.assertEqual(events[0]['reason'], 'prone_appearance')

    def test_processing_gap_is_not_confirmed_loss(self):
        f = FallDetector()
        for i, b in enumerate([person(200,100)]*3+[person(200,180,width=160,height=80)]):
            f.update_tracked(b, i*.2)
        f.update_tracked(None,.8)
        self.assertFalse(f.update_tracked(None,5))
        self.assertIsNone(f.last_event)
        self.assertFalse(any(f.update_tracked(None,5.2+i*.2) for i in range(15)))

    def test_same_target_suspect_can_upgrade_with_same_incident(self):
        low = person(200,180,width=160,height=80)
        events = self.events([None]*6+[low]*11+[person(200,100)]*2+[low]*6)
        self.assertEqual([e['category'] for e in events], ['fall_suspect','fall_detected'])
        self.assertTrue(events[1]['upgrade'])
        self.assertEqual(events[0]['incident_id'], events[1]['incident_id'])
