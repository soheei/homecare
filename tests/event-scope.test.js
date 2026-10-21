/**
 * 이벤트 사용자 범위 테스트 — 로그인한 사용자는 자기 기기의 이벤트만 보고 지울 수 있다
 * (userId를 주지 않는 서버 내부 호출은 기존처럼 제한 없음)
 */

const mockRows = [
  { id: 'ev-a1', type: 'visitor', description: 'A집 방문', device_id: 'dev-A', timestamp: '2026-09-25T07:00:00+00:00' },
  { id: 'ev-a2', type: 'sound', description: 'A집 소리', device_id: 'dev-A', timestamp: '2026-09-25T08:00:00+00:00' },
  { id: 'ev-b1', type: 'visitor', description: 'B집 방문', device_id: 'dev-B', timestamp: '2026-09-25T09:00:00+00:00' }
];

// .in / .eq / .delete 까지 흉내 내는 가짜 Supabase (필터를 적용한 뒤 await 하면 결과를 돌려줌)
let mockStore;
const mockFrom = () => {
  let rows = [...mockStore];
  let deleting = false;
  const q = {
    select: () => q,
    order: () => q,
    range: () => q,
    limit: (n) => { rows = rows.slice(0, n); return q; },
    gte: () => q,
    lte: () => q,
    not: () => q,
    lt: (col, v) => { rows = rows.filter(r => new Date(r[col]) < new Date(v)); return q; },
    delete: () => { deleting = true; return q; },
    eq: (col, v) => { rows = rows.filter(r => r[col] === v); return q; },
    in: (col, vs) => { rows = rows.filter(r => vs.includes(r[col])); return q; },
    single: () => Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }),
    then: (resolve, reject) => {
      if (deleting) mockStore = mockStore.filter(r => !rows.includes(r));
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
    }
  };
  return q;
};

jest.mock('../src/config/supabase', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom }
}));

jest.mock('../src/services/device.service', () => ({
  getDevices: jest.fn(async (userId) => ({
    'user-A': [{ id: 'dev-A' }],
    'user-B': [{ id: 'dev-B' }],
    'user-none': []
  }[userId] || []))
}));

jest.mock('../src/services/storage.service', () => ({
  removeEventMedia: jest.fn().mockResolvedValue(undefined)
}));

const eventService = require('../src/services/event.service');

beforeEach(() => {
  mockStore = [...mockRows];
});

describe('이벤트 사용자 범위', () => {
  it('목록은 본인 기기의 이벤트만', async () => {
    const result = await eventService.getEvents({ userId: 'user-A' });
    expect(result.events.map(e => e.id)).toEqual(['ev-a1', 'ev-a2']);
  });

  it('기기가 없는 사용자는 아무것도 못 봄', async () => {
    const result = await eventService.getEvents({ userId: 'user-none' });
    expect(result.events).toEqual([]);
  });

  it('userId 없이(서버 내부) 호출하면 제한 없음', async () => {
    const result = await eventService.getEvents({});
    expect(result.events).toHaveLength(3);
  });

  it('남의 이벤트 상세는 없는 이벤트와 똑같이 null', async () => {
    expect(await eventService.getEventById('ev-b1', 'user-A')).toBeNull();
    expect((await eventService.getEventById('ev-a1', 'user-A')).id).toBe('ev-a1');
  });

  it('남의 이벤트는 삭제되지 않음 (0건), 본인 것은 삭제됨', async () => {
    expect(await eventService.deleteEvent('ev-b1', 'user-A')).toBe(0);
    expect(mockStore.map(e => e.id)).toContain('ev-b1');

    expect(await eventService.deleteEvent('ev-a1', 'user-A')).toBe(1);
    expect(mockStore.map(e => e.id)).not.toContain('ev-a1');
  });

  it('주간 요약도 본인 기기만, 기기가 없으면 빈 요약', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-27T08:15:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    try {
      expect((await eventService.getWeeklySummary('user-A')).totalEvents).toBe(2);
      expect((await eventService.getWeeklySummary('user-none')).totalEvents).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('보존 기간 삭제', () => {
  it('기준 시각보다 오래된 이벤트만 삭제 (여러 묶음에 걸쳐서도)', async () => {
    mockStore = [
      ...mockRows, // 2026-09-25
      { id: 'ev-old1', type: 'sound', device_id: 'dev-A', timestamp: '2026-08-01T00:00:00+00:00' },
      { id: 'ev-old2', type: 'sound', device_id: 'dev-B', timestamp: '2026-08-02T00:00:00+00:00' },
      { id: 'ev-old3', type: 'sound', device_id: 'dev-B', timestamp: '2026-08-03T00:00:00+00:00' }
    ];
    const deleted = await eventService.deleteEventsOlderThan('2026-09-01T00:00:00Z', 2);
    expect(deleted).toBe(3);
    expect(mockStore.map(e => e.id)).toEqual(['ev-a1', 'ev-a2', 'ev-b1']);
  });
});

