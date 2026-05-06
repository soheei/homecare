/**
 * Device Routes - Edge Device 관련 API
 */

const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/device.controller');
const { authenticateUser, authenticateDevice } = require('../middlewares/auth.middleware');

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
 * 디바이스에 캡처 요청 (수동 캡처)
 */
router.post('/:id/capture', authenticateUser, deviceController.requestCapture);

/**
 * DELETE /api/devices/:id
 * 디바이스 삭제
 */
router.delete('/:id', authenticateUser, deviceController.deleteDevice);

module.exports = router;
