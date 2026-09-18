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

  // Multer — a file past the active upload middleware's own size limit (upload.middleware.js:
  // 10MB for KYC documents, 50MB for POD photos/video) previously fell through to a bare 500
  // "Internal server error" here, which is what a client's "too large" complaint was actually
  // hitting when it wasn't the reverse proxy in front of this app rejecting it first (nginx's
  // own default client_max_body_size — 1MB — runs even before this process sees the request at
  // all, and can't be fixed from application code; that needs raising on the server itself).
  if (err.code === 'LIMIT_FILE_SIZE') {
    return errorResponse(res, 413, 'File is too large for this upload.');
  }

  // Node's own http server rejecting a request whose Content-Length exceeds --max-http-header-size
  // or a body over its raw socket limits surfaces as this code — same "too large" family as
  // above, just from a layer below Multer instead of the field-level limit.
  if (err.type === 'entity.too.large' || err.code === 'ERR_ENTITY_TOO_LARGE') {
    return errorResponse(res, 413, 'File is too large for this upload.');
  }

  return errorResponse(
    res,
    err.statusCode || 500,
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  );
};

module.exports = errorHandler;
