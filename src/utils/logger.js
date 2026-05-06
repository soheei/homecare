/**
 * Logger Utility - Winston 기반 로깅
 */

const winston = require('winston');
const config = require('../config');

// 로그 포맷 정의
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// 콘솔 출력용 컬러 포맷
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Winston 로거 생성
const logger = winston.createLogger({
  level: config.logLevel || 'debug',
  format: logFormat,
  transports: [
    // 콘솔 출력
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

// 프로덕션 환경에서는 파일 로깅 추가
if (config.nodeEnv === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
  
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5
    })
  );
}

// HTTP 요청 로깅을 위한 stream
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

module.exports = logger;
