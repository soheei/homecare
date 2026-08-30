import { BG } from '../theme';

export const EVENT_ICON = {
  visitor: { icon: '🚪', bg: BG.info },
  motion: { icon: '🚶', bg: BG.success },
  sound: { icon: '🔔', bg: BG.warning },
  danger: { icon: '🚨', bg: BG.danger },
  other: { icon: '📌', bg: BG.purple }
};

export const RISK_FROM_LEVEL = {
  danger: { key: 'high', label: '높음', badgeBg: '#F3DCE1', badgeColor: '#A93357', border: '#D94F6E' },
  warning: { key: 'mid', label: '중간', badgeBg: '#F2E4D3', badgeColor: '#93601F', border: '#D98A3D' },
  normal: { key: 'low', label: '낮음', badgeBg: '#DCE6EC', badgeColor: '#245166', border: '#0FAE82' }
};

export function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
