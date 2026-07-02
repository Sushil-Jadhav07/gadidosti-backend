const express = require('express');
const router = express.Router();

const {
  getProfile,
  updateProfile,
  changePassword,
  getAllUsers,
  getUserById,
  updateUserStatus,
  deleteUser,
} = require('../controllers/user.controller');
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../controllers/notification.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  updateProfileValidation,
  changePasswordValidation,
  updateUserStatusValidation,
} = require('../validations/auth.validation');

// ─── Authenticated user — own profile ────────────────────────────────────────

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     tags: [User Profile]
 *     summary: Get own profile
 *     description: Returns the authenticated user's profile information.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profile fetched
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
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/users/profile', authenticate, getProfile);

/**
 * @swagger
 * /api/users/profile:
 *   patch:
 *     tags: [User Profile]
 *     summary: Update own profile
 *     description: Updates name, email, profile photo, address, and/or company name for the authenticated user. All fields are optional — only send what changed.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Rajesh Kumar
 *               email:
 *                 type: string
 *                 format: email
 *                 example: rajesh@example.com
 *               profile_image:
 *                 type: string
 *                 example: "https://s3.amazonaws.com/ssk/profiles/abc.jpg"
 *                 nullable: true
 *               address:
 *                 type: string
 *                 example: "12 MG Road, Pune, Maharashtra 411001"
 *                 nullable: true
 *               company_name:
 *                 type: string
 *                 example: "Suresh Transport Co."
 *                 description: Business/company name — clients booking on behalf of a business, brokers, etc.
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Profile updated
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
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *       409:
 *         description: Email already in use
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
router.patch('/users/profile', authenticate, updateProfileValidation, validate, updateProfile);

/**
 * @swagger
 * /api/users/change-password:
 *   patch:
 *     tags: [User Profile]
 *     summary: Change password
 *     description: |
 *       Changes the authenticated user's password. Requires the current password.
 *
 *       For users who forgot their password (locked out, don't know the current one), use
 *       `POST /api/auth/forgot-password` + `POST /api/auth/reset-password` instead.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_password, new_password]
 *             properties:
 *               current_password:
 *                 type: string
 *                 format: password
 *                 example: "OldPass@123"
 *               new_password:
 *                 type: string
 *                 format: password
 *                 example: "NewPass@456"
 *                 description: Min 6 characters
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Current password incorrect
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/users/change-password', authenticate, changePasswordValidation, validate, changePassword);

// ─── Authenticated user — notifications ──────────────────────────────────────

/**
 * @swagger
 * /api/users/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List notifications
 *     description: Returns the authenticated user's notifications (booking accepted, driver assigned, payment received, etc.), newest first, paginated.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Notifications fetched
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
 *                         notifications:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Notification'
 *                         total: { type: integer, example: 12 }
 *                         unread_count: { type: integer, example: 3 }
 *                         page: { type: integer, example: 1 }
 *                         limit: { type: integer, example: 20 }
 *                         total_pages: { type: integer, example: 1 }
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/users/notifications', authenticate, getNotifications);

/**
 * @swagger
 * /api/users/notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark one notification as read
 *     description: Clears the unread state for a single notification belonging to the authenticated user.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Notification UUID
 *     responses:
 *       200:
 *         description: Notification marked as read
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
 *                         notification:
 *                           $ref: '#/components/schemas/Notification'
 *       404:
 *         description: Notification not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/users/notifications/:id/read', authenticate, markNotificationRead);

/**
 * @swagger
 * /api/users/notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark all notifications as read
 *     description: Clears the unread badge — marks every unread notification for the authenticated user as read.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
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
 *                         updated: { type: integer, example: 3, description: "Number of notifications marked read" }
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/users/notifications/read-all', authenticate, markAllNotificationsRead);

// ─── Admin — user management ──────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     tags: [Admin Management]
 *     summary: List all users
 *     description: Admin-only. Returns paginated list of all users with optional filters.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [client, broker, driver, admin] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive, blocked, pending_verification] }
 *       - in: query
 *         name: kyc_status
 *         schema: { type: string, enum: [not_submitted, pending, approved, rejected] }
 *         description: Filter by broker/driver KYC review status
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Users listed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedUsers'
 *       403:
 *         description: Admin access required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/admin/users', authenticate, authorize('admin'), getAllUsers);

/**
 * @swagger
 * /api/admin/users/{id}:
 *   get:
 *     tags: [Admin Management]
 *     summary: Get user by ID
 *     description: Admin-only. Fetch full details of any user by their UUID.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User UUID
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     responses:
 *       200:
 *         description: User fetched
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
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/admin/users/:id', authenticate, authorize('admin'), getUserById);

/**
 * @swagger
 * /api/admin/users/{id}/status:
 *   patch:
 *     tags: [Admin Management]
 *     summary: Block or unblock a user
 *     description: Admin-only. Changes user status to active, inactive, or blocked. Cannot modify other admin accounts.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, inactive, blocked]
 *                 example: blocked
 *     responses:
 *       200:
 *         description: User status updated
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
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *       403:
 *         description: Cannot modify admin account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/admin/users/:id/status', authenticate, authorize('admin'), updateUserStatusValidation, validate, updateUserStatus);

/**
 * @swagger
 * /api/admin/users/{id}:
 *   delete:
 *     tags: [Admin Management]
 *     summary: Delete a user
 *     description: Admin-only. Soft-deletes a user (sets status to inactive). Cannot delete own account or other admins.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User UUID
 *     responses:
 *       200:
 *         description: User deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Cannot delete admin account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/admin/users/:id', authenticate, authorize('admin'), deleteUser);

module.exports = router;
