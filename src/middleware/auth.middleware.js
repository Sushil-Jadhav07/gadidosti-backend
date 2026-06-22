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

    req.user = user;
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
