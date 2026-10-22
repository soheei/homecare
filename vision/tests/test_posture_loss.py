"""완만한 하강 뒤 소실과 퇴장/부분 가림/입력 공백을 구분한다."""
import unittest
from vision.fall_detector import FallDetector
from vision.activity_tracker import FallPersonTracker
from vision.tests.test_fall_person_tracker import person


class PostureLossTest(unittest.TestCase):
    def descent(self, x=320):
        # 바닥쪽 좌표320 유지. 속도/하강량 동시 통과 없는 완만한 형태 변화.
        return [person(x,160,width=100,height=320) for _ in range(4)] + [
            person(x,195,width=158,height=248),
            person(x,226,width=192,height=184),
            person(x,241,width=205,height=154),
            person(x,248,width=246,height=142)]

    def run_boxes(self, boxes, sizes=None, timestamps=None, reset_at=None, ambiguous_at=None):
        f,t = FallDetector(),FallPersonTracker()
        events=[]
        for i,p in enumerate(boxes):
            ts=timestamps[i] if timestamps else i*.2
            if i==reset_at: f.reset();t.reset()
            selected,changed=t.update([] if p is None else [p],timestamp=ts)
            visible=p is not None or i==ambiguous_at
            if i==ambiguous_at: selected=None
            if f.update_tracked(selected,ts,changed,visible,
                                frame_size=sizes[i] if sizes else (640,480)):
                events.append((ts,dict(f.last_event)))
        return events

    def test_subthreshold_descent_then_loss_is_one_suspect(self):
        events=self.run_boxes(self.descent()+[None]*30)
        self.assertEqual(len(events),1)
        self.assertAlmostEqual(events[0][0],2.6)
        self.assertEqual(events[0][1]['category'],'fall_suspect')
        self.assertEqual(events[0][1]['reason'],'posture_change_person_lost')

    def test_upright_exit_or_static_occlusion_has_no_alert(self):
        for x in (320,580):
            self.assertEqual(self.run_boxes([person(x,160,height=320)]*10+[None]*20),[])

    def test_descent_at_left_right_or_bottom_edge_is_excluded(self):
        for x in (100,540):
            self.assertEqual(self.run_boxes(self.descent(x)+[None]*20),[])
        boxes=self.descent()
        for p in boxes:
            p['center_y']+=150;p['y1']+=150;p['y2']+=150
        self.assertEqual(self.run_boxes(boxes+[None]*20),[])

    def test_sideways_exit_during_descent_is_excluded(self):
        boxes=self.descent()
        for p in boxes[4:]:
            p['center_x']+=120;p['x1']+=120;p['x2']+=120
        self.assertEqual(self.run_boxes(boxes+[None]*20),[])

    def test_partial_occlusion_without_width_growth_is_excluded(self):
        boxes=self.descent()
        for p in boxes[4:]:
            p['x1']=270;p['x2']=370
        self.assertEqual(self.run_boxes(boxes+[None]*20),[])

    def test_single_low_box_is_not_enough(self):
        self.assertEqual(self.run_boxes(self.descent()[:-1]+[None]*20),[])

    def test_bottom_edge_jump_is_not_posture_change(self):
        boxes=self.descent()
        for p in boxes[4:]:
            p['center_y']+=60;p['y1']+=60;p['y2']+=60
        # Strict rapid-drop path may legitimately trigger on this artificial jump;
        # test the independent posture-loss filter directly.
        from vision.fall_detector import PostureLossDetector
        detector=PostureLossDetector()
        self.assertFalse(any(detector.update(p,i*.2,False,p is not None,(640,480))
                             for i,p in enumerate(boxes+[None]*20)))

    def test_replay_wires_same_suspect_path(self):
        import contextlib
        import io
        from unittest.mock import Mock
        import numpy as np
        from vision.evaluation.replay import RuleRunner, pipeline_settings
        runner=RuleRunner(pipeline_settings(),'living',False)
        detector=Mock()
        detector.get_best_person.side_effect=lambda ds: ds[0] if ds else None
        frame=np.zeros((480,640,3),dtype=np.uint8)
        hits=[]
        with contextlib.redirect_stdout(io.StringIO()):
            for i,p in enumerate(self.descent()+[None]*20):
                if p is not None:
                    p={**p,'width':p['x2']-p['x1'],'height':p['y2']-p['y1']}
                events=runner.update(frame,[] if p is None else [p],i*.2,detector)
                if events:hits.append((i,events))
        self.assertEqual(hits,[(13,['fall_suspect'])])

    def test_short_loss_and_upright_recovery_is_not_alert(self):
        self.assertEqual(self.run_boxes(self.descent()+[None]*2+
                         [person(320,160,height=320)]*10+[None]*20),[])

    def test_long_crouch_before_disappearance_is_not_recent_descent(self):
        boxes=self.descent()
        self.assertEqual(self.run_boxes(boxes+[boxes[-1]]*10+[None]*20),[])

    def test_frame_gap_mode_reset_and_visible_ambiguity_cancel(self):
        boxes=self.descent()+[None]*20
        times=[i*.2+(2 if i>=9 else 0) for i in range(len(boxes))]
        self.assertEqual(self.run_boxes(boxes,timestamps=times),[])
        self.assertEqual(self.run_boxes(boxes,reset_at=9),[])
        self.assertEqual(self.run_boxes(boxes,ambiguous_at=9),[])

    def test_frame_size_change_or_missing_context_cancels(self):
        boxes=self.descent()+[None]*20
        self.assertEqual(self.run_boxes(boxes,sizes=[None]*len(boxes)),[])
        self.assertEqual(self.run_boxes(boxes,sizes=[(640,480)]*9+[(800,600)]*19),[])

    def test_reappearing_different_person_cancels_loss(self):
        boxes=self.descent()+[None]*2+[person(100,100)]+[None]*20
        self.assertEqual(self.run_boxes(boxes),[])

    def test_strict_detection_is_not_followed_by_extra_loss_alert(self):
        boxes=[person(320,100)]*3+[person(320,180,width=160,height=80)]*8+[None]*20
        events=self.run_boxes(boxes)
        self.assertEqual([e['category'] for _,e in events],['fall_detected'])
