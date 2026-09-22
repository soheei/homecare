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

  const [briefing, setBriefing] = useState(null);
  const [briefingStatus, setBriefingStatus] = useState('empty'); // empty | loading | done | error
  const [briefingError, setBriefingError] = useState('');

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

  const generateBriefing = async () => {
    setBriefingStatus('loading');
    setBriefingError('');
    try {
      const data = await api.chat.getDailySummary();
      setBriefing(data);
      setBriefingStatus('done');
    } catch (err) {
      setBriefingError(err.message || '브리핑을 만들지 못했어요.');
      setBriefingStatus('error');
    }
  };

  const cameraDevice = devices.find((d) => d.type === 'camera');
  const micDevice = devices.find((d) => d.type === 'microphone');
  const deviceLabel = (d) => (!d ? '미등록' : d.status === 'online' ? '켜짐' : '꺼짐');
  const deviceColor = (d) => (d?.status === 'online' ? 'text-success' : 'text-ink-light');

  const initial = user?.email?.[0]?.toUpperCase() || '?';

  const cards = [
    { icon: '📷', label: '카메라', value: deviceLabel(cameraDevice), bg: 'bg-brand-500/8', valueColor: deviceColor(cameraDevice) },
    { icon: '🎙️', label: '마이크', value: deviceLabel(micDevice), bg: 'bg-brand-400/10', valueColor: deviceColor(micDevice) },
    { icon: '📊', label: '오늘 이벤트', value: `${todayCount}건`, bg: 'bg-brand-400/10', valueColor: 'text-ink' },
    { icon: '⚠️', label: '위험 알림', value: `${dangerCount}건`, bg: dangerCount > 0 ? 'bg-danger/12' : 'bg-brand-100', valueColor: dangerCount > 0 ? 'text-danger' : 'text-ink' }
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

      <div className="px-5 pt-5">
        <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm shadow-brand-900/[0.04]">
          <div className="flex items-start gap-3 px-[18px] pt-[18px]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-400/10 text-[19px]">📋</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-bold text-ink">오늘의 브리핑</span>
                <span className="rounded-[6px] bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-brand-500">AI</span>
              </div>
              {briefingStatus === 'done' && briefing && (
                <div className="mt-0.5 text-xs text-ink-light">
                  {new Date(briefing.timestamp).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} 생성 · 이벤트 {briefing.eventCount}건 기반
                </div>
              )}
            </div>
            {briefingStatus === 'done' && (
              <button
                type="button"
                onClick={generateBriefing}
                aria-label="브리핑 다시 만들기"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-sm text-ink-light transition-colors hover:bg-black/[0.03]"
              >
                ↻
              </button>
            )}
          </div>

          {briefingStatus === 'empty' && (
            <div className="px-[18px] pb-[22px] pt-2 text-center">
              <p className="mx-0 mb-4 mt-1 text-[13px] leading-relaxed text-ink-light">
                아직 오늘의 브리핑이 없어요.<br />버튼을 누르면 AI가 오늘 하루를 요약해드려요.
              </p>
              <button
                type="button"
                onClick={generateBriefing}
                className="rounded-xl border-none bg-brand-600 px-[18px] py-2.5 text-[13px] font-bold text-white transition-transform active:scale-[0.98]"
              >
                지금 브리핑 만들기
              </button>
            </div>
          )}

          {briefingStatus === 'loading' && (
            <div className="px-[18px] pb-5 pt-1.5">
              <div className="mb-3.5 flex items-center gap-2">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-100 border-t-brand-400" />
                <span className="text-[13px] text-ink-light">오늘 하루를 정리하고 있어요…</span>
              </div>
              <div className="mb-2 h-2.5 w-full rounded-full bg-brand-50" />
              <div className="mb-2 h-2.5 w-[92%] rounded-full bg-brand-50" />
              <div className="h-2.5 w-[65%] rounded-full bg-brand-50" />
            </div>
          )}

          {briefingStatus === 'done' && briefing && (
            <div className="px-[18px] pb-5 pt-3.5">
              <p className="m-0 whitespace-pre-line text-sm leading-relaxed text-ink">{briefing.summary}</p>
            </div>
          )}

          {briefingStatus === 'error' && (
            <div className="px-[18px] pb-5 pt-1.5">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[15px]">⚠️</span>
                <span className="text-[13px] font-semibold text-danger">브리핑을 만들지 못했어요</span>
              </div>
              <p className="mb-3.5 text-[13px] leading-relaxed text-ink-light">{briefingError}</p>
              <button
                type="button"
                onClick={generateBriefing}
                className="rounded-xl border border-danger/35 bg-danger/12 px-4 py-2.5 text-[13px] font-bold text-danger"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
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
