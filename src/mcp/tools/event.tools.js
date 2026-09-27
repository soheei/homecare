/**
 * MCP Tools - Event Related
 * 이벤트 조회 및 관리 도구
 */

const eventService = require('../../services/event.service');
const { kstDateString, formatKst } = require('../../utils/date.utils');

// 도구 정의
const definitions = [
  {
    name: 'get_today_events',
    description: '오늘 발생한 모든 이벤트를 조회합니다. 방문자, 움직임 감지, 소리 감지 등 모든 이벤트가 포함됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '이벤트 유형 필터 (visitor, motion, sound, danger)',
          enum: ['visitor', 'motion', 'sound', 'danger']
        }
      }
    }
  },
  {
    name: 'get_events_by_date',
    description: '특정 날짜의 이벤트를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '조회할 날짜 (YYYY-MM-DD 형식)',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$'
        }
      },
      required: ['date']
    }
  },
  {
    name: 'get_visitor_log',
    description: '방문자 기록을 조회합니다. 초인종, 택배 기사, 가족, 낯선 사람 등 집에 방문한 기록입니다. 날짜를 생략하면 최근 며칠(기본 7일)의 방문을 최신순으로 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '특정 날짜만 조회할 때 (YYYY-MM-DD 형식). 생략하면 최근 days일'
        },
        days: {
          type: 'number',
          description: '날짜 생략 시 조회할 기간 (일 단위, 기본 7일)',
          default: 7
        },
        limit: {
          type: 'number',
          description: '조회할 최대 개수',
          default: 10
        }
      }
    }
  },
  {
    name: 'get_danger_events',
    description: '위험 상황 이벤트를 조회합니다. 낙상, 비명, 이상 행동 등 위험 신호가 감지된 이벤트입니다.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: '조회할 기간 (일 단위, 기본 7일)',
          default: 7
        }
      }
    }
  },
  {
    name: 'get_weekly_summary',
    description: '이번 주(최근 7일) 이벤트 요약을 제공합니다. 전체 건수(totalEvents), 유형별 건수(byType), 날짜별 건수(dailySummaries)와 기간 내 모든 이벤트 목록(events, 한국 시간 timeKst 포함)이 들어 있습니다. "이번 주", "최근 며칠", "요즘" 같은 기간 질문에 사용하세요.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_daily_summary',
    description: '특정 날짜의 이벤트 요약을 제공합니다. 총 이벤트 수, 유형별 분류, 주요 이벤트 등이 포함됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '요약할 날짜 (YYYY-MM-DD 형식, 생략시 오늘)'
        }
      }
    }
  }
];

// DB 행에 한국 시간 표시를 붙임 (timestamp는 UTC라 모델이 그대로 읽으면 9시간 틀림)
const withKstTime = e => ({ ...e, timeKst: formatKst(e.timestamp) });

// 도구 핸들러
const handlers = {
  async get_today_events({ type }) {
    const events = await eventService.getEventsByDate(kstDateString()); // 오늘 = 한국 날짜

    return (type ? events.filter(e => e.type === type) : events).map(withKstTime);
  },

  async get_events_by_date({ date }) {
    return (await eventService.getEventsByDate(date)).map(withKstTime);
  },

  async get_visitor_log({ date, days = 7, limit = 10 }) {
    const toVisitor = e => ({
      time: e.timestamp,
      timeKst: formatKst(e.timestamp),
      description: e.description,
      imageUrl: e.image_url // DB 컬럼은 snake_case
    });

    // 특정 날짜 지정 시 그날만
    if (date) {
      const events = await eventService.getEventsByDate(date);
      return events.filter(e => e.type === 'visitor').slice(0, limit).map(toVisitor);
    }

    // 날짜 생략 시 최근 N일 (기존엔 "오늘"만 조회해서 며칠 전 방문을 "기록 없음"으로 답했음)
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const result = await eventService.getEvents({
      type: 'visitor',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      limit
    });
    return result.events.map(toVisitor);
  },

  async get_danger_events({ days = 7 }) {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    
    const result = await eventService.getEvents({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      limit: 100
    });

    // DB 컬럼은 snake_case(danger_level) — camelCase로 읽으면 항상 빈 결과가 됨
    return result.events
      .filter(e => e.danger_level === 'danger' || e.danger_level === 'warning')
      .map(withKstTime);
  },

  async get_weekly_summary() {
    return await eventService.getWeeklySummary();
  },

  async get_daily_summary({ date }) {
    const targetDate = date || kstDateString(); // 생략 시 오늘(한국 날짜)
    return await eventService.getDailySummary(targetDate);
  }
};

module.exports = {
  definitions,
  handlers
};
