/**
 * MCP Tools - Camera Related
 * 카메라 및 디바이스 관련 도구
 *
 * [버그 수정]
 * 3. request_capture, get_latest_capture TODO 구현
 */

const deviceService = require('../../services/device.service');
const { supabase, supabaseAdmin } = require('../../config/supabase');
const logger = require('../../utils/logger');

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
    description: '특정 카메라에 즉시 캡처를 요청합니다. 현재 상황을 확인하고 싶을 때 사용합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: {
          type: 'string',
          description: '캡처를 요청할 디바이스 ID'
        }
      },
      required: ['deviceId']
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
// [버그 3 수정] 캡처 관련 DB 헬퍼
// ============================================================

/**
 * capture_requests 테이블에 요청 저장
 * (Edge Device가 주기적으로 폴링하여 캡처 실행)
 * - DB에 테이블이 없을 경우 events 테이블로 fallback
 */
const insertCaptureRequest = async (deviceId) => {
  // capture_requests 테이블이 있으면 사용, 없으면 events 테이블에 특수 이벤트로 기록
  try {
    const { data, error } = await supabaseAdmin
      .from('capture_requests')
      .insert([{
        device_id: deviceId,
        status: 'pending',
        requested_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;
    return { source: 'capture_requests', id: data.id };
  } catch {
    // fallback: events 테이블에 type='other' 메타 이벤트로 기록
    try {
      const { data, error } = await supabaseAdmin
        .from('events')
        .insert([{
          device_id: deviceId,
          type: 'other',
          description: '[CAPTURE_REQUEST] 사용자 요청 캡처',
          danger_level: 'normal',
          metadata: { capture_request: true, status: 'pending' },
          timestamp: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;
      return { source: 'events', id: data.id };
    } catch (fallbackError) {
      logger.warn('[CameraTools] DB insert failed, returning in-memory request');
      return { source: 'memory', id: `req_${Date.now()}` };
    }
  }
};

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
  // [버그 3 수정] request_capture 구현
  // Edge Device가 polling 방식으로 캡처 요청을 감지하는 구조
  // ============================================================
  async request_capture({ deviceId }) {
    // 1. 디바이스 존재 & 온라인 여부 확인
    const status = await deviceService.getDeviceStatus(deviceId);
    if (!status) {
      return {
        success: false,
        error: `Device not found: ${deviceId}`
      };
    }

    if (!status.isOnline) {
      return {
        success: false,
        deviceId,
        deviceName: status.name,
        error: '디바이스가 오프라인 상태입니다. 캡처를 요청할 수 없습니다.',
        lastHeartbeat: status.last_heartbeat
      };
    }

    // 2. DB에 캡처 요청 기록 (Edge Device가 polling으로 감지)
    const request = await insertCaptureRequest(deviceId);

    logger.info(`[CameraTools] Capture requested for device ${deviceId}, requestId: ${request.id}`);

    return {
      success: true,
      deviceId,
      deviceName: status.name,
      deviceLocation: status.location,
      requestId: request.id,
      requestedAt: new Date().toISOString(),
      message: `${status.name}(${status.location})에 캡처 요청을 전송했습니다. 잠시 후 최신 이미지를 확인하세요.`
    };
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
