const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const {
  register,
  registerAdmin,
  login,
  adminLogin,
  sendOtp,
  verifyOtp,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
} = require('../controllers/auth.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  registerValidation,
  registerAdminValidation,
  loginValidation,
  adminLoginValidation,
  sendOtpValidation,
  verifyOtpValidation,
  refreshTokenValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
} = require('../validations/auth.validation');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many requests, please try again later' },
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many OTP requests, please wait 10 minutes' },
});

// ─── ADMIN PORTAL ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/admin/login:
 *   post:
 *     tags: [Admin Portal — Auth]
 *     summary: Admin login (email + password)
 *     description: |
 *       Authenticates an **admin** using email address and password.
 *
 *       - Only accounts with `role: admin` can use this endpoint.
 *       - Admin accounts are pre-seeded — self-registration is not available.
 *       - On success, admin has access to all `Admin Management` endpoints.
 *       - Regular users (client, broker, driver) must use `POST /api/auth/login`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminLoginRequest'
 *           example:
 *             email: "admin@ssklogistics.in"
 *             password: "Admin@123456"
 *     responses:
 *       200:
 *         description: Admin login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *             example:
 *               success: true
 *               message: "Login successful"
 *               data:
 *                 user:
 *                   id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   name: "SSK Admin"
 *                   email: "admin@ssklogistics.in"
 *                   phone: "9000000001"
 *                   role: "admin"
 *                   status: "active"
 *                   is_phone_verified: true
 *                   is_email_verified: true
 *                 tokens:
 *                   access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   token_type: "Bearer"
 *                   expires_in: "7d"
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Account is blocked or not an admin account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/admin/login', authLimiter, adminLoginValidation, validate, adminLogin);

