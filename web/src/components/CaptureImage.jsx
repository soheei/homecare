import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';

/**
 * 카메라 캡처 이미지 (홈 "현재 화면" 카드 + 채팅 이미지 메시지 공용)
 * - 캡처 이미지는 로그인한 소유자만 볼 수 있어 <img src>로 바로 못 불러옴 → 토큰을 붙여 fetch 후 Blob URL
 * - 서버는 이미지를 잠깐만 보관(영구 저장 안 함) → 만료되면 안내 문구
 * - 누르면 전체 화면으로 확대
 */

// 탭 전환으로 다시 그려질 때 또 받지 않도록 (세션 동안 유지, 캡처는 최대 수십 장이라 해제하지 않음)
const blobUrlCache = new Map(); // src → Promise<objectURL>

function loadBlobUrl(src) {
  if (!blobUrlCache.has(src)) {
    const p = api.devices.getCaptureImage(src).then((blob) => URL.createObjectURL(blob));
    p.catch(() => blobUrlCache.delete(src)); // 실패하면 다음에 다시 시도
    blobUrlCache.set(src, p);
  }
  return blobUrlCache.get(src);
}

/** @param {boolean} zoomable - false면 눌러도 확대하지 않음 (이미 모달 안에서 크게 보여줄 때) */
export default function CaptureImage({ src, alt = '현재 카메라 화면', caption, zoomable = true }) {
  const [state, setState] = useState({ status: 'loading', url: null, error: '' });
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', url: null, error: '' });
    loadBlobUrl(src)
      .then((url) => { if (!cancelled) setState({ status: 'done', url, error: '' }); })
      .catch((err) => {
        console.warn('[CaptureImage] load failed:', err);
        if (!cancelled) {
          setState({
            status: 'error',
            url: null,
            error: err.status === 404 ? '사진 보관 시간이 지나 더 이상 볼 수 없어요.' : '사진을 불러오지 못했어요.'
          });
        }
      });
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    if (!zoomed) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  return (
    <figure className="m-0 w-full min-w-0 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm shadow-brand-900/[0.04]">
      {state.status === 'loading' && (
        <div className="flex aspect-video w-full items-center justify-center gap-2 bg-brand-50">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-100 border-t-brand-400" />
          <span className="text-[13px] text-ink-light">사진을 불러오는 중…</span>
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex aspect-video w-full items-center justify-center bg-brand-50 px-4 text-center text-[13px] text-ink-light">
          📷 {state.error}
        </div>
      )}
      {/* 원본 비율 유지, 세로로 너무 길어지지 않게 제한 */}
      {state.status === 'done' && zoomable && (
        <button type="button" onClick={() => setZoomed(true)} aria-label="사진 크게 보기" className="block w-full cursor-zoom-in bg-black">
          <img src={state.url} alt={alt} className="mx-auto block h-auto max-h-[60vh] w-full object-contain" />
        </button>
      )}
      {state.status === 'done' && !zoomable && (
        <div className="bg-black">
          <img src={state.url} alt={alt} className="mx-auto block h-auto max-h-[60vh] w-full object-contain" />
        </div>
      )}
      {caption && <figcaption className="px-3.5 py-2 text-xs text-ink-light">{caption}</figcaption>}

      {/* 조상에 transform이 있으면 fixed가 그 안에 갇히므로 body로 */}
      {zoomed && state.url && createPortal(
        <div
          role="dialog"
          aria-label="사진 크게 보기"
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-3"
        >
          <img src={state.url} alt={alt} className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            aria-label="닫기"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-lg text-white"
          >
            ✕
          </button>
        </div>,
        document.body
      )}
    </figure>
  );
}
