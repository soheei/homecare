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

const sendToSubscription = async (subscription, payload) => {
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
    JSON.stringify(payload)
  );
};

module.exports = {
  isConfigured,
  sendToSubscription
};
