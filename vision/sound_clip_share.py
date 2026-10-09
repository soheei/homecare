"""
sound_clip_share.py — 녹화 중에 들어온 소리 이벤트 요청이 영상 없이 소리만 전송되지 않게 한다

녹화기는 하나라 이미 다른 이벤트(낙상, 다른 소리 등)를 녹화 중이면 마이크의 녹화 요청을 새로 시작할 수 없다.
예전에는 이때 요청을 거절해 소리 이벤트가 wav만 전송됐다. 지금은 요청을 기억해 뒀다가, 진행 중인 녹화가 끝나면
같은 영상의 복사본을 요청마다 넘긴다(마이크는 받은 영상을 전송 후 지우므로 요청마다 별도 파일이 필요).
"""

import logging
import shutil

log = logging.getLogger("vision.sound_clip_share")


class WaitingSoundRequests:
    """진행 중인 녹화가 끝나길 기다리는 소리 이벤트 영상 요청 id 목록."""

    def __init__(self):
        self._ids = []

    def __len__(self):
        return len(self._ids)

    def add(self, request_id):
        if request_id not in self._ids:
            self._ids.append(request_id)

    def publish(self, av_share, video_path):
        """기다리던 요청마다 video_path의 복사본을 넘기고 목록을 비운다. 복사에 실패한 요청은 영상 없음(None)으로 답한다.

        반드시 원본 영상이 다른 곳으로 넘어가거나 삭제되기 전에 호출해야 한다."""
        ids, self._ids = self._ids, []

        for request_id in ids:
            copy_path = f"{video_path}.{request_id[:8]}.shared.mp4"
            try:
                shutil.copyfile(video_path, copy_path)
            except OSError as e:
                log.warning("소리 이벤트 영상 복사 실패 request=%s: %s — 소리만 전송", request_id, e)
                av_share.publish_video_result(request_id, None)
                continue

            av_share.publish_video_result(request_id, copy_path)
            print(f"[SOUND CLIP SHARED] request={request_id}")
