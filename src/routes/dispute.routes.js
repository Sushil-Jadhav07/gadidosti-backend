const express = require('express');
const router = express.Router();

const { createDispute, listDisputes, getDispute, resolveDispute } = require('../controllers/dispute.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { createDisputeValidation, resolveDisputeValidation } = require('../validations/dispute.validation');

/**
 * @swagger
 * /api/disputes:
 *   post:
 *     tags: [Disputes]
 *     summary: Raise a dispute on a booking (client/broker)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateDisputeRequest' }
 *     responses:
 *       201:
 *         description: Dispute raised
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors — booking_id/issue_type/description are required, issue_type must be a recognized value
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/disputes', authenticate, authorize('client', 'broker'), createDisputeValidation, validate, createDispute);

/**
 * @swagger
 * /api/disputes:
 *   get:
 *     tags: [Disputes]
 *     summary: List disputes (admin -> all with filters, client/broker -> own)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, under_review, resolved] }
 *       - in: query
 *         name: issue_type
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Disputes fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/disputes', authenticate, listDisputes);

/**
 * @swagger
 * /api/disputes/{id}:
 *   get:
 *     tags: [Disputes]
 *     summary: Get a dispute by ID
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Dispute fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Dispute not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/disputes/:id', authenticate, getDispute);

/**
 * @swagger
 * /api/disputes/{id}/resolve:
 *   patch:
 *     tags: [Disputes]
 *     summary: Resolve a dispute (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resolution]
 *             properties:
 *               resolution: { type: string }
 *     responses:
 *       200:
 *         description: Dispute resolved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Already resolved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/disputes/:id/resolve', authenticate, authorize('admin'), resolveDisputeValidation, validate, resolveDispute);

module.exports = router;
