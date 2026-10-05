/**
 * Chat Controller - AI 대화 처리
 *
 * [버그 수정]
 * 1. getHistory: DB에서 실제 대화 기록 조회
 * 2. deleteConversation: DB에서 실제 삭제
 */

const claudeService = require('../services/claude.service');
const eventService = require('../services/event.service');
const conversationService = require('../services/conversation.service');
const briefingService = require('../services/briefing.service');
const logger = require('../utils/logger');
const { kstDateString } = require('../utils/date.utils');

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
 * - conversationId 없음: 로그인 사용자의 대화 목록 (최근 대화 순)
 * - conversationId 있음: 그 대화의 전체 메시지 (본인 대화가 아니면 404)
 */
const getHistory = async (req, res, next) => {
  try {
    const userId = req.user?.id || 'anonymous';
    const { conversationId } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    if (conversationId) {
      if (!(await conversationService.isOwnConversation(conversationId, userId))) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found'
        });
      }

      const messages = await conversationService.getMessages(conversationId);

      return res.json({
        success: true,
        data: {
          conversationId,
          messages,
          total: messages.length
        }
      });
    }

    const { conversations, total } = await conversationService.listConversations(userId, { limit, offset });

    res.json({
      success: true,
      data: {
        conversations,
        total,
        limit,
        offset
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
    const targetDate = date || kstDateString(); // 생략 시 오늘(한국 날짜)

    logger.info(`[Chat] Generating daily summary for ${targetDate}`);

    const events = await eventService.getEventsByDate(targetDate);
    const summary = await claudeService.generateDailySummary(events, targetDate);

    const briefing = {
      date: targetDate,
      summary: summary.content,
      eventCount: events.length,
      timestamp: new Date().toISOString()
    };

    // 새로고침/다른 기기에서도 마지막 브리핑을 보여주도록 저장
    await briefingService.saveBriefing(req.user?.id || 'anonymous', briefing);

    res.json({
      success: true,
      data: briefing
    });

  } catch (error) {
    logger.error('[Chat] Error generating daily summary:', error);
    next(error);
  }
};

/**
 * 가장 최근에 만든 브리핑 조회 (없으면 data: null)
 */
const getLatestSummary = async (req, res, next) => {
  try {
    const briefing = await briefingService.getLatestBriefing(req.user?.id || 'anonymous');

    res.json({
      success: true,
      data: briefing
    });

  } catch (error) {
    logger.error('[Chat] Error fetching latest summary:', error);
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

    // 본인 대화만 삭제 (messages는 CASCADE로 자동 삭제 — schema.sql 참고)
    const deleted = await conversationService.deleteConversation(conversationId, userId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });

  } catch (error) {
    logger.error('[Chat] Error deleting conversation:', error);
    next(error);
  }
};

/**
 * 대화 제목 변경
 */
const renameConversation = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { title } = req.body;
    const userId = req.user?.id || 'anonymous';

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    const saved = await conversationService.renameConversation(conversationId, userId, title);

    if (!saved) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      data: { id: conversationId, title: saved }
    });

  } catch (error) {
    logger.error('[Chat] Error renaming conversation:', error);
    next(error);
  }
};

module.exports = {
  renameConversation,
  sendMessage,
  getHistory,
  getDailySummary,
  getLatestSummary,
  deleteConversation
};
