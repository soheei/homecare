const TABS = [
  { icon: '🏠', label: '홈' },
  { icon: '💬', label: '채팅' },
  { icon: '📋', label: '이벤트' },
  { icon: '⚙️', label: '설정' }
];

export default function BottomNav({ tab, setTab }) {
  return (
    <div className="fixed bottom-0 left-1/2 z-20 flex h-[70px] w-full max-w-[430px] -translate-x-1/2 border-t border-black/5 bg-white/90 pb-2 backdrop-blur-lg">
      {TABS.map((t, i) => {
        const active = tab === i;
        return (
          <button
            key={t.label}
            onClick={() => setTab(i)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 border-none bg-transparent"
          >
            <span className={`text-[22px] transition-transform ${active ? 'scale-110' : ''}`}>{t.icon}</span>
            <span className={`text-[11px] font-semibold transition-colors ${active ? 'text-brand-500' : 'text-ink-light'}`}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
