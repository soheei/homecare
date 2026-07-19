import { C } from '../theme';

const TABS = [
  { icon: '🏠', label: '홈' },
  { icon: '💬', label: '채팅' },
  { icon: '📋', label: '이벤트' },
  { icon: '⚙️', label: '설정' }
];

export default function BottomNav({ tab, setTab }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, height: 70, background: C.card, borderTop: `1px solid ${C.border}`, display: 'flex', paddingBottom: 8, zIndex: 20 }}>
      {TABS.map((t, i) => (
        <div key={t.label} onClick={() => setTab(i)}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer' }}>
          <span style={{ fontSize: 22 }}>{t.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: tab === i ? C.primary : C.textLight }}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}
