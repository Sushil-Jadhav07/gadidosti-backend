const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const {
  register,
  registerAdmin,
  login,
  googleSignIn,
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
  googleSignInValidation,
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

// ─── LOGIN (all roles) ───────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login (all roles)
 *     description: |
 *       Unified login for **all roles** — admin, broker, driver, client.
 *
 *       - **Admin** — pass `email` + `password` (admin accounts use email login)
 *       - **Broker / Driver / Client** — pass `phone` + `password`
 *       - At least one of `email` or `phone` is required.
 *       - Non-admin accounts must have a verified phone before login works.
 *       - The `role` field in the response tells the frontend which portal to load.
 *
 *       **Seeded demo accounts** (password for all is `Admin@123456`):
 *       | Role   | Identifier                |
 *       |--------|---------------------------|
 *       | admin  | admin@ssklogistics.in      |
 *       | client | 9000000002                 |
 *       | broker | 9000000003                 |
 *       | driver | 9000000004                 |
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Use for admin login
 *               phone:
 *                 type: string
 *                 description: 10-digit Indian mobile number (broker/driver/client)
 *               password:
 *                 type: string
 *                 format: password
 *           examples:
 *             admin:
 *               summary: Admin login (email)
 *               value:
 *                 email: "admin@ssklogistics.in"
 *                 password: "Admin@123456"
 *             client:
 *               summary: Client login (phone)
 *               value:
 *                 phone: "9000000002"
 *                 password: "Admin@123456"
 *             broker:
 *               summary: Broker login (phone)
 *               value:
 *                 phone: "9000000003"
 *                 password: "Admin@123456"
 *             driver:
 *               summary: Driver login (phone)
 *               value:
 *                 phone: "9000000004"
 *                 password: "Admin@123456"
 *     responses:
 *       200:
 *         description: Login successful
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
 *                 tokens:
 *                   access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   token_type: "Bearer"
 *                   expires_in: "7d"
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Account blocked, inactive, or phone not verified
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

// ─── REGISTER (client / broker / driver) ─────────────────────────────────────

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register (client, broker, or driver)
 *     description: |
 *       Creates a new user account with the specified role.
 *
 *       **Roles:**
 *       - `client` (default) — Client Portal user
 *       - `broker` — Broker/Driver Portal fleet owner
 *       - `driver` — Broker/Driver Portal truck driver
 *
 *       Admin accounts **cannot** be created here — use `POST /api/auth/admin/register` (requires admin token).
 *
 *       **After registration:**
 *       1. `POST /api/auth/otp/send` with `purpose: phone_verify`
 *       2. `POST /api/auth/otp/verify` with the OTP
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
 *                 description: Min 6 characters
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
 *                 password: "mypassword"
 *                 role: "client"
 *             broker:
 *               summary: Register as Broker
 *               value:
 *                 name: "Suresh Transport Co."
 *                 phone: "9876543211"
 *                 email: "suresh@transport.in"
 *                 password: "mypassword"
 *                 role: "broker"
 *             driver:
 *               summary: Register as Driver
 *               value:
 *                 name: "Ramesh Singh"
 *                 phone: "9876543212"
 *                 password: "mypassword"
 *                 role: "driver"
 *     responses:
 *       201:
 *         description: Registration successful — verify phone OTP to activate
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

// ─── ADMIN REGISTER (protected) ──────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/admin/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create admin account (admin only)
 *     description: |
 *       Creates a new **admin** account. Requires an existing admin's Bearer token.
 *
 *       - Admin accounts are immediately **active** and **verified** (no OTP needed).
 *       - Email is **required** for admin accounts.
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
 *             password: "Manager123"
 *     responses:
 *       201:
 *         description: Admin account created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RegisterResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Admin role required
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

// ─── GOOGLE SIGN-IN ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/google:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in / Sign up with Google
 *     description: |
 *       Authenticates a user using a Google ID token (credential) from the frontend.
 *
 *       **Behaviour:**
 *       - If the Google account is already linked → login
 *       - If the email matches an existing phone account → link Google + login
 *       - If no account exists → create a new account with the given role
 *
 *       Admin accounts **cannot** use Google Sign-In.
 *
 *       **Response flags:**
 *       - `is_new_user` — true if the account was just created
 *       - `needs_phone` — true if the user has no phone number yet (prompt them to add one)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GoogleSignInRequest'
 *           examples:
 *             client:
 *               summary: Google sign-in as client
 *               value:
 *                 id_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 role: "client"
 *             broker:
 *               summary: Google sign-in as broker
 *               value:
 *                 id_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 role: "broker"
 *     responses:
 *       200:
 *         description: Returning user logged in
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       201:
 *         description: New account created via Google
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid or expired Google token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Email not verified, account blocked, or admin role attempted
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
router.post('/google', authLimiter, googleSignInValidation, validate, googleSignIn);

// ─── OTP ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/otp/send:
 *   post:
 *     tags: [Auth]
 *     summary: Send OTP
 *     description: |
 *       Sends a 6-digit OTP to the phone number. Rate limited to 3 per 10 minutes.
 *
 *       **Purpose values:**
 *       - `phone_verify` — verify phone after registration
 *       - `login` — OTP-based login
 *       - `password_reset` — for forgot-password flow
 *
 *       In development mode the OTP is returned as `dev_otp`.
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
 *           examples:
 *             phone_verify:
 *               summary: Verify phone after registration
 *               value:
 *                 phone: "9876543210"
 *                 purpose: "phone_verify"
 *             password_reset:
 *               summary: Forgot password
 *               value:
 *                 phone: "9876543210"
 *                 purpose: "password_reset"
 *     responses:
 *       200:
 *         description: OTP sent
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
 *                         dev_otp:            { type: string, description: "Dev mode only" }
 *       429:
 *         description: Too many OTP requests
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
 *     tags: [Auth]
 *     summary: Verify OTP
 *     description: |
 *       Verifies the OTP sent to a phone number.
 *
 *       - `phone_verify` — activates account (status: active)
 *       - `login` — activates + returns auth tokens
 *       - `password_reset` — validates OTP for reset flow
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
 *         description: OTP verified
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
 */
router.post('/otp/verify', otpLimiter, verifyOtpValidation, validate, verifyOtp);

// ─── FORGOT / RESET PASSWORD ─────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request password reset OTP
 *     description: |
 *       Sends OTP to the registered phone for password reset.
 *
 *       **Flow:** call this → then `POST /api/auth/reset-password` with OTP + new password.
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
 *         description: OTP sent
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
 *                         dev_otp:            { type: string, description: "Dev mode only" }
 *       404:
 *         description: No account found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many requests
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
 *     tags: [Auth]
 *     summary: Reset password with OTP
 *     description: |
 *       Resets password using the OTP from `POST /api/auth/forgot-password`.
 *       After success, login with the new password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *           example:
 *             phone: "9876543210"
 *             otp: "482619"
 *             new_password: "NewPass123"
 *     responses:
 *       200:
 *         description: Password reset successful
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
 *         description: No account found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/reset-password', otpLimiter, resetPasswordValidation, validate, resetPassword);

// ─── TOKEN MANAGEMENT ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     description: |
 *       Issues new tokens using a valid refresh token. The old refresh token is invalidated (rotation).
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
 *         description: Tokens refreshed
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
 *     tags: [Auth]
 *     summary: Logout
 *     description: |
 *       Revokes the refresh token. Pass `all_devices: true` to logout everywhere.
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
 *               all_devices:
 *                 type: boolean
 *                 default: false
 *           examples:
 *             single:
 *               summary: Logout this device
 *               value:
 *                 refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 all_devices: false
 *             all:
 *               summary: Logout all devices
 *               value:
 *                 all_devices: true
 *     responses:
 *       200:
 *         description: Logged out
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
