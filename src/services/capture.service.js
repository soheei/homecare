/**
 * Capture Service - "현재 카메라 화면" 1장 촬영을 라즈베리파이(엣지)에 요청하고 결과 이미지를 받아 둔다
 *
 * Render의 백엔드는 Pi로 먼저 접속할 수 없다(Pi에 공인 주소가 없음). 그래서 Pi의 카메라 서비스
 * (vision 파이프라인 — vision/camera_service.py, 롱폴링 함수는 edge/apps/camera_monitor.py)가 GET /api/devices/:id/capture-requests/next 로 롱폴링하며 기다리고,
 * 요청이 생기면 바로 응답을 받아 촬영 → POST /api/devices/:id/capture-requests/:requestId 로 JPEG를 올린다.
 *
 * - 상태는 전부 메모리(Render 단일 인스턴스 전제)
 * - 이미지는 영구 저장하지 않는다: 최근 MAX_STORED장을 STORE_TTL_MS 동안만 보관 (서버 재시작 시 사라짐)
 * - 같은 카메라에 진행 중인 요청이 있으면 새 요청도 그 결과를 함께 받는다 (중복 촬영 방지)
 */

const crypto = require('crypto');
const deviceService = require('./device.service');
const { AppError } = require('../middlewares/error.middleware');
const logger = require('../utils/logger');

// 테스트에서 시간을 줄일 수 있도록 객체로 둠
const settings = {
  captureTimeoutMs: 25000,  // 요청 → 이미지 도착까지 최대 대기
  pollHoldMs: 25000,        // Pi 롱폴링 1회 최대 대기
  listenerStaleMs: 40000,   // 이 시간 동안 Pi 폴링이 없으면 캡처 요청을 받을 수 없는 상태로 봄
  maxStored: 20,
  storeTtlMs: 6 * 60 * 60 * 1000
};

// 사용자에게 그대로 보여줄 메시지 (기술적인 원인은 로그에만)
const MESSAGES = {
  noCamera: '등록된 카메라가 없어요.',
  notCamera: '카메라 기기가 아니에요.',
  cameraOff: '카메라가 꺼져 있어 현재 화면을 가져올 수 없습니다.',
  notListening: '라즈베리파이 카메라 서비스와 연결되지 않았어요. 카메라 서비스를 다시 시작해주세요.',
  timeout: '카메라 응답이 늦어 현재 화면을 가져오지 못했어요. 잠시 후 다시 시도해주세요.',
  cameraNotDetected: '카메라 장치를 찾을 수 없어요. 카메라 연결 상태를 확인해주세요.',
  captureFailed: '현재 카메라 화면을 가져오지 못했어요. 카메라 연결 상태를 확인해주세요.'
};

// Pi가 보내는 실패 사유 → 사용자 메시지
const EDGE_ERRORS = {
  camera_not_detected: { status: 503, message: MESSAGES.cameraNotDetected },
  capture_failed: { status: 502, message: MESSAGES.captureFailed }
};

const pending = new Map();    // deviceId → { id, promise, resolve, reject, timer, dispatched }
const pollers = new Map();    // deviceId → { deliver(requestId|null) }
const lastPollAt = new Map(); // deviceId → ms
const captures = new Map();   // captureId → { deviceId, buffer, mimeType, capturedAt }

const imagePath = (deviceId, captureId) => `/api/devices/${deviceId}/captures/${captureId}`;

const pruneCaptures = () => {
  const now = Date.now();
  for (const [id, c] of captures) {
    if (now - c.storedAt > settings.storeTtlMs) captures.delete(id);
  }
  // Map은 넣은 순서를 유지 → 앞에서부터 오래된 것
  while (captures.size > settings.maxStored) captures.delete(captures.keys().next().value);
};

/**
 * 촬영할 카메라 결정: deviceId가 있으면 그 기기, 없으면 등록된 카메라 중 켜진 것 우선
 */
const resolveCamera = async (deviceId) => {
  if (deviceId) {
    const device = await deviceService.getDeviceStatus(deviceId);
    if (!device) throw new AppError(MESSAGES.noCamera, 404);
    if (device.type !== 'camera') throw new AppError(MESSAGES.notCamera, 400);
    return device;
  }
  const cameras = (await deviceService.getDevices('all')).filter(d => d.type === 'camera');
  if (cameras.length === 0) throw new AppError(MESSAGES.noCamera, 404);
  const device = cameras.find(d => d.status === 'online') || cameras[0];
  return { ...device, isOnline: device.status === 'online' };
};

/**
 * 현재 화면 1장 촬영 요청 → 이미지가 도착하면 { captureId, imageUrl, ... } 반환
 * @throws {AppError} 카메라 꺼짐/연결 안 됨/시간 초과/촬영 실패 (message는 사용자용)
 */
