// HOME-TALK Push Service Worker

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'HOME-TALK', body: event.data.text() };
  }

  const title = payload.title || 'HOME-TALK';

  event.waitUntil(handlePush(title, payload));
});

// iOS(WebKit)는 푸시마다 OS 알림을 띄우지 않으면 구독을 취소하므로 예외로 둔다
const IS_IOS = /iPad|iPhone|iPod/.test(self.navigator.userAgent);

async function handlePush(title, payload) {
  // 앱 화면이 보이는 상태면 화면 안 배너로 알리고, 같은 내용의 OS 알림은 중복이라 생략한다
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = clients.filter((c) => c.visibilityState === 'visible');
  if (visible.length > 0) {
    visible.forEach((c) => c.postMessage({ type: 'push-alert', payload }));
    if (!IS_IOS) return;
  }

  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { eventId: payload.eventId || null },
    // 사용자가 켜 둔 모든 알림을 소리·진동과 함께 상단 배너로 잠깐 표시한다.
    // requireInteraction을 켜면 직접 닫을 때까지 남는 알림이 되므로 일부러 쓰지 않는다
    // (배너는 몇 초 뒤 알림 센터로 들어간다). tag를 두지 않아 알림끼리 서로 덮어쓰지 않는다.
    vibrate: [200, 100, 200],
    silent: false,
    timestamp: Date.now()
  };

  await self.registration.showNotification(title, options);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
