const express = require('express');
const router = express.Router();

const { getThreadForBooking, listMessages, sendMessage, markThreadRead, getUnreadCount } = require('../controllers/chat.controller');
const { authenticate } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { sendMessageValidation } = require('../validations/chat.validation');

/**
 * @swagger
 * /api/chat/bookings/{bookingId}/thread:
 *   get:
 *     tags: [Chat]
 *     summary: Get (or lazily create) the chat thread for a booking
 *     description: Thread participants are the booking's client + assigned broker + assigned driver (pulled live from bookings.client_id/broker_id/driver_id). Admin can always view (read-only); everyone else must be one of those three.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Thread fetched
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
 *                         thread:  { $ref: '#/components/schemas/ChatThread' }
 *                         canSend: { type: boolean, description: 'False for admin (read-only) or anyone not yet a participant on the booking' }
 *       403:
 *         description: Not a participant on this booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Booking not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/chat/bookings/:bookingId/thread', authenticate, getThreadForBooking);

/**
 * @swagger
 * /api/chat/threads/{threadId}/messages:
 *   get:
 *     tags: [Chat]
 *     summary: List a thread's message history (paginated, oldest-first per page)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: threadId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *     responses:
 *       200:
 *         description: Messages fetched
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
 *                         messages:    { type: array, items: { $ref: '#/components/schemas/ChatMessage' } }
 *                         total:       { type: integer }
 *                         page:        { type: integer }
 *                         limit:       { type: integer }
 *                         total_pages: { type: integer }
 *       403:
 *         description: Not a participant on this thread's booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/chat/threads/:threadId/messages', authenticate, listMessages);

/**
 * @swagger
 * /api/chat/threads/{threadId}/messages:
 *   post:
 *     tags: [Chat]
 *     summary: Send a message (REST fallback — prefer the 'send-message' socket event for live delivery)
 *     description: REST is the source of truth for history; this endpoint and the socket 'send-message' event share the exact same write path, so a message sent either way is broadcast to everyone connected to the thread's socket room.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: threadId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *     responses:
 *       201:
 *         description: Message sent
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
 *                         message: { $ref: '#/components/schemas/ChatMessage' }
 *       403:
 *         description: Not a participant on this thread's booking (admin is read-only)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/chat/threads/:threadId/messages', authenticate, sendMessageValidation, validate, sendMessage);

/**
 * @swagger
 * /api/chat/threads/{threadId}/read:
 *   patch:
 *     tags: [Chat]
 *     summary: Mark every unread message in a thread as read (by the authenticated user)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: threadId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Thread marked read
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
 *                         markedCount: { type: integer, description: 'How many messages flipped from unread to read' }
 */
router.patch('/chat/threads/:threadId/read', authenticate, markThreadRead);

/**
 * @swagger
 * /api/chat/unread-count:
 *   get:
 *     tags: [Chat]
 *     summary: Total unread chat message count across every thread the user participates in
 *     description: Powers the chat badge in each app's header/navbar, same idea as GET /api/users/notifications' unread_count.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count fetched
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
 *                         unreadCount: { type: integer }
 */
router.get('/chat/unread-count', authenticate, getUnreadCount);

module.exports = router;
