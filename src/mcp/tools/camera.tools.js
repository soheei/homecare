/**
 * MCP Tools - Camera Related
 * 카메라 및 디바이스 관련 도구
 *
 * [버그 수정]
 * 3. request_capture, get_latest_capture TODO 구현
 * 4. (2026-09-27) request_capture: 가짜 이벤트 기록 대신 Pi 카메라로 실제 촬영
 */

const deviceService = require('../../services/device.service');
const captureService = require('../../services/capture.service');
const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const { formatKst } = require('../../utils/date.utils');

// 도구 정의
const definitions = [
  {
    name: 'get_camera_status',
    description: '등록된 카메라(Edge Device)의 현재 상태를 확인합니다. 온라인/오프라인 상태, 마지막 연결 시간 등을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: {
          type: 'string',
          description: '특정 디바이스 ID (생략시 모든 디바이스)'
        }
      }
    }
  },
  {
    name: 'get_device_list',
    description: '등록된 모든 디바이스(카메라, 마이크 등) 목록을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'request_capture',
    description: '라즈베리파이 카메라로 지금 이 순간의 화면을 실제로 1장 촬영합니다. "현재 화면 보여줘", "지금 카메라 보여줘", "카메라 확인해줘"처럼 현재 모습을 보고 싶어할 때 사용합니다. 촬영된 사진은 앱이 답변에 자동으로 표시합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: {
          type: 'string',
          description: '촬영할 카메라 디바이스 ID (생략시 등록된 카메라 중 켜져 있는 것)'
        }
      }
    }
  },
  {
    name: 'get_latest_capture',
    description: '특정 카메라의 가장 최근 캡처 이미지 정보를 가져옵니다.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: {
          type: 'string',
          description: '디바이스 ID'
        }
      },
      required: ['deviceId']
    }
  }
];

// ============================================================
// 캡처 관련 DB 헬퍼
// ============================================================

/**
 * 특정 디바이스의 가장 최근 이미지 이벤트 조회
 */
const fetchLatestCapture = async (deviceId) => {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, type, description, image_url, timestamp, metadata')
      .eq('device_id', deviceId)
      .not('image_url', 'is', null) // image_url이 있는 이벤트만
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    logger.warn('[CameraTools] No capture found for device:', deviceId, error.message);
    return null;
  }
};

// 도구 핸들러
const handlers = {
  async get_camera_status({ deviceId }) {
    if (deviceId) {
      const status = await deviceService.getDeviceStatus(deviceId);
      return status || { error: 'Device not found' };
    }

    // 모든 디바이스 상태 조회
    const devices = await deviceService.getDevices('all');
    const statuses = await Promise.all(
      devices.map(async (d) => {
        const status = await deviceService.getDeviceStatus(d.id);
        return {
          id: d.id,
          name: d.name,
          location: d.location,
          isOnline: status?.isOnline || false,
          lastHeartbeat: status?.last_heartbeat
        };
      })
    );

    return statuses;
  },

  async get_device_list() {
    const devices = await deviceService.getDevices('all');
    return devices.map(d => ({
      id: d.id,
      name: d.name,
      type: d.type,
      location: d.location,
      status: d.status
    }));
  },

  // ============================================================
  // request_capture — Pi 카메라로 실제 촬영 (capture.service.js가 Pi 롱폴링에 요청 전달)
  // 결과의 imageUrl은 claude.service.js가 답변에 이미지로 붙인다 (모델이 URL을 옮겨 쓰지 않게)
  // ============================================================
  async request_capture({ deviceId } = {}) {
    try {
      const capture = await captureService.requestCapture(deviceId);
      logger.info(`[CameraTools] Captured ${capture.captureId} from device ${capture.deviceId}`);
      return {
        success: true,
        captureId: capture.captureId,
        deviceId: capture.deviceId,
        deviceName: capture.deviceName,
        imageUrl: capture.imageUrl,
        capturedAtKst: formatKst(capture.capturedAt),
        message: '촬영 완료. 사진은 앱이 답변 위에 자동으로 보여주므로 이미지 링크나 URL은 쓰지 말고, 짧게 안내만 하세요.'
      };
    } catch (error) {
      logger.warn(`[CameraTools] Capture failed: ${error.message}`);
      return {
        success: false,
        error: error.message // 사용자용 메시지 (카메라 꺼짐/연결 안 됨/시간 초과 등)
      };
    }
  },

  // ============================================================
  // [버그 3 수정] get_latest_capture 구현
  // events 테이블에서 해당 디바이스의 가장 최근 이미지 조회
  // ============================================================
  async get_latest_capture({ deviceId }) {
    // 1. 디바이스 정보 조회
    const status = await deviceService.getDeviceStatus(deviceId);
    if (!status) {
      return {
        success: false,
        error: `Device not found: ${deviceId}`
      };
    }

    // 2. 최근 캡처 이미지 조회
    const capture = await fetchLatestCapture(deviceId);

    if (!capture) {
      return {
        success: false,
        deviceId,
        deviceName: status.name,
        message: '아직 저장된 캡처 이미지가 없습니다.'
      };
    }

    // 3. 캡처 시간 계산 (몇 분 전)
    const capturedAt = new Date(capture.timestamp);
    const minutesAgo = Math.round((Date.now() - capturedAt.getTime()) / 60000);
    const timeLabel = minutesAgo < 1
      ? '방금 전'
      : minutesAgo < 60
        ? `${minutesAgo}분 전`
        : `${Math.round(minutesAgo / 60)}시간 전`;

    return {
      success: true,
      deviceId,
      deviceName: status.name,
      deviceLocation: status.location,
      capture: {
        id: capture.id,
        imageUrl: capture.image_url,
        description: capture.description,
        eventType: capture.type,
        capturedAt: capture.timestamp,
        capturedAgo: timeLabel
      }
    };
  }
};

module.exports = {
  definitions,
  handlers
};
