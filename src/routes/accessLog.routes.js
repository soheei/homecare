/**
 * Access Log Routes - 열람·촬영·삭제 기록
 */

const express = require('express');
const router = express.Router();
const accessLogController = require('../controllers/accessLog.controller');
const { authenticateUser } = require('../middlewares/auth.middleware');

/**
 * GET /api/access-logs?limit=50&offset=0
 * 내 기록만 최신순으로 조회
 */
router.get('/', authenticateUser, accessLogController.getLogs);

module.exports = router;
