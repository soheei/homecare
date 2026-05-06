/**
 * Device Controller - Edge Device 관리
 */

const deviceService = require('../services/device.service');
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

    res.json({
      success: true,
      message: 'Heartbeat updated'
    });

  } catch (error) {
    logger.error('[Device] Error updating heartbeat:', error);
    next(error);
  }
};

/**
 * 디바이스에 캡처 요청
 */
const requestCapture = async (req, res, next) => {
  try {
    const { id } = req.params;

    logger.info(`[Device] Capture requested for device: ${id}`);
    // TODO: 실제 디바이스에 캡처 요청 전송

    res.json({
      success: true,
      message: 'Capture request sent'
    });

  } catch (error) {
    logger.error('[Device] Error requesting capture:', error);
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
  requestCapture,
  deleteDevice
};
