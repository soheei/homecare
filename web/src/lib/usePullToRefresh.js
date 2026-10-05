import { useEffect, useRef, useState } from 'react';

const IGNORE_SELECTOR = '[role="dialog"], video, audio, input, textarea';

/**
 * 화면 맨 위에서 아래로 끌어당기면 onRefresh를 실행 (모바일 터치 전용)
 * - enabled가 false면 동작하지 않음 (예: 자체 스크롤이 있는 채팅 탭)
 * - 모달/서랍/영상 위에서 시작한 터치는 무시
 * @returns {{ pull: number, refreshing: boolean }} 끌어당긴 거리(px)와 갱신 중 여부 — 표시용
 */
export default function usePullToRefresh(onRefresh, { enabled = true, threshold = 70 } = {}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return undefined;

    const setPullValue = (v) => {
      pullRef.current = v;
      setPull(v);
    };

    const onStart = (e) => {
      if (refreshingRef.current || window.scrollY > 0) return;
      if (e.target instanceof Element && e.target.closest(IGNORE_SELECTOR)) return;
      startY.current = e.touches[0].clientY;
    };

    const onMove = (e) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        setPullValue(0);
        return;
      }
      setPullValue(Math.min(dy * 0.5, 90));
    };

    const onEnd = async () => {
      if (startY.current === null) return;
      startY.current = null;
      const reached = pullRef.current >= threshold * 0.5;
      setPullValue(0);
      if (!reached || refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
      try {
        await onRefreshRef.current();
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, threshold]);

  return { pull, refreshing };
}
