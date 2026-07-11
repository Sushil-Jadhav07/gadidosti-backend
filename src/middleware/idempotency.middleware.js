const IdempotencyKeyModel = require('../models/idempotencyKey.model');
const logger = require('../utils/logger');

// Optional Idempotency-Key header support. When present, replays the exact response
// snapshot from a prior request with the same (key, user, endpoint) instead of
// re-running the handler — used on POST /api/bookings and PATCH /api/trips/:id/status
// to make client retries safe. Absent header -> normal request, no behavior change.
// Must run after `authenticate` (needs req.user.id).
const idempotent = (endpoint) => async (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!key) return next();

  try {
    const cached = await IdempotencyKeyModel.find(key, req.user.id, endpoint);
    if (cached) return res.status(200).json(cached);

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        IdempotencyKeyModel.save(key, req.user.id, endpoint, body).catch((err) => {
          logger.warn(`Failed to save idempotency snapshot for ${endpoint}: ${err.message}`);
        });
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = idempotent;
