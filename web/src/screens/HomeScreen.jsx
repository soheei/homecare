import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { C, BG } from '../theme';
import { EVENT_ICON, formatRelativeTime } from '../lib/eventDisplay';
import { useAuth } from '../context/AuthContext';

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

  const cards = [
    { icon: '📷', label: '카메라', value: `${onlineDevices}대 온라인`, bg: BG.success },
    { icon: '📊', label: '오늘 이벤트', value: `${todayCount}건`, bg: BG.info },
    { icon: '⚠️', label: '위험 알림', value: `${dangerCount}건`, bg: dangerCount > 0 ? BG.danger : BG.warning },
    { icon: '✅', label: '시스템 상태', value: '정상', bg: BG.success }
  ];

  return (
    <div>
      <div style={{ background: `linear-gradient(135deg,${C.primary},${C.primaryLight})`, padding: '24px 20px 32px', color: '#fff' }}>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>안녕하세요 👋</div>
        <div style={{ fontSize: 15, opacity: 0.9 }}>{user?.email ? `${user.email}님, ` : ''}부모님 집 상태를 확인하세요</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 20, marginTop: -20 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: C.card, borderRadius: 16, padding: 18, boxShadow: '0 2px 12px rgba(42,95,127,0.08)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 12 }}>{c.icon}</div>
            <div style={{ fontSize: 13, color: C.textLight, marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.text, padding: '0 20px', margin: '24px 0 12px' }}>최근 이벤트</div>
      <div style={{ padding: '0 20px' }}>
        {loading && <div style={{ color: C.textLight, fontSize: 14 }}>불러오는 중...</div>}
        {error && <div style={{ color: C.danger, fontSize: 14 }}>{error}</div>}
        {!loading && !error && events.length === 0 && (
          <div style={{ color: C.textLight, fontSize: 14 }}>최근 이벤트가 없습니다.</div>
        )}
        {events.map((e) => {
          const disp = EVENT_ICON[e.type] || EVENT_ICON.other;
          return (
            <div key={e.id} style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: '0 2px 8px rgba(42,95,127,0.08)', display: 'flex', gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: disp.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{disp.icon}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>{e.description}</div>
                <div style={{ fontSize: 12, color: C.textLight }}>{formatRelativeTime(e.timestamp)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
