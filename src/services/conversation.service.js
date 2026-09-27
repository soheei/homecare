/**
 * Conversation Service - 채팅 대화/메시지 DB 관리
 *
 * conversations/messages 테이블의 RLS는 auth.uid() 기준이라 서버의 anon 클라이언트로는
 * 항상 빈 결과가 나온다 → supabaseAdmin을 쓰되, 모든 조회/삭제에서 user_id로 소유자를 직접 확인한다.
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const TITLE_MAX_LENGTH = 40;

/**
 * 첫 질문으로 대화 제목 만들기 (목록 표시용)
 */
const makeTitle = (message) => {
  const oneLine = (message || '').replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  return oneLine.length > TITLE_MAX_LENGTH ? `${oneLine.slice(0, TITLE_MAX_LENGTH)}…` : oneLine;
};

/**
 * 새 대화 생성
 * @returns {string} conversation id (DB 실패 시 임시 ID — 개발 편의, 기존 동작 유지)
 */
const createConversation = async (userId, firstMessage) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .insert([{ user_id: userId || 'anonymous', title: makeTitle(firstMessage) }])
      .select()
      .single();

    if (error) throw error;
    logger.info(`[Conversation] Created: ${data.id}`);
    return data.id;
  } catch (error) {
    const tempId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    logger.warn('[Conversation] DB unavailable, using temp conversation ID:', error.message);
    return tempId;
  }
};

/**
 * 요청한 사용자의 대화인지 확인
 */
const isOwnConversation = async (conversationId, userId) => {
  // 임시 ID(conv_timestamp_xxx)는 DB에 없는 개발용 대화라 그대로 사용
  if (conversationId.startsWith('conv_')) return true;

  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId || 'anonymous')
      .maybeSingle();

    if (error) throw error;
    return Boolean(data);
  } catch (error) {
    logger.warn('[Conversation] Failed to verify owner:', error.message);
    return false;
  }
};

/**
 * 대화의 메시지 조회 (시간순)
 * @param {number} limit - 최근 N개만 (Claude 컨텍스트용). 생략 시 전체
 */
const getMessages = async (conversationId, limit) => {
  if (!conversationId || conversationId.startsWith('conv_')) return [];

  let query = supabaseAdmin
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: !limit });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  // limit이 있으면 최신순으로 가져왔으므로 시간순으로 되돌림
  return limit ? (data || []).reverse() : (data || []);
};

/**
 * 메시지 저장 + 대화의 updated_at 갱신 (목록을 최근 대화 순으로 정렬하기 위해)
 */
const saveMessage = async (conversationId, role, content) => {
  if (!conversationId || conversationId.startsWith('conv_')) return;

  try {
    const { error } = await supabaseAdmin
      .from('messages')
      .insert([{ conversation_id: conversationId, role, content }]);
    if (error) throw error;

    const { error: touchError } = await supabaseAdmin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (touchError) throw touchError;
  } catch (error) {
    logger.warn('[Conversation] Failed to save message:', error.message);
  }
};

/**
 * 사용자의 대화 목록 (최근 대화 순)
 */
const listConversations = async (userId, { limit = 20, offset = 0 } = {}) => {
  const { data, error, count } = await supabaseAdmin
    .from('conversations')
    .select('id, title, created_at, updated_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return { conversations: data || [], total: count || 0 };
};

/**
 * 본인 대화 삭제 (messages는 FK ON DELETE CASCADE로 함께 삭제)
 * @returns {boolean} 삭제했으면 true, 본인 대화가 아니거나 없으면 false
 */
const deleteConversation = async (conversationId, userId) => {
  if (!(await isOwnConversation(conversationId, userId))) return false;

  const { error } = await supabaseAdmin
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId);

  if (error) throw error;
  logger.info(`[Conversation] Deleted: ${conversationId}`);
  return true;
};

module.exports = {
  createConversation,
  isOwnConversation,
  getMessages,
  saveMessage,
  listConversations,
  deleteConversation
};
