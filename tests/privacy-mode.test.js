/**
 * 사생활 모드 + 열람 감사 로그
 */

let mockDeviceResult;
const mockInsert = jest.fn();
const mockFrom = (table) => {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve(mockDeviceResult),
    insert: (rows) => Promise.resolve(mockInsert(table, rows))
  };
  return q;
};

jest.mock('../src/config/supabase', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom }
}));

const deviceService = require('../src/services/device.service');
const accessLogService = require('../src/services/accessLog.service');

describe('isPrivacyMode', () => {
  it('privacy_mode가 true면 켜짐', async () => {
    mockDeviceResult = { data: { privacy_mode: true }, error: null };
    expect(await deviceService.isPrivacyMode('dev-1')).toBe(true);
  });

  it('false이거나 기기 행이 없으면 꺼짐', async () => {
    mockDeviceResult = { data: { privacy_mode: false }, error: null };
    expect(await deviceService.isPrivacyMode('dev-1')).toBe(false);
    mockDeviceResult = { data: null, error: null };
    expect(await deviceService.isPrivacyMode('dev-1')).toBe(false);
  });

  it('컬럼이 아직 없는 DB(ALTER 전)면 꺼짐 — 배포가 먼저여도 기존 동작 유지', async () => {
    mockDeviceResult = { data: null, error: { code: '42703', message: 'column does not exist' } };
    expect(await deviceService.isPrivacyMode('dev-1')).toBe(false);
  });

  it('그 밖의 조회 오류는 켜짐으로 봄 (확인 못 하면 영상을 저장하지 않음)', async () => {
    mockDeviceResult = { data: null, error: { code: '08006', message: 'connection failure' } };
    expect(await deviceService.isPrivacyMode('dev-1')).toBe(true);
  });
});

describe('accessLogService.record', () => {
  beforeEach(() => mockInsert.mockReset().mockReturnValue({ error: null }));

  it('사용자·행동·대상만 저장 (내용 없음)', async () => {
    expect(await accessLogService.record({ userId: 'user-A', action: 'view_event', resourceId: 'ev-1', source: 'chat' })).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith('access_logs', [
      { user_id: 'user-A', action: 'view_event', resource_id: 'ev-1', source: 'chat' }
    ]);
  });

  it('알 수 없는 행동이나 사용자 없음은 기록하지 않음', async () => {
    expect(await accessLogService.record({ userId: 'user-A', action: 'hack' })).toBe(false);
    expect(await accessLogService.record({ action: 'capture' })).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('기록에 실패해도 throw하지 않음 (테이블 미생성 등)', async () => {
    mockInsert.mockReturnValue({ error: { message: 'relation "access_logs" does not exist' } });
    await expect(accessLogService.record({ userId: 'user-A', action: 'capture' })).resolves.toBe(false);
  });
});
