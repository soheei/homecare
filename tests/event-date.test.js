/**
 * 이벤트 기간/날짜 처리 테스트 (한국 시간 기준)
 * - 주간 요약이 기간 내 모든 이벤트를 상세까지 돌려주는지
 * - 날짜 조회가 UTC가 아니라 한국 날짜 경계로 잘리는지
 */

// 실제 운영 DB와 같은 형태의 이벤트 (timestamp는 UTC)
const mockRows = [
  { id: 'ev-danger', type: 'danger', description: '낙상 감지 테스트', danger_level: 'danger', timestamp: '2026-09-25T07:00:47.882843+00:00' },
  { id: 'ev-sound', type: 'sound', description: '문 소리 감지 (신뢰도 0.49)', danger_level: 'normal', timestamp: '2026-09-22T07:02:56.786649+00:00' },
  { id: 'ev-door', type: 'visitor', description: '초인종/방문 감지 (신뢰도 0.49)', danger_level: 'normal', timestamp: '2026-09-22T07:02:56.730302+00:00' },
  // 한국 9/28 새벽 5:30 (UTC로는 9/27 20:30)
  { id: 'ev-dawn', type: 'motion', description: '새벽 움직임', danger_level: 'normal', timestamp: '2026-09-27T20:30:00+00:00' },
  // 주간 요약 범위(9/20~) 밖의 날: 일일 요약 위험 알림 기준 확인용
  { id: 'ev-fire', type: 'danger', description: '화재경보', danger_level: 'danger', timestamp: '2026-09-10T03:00:00+00:00' },
  { id: 'ev-scream', type: 'sound', description: '비명 감지', danger_level: 'warning', timestamp: '2026-09-10T04:00:00+00:00' },
  { id: 'ev-bark', type: 'sound', description: '반려동물 울음', danger_level: 'warning', timestamp: '2026-09-10T05:00:00+00:00' }
];

// 날짜 비교를 문자열이 아니라 실제 시각으로 하는 가짜 Supabase
const mockFrom = () => {
  let rows = [...mockRows];
  const q = {
    select: () => q,
    gte: (col, v) => { rows = rows.filter(r => new Date(r[col]) >= new Date(v)); return q; },
    lte: (col, v) => { rows = rows.filter(r => new Date(r[col]) <= new Date(v)); return q; },
    order: (col, { ascending }) => {
      rows.sort((a, b) => (new Date(a[col]) - new Date(b[col])) * (ascending ? 1 : -1));
      return q;
    },
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject)
  };
  return q;
};

jest.mock('../src/config/supabase', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom }
}));

const eventService = require('../src/services/event.service');

describe('주간 요약', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-09-27T08:15:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterAll(() => jest.useRealTimers());

  it('기간 내 모든 이벤트(방문·소리·위험)를 건수와 상세로 반환', async () => {
    const summary = await eventService.getWeeklySummary();

    expect(summary.totalEvents).toBe(3);
    expect(summary.byType).toEqual({ danger: 1, sound: 1, visitor: 1 });
    expect(summary.events.map(e => e.description)).toEqual(
      expect.arrayContaining(['낙상 감지 테스트', '문 소리 감지 (신뢰도 0.49)', '초인종/방문 감지 (신뢰도 0.49)'])
    );
  });

  it('이벤트 시각을 한국 시간으로 제공 (UTC 07:00 → 오후 4:00)', async () => {
    const summary = await eventService.getWeeklySummary();
    const fall = summary.events.find(e => e.description === '낙상 감지 테스트');

    expect(fall.timeKst).toContain('9월 25일');
    expect(fall.timeKst).toContain('오후 4:00');
  });
});

describe('일일 요약의 위험 알림 기준 (홈 "위험 알림" 건수)', () => {
  it('type=danger만 dangerEvents에 넣고, 비명·울음 같은 sound warning은 제외하되 전체 건수/타임라인에는 포함', async () => {
    const summary = await eventService.getDailySummary('2026-09-10');

    expect(summary.dangerEvents.map(e => e.id)).toEqual(['ev-fire']);
    expect(summary.totalEvents).toBe(3);
    expect(summary.timeline.map(t => t.id)).toEqual(expect.arrayContaining(['ev-scream', 'ev-bark']));
  });
});

describe('날짜별 조회는 한국 날짜 기준', () => {
  it('한국 9/28 새벽 이벤트는 9/28에 포함되고 9/27에는 없음', async () => {
    const day28 = await eventService.getEventsByDate('2026-09-28');
    const day27 = await eventService.getEventsByDate('2026-09-27');

    expect(day28.map(e => e.id)).toEqual(['ev-dawn']);
    expect(day27.map(e => e.id)).not.toContain('ev-dawn');
  });
});
