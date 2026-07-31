import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { EVENT_ICON, RISK_FROM_LEVEL, formatRelativeTime } from '../lib/eventDisplay';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'high', label: '🔴 높음' },
  { key: 'mid', label: '🟡 중간' },
  { key: 'low', label: '🟢 낮음' }
];

const RISK_TO_LEVEL = { high: 'danger', mid: 'warning', low: 'normal' };

export default function EventsScreen() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.events.list({ limit: 50 });
        if (!cancelled) setEvents(data.events || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = filter === 'all'
    ? events
    : events.filter((e) => e.danger_level === RISK_TO_LEVEL[filter]);

  return (
    <div>
      <div className="bg-gradient-to-br from-brand-500 to-brand-400 px-5 pb-6 pt-6 text-white">
        <div className="text-2xl font-bold">이벤트</div>
        <div className="mt-1 text-sm opacity-85">감지된 활동을 한눈에 확인하세요</div>
      </div>

      <div className="sticky top-0 z-[5] flex gap-2 overflow-x-auto border-b border-black/5 bg-white/90 px-5 py-3.5 backdrop-blur-lg">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-all ${
                active ? 'bg-brand-500 text-white shadow-md shadow-brand-500/25' : 'bg-[#f2f4f6] text-ink hover:bg-[#e9ecef]'
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
              className="mb-3 flex gap-3.5 rounded-2xl border border-black/5 bg-white p-4 shadow-sm shadow-black/[0.03] transition-transform hover:-translate-y-0.5"
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
            </div>
          );
        })}
      </div>
      <div className="h-5" />
    </div>
  );
}
