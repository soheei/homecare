/**
 * Event Service - 이벤트 데이터 관리
 *
 * [버그 수정] 모든 읽기 쿼리를 supabaseAdmin으로 변경
 * 이유: 서버 내부(MCP) 호출은 RLS 적용 대상이 아님
 *       anon 키는 auth.uid() 없이 RLS에 막혀 빈 배열 반환
 *       service_role 키는 RLS를 우회해 모든 데이터 접근 가능
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const storageService = require('./storage.service');
const deviceService = require('./device.service');
const { kstDateString, kstDayRange, formatKst } = require('../utils/date.utils');

// 요약 목록용 미디어 유무 (채팅 AI가 get_event_media로 재생할 이벤트를 고를 수 있게)
const mediaFlags = event => ({
  hasImage: Boolean(event.image_url),
  hasAudio: Boolean(event.audio_url),
  hasVideo: Boolean(event.video_url)
});

/**
 * 사용자 범위: userId가 있으면 그 사용자의 기기 id 목록, 없으면 null(제한 없음 — 서버 내부·stdio 전용)
 * 기기 조회가 실패하면 빈 목록이 되어 아무것도 보이지 않는다(실패 시 닫힘).
 * 기기 없이 저장된 이벤트(device_id NULL)는 주인을 알 수 없어 사용자에게는 보이지 않는다.
 */
const deviceIdsOf = async (userId) => {
  if (!userId) return null;
  return (await deviceService.getDevices(userId)).map(d => d.id);
};

const getEvents = async (filters = {}) => {
  try {
    const { type, startDate, endDate, limit = 20, offset = 0, userId } = filters;

    const deviceIds = await deviceIdsOf(userId);
    if (deviceIds && deviceIds.length === 0) return { events: [], total: 0, limit, offset };

    let query = supabaseAdmin
      .from('events')
      .select('*', { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (deviceIds) query = query.in('device_id', deviceIds);

    if (type) query = query.eq('type', type);
    if (startDate) query = query.gte('timestamp', startDate);
    if (endDate) query = query.lte('timestamp', endDate);

    const { data, error, count } = await query;
    if (error) throw error;

    return { events: data || [], total: count || 0, limit, offset };

  } catch (error) {
    logger.error('[EventService] Error fetching events:', error);
    return { events: [], total: 0, limit: filters.limit || 20, offset: filters.offset || 0 };
  }
};

const getEventById = async (id, userId) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    // 남의 이벤트는 "없음"과 똑같이 응답 (존재 여부도 알려주지 않음)
    const deviceIds = await deviceIdsOf(userId);
    if (deviceIds && !deviceIds.includes(data.device_id)) return null;
    return data;

  } catch (error) {
    logger.error('[EventService] Error fetching event:', error);
    return null;
  }
};

const getEventsByDate = async (date, userId) => {
  try {
    // 날짜는 한국 기준 하루 (UTC 자정으로 자르면 KST 00~09시 이벤트가 전날로 잡힘)
    const { start, end } = kstDayRange(date);

    const deviceIds = await deviceIdsOf(userId);
    if (deviceIds && deviceIds.length === 0) return [];

    let query = supabaseAdmin
      .from('events')
      .select('*')
      .gte('timestamp', start)
      .lte('timestamp', end)
      .order('timestamp', { ascending: true });
    if (deviceIds) query = query.in('device_id', deviceIds);

    const { data, error } = await query;

    if (error) throw error;
    return data || [];

  } catch (error) {
    logger.error('[EventService] Error fetching events by date:', error);
    return [];
  }
};

const createEvent = async (eventData) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('events')
      .insert([eventData])
      .select()
      .single();

    if (error) throw error;

    logger.info(`[EventService] Event created: ${data.id}`);
    return data;

  } catch (error) {
    logger.error('[EventService] Error creating event:', error);
    // 저장 실패를 성공처럼 숨기지 않는다 — 엣지 디바이스가 5xx를 보고 재시도할 수 있어야 함.
    // (중앙 에러 핸들러가 PGRST 코드를 400으로 바꾸므로 statusCode를 명시. 상세 원인은 로그에만 남김)
    const saveError = new Error('Failed to save event');
    saveError.statusCode = 500;
    throw saveError;
  }
};

const getDailySummary = async (date, userId) => {
  try {
    const events = await getEventsByDate(date, userId);

    const summary = {
      date,
      totalEvents: events.length,
      byType: {},
      dangerEvents: [],
      timeline: []
    };

    events.forEach(event => {
      if (!summary.byType[event.type]) summary.byType[event.type] = 0;
      summary.byType[event.type]++;

      // 홈 "위험 알림" 기준: type=danger(낙상·화재경보·파손)만. 비명·울음 같은 sound warning은 제외
      if (event.type === 'danger') {
        summary.dangerEvents.push(event);
      }

      summary.timeline.push({
        id: event.id,
        time: event.timestamp,
        timeKst: formatKst(event.timestamp),
        type: event.type,
        description: event.description,
        ...mediaFlags(event)
      });
    });

    return summary;

  } catch (error) {
    logger.error('[EventService] Error getting daily summary:', error);
    return { date, totalEvents: 0, byType: {}, dangerEvents: [], timeline: [] };
  }
};

