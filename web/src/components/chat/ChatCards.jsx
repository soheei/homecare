import { InlineText } from './MarkdownText';

/**
 * AI 응답의 구조화 블록용 카드 UI
 * 홈 화면 카드와 같은 톤(흰 배경, rounded-2xl, 옅은 테두리/그림자)을 쓰고, 상태 색은 옅게만 사용
 */

const CARD = 'rounded-2xl border border-black/5 bg-white shadow-sm shadow-brand-900/[0.04]';

const TONE = {
  good: { badge: 'bg-success/10 text-success', dot: 'bg-success' },
  offline: { badge: 'bg-danger/[0.08] text-danger', dot: 'bg-danger' },
  warning: { badge: 'bg-warning/15 text-[#93601F]', dot: 'bg-warning' },
  danger: { badge: 'bg-danger/[0.12] text-danger', dot: 'bg-danger' },
  neutral: { badge: 'bg-[#f2f4f6] text-ink-light', dot: 'bg-ink-light/60' }
};

export function StatusBadge({ status, size = 'md' }) {
  if (!status) return null;
  const tone = TONE[status.tone] || TONE.neutral;
  return (
    <span
      data-block="status-badge"
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full align-middle font-semibold ${tone.badge} ${
        size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-2.5 py-1 text-[12.5px]'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
      <span className="[overflow-wrap:anywhere]">{status.label}</span>
    </span>
  );
}

function SectionTitle({ title }) {
  if (!title) return null;
  return <div className="mb-2 px-1 text-[13px] font-semibold text-ink-light [overflow-wrap:anywhere]">{title}</div>;
}

// ─────────────────────────────────────────────────────────────
// 장치 상태
// ─────────────────────────────────────────────────────────────

function deviceIcon({ kind, name }) {
  const s = `${kind} ${name}`.toLowerCase();
  if (/카메라|camera|캠/.test(s)) return { icon: '📷', bg: 'bg-brand-500/8' };
  if (/마이크|mic|respeaker|오디오/.test(s)) return { icon: '🎙️', bg: 'bg-brand-400/10' };
  if (/센서|sensor/.test(s)) return { icon: '📡', bg: 'bg-brand-400/10' };
  return { icon: '🔌', bg: 'bg-brand-100' };
}

export function DeviceStatusCard({ title, devices }) {
  return (
    <div data-block="device-status">
      <SectionTitle title={title} />
      <div className="flex flex-col gap-2">
        {devices.map((d, i) => {
          const { icon, bg } = deviceIcon(d);
          const meta = [d.kind, d.location].filter(Boolean).join(' · ');
          return (
            <div key={i} data-block="device-card" className={`flex items-start gap-3 p-3.5 ${CARD}`}>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${bg}`}>{icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{d.name || '이름 없는 장치'}</div>
                {meta && <div className="mt-0.5 text-[13px] text-ink-light [overflow-wrap:anywhere]">{meta}</div>}
                {d.status && <div className="mt-2"><StatusBadge status={d.status} /></div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 이벤트 목록
// ─────────────────────────────────────────────────────────────

export function EventList({ title, events }) {
  return (
    <div data-block="event-list">
      <SectionTitle title={title} />
      <div className={`divide-y divide-black/5 ${CARD}`}>
        {events.map((e, i) => (
          <div key={i} data-block="event-row" className="px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-xs text-ink-light [overflow-wrap:anywhere]">🕐 {e.time}</span>
              {e.status && <StatusBadge status={e.status} size="sm" />}
            </div>
            <div className="mt-1 text-[14px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{e.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 통계
// ─────────────────────────────────────────────────────────────

export function StatCard({ title, items }) {
  return (
    <div data-block="stats">
      <SectionTitle title={title} />
      <div className="grid grid-cols-2 gap-2">
        {items.map((s, i) => (
          // 라벨·값을 한 줄에 배치해 타일 높이를 줄임
          <div key={i} data-block="stat-tile" className={`flex min-w-0 items-baseline justify-between gap-2 px-3 py-2 ${CARD}`}>
            <div className="min-w-0 text-[12.5px] text-ink-light [overflow-wrap:anywhere]">{s.label}</div>
            <div className="shrink-0 text-base font-bold tabular-nums text-ink">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 경고
// ─────────────────────────────────────────────────────────────

export function AlertCard({ tone, title, body }) {
  const danger = tone === 'danger';
  return (
    <div
      data-block="alert"
      role="alert"
      className={`rounded-2xl border px-4 py-3.5 ${danger ? 'border-danger/25 bg-danger/[0.06]' : 'border-warning/30 bg-warning/[0.08]'}`}
    >
      <div className={`flex items-start gap-2 text-[14.5px] font-bold leading-snug ${danger ? 'text-danger' : 'text-[#93601F]'}`}>
        <span className="shrink-0">{danger ? '🚨' : '⚠️'}</span>
        <span className="min-w-0 [overflow-wrap:anywhere]"><InlineText text={title} /></span>
      </div>
      {body.length > 0 && (
        <div className="mt-1.5 space-y-0.5 pl-7 text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]">
          {body.map((line, i) => <p key={i} className="m-0"><InlineText text={line} /></p>)}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 분류되지 않는 일반 표 → 모바일용 세로 배치 (행마다 "헤더: 값")
// ─────────────────────────────────────────────────────────────

export function ResponsiveTable({ title, headers, rows }) {
  return (
    <div data-block="table">
      <SectionTitle title={title} />
      <div className={`divide-y divide-black/5 ${CARD}`}>
        {rows.map((row, i) => (
          <div key={i} className="px-3.5 py-3">
            <div className="text-[14.5px] font-semibold text-ink [overflow-wrap:anywhere]"><InlineText text={row[0]} /></div>
            {headers.slice(1).map((h, j) => (
              row[j + 1] ? (
                <div key={j} className="mt-1 flex gap-3 text-[13.5px]">
                  <span className="shrink-0 text-ink-light">{h}</span>
                  <span className="min-w-0 flex-1 text-right text-ink [overflow-wrap:anywhere]"><InlineText text={row[j + 1]} /></span>
                </div>
              ) : null
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
