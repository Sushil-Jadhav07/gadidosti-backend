const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  logger.error(`${err.message} — ${req.method} ${req.originalUrl}`, err);

  // PostgreSQL unique violation
  if (err.code === '23505') {
    const field = err.detail?.match(/\((.+?)\)/)?.[1] || 'field';
    return errorResponse(res, 409, `${field} already exists`);
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return errorResponse(res, 400, 'Referenced record not found');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') return errorResponse(res, 401, 'Invalid token');
  if (err.name === 'TokenExpiredError') return errorResponse(res, 401, 'Token expired');

  return errorResponse(
    res,
    err.statusCode || 500,
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  );
};

module.exports = errorHandler;
