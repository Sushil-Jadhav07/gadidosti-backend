const WalletModel = require('../models/wallet.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── GET /api/admin/payouts ───────────────────────────────────────────────────
// Every driver/broker with their earnings-wallet balance and effective commission rate, in one
// list — the superadmin's main view for deciding who to pay.
const listPayoutCandidates = async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;
    const result = await WalletModel.listPayoutCandidates({
      role: role || undefined,
      search: search || undefined,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });
    return successResponse(res, 200, 'Payout candidates fetched', result);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/payouts/:userId ───────────────────────────────────────────
const getPayoutDetail = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await UserModel.findById(userId);
    if (!user || !['driver', 'broker'].includes(user.role)) return errorResponse(res, 404, 'Driver/broker not found');

    const { page = 1, limit = 20 } = req.query;
    const wallet = await WalletModel.getOrCreate(userId);
    const transactions = await WalletModel.listTransactions(userId, { page: parseInt(page), limit: Math.min(parseInt(limit), 100) });

    return successResponse(res, 200, 'Payout detail fetched', {
      balance: Number(wallet.balance),
      ...transactions,
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/payouts/:userId ──────────────────────────────────────────
// Logs that the superadmin paid this person outside the system (bank transfer, UPI, cash —
// whatever) and debits the amount from their earnings-wallet balance. No per-order tracking —
// just a running balance, same as the amount was credited without being tied to any one choice
// of settlement by the payer.
const logPayout = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { amount, note } = req.body;

    const user = await UserModel.findById(userId);
    if (!user || !['driver', 'broker'].includes(user.role)) return errorResponse(res, 404, 'Driver/broker not found');
    if (!amount || Number(amount) <= 0) return errorResponse(res, 422, 'amount must be a positive number');

    const debit = await WalletModel.debit(userId, Number(amount), { type: 'payout', note: note || undefined });
    if (debit.insufficientFunds) return errorResponse(res, 402, 'Payout amount exceeds the current wallet balance');

    await AuditLogModel.log({
      userId: req.user.id, action: 'PAYOUT_LOGGED', entity: 'wallet_transactions',
      entityId: debit.wallet.id, meta: { target_user_id: userId, amount, note: note || null }, ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId,
      title: 'Payout Received',
      message: `₹${Number(amount).toLocaleString('en-IN')} was paid out to you${note ? ` — ${note}` : ''}.`,
      type: 'payment',
      meta: { amount },
    });

    logger.info(`Payout of ${amount} logged for ${userId} by admin ${req.user.id}`);
    return successResponse(res, 200, 'Payout logged', { balance: Number(debit.wallet.balance) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/admin/payouts/:userId/commission ──────────────────────────────
// commission_rate: a number (0-100) to set an override, or null to clear it and fall back to
// the global default (admin_settings.commission_rate, the Settings page's "Commission" tab).
const setCommissionRate = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { commission_rate } = req.body;

    if (commission_rate !== null && (typeof commission_rate !== 'number' || commission_rate < 0 || commission_rate > 100)) {
      return errorResponse(res, 422, 'commission_rate must be a number between 0 and 100, or null to clear the override');
    }

    const updated = await UserModel.setCommissionRate(userId, commission_rate);
    if (!updated) return errorResponse(res, 404, 'Driver/broker not found');

    await AuditLogModel.log({
      userId: req.user.id, action: 'COMMISSION_RATE_SET', entity: 'users',
      entityId: userId, meta: { commission_rate }, ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Commission rate updated', { user: updated });
  } catch (err) {
    next(err);
  }
};

module.exports = { listPayoutCandidates, getPayoutDetail, logPayout, setCommissionRate };
