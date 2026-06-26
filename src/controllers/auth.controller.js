const bcrypt = require('bcryptjs');
const { verifyGoogleIdToken } = require('../utils/googleClient');
const UserModel = require('../models/user.model');
const OtpModel = require('../models/otp.model');
const RefreshTokenModel = require('../models/refreshToken.model');
const AuditLogModel = require('../models/auditLog.model');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, hashToken, generateOTP } = require('../utils/jwt');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── POST /api/auth/register ─────────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const { name, phone, email, password, role = 'client' } = req.body;

    const existingPhone = await UserModel.findByPhone(phone);
    if (existingPhone) return errorResponse(res, 409, 'Phone number already registered');

    if (email) {
      const existingEmail = await UserModel.findByEmail(email);
      if (existingEmail) return errorResponse(res, 409, 'Email address already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await UserModel.create({ name, phone, email, passwordHash, role });

    await AuditLogModel.log({
      userId: user.id,
      action: 'USER_REGISTER',
      entity: 'users',
      entityId: user.id,
      meta: { role, phone },
      ipAddress: req.ip,
    });

    logger.info(`New user registered: ${phone} [${role}]`);
    return successResponse(res, 201, 'Registration successful. You can now log in.', { user });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/login (unified — all roles) ─────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await UserModel.findByEmail(email);

    if (!user) return errorResponse(res, 401, 'Invalid credentials');

    if (user.status === 'blocked')  return errorResponse(res, 403, 'Your account has been blocked. Contact support.');
    if (user.status === 'inactive') return errorResponse(res, 403, 'Account is inactive');

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) return errorResponse(res, 401, 'Invalid credentials');

    const tokenPayload = { id: user.id, role: user.role, phone: user.phone };
    const accessToken  = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const tokenHash    = hashToken(refreshToken);

    await RefreshTokenModel.create({
      userId: user.id,
      tokenHash,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    await UserModel.updateLastLogin(user.id);

    await AuditLogModel.log({
      userId: user.id,
      action: user.role === 'admin' ? 'ADMIN_LOGIN' : 'USER_LOGIN',
      entity: 'users',
      entityId: user.id,
      meta: { role: user.role },
      ipAddress: req.ip,
    });

    const { password_hash, ...safeUser } = user;
    logger.info(`Login: ${email || phone} [${user.role}]`);

    return successResponse(res, 200, 'Login successful', {
      user: safeUser,
      tokens: {
        access_token:  accessToken,
        refresh_token: refreshToken,
        token_type:    'Bearer',
        expires_in:    process.env.JWT_EXPIRES_IN || '7d',
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/admin/register ───────────────────────────────────────────
const registerAdmin = async (req, res, next) => {
  try {
    const { name, phone, email, password } = req.body;

    const existingPhone = await UserModel.findByPhone(phone);
    if (existingPhone) return errorResponse(res, 409, 'Phone number already registered');

    if (email) {
      const existingEmail = await UserModel.findByEmail(email);
      if (existingEmail) return errorResponse(res, 409, 'Email address already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Admin accounts are created as active + verified immediately (no OTP needed)
    const result = await UserModel.createAdmin({ name, phone, email, passwordHash });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'ADMIN_CREATED',
      entity: 'users',
      entityId: result.id,
      meta: { created_by: req.user.email, new_admin_email: email, new_admin_phone: phone },
      ipAddress: req.ip,
    });

    logger.info(`New admin created by ${req.user.email}: ${email || phone}`);
    return successResponse(res, 201, 'Admin account created successfully', { user: result });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/otp/send ─────────────────────────────────────────────────
const sendOtp = async (req, res, next) => {
  try {
    const { phone, purpose = 'login' } = req.body;

    const recentCount = await OtpModel.countRecent(phone, purpose, 10);
    if (recentCount >= 3) {
      return errorResponse(res, 429, 'Too many OTP requests. Please wait 10 minutes before trying again.');
    }

    if (purpose === 'login' || purpose === 'password_reset') {
      const user = await UserModel.findByPhone(phone);
      if (!user) return errorResponse(res, 404, 'No account found with this phone number');
      if (user.status === 'blocked') return errorResponse(res, 403, 'Account is blocked');
    }

    const otpCode = generateOTP();
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
    await OtpModel.create({ phone, otpCode, purpose, expiryMinutes });

    // TODO: Integrate SMS provider (Twilio / MSG91 / Fast2SMS)
    logger.info(`OTP for ${phone} [${purpose}]: ${otpCode}`);

    return successResponse(res, 200, `OTP sent to ${phone}. Valid for ${expiryMinutes} minutes.`, {
      phone,
      purpose,
      expires_in_minutes: expiryMinutes,
      ...(process.env.NODE_ENV !== 'production' && { dev_otp: otpCode }),
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/otp/verify ────────────────────────────────────────────────
const verifyOtp = async (req, res, next) => {
  try {
    const { phone, otp, purpose = 'login' } = req.body;

    const otpRecord = await OtpModel.findValid({ phone, otpCode: otp, purpose });
    if (!otpRecord) {
      await OtpModel.incrementAttempt(phone, purpose);
      return errorResponse(res, 400, 'Invalid or expired OTP');
    }

    await OtpModel.markUsed(otpRecord.id);

    const user = await UserModel.verifyPhone(phone);
    if (!user) return errorResponse(res, 404, 'User not found');

    if (purpose === 'login') {
      const tokenPayload = { id: user.id, role: user.role, phone: user.phone };
      const accessToken  = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);
      const tokenHash    = hashToken(refreshToken);

      await RefreshTokenModel.create({
        userId: user.id,
        tokenHash,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });

      await UserModel.updateLastLogin(user.id);
      await AuditLogModel.log({ userId: user.id, action: 'OTP_LOGIN', entity: 'users', entityId: user.id, ipAddress: req.ip });

      return successResponse(res, 200, 'OTP verified. Login successful.', {
        user,
        tokens: {
          access_token:  accessToken,
          refresh_token: refreshToken,
          token_type:    'Bearer',
          expires_in:    process.env.JWT_EXPIRES_IN || '7d',
        },
      });
    }

    await AuditLogModel.log({ userId: user.id, action: 'PHONE_VERIFIED', entity: 'users', entityId: user.id, ipAddress: req.ip });
    return successResponse(res, 200, 'Phone number verified successfully', { user });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
const forgotPassword = async (req, res, next) => {
  try {
    const { phone } = req.body;

    const user = await UserModel.findByPhone(phone);
    if (!user) return errorResponse(res, 404, 'No account found with this phone number');
    if (user.status === 'blocked') return errorResponse(res, 403, 'Account is blocked. Contact support.');

    const recentCount = await OtpModel.countRecent(phone, 'password_reset', 10);
    if (recentCount >= 3) {
      return errorResponse(res, 429, 'Too many OTP requests. Please wait 10 minutes before trying again.');
    }

    const otpCode = generateOTP();
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
    await OtpModel.create({ phone, otpCode, purpose: 'password_reset', expiryMinutes });

    // TODO: Integrate SMS provider (Twilio / MSG91 / Fast2SMS)
    logger.info(`Password reset OTP for ${phone}: ${otpCode}`);

    return successResponse(res, 200, `OTP sent to ${phone}. Valid for ${expiryMinutes} minutes.`, {
      phone,
      expires_in_minutes: expiryMinutes,
      ...(process.env.NODE_ENV !== 'production' && { dev_otp: otpCode }),
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    const { phone, otp, new_password } = req.body;

    const otpRecord = await OtpModel.findValid({ phone, otpCode: otp, purpose: 'password_reset' });
    if (!otpRecord) {
      await OtpModel.incrementAttempt(phone, 'password_reset');
      return errorResponse(res, 400, 'Invalid or expired OTP');
    }

    const user = await UserModel.findByPhone(phone);
    if (!user) return errorResponse(res, 404, 'No account found with this phone number');

    await OtpModel.markUsed(otpRecord.id);

    const passwordHash = await bcrypt.hash(new_password, 12);
    await UserModel.updatePassword(user.id, passwordHash);

    // Revoke all existing refresh tokens for security
    await RefreshTokenModel.revokeAllForUser(user.id);

    await AuditLogModel.log({
      userId: user.id,
      action: 'PASSWORD_RESET',
      entity: 'users',
      entityId: user.id,
      ipAddress: req.ip,
    });

    logger.info(`Password reset successful for ${phone}`);
    return successResponse(res, 200, 'Password reset successful. Please login with your new password.');
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/refresh-token ─────────────────────────────────────────────
const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    let decoded;
    try {
      decoded = verifyRefreshToken(refresh_token);
    } catch {
      return errorResponse(res, 401, 'Invalid or expired refresh token');
    }

    const tokenHash = hashToken(refresh_token);
    const storedToken = await RefreshTokenModel.findValid(tokenHash);
    if (!storedToken) return errorResponse(res, 401, 'Refresh token revoked or not found');

    if (storedToken.status === 'blocked') return errorResponse(res, 403, 'Account is blocked');

    await RefreshTokenModel.revoke(tokenHash);

    const tokenPayload = { id: decoded.id, role: decoded.role, phone: decoded.phone };
    const newAccessToken  = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);
    const newTokenHash    = hashToken(newRefreshToken);

    await RefreshTokenModel.create({
      userId: decoded.id,
      tokenHash: newTokenHash,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Tokens refreshed', {
      tokens: {
        access_token:  newAccessToken,
        refresh_token: newRefreshToken,
        token_type:    'Bearer',
        expires_in:    process.env.JWT_EXPIRES_IN || '7d',
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
const logout = async (req, res, next) => {
  try {
    const { refresh_token, all_devices = false } = req.body;

    if (all_devices) {
      await RefreshTokenModel.revokeAllForUser(req.user.id);
      await AuditLogModel.log({ userId: req.user.id, action: 'LOGOUT_ALL_DEVICES', entity: 'users', entityId: req.user.id, ipAddress: req.ip });
      return successResponse(res, 200, 'Logged out from all devices');
    }

    if (refresh_token) {
      const tokenHash = hashToken(refresh_token);
      await RefreshTokenModel.revoke(tokenHash);
    }

    await AuditLogModel.log({ userId: req.user.id, action: 'USER_LOGOUT', entity: 'users', entityId: req.user.id, ipAddress: req.ip });
    return successResponse(res, 200, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/auth/google ────────────────────────────────────────────────────
const googleSignIn = async (req, res, next) => {
  try {
    const { id_token, role = 'client' } = req.body;

    if (role === 'admin') {
      return errorResponse(res, 403, 'Admin accounts cannot use Google Sign-In');
    }

    let payload;
    try {
      payload = await verifyGoogleIdToken(id_token);
    } catch (err) {
      logger.warn(`Google token verification failed: ${err.message}`);
      return errorResponse(res, 401, 'Invalid or expired Google token');
    }

    const { googleId, email, emailVerified, name, picture } = payload;

    if (!emailVerified) {
      return errorResponse(res, 403, 'Your Google email is not verified');
    }

    let user;
    let isNewUser = false;

    user = await UserModel.findByGoogleId(googleId);

    if (!user && email) {
      const existing = await UserModel.findByEmail(email);
      if (existing) {
        user = await UserModel.linkGoogleAccount(existing.id, { googleId, profileImage: picture });
        await AuditLogModel.log({
          userId: user.id,
          action: 'GOOGLE_ACCOUNT_LINKED',
          entity: 'users',
          entityId: user.id,
          meta: { googleId, email },
          ipAddress: req.ip,
        });
      }
    }

    if (!user) {
      user = await UserModel.createGoogleUser({ name, email, googleId, profileImage: picture, role });
      isNewUser = true;
      await AuditLogModel.log({
        userId: user.id,
        action: 'GOOGLE_REGISTER',
        entity: 'users',
        entityId: user.id,
        meta: { role, googleId, email },
        ipAddress: req.ip,
      });
    }

    if (user.status === 'blocked') return errorResponse(res, 403, 'Your account has been blocked. Contact support.');
    if (user.status === 'inactive') return errorResponse(res, 403, 'Account is inactive');

    const tokenPayload = { id: user.id, role: user.role, phone: user.phone };
    const accessToken  = generateAccessToken(tokenPayload);
    const refreshTkn   = generateRefreshToken(tokenPayload);
    const tokenHash    = hashToken(refreshTkn);

    await RefreshTokenModel.create({
      userId: user.id,
      tokenHash,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    await UserModel.updateLastLogin(user.id);

    await AuditLogModel.log({
      userId: user.id,
      action: 'GOOGLE_LOGIN',
      entity: 'users',
      entityId: user.id,
      meta: { role: user.role, googleId },
      ipAddress: req.ip,
    });

    const { password_hash, ...safeUser } = user;
    logger.info(`Google ${isNewUser ? 'register' : 'login'}: ${email} [${user.role}]`);

    return successResponse(res, isNewUser ? 201 : 200, isNewUser ? 'Account created via Google' : 'Login successful', {
      user: safeUser,
      is_new_user: isNewUser,
      needs_phone: !user.phone,
      tokens: {
        access_token:  accessToken,
        refresh_token: refreshTkn,
        token_type:    'Bearer',
        expires_in:    process.env.JWT_EXPIRES_IN || '7d',
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, registerAdmin, login, googleSignIn, sendOtp, verifyOtp, refreshToken, logout, forgotPassword, resetPassword };
