const PostpaidBillModel = require('../models/postpaidBill.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getPaymentProvider } = require('../providers/payment');

// ─── PATCH /api/admin/users/:userId/billing-type ──────────────────────────────
// Switches a client between prepaid (default, unchanged Pay Now/Advance/Wallet/To Pay flow) and
// postpaid (credit-limit-based, see booking.controller.js's createBooking). creditLimit is
// required when switching to postpaid.
const setBillingType = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { billing_type, credit_limit } = req.body;

    const target = await UserModel.findById(userId);
    if (!target || target.role !== 'client') return errorResponse(res, 404, 'Client not found');
    if (billing_type === 'postpaid' && !(Number(credit_limit) > 0)) {
      return errorResponse(res, 422, 'credit_limit is required and must be a positive number for a postpaid account');
    }

    const updated = await UserModel.setBillingType(userId, { billingType: billing_type, creditLimit: billing_type === 'postpaid' ? credit_limit : null });
    if (!updated) return errorResponse(res, 404, 'Client not found');

    await AuditLogModel.log({
      userId: req.user.id, action: 'BILLING_TYPE_SET', entity: 'users',
      entityId: userId, meta: { billing_type, credit_limit }, ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId,
      title: billing_type === 'postpaid' ? 'Postpaid Account Activated' : 'Switched to Prepaid',
      message: billing_type === 'postpaid'
        ? `Your account is now postpaid with a ₹${Number(credit_limit).toLocaleString('en-IN')} credit limit — bookings are billed later instead of paid upfront.`
        : 'Your account is now prepaid — bookings are paid for as usual.',
      type: 'payment',
    });

    return successResponse(res, 200, 'Billing type updated', { user: updated });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/postpaid-bills ─────────────────────────────────────────────
const listBills = async (req, res, next) => {
  try {
    const { client_id, status, page = 1, limit = 20 } = req.query;
    const result = await PostpaidBillModel.findAll({
      clientId: client_id || undefined, status: status || undefined,
      page: parseInt(page), limit: Math.min(parseInt(limit), 100),
    });
    return successResponse(res, 200, 'Bills fetched', result);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/postpaid-bills/:billId ─────────────────────────────────────
const getBillDetailAdmin = async (req, res, next) => {
  try {
    const bill = await PostpaidBillModel.findById(req.params.billId);
    if (!bill) return errorResponse(res, 404, 'Bill not found');
    const items = await PostpaidBillModel.getItems(bill.id);
    return successResponse(res, 200, 'Bill fetched', { bill, items });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/postpaid-bills/:billId/send ───────────────────────────────
// Explicit admin action — bills exist the moment they're generated, but the client is only
// notified once admin deliberately sends it (lets admin review the amount first).
const sendBill = async (req, res, next) => {
  try {
    const bill = await PostpaidBillModel.markSent(req.params.billId);
    if (!bill) return errorResponse(res, 404, 'Bill not found, or already paid');

    await NotificationModel.create({
      userId: bill.client_id,
      title: 'Your Bill Is Ready',
      message: `A bill for ₹${Number(bill.total_amount).toLocaleString('en-IN')} is ready — view it in My Bills.`,
      type: 'payment',
      meta: { bill_id: bill.id },
    });

    await AuditLogModel.log({
      userId: req.user.id, action: 'POSTPAID_BILL_SENT', entity: 'postpaid_bills',
      entityId: bill.id, meta: { amount: bill.total_amount }, ipAddress: req.ip,
    });

    logger.info(`Postpaid bill ${bill.id} sent to ${bill.client_id} by admin ${req.user.id}`);
    return successResponse(res, 200, 'Bill sent', { bill });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/postpaid-bills/:billId/mark-paid ──────────────────────────
// Admin logs that the client paid outside the app (bank transfer, cheque, UPI to the company
// account) — same pattern as the driver/broker payout logging.
const markBillPaidAdmin = async (req, res, next) => {
  try {
    const { payment_mode, note } = req.body;
    const bill = await PostpaidBillModel.markPaid(req.params.billId, { paymentMode: payment_mode || 'manual', note });
    if (!bill) return errorResponse(res, 404, 'Bill not found, or already paid');

    await NotificationModel.create({
      userId: bill.client_id,
      title: 'Bill Paid',
      message: `Your bill of ₹${Number(bill.total_amount).toLocaleString('en-IN')} has been marked as paid.`,
      type: 'payment',
      meta: { bill_id: bill.id },
    });

    await AuditLogModel.log({
      userId: req.user.id, action: 'POSTPAID_BILL_MARKED_PAID', entity: 'postpaid_bills',
      entityId: bill.id, meta: { payment_mode, note }, ipAddress: req.ip,
    });

    logger.info(`Postpaid bill ${bill.id} marked paid by admin ${req.user.id}`);
    return successResponse(res, 200, 'Bill marked as paid', { bill });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/bills/account (client) ────────────────────────────────────────────
// Whether this client is postpaid, their credit limit, and current outstanding balance —
// fetched fresh rather than trusted off the cached login user object (same reasoning as
// KycStatusContext on the client app: billing_type can change mid-session). This is what the
// app uses to decide whether to even show a "My Bills" nav item at all.
const getMyBillingAccount = async (req, res, next) => {
  try {
    const billingInfo = await UserModel.getBillingInfo(req.user.id);
    const outstanding = billingInfo?.billing_type === 'postpaid'
      ? await PostpaidBillModel.getOutstandingTotal(req.user.id)
      : 0;
    return successResponse(res, 200, 'Billing account fetched', {
      billing_type: billingInfo?.billing_type || 'prepaid',
      credit_limit: billingInfo?.credit_limit != null ? Number(billingInfo.credit_limit) : null,
      outstanding,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/bills (client) ────────────────────────────────────────────────────
const listMyBills = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const result = await PostpaidBillModel.findAll({
      clientId: req.user.id, status: status || undefined,
      page: parseInt(page), limit: Math.min(parseInt(limit), 100),
    });
    return successResponse(res, 200, 'Bills fetched', result);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/bills/:billId (client) ────────────────────────────────────────────
const getMyBillDetail = async (req, res, next) => {
  try {
    const bill = await PostpaidBillModel.findById(req.params.billId);
    if (!bill || bill.client_id !== req.user.id) return errorResponse(res, 404, 'Bill not found');
    const items = await PostpaidBillModel.getItems(bill.id);
    return successResponse(res, 200, 'Bill fetched', { bill, items });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bills/:billId/payment/order (client) ─────────────────────────────
const createBillPaymentOrder = async (req, res, next) => {
  try {
    const bill = await PostpaidBillModel.findById(req.params.billId);
    if (!bill || bill.client_id !== req.user.id) return errorResponse(res, 404, 'Bill not found');
    if (bill.status === 'paid') return errorResponse(res, 409, 'This bill is already paid');

    const order = await getPaymentProvider().createOrder({ bookingId: `bill_${bill.id}`, amount: Number(bill.total_amount) });
    return successResponse(res, 200, 'Order created', { order });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bills/:billId/payment/verify (client) ────────────────────────────
const verifyBillPayment = async (req, res, next) => {
  try {
    const { order_id, ...payload } = req.body;
    if (!order_id) return errorResponse(res, 422, 'order_id is required');

    const bill = await PostpaidBillModel.findById(req.params.billId);
    if (!bill || bill.client_id !== req.user.id) return errorResponse(res, 404, 'Bill not found');
    if (bill.status === 'paid') return errorResponse(res, 409, 'This bill is already paid');

    const verification = await getPaymentProvider().verifyPayment({ orderId: order_id, payload });
    if (!verification.success) return errorResponse(res, 402, 'Payment verification failed');

    const paid = await PostpaidBillModel.markPaid(bill.id, { paymentMode: 'razorpay', note: `Paid in-app, order ${order_id}` });

    await AuditLogModel.log({
      userId: req.user.id, action: 'POSTPAID_BILL_PAID_BY_CLIENT', entity: 'postpaid_bills',
      entityId: bill.id, meta: { amount: bill.total_amount, order_id }, ipAddress: req.ip,
    });

    logger.info(`Postpaid bill ${bill.id} paid in-app by client ${req.user.id}`);
    return successResponse(res, 200, 'Bill paid', { bill: paid });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  setBillingType, listBills, getBillDetailAdmin, sendBill, markBillPaidAdmin,
  getMyBillingAccount, listMyBills, getMyBillDetail, createBillPaymentOrder, verifyBillPayment,
};
