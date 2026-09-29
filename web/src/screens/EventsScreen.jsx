import { useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { EVENT_ICON, RISK_FROM_LEVEL, formatRelativeTime } from '../lib/eventDisplay';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'high', label: '🔴 높음' },
  { key: 'mid', label: '🟡 중간' },
  { key: 'low', label: '🟢 낮음' }
];

const RISK_TO_LEVEL = { high: 'danger', mid: 'warning', low: 'normal' };

export default function EventsScreen() {
  // 이벤트 목록은 AppDataContext에 캐시되어 탭을 오가도 다시 불러오지 않음
  const { eventList, loadEventList, deleteEvent } = useAppData();
  const [filter, setFilter] = useState('all');
  const [deletingId, setDeletingId] = useState(null);

  // 이미 불러온 상태면 loadEventList()는 아무것도 하지 않음
  useEffect(() => {
    loadEventList();
  }, [loadEventList]);

  const events = eventList.data ?? [];
  const loading = !eventList.data && (eventList.status === 'idle' || eventList.status === 'loading');
  const refreshing = !!eventList.data && eventList.status === 'loading';
  const error = eventList.error;

  const handleRefresh = () => loadEventList(true);

  const filtered = filter === 'all'
    ? events
    : events.filter((e) => e.danger_level === RISK_TO_LEVEL[filter]);

  const handleDelete = async (id) => {
    if (!window.confirm('이 이벤트를 삭제하시겠습니까?')) return;
    setDeletingId(id);
    try {
      await deleteEvent(id);
    } catch (err) {
      alert(err.message || '이벤트 삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="grain-surface flex items-start justify-between bg-brand-600 px-5 pb-6 pt-6 text-white">
        <div>
          <div className="text-2xl font-bold tracking-tight">이벤트</div>
          <div className="mt-1 text-sm opacity-80">감지된 활동을 한눈에 확인하세요</div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="이벤트 새로고침"
          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white/70 transition-transform active:scale-90 disabled:opacity-60"
        >
          <svg
            className={refreshing ? 'animate-spin' : ''}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      <div className="sticky top-0 z-[5] flex gap-2 overflow-x-auto border-b border-black/5 bg-white/90 px-5 py-3.5 backdrop-blur-lg">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-all active:scale-95 ${
                active ? 'bg-brand-600 text-white shadow-md shadow-brand-900/25' : 'bg-[#f2f4f6] text-ink hover:bg-[#e9ecef]'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="px-5 pt-5">
        {loading && <div className="text-sm text-ink-light">불러오는 중...</div>}
        {error && <div className="text-sm text-danger">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 py-8 text-center text-sm text-ink-light">
            해당 조건의 이벤트가 없습니다.
          </div>
        )}
        {filtered.map((e) => {
          const disp = EVENT_ICON[e.type] || EVENT_ICON.other;
          const risk = RISK_FROM_LEVEL[e.danger_level] || RISK_FROM_LEVEL.normal;
          return (
            <div
              key={e.id}
              className="mb-3 flex gap-3.5 rounded-2xl border border-black/5 bg-white p-4 shadow-sm shadow-brand-900/[0.04] transition-transform hover:-translate-y-0.5"
              style={{ borderLeft: `4px solid ${risk.border}` }}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: disp.bg }}>
                {disp.icon}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center">
                  <span className="text-[15px] font-semibold text-ink">{e.description}</span>
                  <span
                    className="ml-2 inline-block rounded-[10px] px-2.5 py-[3px] text-[11px] font-bold"
                    style={{ background: risk.badgeBg, color: risk.badgeColor }}
                  >
                    {risk.label}
                  </span>
                </div>
                <div className="mt-1.5 text-xs text-ink-light">
                  {new Date(e.timestamp).toLocaleString('ko-KR')} • {formatRelativeTime(e.timestamp)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(e.id)}
                disabled={deletingId === e.id}
                aria-label="이벤트 삭제"
                className="h-7 w-7 shrink-0 self-start rounded-full text-lg leading-none text-ink-light transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="h-5" />
    </div>
  );
}
