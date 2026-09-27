/**
 * Briefing Service - 홈 화면 "오늘의 브리핑" 저장/조회
 *
 * 새로고침·다른 기기에서도 마지막 브리핑을 다시 보여주기 위해 서버(DB)에 보관한다.
 * conversation.service와 같이 supabaseAdmin을 쓰고, 모든 조회에서 user_id로 소유자를 직접 거른다.
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

// DB 행 → API 응답 형식 (POST /api/chat/summary 응답과 동일)
const toResponse = (row) => ({
  date: row.date,
  summary: row.summary,
  eventCount: row.event_count,
  timestamp: row.created_at
});

/**
 * 브리핑 저장 — 사용자당 1행, 새로 만들면 최신 것으로 덮어씀 (user_id UNIQUE)
 * (실패해도 브리핑 생성 응답은 막지 않도록 에러를 던지지 않음)
 */
const saveBriefing = async (userId, { date, summary, eventCount, timestamp }) => {
  try {
    const { error } = await supabaseAdmin
      .from('briefings')
      .upsert(
        [{ user_id: userId, date, summary, event_count: eventCount, created_at: timestamp }],
        { onConflict: 'user_id' }
      );
    if (error) throw error;
  } catch (error) {
    logger.warn('[Briefing] Failed to save briefing:', error.message);
  }
};

/**
 * 사용자의 가장 최근 브리핑 (없으면 null)
 */
const getLatestBriefing = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('briefings')
    .select('date, summary, event_count, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? toResponse(data) : null;
};

module.exports = {
  saveBriefing,
  getLatestBriefing
};
