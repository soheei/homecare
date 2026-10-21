/**
 * 엣지 기기 인증 테스트 — 시크릿이 맞아도 등록된 기기 id여야 통과
 */

process.env.EDGE_DEVICE_SECRET = 'test-edge-secret';

const mockGetDeviceStatus = jest.fn();
jest.mock('../src/services/device.service', () => ({
  getDeviceStatus: (...args) => mockGetDeviceStatus(...args)
}));

jest.mock('../src/config/supabase', () => ({
  supabase: {},
  supabaseAdmin: {}
}));

const { authenticateDevice } = require('../src/middlewares/auth.middleware');

const run = async (headers) => {
  const req = { headers };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const next = jest.fn();
  await authenticateDevice(req, res, next);
  return { req, res, next };
};

beforeEach(() => mockGetDeviceStatus.mockReset());

describe('authenticateDevice', () => {
  it('시크릿이 맞고 등록된 기기면 통과', async () => {
    mockGetDeviceStatus.mockResolvedValue({ id: 'dev-1' });
    const { req, next } = await run({ 'x-device-id': 'dev-1', 'x-device-secret': 'test-edge-secret' });
    expect(next).toHaveBeenCalled();
    expect(req.device).toEqual({ id: 'dev-1' });
  });

  it('시크릿이 맞아도 등록되지 않은 기기 id면 403', async () => {
    mockGetDeviceStatus.mockResolvedValue(null);
    const { res, next } = await run({ 'x-device-id': 'made-up-id', 'x-device-secret': 'test-edge-secret' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('시크릿이 틀리면 기기 조회 없이 403', async () => {
    const { res, next } = await run({ 'x-device-id': 'dev-1', 'x-device-secret': 'wrong' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(mockGetDeviceStatus).not.toHaveBeenCalled();
  });

  it('등록 확인된 기기는 잠깐 기억해 DB를 다시 조회하지 않음', async () => {
    mockGetDeviceStatus.mockResolvedValue({ id: 'dev-cache' });
    await run({ 'x-device-id': 'dev-cache', 'x-device-secret': 'test-edge-secret' });
    await run({ 'x-device-id': 'dev-cache', 'x-device-secret': 'test-edge-secret' });
    expect(mockGetDeviceStatus).toHaveBeenCalledTimes(1);
  });
});