const getWeeklySummary = async (userId) => {
  try {
    const today   = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const deviceIds = await deviceIdsOf(userId);
    if (deviceIds && deviceIds.length === 0) {
      return { startDate: kstDateString(weekAgo), endDate: kstDateString(today), totalEvents: 0, byType: {}, dailySummaries: {}, events: [] };
    }

    let query = supabaseAdmin
      .from('events')
      .select('*')
      .gte('timestamp', weekAgo.toISOString())
      .lte('timestamp', today.toISOString())
      .order('timestamp', { ascending: true });
    if (deviceIds) query = query.in('device_id', deviceIds);

    const { data, error } = await query;

    if (error) throw error;

    const dailySummaries = {};
    const byType = {};
    (data || []).forEach(event => {
      const date = kstDateString(event.timestamp); // 한국 날짜 기준으로 묶음
      if (!dailySummaries[date]) dailySummaries[date] = { count: 0, types: {} };
      dailySummaries[date].count++;
      if (!dailySummaries[date].types[event.type]) dailySummaries[date].types[event.type] = 0;
      dailySummaries[date].types[event.type]++;
      byType[event.type] = (byType[event.type] || 0) + 1;
    });

    return {
      startDate: kstDateString(weekAgo),
      endDate:   kstDateString(today),
      totalEvents: (data || []).length,
      byType,
      dailySummaries,
      // 기간 내 모든 이벤트 (요약에서 빠뜨리지 않도록 상세까지 함께 제공, 시각은 한국 시간)
      events: (data || []).map(event => ({
        id: event.id,
        timeKst: formatKst(event.timestamp),
        type: event.type,
        description: event.description,
        dangerLevel: event.danger_level,
        ...mediaFlags(event)
      }))
    };

  } catch (error) {
    logger.error('[EventService] Error getting weekly summary:', error);
    return { startDate: '', endDate: '', totalEvents: 0, byType: {}, dailySummaries: {}, events: [] };
  }
};

/**
 * 해당 미디어(영상/소리)가 붙은 가장 최근 이벤트 (없으면 null)
 * 채팅에서 "최근 영상 보여줘"처럼 이벤트를 지목하지 않고 물을 때 사용
 * @param {number} [days] - 주면 최근 days일 안에서만, 생략하면 기간 제한 없음
 */
const MEDIA_COLUMNS = { video: 'video_url', audio: 'audio_url' };
const getLatestEventWithMedia = async (mediaType, days, userId) => {
  const column = MEDIA_COLUMNS[mediaType];
  if (!column) return null;
  try {
    const deviceIds = await deviceIdsOf(userId);
    if (deviceIds && deviceIds.length === 0) return null;

    let query = supabaseAdmin
      .from('events')
      .select('*')
      .not(column, 'is', null)
      .order('timestamp', { ascending: false })
      .limit(1);
    if (deviceIds) query = query.in('device_id', deviceIds);
    if (days > 0) {
      query = query.gte('timestamp', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;
    return data?.[0] || null;

  } catch (error) {
    logger.error('[EventService] Error fetching latest media event:', error);
    return null;
  }
};

// 삭제하면서 지워진 행의 미디어 URL을 돌려받아 Storage 파일도 지운다
const DELETED_MEDIA_COLUMNS = 'id, image_url, audio_url, video_url';

// userId를 주면 그 사용자의 기기 이벤트만 지운다 → 지운 건수 (남의 이벤트·없는 id면 0)
const deleteEvent = async (id, userId) => {
  try {
    const deviceIds = await deviceIdsOf(userId);
    if (deviceIds && deviceIds.length === 0) return 0;

    let query = supabaseAdmin.from('events').delete().eq('id', id);
    if (deviceIds) query = query.in('device_id', deviceIds);

    const { data, error } = await query.select(DELETED_MEDIA_COLUMNS);
    if (error) throw error;
    logger.info(`[EventService] Event deleted: ${id}`);
    await storageService.removeEventMedia(data);
    return (data || []).length;
  } catch (error) {
    logger.error('[EventService] Error deleting event:', error);
    throw error;
  }
};

/**
 * 주어진 기기들에서 발생한 이벤트 삭제 → 삭제된 건수
 * ids를 주면 그중 해당 기기 이벤트만, 없으면 해당 기기 이벤트 전부
 */
const deleteEventsByDevices = async (deviceIds, ids) => {
  if (!deviceIds || deviceIds.length === 0) return 0;
  try {
    let query = supabaseAdmin
      .from('events')
      .delete()
      .in('device_id', deviceIds);
    if (ids) query = query.in('id', ids);

    const { data, error } = await query.select(DELETED_MEDIA_COLUMNS);
    if (error) throw error;
    const deleted = (data || []).length;
    logger.info(`[EventService] Deleted ${deleted} events for ${deviceIds.length} devices`);
    await storageService.removeEventMedia(data);
    return deleted;
  } catch (error) {
    logger.error('[EventService] Error deleting events by devices:', error);
    throw error;
  }
};

module.exports = {
  getEvents,
  getEventById,
  getEventsByDate,
  createEvent,
  getDailySummary,
  getWeeklySummary,
  getLatestEventWithMedia,
  deleteEvent,
  deleteEventsByDevices
};
