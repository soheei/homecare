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
  },
  {
    name: 'get_event_media',
    description: '이벤트에 저장된 영상/소리/사진을 사용자에게 보여줍니다. "그 소리 들려줘", "낙상 영상 보여줘", "최근 영상 보여줘"처럼 이벤트의 녹화·녹음을 확인하고 싶어할 때 사용합니다. 특정 이벤트면 eventId(다른 이벤트 조회 결과의 id, hasVideo/hasAudio/hasImage가 true인 것)를, 특정 이벤트 없이 "최근 영상/소리"면 eventId 없이 mediaType만 주면 기간 제한 없이 가장 최근 것을 찾고, 사용자가 기간을 말하면("이번 주", "최근 3일") days로 그 기간 안에서만 찾습니다. 재생 플레이어는 앱이 답변에 자동으로 표시합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: '미디어를 보여줄 이벤트 ID (이번 답변에서 부른 이벤트 조회 도구 결과의 id, UUID 형식). 모르면 추측하지 말고 먼저 조회 도구를 호출'
        },
        mediaType: {
          type: 'string',
          description: '사용자가 원한 미디어 종류 (video: 카메라 영상, audio: 마이크 소리). eventId와 함께 주면 그 종류가 없을 때 있는 미디어를 대신 보여주고 notice로 알려줌. eventId 없이 주면 그 종류의 최근 이벤트를 찾음',
          enum: ['video', 'audio']
        },
        days: {
          type: 'number',
          description: 'mediaType으로 찾을 때 최근 며칠 안에서만 찾을지 (사용자가 기간을 말했을 때만. 생략하면 기간 제한 없음)'
        }
      }
    }
  }
];

// 미디어 유무만 알려줌 — DB의 URL은 private 버킷이라 그대로는 열리지 않고, 모델이 옮겨 적지 않게 넘기지 않는다
const mediaFlags = e => ({
  hasImage: Boolean(e.image_url),
  hasAudio: Boolean(e.audio_url),
  hasVideo: Boolean(e.video_url)
});

// DB 행 → 도구 결과: 한국 시간 표시를 붙이고(timestamp는 UTC라 모델이 그대로 읽으면 9시간 틀림) 미디어 URL은 유무로 바꿈
const toToolEvent = ({ image_url, audio_url, video_url, ...e }) => ({
  ...e,
  timeKst: formatKst(e.timestamp),
  ...mediaFlags({ image_url, audio_url, video_url })
});

// 도구 핸들러
const handlers = {
  async get_today_events({ type }) {
    const events = await eventService.getEventsByDate(kstDateString()); // 오늘 = 한국 날짜

    return (type ? events.filter(e => e.type === type) : events).map(toToolEvent);
  },

  async get_events_by_date({ date }) {
    return (await eventService.getEventsByDate(date)).map(toToolEvent);
  },

  async get_visitor_log({ date, days = 7, limit = 10 }) {
    const toVisitor = e => ({
      id: e.id,
      time: e.timestamp,
      timeKst: formatKst(e.timestamp),
      description: e.description,
      ...mediaFlags(e)
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
      .slice(0, 30) // 도구 결과가 입력 토큰으로 쌓이므로 최신 30건까지만 (이벤트는 최신순)
      .map(toToolEvent);
  },

  async get_weekly_summary() {
    return await eventService.getWeeklySummary();
  },

  async get_daily_summary({ date }) {
    const targetDate = date || kstDateString(); // 생략 시 오늘(한국 날짜)
    const summary = await eventService.getDailySummary(targetDate);
    return { ...summary, dangerEvents: (summary.dangerEvents || []).map(toToolEvent) };
  },

  // 결과의 eventId로 claude.service.js가 답변에 재생 플레이어 줄을 붙인다 (URL은 앱이 열 때마다 새로 서명)
  async get_event_media({ eventId, mediaType, days } = {}) {
    let event;
    if (typeof eventId === 'string' && eventId) {
      event = await eventService.getEventById(eventId);
      // 모델이 id를 지어내는 경우가 있음(로그: eventId "1727600340000") → 바로 "영상 없음"이라 답하지 않고 조회 후 재호출하게 안내
      if (!event) {
        return {
          success: false,
          error: '해당 이벤트를 찾을 수 없어요.',
          retry: 'eventId가 실제 이벤트 id가 아닙니다. id를 추측하지 말고 get_danger_events, get_events_by_date, get_weekly_summary 등 조회 도구로 이벤트를 먼저 찾은 뒤, 그 결과의 id로 get_event_media를 다시 호출하세요. 조회해도 해당 이벤트가 없을 때만 사용자에게 없다고 알리세요.'
        };
      }
    } else if (mediaType === 'video' || mediaType === 'audio') {
      const period = Number(days) > 0 ? Number(days) : undefined; // 기간을 말하지 않았으면 제한 없음
      event = await eventService.getLatestEventWithMedia(mediaType, period);
      if (!event) {
        const what = mediaType === 'video' ? '영상이' : '소리가';
        return { success: false, error: period ? `최근 ${period}일 동안 저장된 ${what} 없어요.` : `저장된 ${what} 없어요.` };
      }
    } else {
      return { success: false, error: '어떤 이벤트의 영상/소리인지 알 수 없어요.' };
    }

    const flags = mediaFlags(event);
    if (!flags.hasAudio && !flags.hasVideo && !flags.hasImage) {
      return { success: false, eventId: event.id, error: '이 이벤트에는 저장된 소리나 영상이 없어요.' };
    }

    // 영상을 원했는데 소리로 감지된 이벤트처럼, 요청한 종류는 없고 다른 미디어만 있으면 있는 것을 대신 보여주고 알림
    const missing = (mediaType === 'video' && !flags.hasVideo && '영상')
      || (mediaType === 'audio' && !flags.hasAudio && '소리')
      || null;
    const available = flags.hasVideo ? '영상' : flags.hasAudio ? '소리' : '사진';
    const TOPIC = { 영상: '영상은', 소리: '소리는' };
    const OBJECT = { 영상: '영상을', 소리: '소리를', 사진: '사진을' };
    const notice = missing ? `이 이벤트는 ${TOPIC[missing]} 없고 ${available}만 있어요.` : null;

    return {
      success: true,
      eventId: event.id,
      type: event.type,
      description: event.description,
      timeKst: formatKst(event.timestamp),
      ...flags,
      ...(notice && { notice }),
      message: notice
        ? `요청한 ${missing} 대신 ${OBJECT[available]} 앱이 답변 위에 보여줍니다. 불러올 수 없다고 하지 말고 notice 내용을 그대로 안내하세요. 링크나 URL은 쓰지 마세요.`
        : '재생 플레이어는 앱이 답변 위에 자동으로 보여주므로 링크나 URL은 쓰지 말고, 어떤 이벤트인지 짧게 안내만 하세요.'
    };
  }
};

module.exports = {
  definitions,
  handlers
};
