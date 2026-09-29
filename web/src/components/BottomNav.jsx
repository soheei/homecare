const TABS = [
  { icon: '🏠', label: '홈' },
  { icon: '💬', label: '채팅' },
  { icon: '📋', label: '이벤트' },
  { icon: '⚙️', label: '설정' }
];

/** @param {boolean} hidden - 채팅 입력 중(모바일 키보드가 떠 있음)이면 숨겨 입력창만 키보드 위에 남김 */
export default function BottomNav({ tab, setTab, hidden = false }) {
  if (hidden) return null;
  return (
    <nav className="fixed bottom-0 left-1/2 z-20 flex h-[82px] w-full max-w-[430px] -translate-x-1/2 border-t border-black/5 bg-white/90 pb-2 backdrop-blur-lg">
      {TABS.map((t, i) => {
        const active = tab === i;
        return (
          <button
            key={t.label}
            onClick={() => setTab(i)}
            aria-current={active ? 'page' : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 border-none bg-transparent transition-transform active:scale-95"
          >
            <span className={`text-[22px] transition-transform ${active ? 'scale-110' : ''}`}>{t.icon}</span>
            <span className={`text-[11px] font-semibold transition-colors ${active ? 'text-brand-500' : 'text-ink-light'}`}>
              {t.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
