/**
 * Error Handling Middleware
 */

const logger = require('../utils/logger');
const config = require('../config');

/**
 * 404 Not Found Handler
 */
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: 'Resource not found',
    path: req.originalUrl
  });
};

/**
 * Global Error Handler
 */
const errorHandler = (err, req, res, next) => {
  // 에러 로깅
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // 기본 에러 응답
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  const response = {
    success: false,
    error: message
  };

  // 개발 환경에서는 스택 트레이스 포함
  if (config.nodeEnv === 'development') {
    response.stack = err.stack;
  }

  // Validation 에러 처리
  if (err.name === 'ValidationError' || err.name === 'ZodError') {
    response.error = 'Validation Error';
    response.details = err.errors || err.issues;
    return res.status(400).json(response);
  }

  // Supabase 에러 처리
  if (err.code && err.code.startsWith('PGRST')) {
    response.error = 'Database Error';
    return res.status(400).json(response);
  }

  // Anthropic API 에러 처리
  if (err.status === 429) {
    response.error = 'Rate limit exceeded. Please try again later.';
    return res.status(429).json(response);
  }

  res.status(statusCode).json(response);
};

/**
 * Async Handler Wrapper
 * - async 함수의 에러를 자동으로 catch
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Custom Error Class
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = {
  notFoundHandler,
  errorHandler,
  asyncHandler,
  AppError
};
