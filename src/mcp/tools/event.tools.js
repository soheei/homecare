/**
 * MCP Tools - Event Related
 * 이벤트 조회 및 관리 도구
 */

const eventService = require('../../services/event.service');

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
    description: '방문자 기록을 조회합니다. 택배 기사, 가족, 낯선 사람 등 집에 방문한 사람들의 기록입니다.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '조회할 날짜 (YYYY-MM-DD 형식, 생략시 오늘)'
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

// 도구 핸들러
const handlers = {
  async get_today_events({ type }) {
    const today = new Date().toISOString().split('T')[0];
    const events = await eventService.getEventsByDate(today);
    
    if (type) {
      return events.filter(e => e.type === type);
    }
    return events;
  },

  async get_events_by_date({ date }) {
    return await eventService.getEventsByDate(date);
  },

  async get_visitor_log({ date, limit = 10 }) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const events = await eventService.getEventsByDate(targetDate);
    
    return events
      .filter(e => e.type === 'visitor')
      .slice(0, limit)
      .map(e => ({
        time: e.timestamp,
        description: e.description,
        imageUrl: e.imageUrl
      }));
  },

  async get_danger_events({ days = 7 }) {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    
    const result = await eventService.getEvents({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      limit: 100
    });

    return result.events.filter(e => 
      e.dangerLevel === 'danger' || e.dangerLevel === 'warning'
    );
  },

  async get_daily_summary({ date }) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    return await eventService.getDailySummary(targetDate);
  }
};

module.exports = {
  definitions,
  handlers
};
