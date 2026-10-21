/**
 * Retention Service - 보존 기간이 지난 이벤트·미디어 자동 삭제
 *
 * RETENTION_DAYS(일)를 설정했을 때만 동작한다. 시작 직후 한 번, 이후 하루에 한 번 실행한다
 * (Render가 재시작/깨어날 때도 밀린 삭제가 바로 실행되도록 시작 때 한 번 더 돈다).
 */

const config = require('../config');
const logger = require('../utils/logger');
const eventService = require('./event.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;

const purgeExpired = async (days = config.retention.days) => {
  if (!(days > 0)) return 0;
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  try {
    const deleted = await eventService.deleteEventsOlderThan(cutoff);
    logger.info(`[Retention] ${days}일 지난 이벤트 ${deleted}건 삭제`);
    return deleted;
  } catch (error) {
    logger.error('[Retention] 자동 삭제 실패:', error);
    return 0;
  }
};

const start = () => {
  const days = config.retention.days;
  if (!(days > 0)) {
    logger.info('[Retention] RETENTION_DAYS 미설정 — 자동 삭제 꺼짐');
    return null;
  }
  logger.info(`[Retention] ${days}일 지난 이벤트·미디어를 하루 1번 자동 삭제`);
  setTimeout(purgeExpired, STARTUP_DELAY_MS).unref();
  return setInterval(purgeExpired, DAY_MS).unref();
};

module.exports = { start, purgeExpired };
