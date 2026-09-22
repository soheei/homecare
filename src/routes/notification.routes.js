/**
 * Notification Routes - 푸시 구독 / 알림 설정 관련 API
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticateUser } = require('../middlewares/auth.middleware');

/**
 * GET /api/notifications/public-key
 * 프론트엔드가 구독 생성 시 사용할 VAPID 공개키
 */
router.get('/public-key', notificationController.getPublicKey);

/**
 * GET /api/notifications/preferences
 * 알림 설정 조회
 */
router.get('/preferences', authenticateUser, notificationController.getPreferences);

/**
 * PUT /api/notifications/preferences
 * 알림 설정 저장
 */
router.put('/preferences', authenticateUser, notificationController.updatePreferences);

/**
 * POST /api/notifications/subscribe
 * 푸시 구독 등록
 */
router.post('/subscribe', authenticateUser, notificationController.subscribe);

/**
 * POST /api/notifications/unsubscribe
 * 푸시 구독 해제
 */
router.post('/unsubscribe', authenticateUser, notificationController.unsubscribe);

module.exports = router;
