/**
 * Chat Routes - AI 대화 관련 API
 */

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { authenticateUser } = require('../middlewares/auth.middleware');

/**
 * POST /api/chat/message
 * 사용자 메시지를 AI에게 전송하고 응답 받기
 */
router.post('/message', authenticateUser, chatController.sendMessage);

/**
 * GET /api/chat/history
 * 대화 기록 조회
 */
router.get('/history', authenticateUser, chatController.getHistory);

/**
 * POST /api/chat/summary
 * 하루 요약 리포트 요청
 */
router.post('/summary', authenticateUser, chatController.getDailySummary);

/**
 * GET /api/chat/summary/latest
 * 가장 최근에 만든 하루 요약 리포트 (새로고침 시 복원용)
 */
router.get('/summary/latest', authenticateUser, chatController.getLatestSummary);

/**
 * DELETE /api/chat/history/:conversationId
 * 특정 대화 기록 삭제
 */
router.delete('/history/:conversationId', authenticateUser, chatController.deleteConversation);

module.exports = router;
