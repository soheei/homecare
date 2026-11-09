import { useEffect, useState } from 'react';

const SHOW_MS = 5000;

/**
 * 앱이 열려 있을 때 위험 이벤트 푸시를 화면 상단 배너로 잠깐 보여준다.
 * 서비스 워커(sw.js)가 보낸 'push-alert' 메시지를 받아 표시하고 몇 초 뒤 스스로 사라진다.
 * 위험(danger) 이벤트와 경비 모드 침입 의심만 대상으로 하고, 나머지 알림은 무시한다.
 */
export default function DangerBanner({ onOpen, onAlert }) {
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    const onMessage = (e) => {
      if (e.data?.type !== 'push-alert') return;
      const p = e.data.payload || {};
      if (p.type !== 'danger' && !p.isSecurity) return;
      // key를 바꿔 연속 알림에도 타이머가 새로 시작되고 애니메이션이 다시 재생된다
      setAlert({ ...p, key: Date.now() });
      onAlert?.();
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [onAlert]);

  useEffect(() => {
    if (!alert) return undefined;
    const timer = setTimeout(() => setAlert(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [alert]);

  if (!alert) return null;

  return (
    <div
      key={alert.key}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto max-w-[430px] px-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
    >
      <div
        role="alert"
        className="animate-banner-down pointer-events-auto flex items-start gap-3 rounded-2xl bg-danger px-4 py-3 text-white shadow-lg"
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            setAlert(null);
            onOpen?.();
          }}
        >
          <div className="text-sm font-bold">{alert.title || '🚨 위험 알림'}</div>
          {alert.body && <div className="mt-0.5 line-clamp-2 text-xs opacity-90">{alert.body}</div>}
        </button>
        <button
          type="button"
          aria-label="닫기"
          className="shrink-0 px-1 text-lg leading-none opacity-80"
          onClick={() => setAlert(null)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
