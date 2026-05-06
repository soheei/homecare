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
 * DELETE /api/chat/history/:conversationId
 * 특정 대화 기록 삭제
 */
router.delete('/history/:conversationId', authenticateUser, chatController.deleteConversation);

module.exports = router;
