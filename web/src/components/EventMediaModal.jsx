import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EVENT_ICON, RISK_FROM_LEVEL } from '../lib/eventDisplay';

/**
 * 이벤트 화면 → 영상/소리가 있는 이벤트를 누르면 뜨는 재생 팝업
 * (스타일은 CameraCaptureModal과 같은 backdrop·rounded-2xl 패턴)
 * 미디어 URL은 서버가 발급한 1시간짜리 서명 URL이라 목록을 오래 띄워 두면 만료될 수 있음 → 새로고침 안내
 */

export default function EventMediaModal({ event, onClose, onRefresh }) {
  const [mediaError, setMediaError] = useState(false);

  useEffect(() => {
    if (!event) return undefined;
    setMediaError(false);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [event, onClose]);

  if (!event) return null;

  const disp = EVENT_ICON[event.type] || EVENT_ICON.other;
  const risk = RISK_FROM_LEVEL[event.danger_level] || RISK_FROM_LEVEL.normal;
  const onMediaError = () => setMediaError(true);

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-media-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-40px)] w-full max-w-[400px] animate-fade-in flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: disp.bg }}>
            {disp.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div id="event-media-title" className="truncate text-[16px] font-bold text-ink">{event.description}</div>
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
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-sm text-ink-light transition-colors hover:bg-black/[0.03]"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto px-5 pb-5">
          {mediaError ? (
            <div className="flex flex-col items-center rounded-2xl bg-brand-50 px-5 py-8 text-center">
              <div className="mb-3 text-[28px]">⚠️</div>
              <p className="m-0 mb-5 text-[13px] leading-relaxed text-ink-light">
                재생하지 못했어요. 재생 링크가 만료됐을 수 있으니 목록을 새로고침한 뒤 다시 열어주세요.
              </p>
              <button
                type="button"
                onClick={() => { onRefresh(); onClose(); }}
                className="rounded-xl border-none bg-brand-600 px-[18px] py-2.5 text-[13px] font-bold text-white transition-transform active:scale-[0.98]"
              >
                새로고침
              </button>
            </div>
          ) : (
            <>
              {event.video_url && (
                <div className="overflow-hidden rounded-2xl bg-black">
                  <video
                    src={event.video_url}
                    poster={event.image_url || undefined}
                    controls
                    autoPlay
                    playsInline
                    onError={onMediaError}
                    className="mx-auto block max-h-[60vh] w-full"
                  />
                </div>
              )}
              {!event.video_url && event.image_url && (
                <div className="overflow-hidden rounded-2xl bg-black">
                  <img src={event.image_url} alt={event.description} className="mx-auto block max-h-[40vh] w-full object-contain" />
                </div>
              )}
              {/* 영상에 소리가 함께 들어 있으므로 영상이 있으면 소리 플레이어는 숨김 (영상 없는 옛 이벤트만 소리 재생) */}
              {!event.video_url && event.audio_url && (
                <div className="rounded-2xl bg-brand-50 p-3">
                  <div className="mb-2 text-[12px] font-semibold text-ink-light">🔊 감지된 소리</div>
                  <audio
                    src={event.audio_url}
                    controls
                    autoPlay
                    onError={onMediaError}
                    className="w-full"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
