import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { C } from '../theme';
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
      <div style={{ display: 'flex', padding: '16px 20px', gap: 8, overflowX: 'auto', background: C.card, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 5 }}>
        {FILTERS.map((f) => (
          <div key={f.key} onClick={() => setFilter(f.key)}
            style={{ padding: '8px 16px', borderRadius: 20, background: filter === f.key ? C.primary : C.bg, color: filter === f.key ? '#fff' : C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {f.label}
          </div>
        ))}
      </div>

      <div style={{ padding: '20px 20px 0' }}>
        {loading && <div style={{ color: C.textLight, fontSize: 14 }}>불러오는 중...</div>}
        {error && <div style={{ color: C.danger, fontSize: 14 }}>{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ color: C.textLight, fontSize: 14 }}>해당 조건의 이벤트가 없습니다.</div>
        )}
        {filtered.map((e) => {
          const disp = EVENT_ICON[e.type] || EVENT_ICON.other;
          const risk = RISK_FROM_LEVEL[e.danger_level] || RISK_FROM_LEVEL.normal;
          return (
            <div key={e.id} style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: '0 2px 8px rgba(42,95,127,0.08)', display: 'flex', gap: 14, borderLeft: `4px solid ${risk.border}` }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: disp.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{disp.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{e.description}</span>
                  <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, marginLeft: 8, background: risk.badgeBg, color: risk.badgeColor }}>{risk.label}</span>
                </div>
                <div style={{ fontSize: 12, color: C.textLight, marginTop: 6 }}>{new Date(e.timestamp).toLocaleString('ko-KR')} • {formatRelativeTime(e.timestamp)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ height: 20 }} />
    </div>
  );
}
