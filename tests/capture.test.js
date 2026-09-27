/**
 * 현재 카메라 화면 캡처 테스트
 * 사용자 요청(POST /api/devices/:id/capture) → Pi 롱폴링(GET .../capture-requests/next) → Pi 업로드 → 이미지 조회
 */

const mockDevices = {};
jest.mock('../src/services/device.service', () => ({
  getDeviceStatus: jest.fn(async (id) => {
    const d = mockDevices[id];
    return d ? { ...d, isOnline: d.status === 'online' } : null;
  }),
  getDevices: jest.fn(async () => Object.values(mockDevices))
}));

// DB 없음 → 대화는 임시 ID로 (claude.service 테스트용)
jest.mock('../src/config/supabase', () => ({
  supabase: { from: () => { throw new Error('no db'); } },
  supabaseAdmin: { from: () => { throw new Error('no db'); } }
}));

// 인증: 사용자는 X-Test-User, 기기는 X-Device-Id 헤더로 통과
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

const mockCallTool = jest.fn();
jest.mock('../src/services/mcp.service', () => ({
  withSession: (fn) => fn({ listTools: async () => [], callTool: (...args) => mockCallTool(...args) })
}));

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockCreate }
})));

const request = require('supertest');
const app = require('../src/app');
const captureService = require('../src/services/capture.service');
const cameraTools = require('../src/mcp/tools/camera.tools');
const claudeService = require('../src/services/claude.service');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const defaults = { ...captureService.settings };

const poll = (deviceId = 'cam-1') =>
  request(app).get(`/api/devices/${deviceId}/capture-requests/next`).set('X-Device-Id', deviceId);

const capture = (deviceId = 'cam-1', user = 'user-A') =>
  request(app).post(`/api/devices/${deviceId}/capture`).set('X-Test-User', user);

const upload = (requestId, deviceId = 'cam-1') =>
  request(app)
    .post(`/api/devices/${deviceId}/capture-requests/${requestId}`)
    .set('X-Device-Id', deviceId)
    .attach('image', JPEG, { filename: 'frame.jpg', contentType: 'image/jpeg' });

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  captureService._reset();
  Object.assign(captureService.settings, defaults);
  for (const k of Object.keys(mockDevices)) delete mockDevices[k];
  mockDevices['cam-1'] = { id: 'cam-1', name: 'Camera Module V3', type: 'camera', status: 'online', user_id: 'user-A' };
  mockDevices['mic-1'] = { id: 'mic-1', name: 'ReSpeaker', type: 'microphone', status: 'online', user_id: 'user-A' };
});

afterAll(() => captureService._reset());

