/**
 * Response Helper Utility
 * API 응답 표준화
 */

/**
 * 성공 응답
 */
const success = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    data,
    timestamp: new Date().toISOString()
  });
};

/**
 * 에러 응답
 */
const error = (res, message, statusCode = 500, details = null) => {
  const response = {
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  };

  if (details && process.env.NODE_ENV === 'development') {
    response.details = details;
  }

  return res.status(statusCode).json(response);
};

/**
 * 페이지네이션 응답
 */
const paginated = (res, data, total, page, limit) => {
  return res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    },
    timestamp: new Date().toISOString()
  });
};

/**
 * 생성 성공 응답 (201)
 */
const created = (res, data) => {
  return success(res, data, 201);
};

/**
 * 삭제 성공 응답 (204 or 200)
 */
const deleted = (res, message = 'Successfully deleted') => {
  return res.status(200).json({
    success: true,
    message,
    timestamp: new Date().toISOString()
  });
};

/**
 * Bad Request (400)
 */
const badRequest = (res, message = 'Bad Request') => {
  return error(res, message, 400);
};

/**
 * Unauthorized (401)
 */
const unauthorized = (res, message = 'Unauthorized') => {
  return error(res, message, 401);
};

/**
 * Forbidden (403)
 */
const forbidden = (res, message = 'Forbidden') => {
  return error(res, message, 403);
};

/**
 * Not Found (404)
 */
const notFound = (res, message = 'Resource not found') => {
  return error(res, message, 404);
};

module.exports = {
  success,
  error,
  paginated,
  created,
  deleted,
  badRequest,
  unauthorized,
  forbidden,
  notFound
};
