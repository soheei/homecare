/**
 * Event Routes - 이벤트 데이터 관련 API
 */

const express = require('express');
const router = express.Router();
const eventController = require('../controllers/event.controller');
const { authenticateUser, authenticateDevice } = require('../middlewares/auth.middleware');

/**
 * GET /api/events
 * 이벤트 목록 조회
 */
router.get('/', authenticateUser, eventController.getEvents);

/**
 * GET /api/events/summary/daily
 * 일별 이벤트 요약
 */
router.get('/summary/daily', authenticateUser, eventController.getDailySummary);

/**
 * GET /api/events/summary/weekly
 * 주간 이벤트 요약
 */
router.get('/summary/weekly', authenticateUser, eventController.getWeeklySummary);

/**
 * GET /api/events/:id
 * 특정 이벤트 상세 조회
 */
router.get('/:id', authenticateUser, eventController.getEventById);

/**
 * POST /api/events
 * 새 이벤트 생성 (Edge Device에서 호출)
 */
router.post('/', authenticateDevice, eventController.createEvent);

/**
 * DELETE /api/events/:id
 * 이벤트 삭제
 */
router.delete('/:id', authenticateUser, eventController.deleteEvent);

module.exports = router;
