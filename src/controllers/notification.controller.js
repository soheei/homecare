/**
 * Notification Controller - 푸시 구독 / 알림 설정
 */

const notificationService = require('../services/notification.service');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * VAPID 공개키 조회 (프론트에서 구독 생성 시 필요)
 */
const getPublicKey = (req, res) => {
  res.json({
    success: true,
    data: { publicKey: config.vapid.publicKey || null }
  });
};

/**
 * 알림 설정 조회
 */
const getPreferences = async (req, res, next) => {
  try {
    const prefs = await notificationService.getPreferences(req.user.id);
    res.json({ success: true, data: prefs });
  } catch (error) {
    logger.error('[Notification] Error fetching preferences:', error);
    next(error);
  }
};

/**
 * 알림 설정 저장
 */
const updatePreferences = async (req, res, next) => {
  try {
    const prefs = await notificationService.savePreferences(req.user.id, req.body || {});
    res.json({ success: true, data: prefs });
  } catch (error) {
    logger.error('[Notification] Error saving preferences:', error);
    next(error);
  }
};

/**
 * 푸시 구독 등록
 */
const subscribe = async (req, res, next) => {
  try {
    await notificationService.saveSubscription(req.user.id, req.body?.subscription);
    res.status(201).json({ success: true, message: 'Subscribed' });
  } catch (error) {
    logger.error('[Notification] Error saving subscription:', error);
    next(error);
  }
};

/**
 * 푸시 구독 해제
 */
const unsubscribe = async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ success: false, error: 'endpoint is required' });
    }
    await notificationService.removeSubscription(req.user.id, endpoint);
    res.json({ success: true, message: 'Unsubscribed' });
  } catch (error) {
    logger.error('[Notification] Error removing subscription:', error);
    next(error);
  }
};

module.exports = {
  getPublicKey,
  getPreferences,
  updatePreferences,
  subscribe,
  unsubscribe
};
