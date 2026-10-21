/**
 * Access Log Controller - 내 열람·촬영·삭제 기록 조회
 */

const accessLogService = require('../services/accessLog.service');
const logger = require('../utils/logger');

const getLogs = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const logs = await accessLogService.getLogs(req.user?.id, { limit, offset });
    res.json({ success: true, data: { logs, limit, offset } });

  } catch (error) {
    logger.error('[AccessLog] Error fetching logs:', error);
    next(error);
  }
};

module.exports = { getLogs };