/**
 * @swagger
 * /api/auth/admin/register:
 *   post:
 *     tags: [Admin Portal — Auth]
 *     summary: Create a new admin account
 *     description: |
 *       Creates a new **admin** account. This endpoint is protected — only an existing admin
 *       can create another admin.
 *
 *       - The new admin account is immediately **active** and **verified** (no OTP required).
 *       - Email is **required** for admin accounts (used for login).
 *       - The action is audit-logged showing which admin performed the creation.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminRegisterRequest'
 *           example:
 *             name: "Operations Manager"
 *             phone: "9000000099"
 *             email: "manager@ssklogistics.in"
 *             password: "Manager@123"
 *     responses:
 *       201:
 *         description: Admin account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RegisterResponse'
 *             example:
 *               success: true
 *               message: "Admin account created successfully"
 *               data:
 *                 user:
 *                   id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *                   name: "Operations Manager"
 *                   email: "manager@ssklogistics.in"
 *                   phone: "9000000099"
 *                   role: "admin"
 *                   status: "active"
 *                   is_phone_verified: true
 *                   is_email_verified: true
 *       401:
 *         description: Not authenticated — provide a valid admin Bearer token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Access denied — admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Phone or email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/admin/register', authenticate, authorize('admin'), registerAdminValidation, validate, registerAdmin);

// ─── BROKER / DRIVER & CLIENT PORTAL — REGISTRATION ──────────────────────────

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Broker/Driver Portal — Auth, Client Portal — Auth]
 *     summary: Register a new user (client, broker, or driver)
 *     description: |
 *       Creates a new user account. After registration, verify the phone number via OTP before logging in.
 *
 *       **Admin accounts cannot be created through this endpoint.** They are pre-seeded.
 *
 *       **Role behaviour:**
 *       - `client` — registers in the Client Portal (default)
 *       - `broker` — registers in the Broker/Driver Portal as a fleet owner
 *       - `driver` — registers in the Broker/Driver Portal as a truck driver
 *
 *       **After registration:**
 *       1. Call `POST /api/auth/otp/send` with `purpose: phone_verify`
 *       2. Call `POST /api/auth/otp/verify` with the received OTP
 *       3. Then `POST /api/auth/login` will work
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, password]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *               phone:
 *                 type: string
 *                 description: 10-digit Indian mobile number
 *               email:
 *                 type: string
 *                 format: email
 *                 nullable: true
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Min 8 chars with uppercase, lowercase and a number
 *               role:
 *                 type: string
 *                 enum: [client, broker, driver]
 *                 default: client
 *           examples:
 *             client:
 *               summary: Register as Client
 *               value:
 *                 name: "Rajesh Kumar"
 *                 phone: "9876543210"
 *                 email: "rajesh@example.com"
 *                 password: "Client@123"
 *                 role: "client"
 *             broker:
 *               summary: Register as Broker
 *               value:
 *                 name: "Suresh Transport Co."
 *                 phone: "9000000003"
 *                 email: "suresh@transport.in"
 *                 password: "Broker@123"
 *                 role: "broker"
 *             driver:
 *               summary: Register as Driver
 *               value:
 *                 name: "Ramesh Singh"
 *                 phone: "9000000004"
 *                 password: "Driver@123"
 *                 role: "driver"
 *     responses:
 *       201:
 *         description: Registration successful — verify phone OTP to activate account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RegisterResponse'
 *             example:
 *               success: true
 *               message: "Registration successful. Please verify your phone number."
 *               data:
 *                 user:
 *                   id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   name: "Rajesh Kumar"
 *                   phone: "9876543210"
 *                   role: "client"
 *                   status: "pending_verification"
 *                   is_phone_verified: false
 *       409:
 *         description: Phone or email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/register', authLimiter, registerValidation, validate, register);

// ─── BROKER / DRIVER & CLIENT PORTAL — LOGIN ──────────────────────────────────

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Broker/Driver Portal — Auth, Client Portal — Auth]
 *     summary: Login with phone and password (broker, driver, or client)
 *     description: |
 *       Authenticates a user with phone number and password. Returns `access_token` + `refresh_token`.
 *
 *       - **Phone must be OTP-verified** before login is allowed (status: active).
 *       - For Admin login, use `POST /api/auth/admin/login` (email-based).
 *       - The `role` field in the response determines which portal the user belongs to.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PhoneLoginRequest'
 *           examples:
 *             client:
 *               summary: Client login (seeded demo account)
 *               value:
 *                 phone: "9000000002"
 *                 password: "Admin@123456"
 *             broker:
 *               summary: Broker login (seeded demo account)
 *               value:
 *                 phone: "9000000003"
 *                 password: "Admin@123456"
 *             driver:
 *               summary: Driver login (seeded demo account)
 *               value:
 *                 phone: "9000000004"
 *                 password: "Admin@123456"
 *     responses:
 *       200:
 *         description: Login successful — use `access_token` in Authorization header for protected routes
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *             example:
 *               success: true
 *               message: "Login successful"
 *               data:
 *                 user:
 *                   id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   name: "Rajesh Kumar"
 *                   phone: "9876543210"
 *                   role: "client"
 *                   status: "active"
 *                   is_phone_verified: true
 *                 tokens:
 *                   access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   token_type: "Bearer"
 *                   expires_in: "7d"
 *       401:
 *         description: Invalid phone or password (note: all seeded demo accounts use Admin@123456)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Account blocked, inactive, or phone not yet verified
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login', authLimiter, loginValidation, validate, login);

// ─── COMMON AUTH — OTP ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/otp/send:
 *   post:
 *     tags: [Common Auth]
 *     summary: Send OTP to a phone number
 *     description: |
 *       Sends a 6-digit OTP to the provided phone number.
 *       Rate limited to **3 OTPs per 10 minutes** per phone number.
 *
 *       **Purpose values:**
 *       - `phone_verify` — after registration to verify phone and activate account
 *       - `login` — OTP-based login (skips password)
 *       - `password_reset` — used by `POST /api/auth/forgot-password`
 *
 *       In **development mode**, the OTP is returned in the response as `dev_otp`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *               purpose:
 *                 type: string
 *                 enum: [registration, login, password_reset, phone_verify]
 *                 default: login
 *                 example: phone_verify
 *           examples:
 *             phone_verify:
 *               summary: Verify phone after registration
 *               value:
 *                 phone: "9876543210"
 *                 purpose: "phone_verify"
 *             otp_login:
 *               summary: OTP-based login
 *               value:
 *                 phone: "9876543210"
 *                 purpose: "login"
 *             password_reset:
 *               summary: Forgot password OTP
 *               value:
 *                 phone: "9876543210"
 *                 purpose: "password_reset"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         phone:              { type: string }
 *                         purpose:            { type: string }
 *                         expires_in_minutes: { type: integer, example: 10 }
 *                         dev_otp:            { type: string, description: "Only in development mode" }
 *       429:
 *         description: Too many OTP requests — wait 10 minutes
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/otp/send', otpLimiter, sendOtpValidation, validate, sendOtp);

/**
 * @swagger
 * /api/auth/otp/verify:
 *   post:
 *     tags: [Common Auth]
 *     summary: Verify OTP
 *     description: |
 *       Verifies the OTP sent to a phone number.
 *
 *       **Behaviour by purpose:**
 *       - `phone_verify` — marks phone as verified, activates account (status: active)
 *       - `login` — marks phone as verified AND returns auth tokens (OTP login)
 *       - `password_reset` — validates OTP for password reset flow (use with `/api/auth/reset-password`)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, otp]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *               otp:
 *                 type: string
 *                 example: "482619"
 *                 description: 6-digit numeric OTP
 *               purpose:
 *                 type: string
 *                 enum: [registration, login, password_reset, phone_verify]
 *                 default: login
 *           examples:
 *             phone_verify:
 *               summary: Verify phone after registration
 *               value:
 *                 phone: "9876543210"
 *                 otp: "482619"
 *                 purpose: "phone_verify"
 *             otp_login:
 *               summary: OTP-based login
 *               value:
 *                 phone: "9876543210"
 *                 otp: "482619"
 *                 purpose: "login"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/otp/verify', otpLimiter, verifyOtpValidation, validate, verifyOtp);

// ─── COMMON AUTH — FORGOT / RESET PASSWORD ────────────────────────────────────

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Common Auth]
 *     summary: Request a password reset OTP
 *     description: |
 *       Sends a 6-digit OTP to the registered phone number to initiate password reset.
 *       Rate limited to **3 requests per 10 minutes**.
 *
 *       **Flow:**
 *       1. Call this endpoint → OTP sent to phone
 *       2. Call `POST /api/auth/reset-password` with the OTP + new password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *           example:
 *             phone: "9876543210"
 *     responses:
 *       200:
 *         description: OTP sent — valid for 10 minutes
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         phone:              { type: string }
 *                         expires_in_minutes: { type: integer, example: 10 }
 *                         dev_otp:            { type: string, description: "Only in development mode" }
 *       404:
 *         description: No account found with this phone number
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many OTP requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/forgot-password', otpLimiter, forgotPasswordValidation, validate, forgotPassword);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     tags: [Common Auth]
 *     summary: Reset password using OTP
 *     description: |
 *       Resets the user's password using the OTP received from `POST /api/auth/forgot-password`.
 *       The OTP is **single-use** and expires in 10 minutes.
 *
 *       After successful reset, log in using `POST /api/auth/login` with the new password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *           example:
 *             phone: "9876543210"
 *             otp: "482619"
 *             new_password: "NewPass@123"
 *     responses:
 *       200:
 *         description: Password reset successful — login with new password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: No account found with this phone number
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/reset-password', otpLimiter, resetPasswordValidation, validate, resetPassword);

// ─── COMMON AUTH — TOKEN MANAGEMENT ─────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     tags: [Common Auth]
 *     summary: Refresh access token
 *     description: |
 *       Uses a valid refresh token to issue a new `access_token` and a rotated `refresh_token`.
 *       The **old refresh token is invalidated** after this call (token rotation for security).
 *
 *       Store the new `refresh_token` for the next rotation call.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token:
 *                 type: string
 *                 example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       200:
 *         description: Tokens refreshed — store the new refresh_token
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         tokens:
 *                           $ref: '#/components/schemas/AuthTokens'
 *       401:
 *         description: Invalid or expired refresh token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/refresh-token', refreshTokenValidation, validate, refreshToken);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Common Auth]
 *     summary: Logout user
 *     description: |
 *       Revokes the refresh token so it cannot be used again.
 *       Pass `all_devices: true` to revoke **all** refresh tokens for this user (logout everywhere).
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refresh_token:
 *                 type: string
 *                 example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               all_devices:
 *                 type: boolean
 *                 default: false
 *                 description: If true, revokes all sessions for this user
 *           examples:
 *             single_device:
 *               summary: Logout from this device
 *               value:
 *                 refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 all_devices: false
 *             all_devices:
 *               summary: Logout from all devices
 *               value:
 *                 all_devices: true
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/logout', authenticate, logout);

module.exports = router;
