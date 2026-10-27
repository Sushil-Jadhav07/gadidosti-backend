const express = require('express');
const router = express.Router();

const {
  setBillingType, listBills, getBillDetailAdmin, sendBill, markBillPaidAdmin,
  getMyBillingAccount, listMyBills, getMyBillDetail, createBillPaymentOrder, verifyBillPayment,
} = require('../controllers/postpaidBill.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { setBillingTypeValidation, markBillPaidValidation } = require('../validations/postpaidBill.validation');

// ─── Admin (superadmin-only, never staff — handles real money, same reasoning as
// geofencing/payouts) ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/users/{userId}/billing-type:
 *   patch:
 *     tags: [Postpaid Billing]
 *     summary: Switch a client between prepaid and postpaid, setting their credit limit (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [billing_type]
 *             properties:
 *               billing_type: { type: string, enum: [prepaid, postpaid] }
 *               credit_limit: { type: number, example: 50000, description: "Required when billing_type is postpaid" }
 *     responses:
 *       200:
 *         description: Billing type updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.patch('/admin/users/:userId/billing-type', authenticate, authorize('admin'), setBillingTypeValidation, validate, setBillingType);

/**
 * @swagger
 * /api/admin/postpaid-bills:
 *   get:
 *     tags: [Postpaid Billing]
 *     summary: List postpaid bills (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: client_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, paid] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Bills fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/admin/postpaid-bills', authenticate, authorize('admin'), listBills);

/**
 * @swagger
 * /api/admin/postpaid-bills/{billId}:
 *   get:
 *     tags: [Postpaid Billing]
 *     summary: One bill's detail + line items (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: billId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bill fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/admin/postpaid-bills/:billId', authenticate, authorize('admin'), getBillDetailAdmin);

/**
 * @swagger
 * /api/admin/postpaid-bills/{billId}/send:
 *   post:
 *     tags: [Postpaid Billing]
 *     summary: Send the bill to the client (admin only)
 *     description: Notifies the client the bill is ready to pay. The bill exists the moment it's generated — this is the explicit step that tells the client about it.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: billId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bill sent
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Bill not found, or already paid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/admin/postpaid-bills/:billId/send', authenticate, authorize('admin'), sendBill);

/**
 * @swagger
 * /api/admin/postpaid-bills/{billId}/mark-paid:
 *   post:
 *     tags: [Postpaid Billing]
 *     summary: Log that the client paid this bill outside the app (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: billId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               payment_mode: { type: string, example: "bank_transfer" }
 *               note: { type: string, example: "Paid via NEFT, ref #12345" }
 *     responses:
 *       200:
 *         description: Bill marked as paid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/admin/postpaid-bills/:billId/mark-paid', authenticate, authorize('admin'), markBillPaidValidation, validate, markBillPaidAdmin);

// ─── Client — own bills ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/bills/account:
 *   get:
 *     tags: [Postpaid Billing]
 *     summary: Own billing type, credit limit, and outstanding balance (client only)
 *     description: Fetched fresh, not trusted off the login user object — what the app uses to decide whether to show "My Bills" at all.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Billing account fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/bills/account', authenticate, authorize('client'), getMyBillingAccount);

/**
 * @swagger
 * /api/bills:
 *   get:
 *     tags: [Postpaid Billing]
 *     summary: List own postpaid bills (client only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Bills fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/bills', authenticate, authorize('client'), listMyBills);

/**
 * @swagger
 * /api/bills/{billId}:
 *   get:
 *     tags: [Postpaid Billing]
 *     summary: One own bill's detail + line items (client only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: billId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bill fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/bills/:billId', authenticate, authorize('client'), getMyBillDetail);

/**
 * @swagger
 * /api/bills/{billId}/payment/order:
 *   post:
 *     tags: [Postpaid Billing]
 *     summary: Open a Razorpay order to pay this bill in-app (client only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: billId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/bills/:billId/payment/order', authenticate, authorize('client'), createBillPaymentOrder);

/**
 * @swagger
 * /api/bills/{billId}/payment/verify:
 *   post:
 *     tags: [Postpaid Billing]
 *     summary: Verify the Razorpay payment and mark the bill paid (client only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: billId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [order_id]
 *             properties:
 *               order_id: { type: string }
 *     responses:
 *       200:
 *         description: Bill paid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       402:
 *         description: Payment verification failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bills/:billId/payment/verify', authenticate, authorize('client'), verifyBillPayment);

module.exports = router;
