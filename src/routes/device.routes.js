/**
 * Device Routes - Edge Device 관련 API
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const deviceController = require('../controllers/device.controller');
const { authenticateUser, authenticateDevice } = require('../middlewares/auth.middleware');

// 현재 화면 캡처 업로드 (메모리에만, JPEG 1장)
const captureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg') cb(null, true);
    else cb(new Error(`지원하지 않는 파일 형식입니다: ${file.mimetype}`));
  }
});

/**
 * GET /api/devices
 * 등록된 디바이스 목록 조회
 */
router.get('/', authenticateUser, deviceController.getDevices);

/**
 * POST /api/devices/register
 * 새 디바이스 등록
 */
router.post('/register', authenticateUser, deviceController.registerDevice);

/**
 * PUT /api/devices/mode
 * 거실/현관 감지 모드, 경비 모드 변경 (body: { mode?, securityArmed? })
 */
router.put('/mode', authenticateUser, deviceController.setMode);

/**
 * GET /api/devices/:id/security-mode
 * 경비 모드 켜짐 여부 (Edge Device vision이 주기적으로 조회)
 */
router.get('/:id/security-mode', authenticateDevice, deviceController.getSecurityMode);

/**
 * GET /api/devices/:id/status
 * 디바이스 상태 조회
 */
router.get('/:id/status', authenticateUser, deviceController.getDeviceStatus);

/**
 * POST /api/devices/:id/heartbeat
 * 디바이스 상태 업데이트 (Edge Device에서 주기적으로 호출)
 */
router.post('/:id/heartbeat', authenticateDevice, deviceController.updateHeartbeat);

/**
 * POST /api/devices/:id/capture
 * 디바이스에 캡처 요청 (수동 캡처) — Pi가 실제 촬영한 이미지가 도착하면 응답
 */
router.post('/:id/capture', authenticateUser, deviceController.requestCapture);

/**
 * GET /api/devices/:id/captures/:captureId
 * 캡처 이미지 조회 (메모리에 잠깐 보관, 영구 저장 안 함)
 */
router.get('/:id/captures/:captureId', authenticateUser, deviceController.getCaptureImage);

/**
 * GET /api/devices/:id/capture-requests/next
 * 캡처 요청 롱폴링 (Edge Device의 카메라 서비스가 호출)
 */
router.get('/:id/capture-requests/next', authenticateDevice, deviceController.pollCaptureRequest);

/**
 * POST /api/devices/:id/capture-requests/:requestId
 * 촬영 결과 제출 (Edge Device) — multipart 'image' 또는 JSON { error }
 */
router.post(
  '/:id/capture-requests/:requestId',
  authenticateDevice,
  captureUpload.single('image'),
  deviceController.submitCaptureResult
);

/**
 * DELETE /api/devices/:id
 * 디바이스 삭제
 */
router.delete('/:id', authenticateUser, deviceController.deleteDevice);

module.exports = router;
