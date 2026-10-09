import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import CaptureImage from './CaptureImage';
import Icon from './Icon';

/**
 * 홈 카메라 카드 → "현재 집 상태" 팝업
 * 캡처 요청/상태는 HomeScreen이 들고 있고, 이 컴포넌트는 보여주기만 한다.
 * (스타일은 설정/로그인 화면의 기존 모달과 같은 backdrop·rounded-2xl 패턴)
 *
 * @param {{ status: 'loading'|'done'|'off'|'error', data, error }} capture
 */

function formatCaptureTime(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function CameraCaptureModal({ open, capture, onClose, onRetry }) {
  // ESC로 닫기 + 열려 있는 동안 뒤 홈 화면 스크롤 막기
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const { status, data, error } = capture;

  // 홈 카드에 hover transform이 있어 fixed가 갇히지 않도록 body로
  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-capture-title"
        onClick={(e) => e.stopPropagation()} // 창 안(이미지 포함)을 눌러도 닫히지 않게
        className="flex max-h-[calc(100dvh-40px)] w-full max-w-[400px] animate-fade-in flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-500"><Icon name="camera" size={20} /></div>
          <div id="camera-capture-title" className="min-w-0 flex-1 text-[17px] font-bold text-ink">현재 집 상태</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-sm text-ink-light transition-colors hover:bg-black/[0.03]"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* 화면보다 길어지면 창 안에서만 스크롤 */}
        <div className="min-h-0 overflow-y-auto px-5 pb-5">
          {status === 'loading' && (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-2.5 rounded-2xl bg-brand-50">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-100 border-t-brand-400" />
              <span className="text-[13px] text-ink-light">현재 화면을 불러오는 중...</span>
            </div>
          )}

          {status === 'done' && data && (
            <>
              <CaptureImage src={data.imageUrl} alt="현재 집 상태" zoomable={false} />
              <div className="mt-3 text-center text-[13px] text-ink-light">
                촬영 시간 <span className="tabular-nums font-semibold text-ink">{formatCaptureTime(data.capturedAt)}</span>
              </div>
            </>
          )}

          {(status === 'error' || status === 'off') && (
            <div className="flex flex-col items-center rounded-2xl bg-brand-50 px-5 py-8 text-center">
              <Icon name={status === 'off' ? 'camera' : 'alert'} size={28} className={`mb-3 ${status === 'off' ? 'text-ink-light' : 'text-danger'}`} />
              <p className={`m-0 mb-5 text-[13px] leading-relaxed ${status === 'off' ? 'text-ink-light' : 'text-danger'}`}>{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-xl border-none bg-brand-600 px-[18px] py-2.5 text-[13px] font-bold text-white transition-transform active:scale-[0.98]"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
