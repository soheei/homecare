/**
 * Push Service - Web Push(VAPID) 발송 래퍼
 */

const webpush = require('web-push');
const config = require('../config');
const logger = require('../utils/logger');

let configured = false;

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  configured = true;
} else {
  logger.warn('[Push] VAPID 키가 설정되지 않아 푸시 알림이 비활성화됩니다.');
}

const isConfigured = () => configured;

// urgent=true면 Web Push Urgency를 high로 보내 잠든 기기에서도 즉시 전달되고,
// Android에서 화면 상단에 잠깐 떴다 사라지는 헤드업 배너로 표시되기 쉽다. TTL은 오래된 위험 알림이 뒤늦게 뜨지 않도록 짧게 둔다.
const URGENT_TTL_SEC = 60;

const sendToSubscription = async (subscription, payload, { urgent = false } = {}) => {
  if (!configured) {
    const err = new Error('Push notifications are not configured');
    err.statusCode = 503;
    throw err;
  }

  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    },
    JSON.stringify(payload),
    urgent ? { urgency: 'high', TTL: URGENT_TTL_SEC } : undefined
  );
};

module.exports = {
  isConfigured,
  sendToSubscription
};
