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
const { kstDateString, kstDayRange, formatKst } = require('../utils/date.utils');

const getEvents = async (filters = {}) => {
  try {
    const { type, startDate, endDate, limit = 20, offset = 0 } = filters;

    let query = supabaseAdmin
      .from('events')
      .select('*', { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

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

const getEventById = async (id) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;

  } catch (error) {
    logger.error('[EventService] Error fetching event:', error);
    return null;
  }
};

const getEventsByDate = async (date) => {
  try {
    // 날짜는 한국 기준 하루 (UTC 자정으로 자르면 KST 00~09시 이벤트가 전날로 잡힘)
    const { start, end } = kstDayRange(date);

    const { data, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('timestamp', start)
      .lte('timestamp', end)
      .order('timestamp', { ascending: true });

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

const getDailySummary = async (date) => {
  try {
    const events = await getEventsByDate(date);

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

      if (event.danger_level === 'danger' || event.danger_level === 'warning') {
        summary.dangerEvents.push(event);
      }

      summary.timeline.push({
        time: event.timestamp,
        timeKst: formatKst(event.timestamp),
        type: event.type,
        description: event.description
      });
    });

    return summary;

  } catch (error) {
    logger.error('[EventService] Error getting daily summary:', error);
    return { date, totalEvents: 0, byType: {}, dangerEvents: [], timeline: [] };
  }
};

const getWeeklySummary = async () => {
  try {
    const today   = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('timestamp', weekAgo.toISOString())
      .lte('timestamp', today.toISOString())
      .order('timestamp', { ascending: true });

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
        timeKst: formatKst(event.timestamp),
        type: event.type,
        description: event.description,
        dangerLevel: event.danger_level
      }))
    };

  } catch (error) {
    logger.error('[EventService] Error getting weekly summary:', error);
    return { startDate: '', endDate: '', totalEvents: 0, byType: {}, dailySummaries: {}, events: [] };
  }
};

const deleteEvent = async (id) => {
  try {
    const { error } = await supabaseAdmin.from('events').delete().eq('id', id);
    if (error) throw error;
    logger.info(`[EventService] Event deleted: ${id}`);
    return true;
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
      .delete({ count: 'exact' })
      .in('device_id', deviceIds);
    if (ids) query = query.in('id', ids);

    const { error, count } = await query;
    if (error) throw error;
    logger.info(`[EventService] Deleted ${count ?? 0} events for ${deviceIds.length} devices`);
    return count ?? 0;
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
  deleteEvent,
  deleteEventsByDevices
};
