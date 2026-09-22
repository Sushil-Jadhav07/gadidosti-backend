const { verifyAccessToken } = require('../utils/jwt');
const { errorResponse } = require('../utils/response');
const UserModel = require('../models/user.model');

// Verify JWT access token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 401, 'Access token required');
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    // Fetch fresh user data to check status
    const user = await UserModel.findById(decoded.id);
    if (!user) return errorResponse(res, 401, 'User not found');
    if (user.status === 'blocked')   return errorResponse(res, 403, 'Account has been blocked');
    if (user.status === 'inactive')  return errorResponse(res, 403, 'Account is inactive');
    // force-logout (user.controller.js's forceLogoutUser / vehicle.controller.js's
    // forceLogoutDriver) stamps this to NOW() — without this check, revoking refresh tokens
    // alone doesn't end an already-open session: THIS access token, decoded successfully above,
    // stays valid and gets accepted right up until its own ~7-day expiry regardless. `iat` is
    // seconds since epoch (JWT standard) — sessions_valid_after is floored to the same
    // second-level precision before comparing, not just converted to milliseconds, so a token
    // freshly issued (e.g. logging back in right after the reset) in the SAME second as the
    // reset timestamp is never incorrectly rejected — verified this matters: millisecond-level
    // comparison flagged a same-second fresh login as stale in testing.
    if (user.sessions_valid_after && decoded.iat < Math.floor(new Date(user.sessions_valid_after).getTime() / 1000)) {
      return errorResponse(res, 401, 'Your session was reset — please log in again.');
    }

    req.user = user;
    // Heartbeat for the single-active-session staleness check (auth.controller.js's
    // rejectIfActiveSession) — drivers only, fire-and-forget so it never adds latency to the
    // request it rides along with.
    if (user.role === 'driver') UserModel.touchLastActive(user.id).catch(() => {});
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 401, 'Access token expired');
    }
    if (err.name === 'JsonWebTokenError') {
      return errorResponse(res, 401, 'Invalid access token');
    }
    return errorResponse(res, 500, 'Authentication error');
  }
};

// Role-based access control
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return errorResponse(res, 401, 'Not authenticated');
    if (!roles.includes(req.user.role)) {
      return errorResponse(res, 403, `Access denied. Required role: ${roles.join(' or ')}`);
    }
    next();
  };
};

module.exports = { authenticate, authorize };
