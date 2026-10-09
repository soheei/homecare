/**
 * getDeviceMode — DB 조회 실패(null)와 실제 설정(경비 OFF 등)을 구분
 */

const mockResult = { value: { data: null, error: null } };
jest.mock('../src/config/supabase', () => {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => {
      if (mockResult.value instanceof Error) throw mockResult.value;
      return mockResult.value;
    }
  };
  const client = { from: () => q };
  return { supabase: client, supabaseAdmin: client };
});

const deviceService = require('../src/services/device.service');

describe('getDeviceMode', () => {
  it('DB 오류면 기본값(경비 OFF)이 아니라 null', async () => {
    mockResult.value = { data: null, error: new Error('db down') };
    expect(await deviceService.getDeviceMode('cam-1')).toBeNull();
  });

  it('예외가 던져져도 null', async () => {
    mockResult.value = new Error('network');
    expect(await deviceService.getDeviceMode('cam-1')).toBeNull();
  });

  it('실제 경비 OFF 설정은 그대로 돌려줌', async () => {
    mockResult.value = { data: { mode: 'entrance', security_armed: false }, error: null };
    expect(await deviceService.getDeviceMode('cam-1')).toEqual({ mode: 'entrance', securityArmed: false });
  });

  it('경비 ON 설정', async () => {
    mockResult.value = { data: { mode: 'living', security_armed: true }, error: null };
    expect(await deviceService.getDeviceMode('cam-1')).toEqual({ mode: 'living', securityArmed: true });
  });

  it('기기 행이 없으면 기존 기본값', async () => {
    mockResult.value = { data: null, error: null };
    expect(await deviceService.getDeviceMode('cam-1')).toEqual({ mode: 'living', securityArmed: false });
  });
});
