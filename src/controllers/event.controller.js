/**
 * Event Controller - 이벤트 데이터 처리
 *
 * [버그 수정]
 * - createEvent: camelCase → snake_case 변환 (DB 스키마 일치)
 * - 4단계 검증 프로토콜에 맞게 상세 로깅 추가
 */

const eventService = require('../services/event.service');
const logger = require('../utils/logger');

/**
 * 이벤트 목록 조회
 */
const getEvents = async (req, res, next) => {
  try {
    const { type, startDate, endDate, limit = 20, offset = 0 } = req.query;

    const filters = {
      type,
      startDate,
      endDate,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const result = await eventService.getEvents(filters);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('[Event] Error fetching events:', error);
    next(error);
  }
};

/**
 * 특정 이벤트 상세 조회
 */
const getEventById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const event = await eventService.getEventById(id);

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    res.json({
      success: true,
      data: event
    });

  } catch (error) {
    logger.error('[Event] Error fetching event:', error);
    next(error);
  }
};

/**
 * 새 이벤트 생성 (Edge Device에서 호출)
 * [버그 수정] camelCase → snake_case 변환 후 DB 저장
 */
const createEvent = async (req, res, next) => {
  try {
    // [로깅 4단계] 수신 데이터 즉시 출력
    logger.info(`[Event] ▶ 수신 요청 from device: ${req.device?.id}`);
    logger.debug(`[Event] 수신 body: ${JSON.stringify(req.body)}`);

    const {
      type,
      description,
      imageUrl,
      audioUrl,
      metadata,
      dangerLevel = 'normal',
      timestamp
    } = req.body;

    const deviceId = req.device?.id;

    if (!type || !description) {
      logger.warn('[Event] ✗ 필수 필드 누락 (type, description)');
      return res.status(400).json({
        success: false,
        error: 'type과 description은 필수입니다'
      });
    }

    // 허용된 type 값 검증
    const validTypes = ['visitor', 'motion', 'sound', 'danger', 'other'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `type은 다음 중 하나여야 합니다: ${validTypes.join(', ')}`
      });
    }

    // 허용된 dangerLevel 값 검증
    const validLevels = ['normal', 'warning', 'danger'];
    if (!validLevels.includes(dangerLevel)) {
      return res.status(400).json({
        success: false,
        error: `dangerLevel은 다음 중 하나여야 합니다: ${validLevels.join(', ')}`
      });
    }

    // [버그 수정] DB 스키마(snake_case)에 맞게 변환
    const eventData = {
      type,
      description,
      image_url: imageUrl || null,
      audio_url: audioUrl || null,
      metadata: metadata || {},
      danger_level: dangerLevel,
      device_id: deviceId || null,
      timestamp: timestamp || new Date().toISOString()
    };

    logger.info(`[Event] DB 저장 시도: type=${type}, danger_level=${dangerLevel}, device_id=${deviceId}`);

    const event = await eventService.createEvent(eventData);

    logger.info(`[Event] ✓ DB 저장 성공: id=${event.id}`);

    // 위험 상황 감지 시 로그 강조
    if (dangerLevel === 'danger') {
      logger.error(`[Event] ⚠⚠⚠ DANGER 이벤트 감지! id=${event.id} | ${description}`);
      // TODO: 7월 - Firebase Push Notification 전송
    } else if (dangerLevel === 'warning') {
      logger.warn(`[Event] ⚠ WARNING 이벤트: id=${event.id} | ${description}`);
      // TODO: 7월 - Firebase Push Notification 전송
    }

    res.status(201).json({
      success: true,
      data: event
    });

  } catch (error) {
    logger.error('[Event] ✗ 이벤트 생성 실패:', error);
    next(error);
  }
};

/**
 * 일별 이벤트 요약
 */
const getDailySummary = async (req, res, next) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const summary = await eventService.getDailySummary(targetDate);

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    logger.error('[Event] Error fetching daily summary:', error);
    next(error);
  }
};

/**
 * 주간 이벤트 요약
 */
const getWeeklySummary = async (req, res, next) => {
  try {
    const summary = await eventService.getWeeklySummary();

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    logger.error('[Event] Error fetching weekly summary:', error);
    next(error);
  }
};

/**
 * 이벤트 삭제
 */
const deleteEvent = async (req, res, next) => {
  try {
    const { id } = req.params;

    await eventService.deleteEvent(id);

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    logger.error('[Event] Error deleting event:', error);
    next(error);
  }
};

module.exports = {
  getEvents,
  getEventById,
  createEvent,
  getDailySummary,
  getWeeklySummary,
  deleteEvent
};