describe('POST /api/devices/:id/capture', () => {
  it('Pi가 촬영해 올린 이미지를 반환하고, 소유자만 이미지를 볼 수 있음', async () => {
    const pollReq = poll();              // Pi가 먼저 대기
    const pollDone = pollReq.then((r) => r);
    await tick();
    const userReq = capture().then((r) => r);

    const pollRes = await pollDone;
    expect(pollRes.status).toBe(200);
    const { requestId } = pollRes.body.data;
    expect(requestId).toBeTruthy();

    const up = await upload(requestId);
    expect(up.status).toBe(200);

    const res = await userReq;
    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toMatch(/^\/api\/devices\/cam-1\/captures\/[\w-]+$/);

    const img = await request(app).get(res.body.data.imageUrl).set('X-Test-User', 'user-A');
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(img.body, JPEG)).toBe(0);

    const other = await request(app).get(res.body.data.imageUrl).set('X-Test-User', 'user-B');
    expect(other.status).toBe(404);
  });

  it('카메라가 꺼져 있으면(하트비트 끊김) 바로 409 + 안내 문구', async () => {
    mockDevices['cam-1'].status = 'offline';
    const res = await capture();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('카메라가 꺼져 있어 현재 화면을 가져올 수 없습니다.');
  });

  it('카메라는 켜져 있지만 Pi 캡처 대기(롱폴링)가 없으면 503', async () => {
    const res = await capture();
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('카메라 서비스');
  });

  it('남의 기기면 404, 카메라가 아닌 기기면 400', async () => {
    expect((await capture('cam-1', 'user-B')).status).toBe(404);
    expect((await capture('mic-1')).status).toBe(400);
  });

  it('Pi가 요청이 생기기 전에 폴링하면 대기하다가 요청을 받음 / 대기 시간이 지나면 null', async () => {
    captureService.settings.pollHoldMs = 50;
    const res = await poll();
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('동시에 여러 번 요청해도 촬영은 1번, 모두 같은 사진을 받음', async () => {
    const pollDone = poll().then((r) => r);
    await tick();
    const a = capture().then((r) => r);
    const b = capture().then((r) => r);

    const { requestId } = (await pollDone).body.data;
    await tick();
    await upload(requestId);

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(ra.body.data.captureId).toBe(rb.body.data.captureId);

    // 두 번째 폴링엔 남은 요청이 없음
    captureService.settings.pollHoldMs = 50;
    expect((await poll()).body.data).toBeNull();
  });

  it('Pi가 카메라 장치를 못 찾았다고 보고하면 503 + 안내 문구', async () => {
    const pollDone = poll().then((r) => r);
    await tick();
    const userReq = capture().then((r) => r);
    const { requestId } = (await pollDone).body.data;

    await request(app)
      .post(`/api/devices/cam-1/capture-requests/${requestId}`)
      .set('X-Device-Id', 'cam-1')
      .send({ error: 'camera_not_detected' });

    const res = await userReq;
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('카메라 장치를 찾을 수 없어요. 카메라 연결 상태를 확인해주세요.');
  });

  it('Pi가 시간 안에 응답하지 않으면 504', async () => {
    captureService.settings.captureTimeoutMs = 150;
    const pollDone = poll().then((r) => r);
    await tick();
    const res = await capture();
    await pollDone;
    expect(res.status).toBe(504);
    expect(res.body.error).toContain('응답이 늦어');
  });

  it('다른 기기 id로 폴링하면 403, 만료된 요청에 업로드하면 410', async () => {
    const mismatch = await request(app).get('/api/devices/cam-1/capture-requests/next').set('X-Device-Id', 'mic-1');
    expect(mismatch.status).toBe(403);
    expect((await upload('no-such-request')).status).toBe(410);
  });
});

describe('채팅 — request_capture 도구', () => {
  it('카메라가 꺼져 있으면 success:false + 사용자용 문구', async () => {
    mockDevices['cam-1'].status = 'offline';
    const result = await cameraTools.handlers.request_capture({});
    expect(result).toEqual({ success: false, error: '카메라가 꺼져 있어 현재 화면을 가져올 수 없습니다.' });
  });

  it('deviceId 없이 호출하면 켜진 카메라로 실제 촬영', async () => {
    const pollDone = poll().then((r) => r);
    await tick();
    const resultP = cameraTools.handlers.request_capture({});
    const { requestId } = (await pollDone).body.data;
    await upload(requestId);

    const result = await resultP;
    expect(result.success).toBe(true);
    expect(result.deviceId).toBe('cam-1');
    expect(result.imageUrl).toMatch(/^\/api\/devices\/cam-1\/captures\//);
  });

  it('도구가 촬영한 이미지를 서버가 답변 맨 위에 이미지 줄로 붙임 (모델 텍스트와 별개)', async () => {
    mockCallTool.mockResolvedValue({
      content: JSON.stringify({ success: true, imageUrl: '/api/devices/cam-1/captures/abc-123' }),
      isError: false
    });
    mockCreate
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'request_capture', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: '현재 카메라 화면이에요.' }], usage: {} });

    const res = await claudeService.chat({ message: '현재 화면 보여줘', userId: 'user-A' });
    expect(res.content).toBe('![현재 카메라 화면](/api/devices/cam-1/captures/abc-123)\n\n현재 카메라 화면이에요.');
  });

  it('촬영 실패 결과면 이미지 줄을 붙이지 않음', async () => {
    mockCallTool.mockResolvedValue({ content: JSON.stringify({ success: false, error: '카메라가 꺼져 있어요' }), isError: false });
    mockCreate
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'request_capture', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: '카메라가 꺼져 있어요.' }], usage: {} });

    const res = await claudeService.chat({ message: '현재 화면 보여줘', userId: 'user-A' });
    expect(res.content).toBe('카메라가 꺼져 있어요.');
  });
});
