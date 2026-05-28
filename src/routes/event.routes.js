/**
 * Event Routes - 이벤트 데이터 관련 API
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const eventController = require('../controllers/event.controller');
const { authenticateUser, authenticateDevice } = require('../middlewares/auth.middleware');

// Multer 설정 (메모리 스토리지 사용)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB 제한 (영상 파일 대응)
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      // 이미지
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      // 오디오
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4',
      // 영상
      'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`지원하지 않는 파일 형식입니다: ${file.mimetype}`));
    }
  }
});

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
 * [업데이트] 이미지('image') 및 오디오('audio') 파일 직접 업로드 지원
 */
router.post(
  '/', 
  authenticateDevice, 
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'video', maxCount: 1 }
  ]), 
  eventController.createEvent
);

/**
 * DELETE /api/events/:id
 * 이벤트 삭제
 */
router.delete('/:id', authenticateUser, eventController.deleteEvent);

module.exports = router;