const requestCapture = async (deviceId) => {
  const device = await resolveCamera(deviceId);
  if (!device.isOnline) throw new AppError(MESSAGES.cameraOff, 409);

  const last = lastPollAt.get(device.id);
  if (!pollers.has(device.id) && (!last || Date.now() - last > settings.listenerStaleMs)) {
    logger.warn(`[Capture] No capture listener for device ${device.id} (카메라 서비스 구버전이거나 연결 끊김)`);
    throw new AppError(MESSAGES.notListening, 503);
  }

  // 진행 중인 요청이 있으면 합류
  let req = pending.get(device.id);
  if (!req) {
    req = { id: crypto.randomUUID(), dispatched: false };
    req.promise = new Promise((resolve, reject) => { req.resolve = resolve; req.reject = reject; });
    req.timer = setTimeout(() => {
      if (pending.get(device.id) !== req) return;
      pending.delete(device.id);
      logger.warn(`[Capture] Timeout waiting for device ${device.id} (request ${req.id}, dispatched=${req.dispatched})`);
      req.reject(new AppError(MESSAGES.timeout, 504));
    }, settings.captureTimeoutMs);
    pending.set(device.id, req);
    logger.info(`[Capture] Request ${req.id} for device ${device.id}`);

    const poller = pollers.get(device.id);
    if (poller) {
      req.dispatched = true;
      poller.deliver(req.id);
    }
  } else {
    logger.info(`[Capture] Joining in-flight request ${req.id} for device ${device.id}`);
  }

  const captureId = await req.promise;
  const stored = captures.get(captureId);
  return {
    captureId,
    deviceId: device.id,
    deviceName: device.name,
    capturedAt: stored.capturedAt,
    imageUrl: imagePath(device.id, captureId)
  };
};

/**
 * [Pi] 캡처 요청이 생길 때까지 최대 pollHoldMs 대기 → requestId 또는 null
 * @param {Function} onAbort - 연결이 끊기면 호출할 정리 함수를 등록받는 콜백
 */
const waitForRequest = (deviceId, onAbort) => {
  lastPollAt.set(deviceId, Date.now());

  // 아직 Pi에 전달 안 된 요청이 있으면 바로 넘김
  const waiting = pending.get(deviceId);
  if (waiting && !waiting.dispatched) {
    waiting.dispatched = true;
    return Promise.resolve(waiting.id);
  }

  // Pi가 재시작해 이전 폴링이 남아 있으면 비워서 끝냄
  pollers.get(deviceId)?.deliver(null);

  return new Promise((resolve) => {
    const poller = {
      deliver: (requestId) => {
        clearTimeout(timer);
        if (pollers.get(deviceId) === poller) pollers.delete(deviceId);
        lastPollAt.set(deviceId, Date.now());
        resolve(requestId);
      }
    };
    const timer = setTimeout(() => poller.deliver(null), settings.pollHoldMs);
    pollers.set(deviceId, poller);
    // 응답 전에 Pi 연결이 끊기면 폴러를 비움 (이미 응답했으면 아무 영향 없음)
    onAbort?.(() => poller.deliver(null));
  });
};

/**
 * [Pi] 요청을 넘기려던 순간 연결이 끊겼으면 다음 폴링이 다시 가져가도록 되돌림
 */
const undispatch = (deviceId, requestId) => {
  const req = pending.get(deviceId);
  if (req && req.id === requestId) req.dispatched = false;
};

/**
 * [Pi] 촬영 결과 제출
 * @param {{ buffer?: Buffer, mimeType?: string, error?: string }} result
 * @returns {boolean} 대기 중인 요청이 있었으면 true
 */
const completeRequest = (deviceId, requestId, { buffer, mimeType, error }) => {
  const req = pending.get(deviceId);
  if (!req || req.id !== requestId) {
    logger.warn(`[Capture] Result for unknown/expired request ${requestId} (device ${deviceId})`);
    return false;
  }
  pending.delete(deviceId);
  clearTimeout(req.timer);

  if (!buffer || buffer.length === 0) {
    const edgeError = EDGE_ERRORS[error] || EDGE_ERRORS.capture_failed;
    logger.warn(`[Capture] Device ${deviceId} failed request ${requestId}: ${error || 'no image'}`);
    req.reject(new AppError(edgeError.message, edgeError.status));
    return true;
  }

  const captureId = crypto.randomUUID();
  captures.set(captureId, {
    deviceId,
    buffer,
    mimeType: mimeType || 'image/jpeg',
    capturedAt: new Date().toISOString(),
    storedAt: Date.now()
  });
  pruneCaptures();
  logger.info(`[Capture] Stored capture ${captureId} (${Math.round(buffer.length / 1024)} KB) for device ${deviceId}`);
  req.resolve(captureId);
  return true;
};

/**
 * 보관 중인 캡처 이미지 (만료됐거나 다른 기기 것이면 null)
 */
const getCapture = (deviceId, captureId) => {
  pruneCaptures();
  const c = captures.get(captureId);
  return c && c.deviceId === deviceId ? c : null;
};

// 테스트용 초기화
const _reset = () => {
  for (const req of pending.values()) clearTimeout(req.timer);
  for (const p of pollers.values()) p.deliver(null);
  pending.clear();
  pollers.clear();
  lastPollAt.clear();
  captures.clear();
};

module.exports = {
  requestCapture,
  waitForRequest,
  undispatch,
  completeRequest,
  getCapture,
  settings,
  MESSAGES,
  _reset
};
