import { BG } from '../theme';

export const EVENT_ICON = {
  // icon은 components/Icon.jsx의 이름, fg는 아이콘 색
  visitor: { icon: 'door', bg: BG.info, fg: '#245166' },
  motion: { icon: 'activity', bg: BG.success, fg: '#0b8a68' },
  sound: { icon: 'bell', bg: BG.warning, fg: '#93601F' },
  danger: { icon: 'alert', bg: BG.danger, fg: '#A93357' },
  other: { icon: 'pin', bg: BG.purple, fg: '#5b4d86' }
};

export const RISK_FROM_LEVEL = {
  danger: { key: 'high', label: '높음', badgeBg: '#F3DCE1', badgeColor: '#A93357', border: '#D94F6E' },
  warning: { key: 'mid', label: '중간', badgeBg: '#F2E4D3', badgeColor: '#93601F', border: '#D98A3D' },
  normal: { key: 'low', label: '낮음', badgeBg: '#DCE6EC', badgeColor: '#245166', border: '#0FAE82' }
};

/** 이벤트 화면에서 눌러 재생할 영상/소리가 있는지 */
export function hasPlayableMedia(event) {
  return Boolean(event?.video_url || event?.audio_url);
}

export function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
