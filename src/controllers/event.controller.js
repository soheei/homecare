/**
 * Event Controller - 이벤트 데이터 처리
 *
 * [버그 수정]
 * - createEvent: camelCase → snake_case 변환 (DB 스키마 일치)
 * - 4단계 검증 프로토콜에 맞게 상세 로깅 추가
 * [업데이트]
 * - Supabase Storage 직접 업로드 지원
 */

const eventService = require('../services/event.service');
const storageService = require('../services/storage.service');
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
 * [업데이트] 파일 직접 업로드 지원 (Supabase Storage)
 */
const createEvent = async (req, res, next) => {
  try {
    // [로깅 4단계] 수신 데이터 즉시 출력
    logger.info(`[Event] ▶ 수신 요청 from device: ${req.device?.id}`);
    
    // Multer가 처리한 텍스트 필드는 req.body에, 파일은 req.files에 들어있음
    let {
      type,
      description,
      imageUrl,
      audioUrl,
      metadata,
      dangerLevel = 'normal',
      timestamp
    } = req.body;

    // JSON 문자열로 올 수 있는 metadata 파싱
    if (metadata && typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        logger.warn('[Event] metadata JSON 파싱 실패, 빈 객체로 대체');
        metadata = {};
      }
    }

    // [파일 업로드 처리] 전송된 파일이 있다면 스토리지에 먼저 업로드
    if (req.files) {
      // 이미지 업로드 (필드명 'image')
      if (req.files.image && req.files.image[0]) {
        const uploadedImageUrl = await storageService.uploadFile(req.files.image[0], 'events');
        if (uploadedImageUrl) {
          imageUrl = uploadedImageUrl;
          logger.info(`[Event] 이미지 업로드 완료: ${imageUrl}`);
        }
      }
      
      // 오디오 업로드 (필드명 'audio')
      if (req.files.audio && req.files.audio[0]) {
        const uploadedAudioUrl = await storageService.uploadFile(req.files.audio[0], 'events');
        if (uploadedAudioUrl) {
          audioUrl = uploadedAudioUrl;
          logger.info(`[Event] 오디오 업로드 완료: ${audioUrl}`);
        }
      }
    }

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

    // DB 스키마(snake_case)에 맞게 변환
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

    logger.info(`[Event] DB 저장 시도: type=${type}, danger_level=${dangerLevel}`);

    const event = await eventService.createEvent(eventData);

    logger.info(`[Event] ✓ DB 저장 성공: id=${event.id}`);

    // 위험 상황 감지 시 로그 강조
    if (dangerLevel === 'danger') {
      logger.error(`[Event] ⚠⚠⚠ DANGER 이벤트 감지! id=${event.id} | ${description}`);
    } else if (dangerLevel === 'warning') {
      logger.warn(`[Event] ⚠ WARNING 이벤트: id=${event.id} | ${description}`);
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
