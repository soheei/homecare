import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { EVENT_ICON, RISK_FROM_LEVEL } from '../../lib/eventDisplay';

/**
 * 채팅 답변 속 이벤트 소리/영상 카드 (서버가 붙인 "![감지된 소리](/api/events/<id>)" 줄)
 * - 대화 기록에는 이벤트 id만 남음 → 카드가 열릴 때마다 GET /api/events/:id로 새 서명 URL(1시간)을 받음
 * - 화면을 오래 띄워 둬 링크가 만료되면 재생 오류 시 한 번 다시 받아옴
 * - 채팅에서는 자동 재생하지 않음 (기록을 다시 열 때마다 소리가 나지 않게)
 */

const CARD = 'w-full min-w-0 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm shadow-brand-900/[0.04]';

export default function EventMediaCard({ eventId, alt }) {
  const [state, setState] = useState({ status: 'loading', event: null, error: '' });
  const [retried, setRetried] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    api.events.getById(eventId)
      .then((event) => {
        if (cancelled) return;
        if (!event?.video_url && !event?.audio_url && !event?.image_url) {
          setState({ status: 'error', event: null, error: '재생할 파일을 찾지 못했어요.' });
        } else {
          setState({ status: 'done', event, error: '' });
        }
      })
      .catch((err) => {
        console.warn('[EventMediaCard] load failed:', err);
        if (!cancelled) {
          setState({
            status: 'error',
            event: null,
            error: err.status === 404 ? '이벤트가 삭제돼 더 이상 볼 수 없어요.' : '소리/영상을 불러오지 못했어요.'
          });
        }
      });
    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    setState({ status: 'loading', event: null, error: '' });
    setRetried(false);
    return load();
  }, [load]);

  // 서명 URL 만료로 재생이 실패하면 새 URL로 한 번만 다시 시도
  const onMediaError = () => {
    if (!retried) {
      setRetried(true);
      load();
    } else {
      setState({ status: 'error', event: null, error: '재생하지 못했어요. 잠시 후 다시 시도해주세요.' });
    }
  };

  if (state.status !== 'done') {
    return (
      <div data-block="event-media" className={CARD}>
        <div className="flex items-center justify-center gap-2 bg-brand-50 px-4 py-6 text-center text-[13px] text-ink-light">
          {state.status === 'loading' ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-100 border-t-brand-400" />
              <span>{alt || '감지된 소리/영상'} 불러오는 중…</span>
            </>
          ) : (
            <span>🔇 {state.error}</span>
          )}
        </div>
      </div>
    );
  }

  const { event } = state;
  const disp = EVENT_ICON[event.type] || EVENT_ICON.other;
  const risk = RISK_FROM_LEVEL[event.danger_level] || RISK_FROM_LEVEL.normal;

  return (
    <div data-block="event-media" className={CARD}>
      <div className="flex items-center gap-3 px-3.5 pb-2.5 pt-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: disp.bg }}>
          {disp.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold text-ink">{event.description}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-light">
            <span
              className="inline-block rounded-[10px] px-2 py-[2px] text-[10px] font-bold"
              style={{ background: risk.badgeBg, color: risk.badgeColor }}
            >
              {risk.label}
            </span>
            {new Date(event.timestamp).toLocaleString('ko-KR')}
          </div>
        </div>
      </div>

      {event.video_url && (
        <div className="bg-black">
          <video
            src={event.video_url}
            poster={event.image_url || undefined}
            controls
            playsInline
            preload="metadata"
            onError={onMediaError}
            className="mx-auto block max-h-[50vh] w-full"
          />
        </div>
      )}
      {!event.video_url && event.image_url && (
        <div className="bg-black">
          <img src={event.image_url} alt={event.description} onError={onMediaError} className="mx-auto block max-h-[40vh] w-full object-contain" />
        </div>
      )}
      {event.audio_url && (
        <div className="px-3.5 pb-3.5 pt-2">
          <div className="mb-1.5 text-[12px] font-semibold text-ink-light">🔊 감지된 소리</div>
          <audio src={event.audio_url} controls preload="metadata" onError={onMediaError} className="w-full" />
        </div>
      )}
    </div>
  );
}
