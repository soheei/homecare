/**
 * 보존 기간 자동 삭제 — 기간이 지난 이벤트만, 설정이 꺼져 있으면 아무것도 지우지 않음
 */

const mockDeleteOlder = jest.fn();
jest.mock('../src/services/event.service', () => ({
  deleteEventsOlderThan: (...args) => mockDeleteOlder(...args)
}));

const retention = require('../src/services/retention.service');

beforeEach(() => mockDeleteOlder.mockReset());

describe('purgeExpired', () => {
  it('days가 0이면 삭제하지 않음', async () => {
    expect(await retention.purgeExpired(0)).toBe(0);
    expect(mockDeleteOlder).not.toHaveBeenCalled();
  });

  it('days일 전 시각을 기준으로 삭제를 요청', async () => {
    mockDeleteOlder.mockResolvedValue(3);
    const before = Date.now();
    expect(await retention.purgeExpired(30)).toBe(3);

    const cutoff = new Date(mockDeleteOlder.mock.calls[0][0]).getTime();
    expect(cutoff).toBeLessThanOrEqual(before - 30 * 86400000 + 1000);
    expect(cutoff).toBeGreaterThan(before - 30 * 86400000 - 5000);
  });

  it('삭제가 실패해도 throw하지 않음', async () => {
    mockDeleteOlder.mockRejectedValue(new Error('db down'));
    expect(await retention.purgeExpired(30)).toBe(0);
  });
});
