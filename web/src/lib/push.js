import { api } from './api';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.error('[Push] Service worker 등록 실패:', err);
    return null;
  }
}

export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * 브라우저 알림 권한을 요청하고, 허용되면 서버에 구독 정보를 등록한다.
 * @returns {Promise<boolean>} 구독 성공 여부
 */
export async function enablePush() {
  if (!isPushSupported()) {
    throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('푸시 알림이 아직 설정되지 않았습니다. (VITE_VAPID_PUBLIC_KEY 누락)');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('알림 권한이 거부되었습니다.');
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }

  await api.notifications.subscribe(subscription.toJSON());
  return true;
}

export async function disablePushIfUnused(stillNeeded) {
  // 다른 알림 항목이 하나라도 켜져 있으면 구독을 유지한다.
  if (stillNeeded) return;

  const subscription = await getExistingSubscription();
  if (!subscription) return;

  try {
    await api.notifications.unsubscribe(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}
