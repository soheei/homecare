import { BG } from '../theme';

export const EVENT_ICON = {
  visitor: { icon: '🚪', bg: BG.info },
  motion: { icon: '🚶', bg: BG.success },
  sound: { icon: '🔔', bg: BG.warning },
  danger: { icon: '🚨', bg: BG.danger },
  other: { icon: '📌', bg: BG.purple }
};

export const RISK_FROM_LEVEL = {
  danger: { key: 'high', label: '높음', badgeBg: '#FFD6E0', badgeColor: '#C81E4E', border: '#EF476F' },
  warning: { key: 'mid', label: '중간', badgeBg: '#FFE8D1', badgeColor: '#B5651D', border: '#F4A261' },
  normal: { key: 'low', label: '낮음', badgeBg: '#D1E7F8', badgeColor: '#1B5A8A', border: '#06D6A0' }
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
