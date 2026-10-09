/**
 * Device Controller - Edge Device 관리
 */

const deviceService = require('../services/device.service');
const captureService = require('../services/capture.service');
const logger = require('../utils/logger');

/**
 * 등록된 디바이스 목록 조회
 */
const getDevices = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const devices = await deviceService.getDevices(userId);

    res.json({
      success: true,
      data: devices
    });

  } catch (error) {
    logger.error('[Device] Error fetching devices:', error);
    next(error);
  }
};

/**
 * 새 디바이스 등록
 */
const registerDevice = async (req, res, next) => {
  try {
    const { name, location, type } = req.body;
    const userId = req.user?.id;

    if (!name || !type) {
      return res.status(400).json({
        success: false,
        error: 'Name and type are required'
      });
    }

    const device = await deviceService.registerDevice({
      name,
      location,
      type,
      userId
    });

    logger.info(`[Device] New device registered: ${name}`);

    res.status(201).json({
      success: true,
      data: device
    });

  } catch (error) {
    logger.error('[Device] Error registering device:', error);
    next(error);
  }
};

/**
 * 디바이스 상태 조회
 */
const getDeviceStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = await deviceService.getDeviceStatus(id);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('[Device] Error fetching device status:', error);
    next(error);
  }
};

/**
 * 디바이스 상태 업데이트 (Heartbeat)
 */
const updateHeartbeat = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, metrics } = req.body;

    await deviceService.updateHeartbeat(id, { status, metrics });

    // 엣지가 다음 하트비트(최대 20초)부터 이 모드로 감지 대상을 바꾼다
    // 조회 실패(null)면 모드 필드를 생략 — 엣지는 마지막 정상 설정을 유지한다
    const modeState = await deviceService.getDeviceMode(id);

    res.json({
      success: true,
      message: 'Heartbeat updated',
      ...(modeState && { mode: modeState.mode, securityArmed: modeState.securityArmed })
    });

  } catch (error) {
    logger.error('[Device] Error updating heartbeat:', error);
    next(error);
  }
};

/**
 * [Edge] 경비 모드 상태 조회 — vision GuardModeClient가 3초마다 폴링 (응답: data.armed_mode)
 */
const getSecurityMode = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.device?.id !== id) {
      return res.status(403).json({ success: false, error: 'Device id mismatch' });
    }

    const modeState = await deviceService.getDeviceMode(id);
    if (!modeState) {
      return res.status(503).json({ success: false, error: 'Device mode unavailable' });
    }

    res.json({
      success: true,
      data: { armed_mode: modeState.securityArmed }
    });

  } catch (error) {
    logger.error('[Device] Error fetching security mode:', error);
    next(error);
  }
};

/**
 * 거실/현관 모드, 경비 모드 변경 — 로그인 사용자의 마이크·카메라 기기에 함께 적용
 */
const setMode = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { mode, securityArmed } = req.body || {};

    if (mode !== undefined && !deviceService.VALID_MODES.includes(mode)) {
      return res.status(400).json({
        success: false,
        error: `mode must be one of: ${deviceService.VALID_MODES.join(', ')}`
      });
    }
    if (securityArmed !== undefined && typeof securityArmed !== 'boolean') {
      return res.status(400).json({ success: false, error: 'securityArmed must be a boolean' });
    }
    if (mode === undefined && securityArmed === undefined) {
      return res.status(400).json({ success: false, error: 'mode or securityArmed is required' });
    }

    const updated = await deviceService.setUserMode(userId, { mode, securityArmed });
    if (updated === 0) {
      return res.status(404).json({ success: false, error: '모드를 바꿀 카메라/마이크 기기가 없습니다.' });
    }

    res.json({
      success: true,
      data: { ...(mode !== undefined && { mode }), ...(securityArmed !== undefined && { securityArmed }) }
    });

  } catch (error) {
    logger.error('[Device] Error setting mode:', error);
    next(error);
  }
};

/**
 * 본인 기기인지 확인 (카메라 사진은 집 내부 영상이라 소유자만 촬영/조회)
 */
const isOwnDevice = async (deviceId, userId) => {
  const device = await deviceService.getDeviceStatus(deviceId);
  return Boolean(device && device.user_id === userId);
};

/**
 * 디바이스에 캡처 요청 → Pi가 실제로 촬영한 이미지가 도착할 때까지 기다렸다가 응답
 */
const requestCapture = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!(await isOwnDevice(id, req.user?.id))) {
      return res.status(404).json({ success: false, error: captureService.MESSAGES.noCamera });
    }

    logger.info(`[Device] Capture requested for device: ${id}`);
    const capture = await captureService.requestCapture(id);

    res.json({
      success: true,
      data: capture
    });

  } catch (error) {
    logger.error('[Device] Error requesting capture:', error.message);
    next(error);
  }
};

/**
 * 캡처 이미지 조회 (메모리에 잠깐 보관된 것만 — 만료되면 404)
 */
const getCaptureImage = async (req, res, next) => {
  try {
    const { id, captureId } = req.params;
    const capture = (await isOwnDevice(id, req.user?.id)) ? captureService.getCapture(id, captureId) : null;

    if (!capture) {
      return res.status(404).json({ success: false, error: '사진 보관 시간이 지나 더 이상 볼 수 없어요.' });
    }

    res.set('Content-Type', capture.mimeType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(capture.buffer);

  } catch (error) {
    logger.error('[Device] Error fetching capture image:', error);
    next(error);
  }
};

/**
 * [Edge] 캡처 요청 롱폴링 — 요청이 생기면 { requestId }, 대기 시간이 지나면 null
 */
const pollCaptureRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.device?.id !== id) {
      return res.status(403).json({ success: false, error: 'Device id mismatch' });
    }

    // req의 'close'는 GET 본문을 다 읽으면 바로 발생하므로 res 쪽으로 연결 끊김을 감지
    const requestId = await captureService.waitForRequest(id, (cleanup) => res.on('close', cleanup));
    if (res.destroyed || res.writableEnded) {
      if (requestId) captureService.undispatch(id, requestId);
      return;
    }

    res.json({
      success: true,
      data: requestId ? { requestId } : null
    });

  } catch (error) {
    logger.error('[Device] Error polling capture request:', error);
    next(error);
  }
};

/**
 * [Edge] 촬영 결과 제출 — multipart 'image'(JPEG) 또는 JSON { error }
 */
const submitCaptureResult = async (req, res, next) => {
  try {
    const { id, requestId } = req.params;
    if (req.device?.id !== id) {
      return res.status(403).json({ success: false, error: 'Device id mismatch' });
    }

    const accepted = captureService.completeRequest(id, requestId, {
      buffer: req.file?.buffer,
      mimeType: req.file?.mimetype,
      error: req.body?.error
    });

    if (!accepted) {
      return res.status(410).json({ success: false, error: 'Capture request expired' });
    }

    res.json({
      success: true,
      message: 'Capture received'
    });

  } catch (error) {
    logger.error('[Device] Error receiving capture result:', error);
    next(error);
  }
};

/**
 * 디바이스 삭제
 */
const deleteDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    await deviceService.deleteDevice(id, userId);

    res.json({
      success: true,
      message: 'Device deleted successfully'
    });

  } catch (error) {
    logger.error('[Device] Error deleting device:', error);
    next(error);
  }
};

module.exports = {
  getDevices,
  registerDevice,
  getDeviceStatus,
  updateHeartbeat,
  setMode,
  getSecurityMode,
  requestCapture,
  getCaptureImage,
  pollCaptureRequest,
  submitCaptureResult,
  deleteDevice
};
