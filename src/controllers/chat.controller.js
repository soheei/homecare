/**
 * Chat Controller - AI 대화 처리
 *
 * [버그 수정]
 * 1. getHistory: DB에서 실제 대화 기록 조회
 * 2. deleteConversation: DB에서 실제 삭제
 */

const claudeService = require('../services/claude.service');
const eventService = require('../services/event.service');
const { supabase, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * 사용자 메시지를 AI에게 전송
 */
const sendMessage = async (req, res, next) => {
  try {
    const { message, conversationId } = req.body;
    const userId = req.user?.id || 'anonymous';

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    logger.info(`[Chat] User ${userId} sent message: ${message.substring(0, 50)}...`);

    const response = await claudeService.chat({
      message,
      conversationId,
      userId
    });

    res.json({
      success: true,
      data: {
        message: response.content,
        conversationId: response.conversationId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('[Chat] Error sending message:', error);
    next(error);
  }
};

/**
 * 대화 기록 조회 [버그 1 수정]
 */
const getHistory = async (req, res, next) => {
  try {
    const userId = req.user?.id || 'anonymous';
    const { conversationId, limit = 20, offset = 0 } = req.query;

    if (conversationId) {
      // 특정 대화의 메시지 목록 조회
      const { data: messages, error: msgError } = await supabase
        .from('messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (msgError) throw msgError;

      return res.json({
        success: true,
        data: {
          conversationId,
          messages: messages || [],
          total: messages?.length || 0
        }
      });
    }

    // 사용자의 대화 목록 조회
    const { data: conversations, error, count } = await supabase
      .from('conversations')
      .select('id, title, created_at, updated_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    res.json({
      success: true,
      data: {
        conversations: conversations || [],
        total: count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    logger.error('[Chat] Error fetching history:', error);
    next(error);
  }
};

/**
 * 하루 요약 리포트 생성
 */
const getDailySummary = async (req, res, next) => {
  try {
    const { date } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];

    logger.info(`[Chat] Generating daily summary for ${targetDate}`);

    const events = await eventService.getEventsByDate(targetDate);
    const summary = await claudeService.generateDailySummary(events, targetDate);

    res.json({
      success: true,
      data: {
        date: targetDate,
        summary: summary.content,
        eventCount: events.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('[Chat] Error generating daily summary:', error);
    next(error);
  }
};

/**
 * 대화 기록 삭제 [버그 1 수정]
 */
const deleteConversation = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.id || 'anonymous';

    // 본인 대화인지 확인
    const { data: conv, error: findError } = await supabase
      .from('conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (findError || !conv) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    // messages는 CASCADE로 자동 삭제 (schema.sql 참고)
    const { error: deleteError } = await supabaseAdmin
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (deleteError) throw deleteError;

    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });

  } catch (error) {
    logger.error('[Chat] Error deleting conversation:', error);
    next(error);
  }
};

module.exports = {
  sendMessage,
  getHistory,
  getDailySummary,
  deleteConversation
};
