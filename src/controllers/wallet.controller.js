const WalletModel = require('../models/wallet.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getPaymentProvider } = require('../providers/payment');

const MIN_RECHARGE_AMOUNT = 100;

// ─── GET /api/wallet ──────────────────────────────────────────────────────────────
const getWallet = async (req, res, next) => {
  try {
    const wallet = await WalletModel.getOrCreate(req.user.id);
    return successResponse(res, 200, 'Wallet fetched', { balance: Number(wallet.balance) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/wallet/transactions ────────────────────────────────────────────────
const listTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await WalletModel.listTransactions(req.user.id, { page: parseInt(page), limit: Math.min(parseInt(limit), 100) });
    return successResponse(res, 200, 'Transactions fetched', result);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/wallet/recharge/order ─────────────────────────────────────────────
// Opens a gateway order for the recharge amount, same mechanism booking payments use
// (createPaymentOrder in booking.controller.js) — just not tied to a booking_id. The intended
// amount is cached server-side (WalletModel.savePendingRecharge) so /recharge/verify credits
// that amount, never whatever the verify call itself claims.
const createRechargeOrder = async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || Number(amount) < MIN_RECHARGE_AMOUNT) {
      return errorResponse(res, 422, `Minimum recharge amount is ₹${MIN_RECHARGE_AMOUNT}`);
    }

    const syntheticId = `wallet_${req.user.id}_${Date.now()}`;
    const order = await getPaymentProvider().createOrder({ bookingId: syntheticId, amount: Number(amount) });
    await WalletModel.savePendingRecharge(req.user.id, { orderId: order.orderId, amount: Number(amount) });

    return successResponse(res, 200, 'Order created', { order });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/wallet/recharge/verify ────────────────────────────────────────────
const verifyRecharge = async (req, res, next) => {
  try {
    const { order_id, ...payload } = req.body;
    if (!order_id) return errorResponse(res, 422, 'order_id is required');

    const pending = await WalletModel.getPendingRecharge(req.user.id);
    if (!pending || pending.order_id !== order_id) {
      return errorResponse(res, 409, 'This order does not match your pending recharge — start a new recharge.');
    }

    const verification = await getPaymentProvider().verifyPayment({ orderId: order_id, payload });
    if (!verification.success) return errorResponse(res, 402, 'Payment verification failed');

    const wallet = await WalletModel.credit(req.user.id, Number(pending.amount), { type: 'recharge', referenceOrderId: order_id });
    await WalletModel.clearPendingRecharge(req.user.id);

    await AuditLogModel.log({
      userId: req.user.id, action: 'WALLET_RECHARGED', entity: 'wallets',
      entityId: wallet.id, meta: { amount: pending.amount, order_id }, ipAddress: req.ip,
    });

    logger.info(`Wallet recharged for ${req.user.id}: +${pending.amount}`);
    return successResponse(res, 200, 'Wallet recharged', { balance: Number(wallet.balance) });
  } catch (err) {
    next(err);
  }
};

module.exports = { getWallet, listTransactions, createRechargeOrder, verifyRecharge };
