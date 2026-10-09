/**
 * 거실/현관 모드 + 경비 모드 테스트
 * - 하트비트 응답에 mode/securityArmed가 실려 엣지로 전달됨
 * - PUT /api/devices/mode (사용자 인증, 값 검증, 기기 없음 404)
 * - notifyEvent: 침입 의심 이벤트는 경비가 켜져 있을 때만, 알림 토글과 무관하게 발송
 */

const mockModeState = { mode: 'living', securityArmed: false };
const mockSetUserMode = jest.fn();
jest.mock('../src/services/device.service', () => ({
  VALID_MODES: ['living', 'entrance'],
  updateHeartbeat: jest.fn(async () => true),
  getDeviceMode: jest.fn(async () => ({ ...mockModeState })),
  setUserMode: (...args) => mockSetUserMode(...args),
  getDevices: jest.fn(async () => []),
  getDeviceStatus: jest.fn(async () => null)
}));

// notifyEvent 테스트용: 테이블별 고정 결과를 돌려주는 체이닝 mock
const mockTables = {};
jest.mock('../src/config/supabase', () => {
  const chain = (table) => {
    const result = () => mockTables[table] ?? { data: null, error: null };
    const q = {
      select: () => q,
      eq: () => q,
      delete: () => q,
      maybeSingle: async () => result(),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
    };
    return q;
  };
  const client = { from: (table) => chain(table) };
  return { supabase: client, supabaseAdmin: client };
});

const mockSend = jest.fn(async () => undefined);
jest.mock('../src/services/push.service', () => ({
  isConfigured: () => true,
  sendToSubscription: (...args) => mockSend(...args)
}));

jest.mock('../src/middlewares/auth.middleware', () => {
  const pass = (req, res, next) => next();
  return {
    authenticateUser: (req, res, next) => {
      const id = req.headers['x-test-user'];
      if (!id) return res.status(401).json({ success: false, error: 'Authorization token required' });
      req.user = { id };
      next();
    },
    authenticateDevice: (req, res, next) => {
      req.device = { id: req.headers['x-device-id'] };
      next();
    },
    authenticateMcp: pass,
    requireAdmin: pass
  };
});

const request = require('supertest');
const app = require('../src/app');
const notificationService = require('../src/services/notification.service');

beforeEach(() => {
  mockModeState.mode = 'living';
  mockModeState.securityArmed = false;
  mockSetUserMode.mockReset().mockResolvedValue(2);
  mockSend.mockClear();
  for (const k of Object.keys(mockTables)) delete mockTables[k];
});

describe('POST /api/devices/:id/heartbeat', () => {
  it('응답에 현재 모드와 경비 상태를 실어 보냄', async () => {
    mockModeState.mode = 'entrance';
    mockModeState.securityArmed = true;

    const res = await request(app).post('/api/devices/cam-1/heartbeat').set('X-Device-Id', 'cam-1').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, mode: 'entrance', securityArmed: true });
  });
});

describe('GET /api/devices/:id/security-mode (vision GuardModeClient)', () => {
  const get = (id, deviceId = id) => request(app).get(`/api/devices/${id}/security-mode`).set('X-Device-Id', deviceId);

  it('경비 상태를 data.armed_mode로 돌려줌', async () => {
    mockModeState.securityArmed = true;
    const res = await get('cam-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { armed_mode: true } });

    mockModeState.securityArmed = false;
    expect((await get('cam-1')).body.data.armed_mode).toBe(false);
  });

  it('다른 기기 id로 조회하면 403', async () => {
    expect((await get('cam-1', 'cam-2')).status).toBe(403);
  });
});

describe('PUT /api/devices/mode', () => {
  const put = (body, user = 'user-A') => {
    const r = request(app).put('/api/devices/mode');
    return (user ? r.set('X-Test-User', user) : r).send(body);
  };

  it('토큰 없으면 401', async () => {
    expect((await put({ mode: 'entrance' }, null)).status).toBe(401);
  });

  it('모드와 경비를 사용자 기기에 저장', async () => {
    const res = await put({ mode: 'entrance', securityArmed: true });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ mode: 'entrance', securityArmed: true });
    expect(mockSetUserMode).toHaveBeenCalledWith('user-A', { mode: 'entrance', securityArmed: true });
  });

  it('경비만 바꿔도 모드는 건드리지 않음', async () => {
    await put({ securityArmed: false });
    expect(mockSetUserMode).toHaveBeenCalledWith('user-A', { mode: undefined, securityArmed: false });
  });

  it('잘못된 값은 400', async () => {
    expect((await put({ mode: 'kitchen' })).status).toBe(400);
    expect((await put({ securityArmed: 'yes' })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(mockSetUserMode).not.toHaveBeenCalled();
  });

  it('바꿀 카메라/마이크가 없으면 404', async () => {
    mockSetUserMode.mockResolvedValue(0);
    expect((await put({ mode: 'living' })).status).toBe(404);
  });
});

describe('notifyEvent — 경비 모드 침입 의심 푸시', () => {
  const event = (category) => ({
    id: 'evt-1',
    device_id: 'cam-1',
    type: 'danger',
    description: '방 안에서 사람이 감지되었습니다',
    danger_level: 'danger',
    metadata: { category_id: category }
  });

  const setup = (prefs) => {
    mockTables.devices = { data: { user_id: 'user-A' }, error: null };
    mockTables.notification_preferences = { data: prefs, error: null };
    mockTables.push_subscriptions = { data: [{ id: 's1', endpoint: 'e', p256dh: 'p', auth: 'a' }], error: null };
  };

  it('경비 ON이면 위험 알림 토글이 꺼져 있어도 "침입 의심"으로 발송', async () => {
    setup({ danger: false, visitor: false, motion: false, sound: false, briefing: false });
    mockModeState.securityArmed = true;

    await notificationService.notifyEvent(event('intrusion_suspect'));

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1].title).toContain('침입 의심');
  });

  it('경비 OFF이면 침입 의심 이벤트는 발송 안 함', async () => {
    setup({ danger: true, visitor: true, motion: true, sound: true, briefing: true });
    mockModeState.securityArmed = false;

    await notificationService.notifyEvent(event('door_left_open'));

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('일반 위험 이벤트는 기존처럼 알림 토글을 따름 (경비 상태와 무관)', async () => {
    setup({ danger: false, visitor: true, motion: false, sound: true, briefing: true });
    mockModeState.securityArmed = true;

    await notificationService.notifyEvent(event('fall_suspect'));
    expect(mockSend).not.toHaveBeenCalled();

    setup({ danger: true, visitor: true, motion: false, sound: true, briefing: true });
    await notificationService.notifyEvent(event('fall_suspect'));
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1].title).not.toContain('침입 의심');
  });
});
