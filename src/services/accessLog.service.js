/**
 * Access Log Service - 열람·촬영·삭제 감사 기록
 *
 * "누가 언제 무엇을 했는지"만 남기고 내용(영상·설명)은 저장하지 않는다.
 * 기록 실패(테이블 미생성 등)는 본 기능을 막지 않는다 — 로그만 남기고 넘어간다.
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const ACTIONS = ['view_event', 'capture', 'delete_event', 'delete_events', 'privacy_mode'];

/**
 * 기록 남기기 (기다릴 필요 없음 — 호출한 쪽은 await 하지 않아도 된다)
 * @param {{userId: string, action: string, resourceId?: string, source?: 'app'|'chat'}} entry
 */
const record = async ({ userId, action, resourceId = null, source = 'app' }) => {
  if (!userId || !ACTIONS.includes(action)) return false;
  try {
    const { error } = await supabaseAdmin
      .from('access_logs')
      .insert([{ user_id: userId, action, resource_id: resourceId ? String(resourceId) : null, source }]);
    if (error) throw error;
    return true;
  } catch (error) {
    logger.warn(`[AccessLog] 기록 실패 (${action}): ${error.message}`);
    return false;
  }
};

/**
 * 본인의 최근 기록 (최신순)
 */
const getLogs = async (userId, { limit = 50, offset = 0 } = {}) => {
  const { data, error } = await supabaseAdmin
    .from('access_logs')
    .select('id, action, resource_id, source, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data || [];
};

module.exports = { record, getLogs, ACTIONS };
