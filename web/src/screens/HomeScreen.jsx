import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { EVENT_ICON, formatRelativeTime } from '../lib/eventDisplay';
import { useAuth } from '../context/AuthContext';

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '늦은 밤이네요 🌙';
  if (h < 12) return '좋은 아침이에요 ☀️';
  if (h < 18) return '좋은 오후예요 👋';
  return '편안한 저녁 되세요 🌆';
}

export default function HomeScreen() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [devices, setDevices] = useState([]);
  const [dangerCount, setDangerCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [eventsData, devicesData] = await Promise.all([
          api.events.list({ limit: 3 }),
          api.devices.list()
        ]);
        if (cancelled) return;
        setEvents(eventsData.events || []);
        setDevices(devicesData || []);
        const today = new Date().toISOString().split('T')[0];
        const daily = await api.events.getDailySummary(today);
        if (cancelled) return;
        setDangerCount(daily?.dangerEvents?.length ?? 0);
        setTodayCount(daily?.totalEvents ?? 0);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onlineDevices = devices.filter((d) => d.status === 'online').length;
  const initial = user?.email?.[0]?.toUpperCase() || '?';

  const cards = [
    { icon: '📷', label: '카메라', value: `${onlineDevices}대 온라인`, bg: 'bg-brand-500/8', valueColor: 'text-ink' },
    { icon: '📊', label: '오늘 이벤트', value: `${todayCount}건`, bg: 'bg-brand-400/10', valueColor: 'text-ink' },
    { icon: '⚠️', label: '위험 알림', value: `${dangerCount}건`, bg: dangerCount > 0 ? 'bg-danger/12' : 'bg-brand-100', valueColor: dangerCount > 0 ? 'text-danger' : 'text-ink' },
    { icon: '✅', label: '시스템 상태', value: '정상', bg: 'bg-success/12', valueColor: 'text-success' }
  ];

  return (
    <div>
      <div className="grain-surface relative overflow-hidden bg-brand-600 px-5 pb-6 pt-7 text-white">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-brand-300/20 blur-2xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-lg font-bold ring-1 ring-white/30">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[22px] font-bold tracking-tight leading-tight">{greeting()}</div>
            <div className="truncate text-[13px] opacity-80">{user?.email ? `${user.email}님, ` : ''}집 상태를 확인하세요</div>
          </div>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-3 px-5 pt-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-black/5 bg-white p-4 shadow-lg shadow-brand-900/[0.06] transition-transform hover:-translate-y-0.5"
          >
            <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl text-xl ${c.bg}`}>{c.icon}</div>
            <div className="mb-1 text-[13px] text-ink-light">{c.label}</div>
            <div className={`tabular-nums text-lg font-bold ${c.valueColor}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="mx-5 mb-3 mt-8 flex items-center justify-between">
        <div className="text-lg font-bold tracking-tight text-ink">최근 이벤트</div>
        <div className="text-xs font-semibold text-ink-light">최근 3건</div>
      </div>
      <div className="px-5">
        {loading && <div className="text-sm text-ink-light">불러오는 중...</div>}
        {error && <div className="text-sm text-danger">{error}</div>}
        {!loading && !error && events.length === 0 && (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 py-8 text-center text-sm text-ink-light">
            최근 이벤트가 없습니다.
          </div>
        )}
        {events.map((e) => {
          const disp = EVENT_ICON[e.type] || EVENT_ICON.other;
          return (
            <div
              key={e.id}
              className="mb-3 flex items-center gap-3.5 rounded-2xl border border-black/5 bg-white p-4 shadow-sm shadow-brand-900/[0.04] transition-transform hover:-translate-y-0.5"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: disp.bg }}>
                {disp.icon}
              </div>
              <div>
                <div className="mb-1 text-[15px] font-semibold text-ink">{e.description}</div>
                <div className="text-xs text-ink-light">{formatRelativeTime(e.timestamp)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
