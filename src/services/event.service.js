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
    const startOfDay = `${date}T00:00:00.000Z`;
    const endOfDay   = `${date}T23:59:59.999Z`;

    const { data, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('timestamp', startOfDay)
      .lte('timestamp', endOfDay)
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
    return {
      id: `temp_${Date.now()}`,
      ...eventData,
      createdAt: new Date().toISOString()
    };
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
    (data || []).forEach(event => {
      const date = event.timestamp.split('T')[0];
      if (!dailySummaries[date]) dailySummaries[date] = { count: 0, types: {} };
      dailySummaries[date].count++;
      if (!dailySummaries[date].types[event.type]) dailySummaries[date].types[event.type] = 0;
      dailySummaries[date].types[event.type]++;
    });

    return {
      startDate: weekAgo.toISOString().split('T')[0],
      endDate:   today.toISOString().split('T')[0],
      totalEvents: (data || []).length,
      dailySummaries
    };

  } catch (error) {
    logger.error('[EventService] Error getting weekly summary:', error);
    return { startDate: '', endDate: '', totalEvents: 0, dailySummaries: {} };
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

module.exports = {
  getEvents,
  getEventById,
  getEventsByDate,
  createEvent,
  getDailySummary,
  getWeeklySummary,
  deleteEvent
};
