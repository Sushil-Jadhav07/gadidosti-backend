const SettlementModel = require('../models/settlement.model');
const { successResponse } = require('../utils/response');

const projectSettlement = (row) => ({
  id: row.id,
  bookingId: row.booking_id,
  bookingNumber: row.booking_number,
  brokerId: row.broker_id,
  driverId: row.driver_id,
  route: row.route,
  truck: row.truck,
  driver: row.driver_name,
  amount: row.amount,
  platformFee: row.platform_fee,
  net: row.net_earnings,
  netEarnings: row.net_earnings,
  status: row.status,
  settledAt: row.settled_at,
  date: row.created_at,
});

// ─── GET /api/payments/settlements ────────────────────────────────────────────
const listSettlements = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const result = await SettlementModel.findAll({
      role: req.user.role,
      userId: req.user.id,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'Settlements fetched', { ...result, settlements: result.settlements.map(projectSettlement) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/analytics/broker ────────────────────────────────────────────────
const getBrokerAnalytics = async (req, res, next) => {
  try {
    const summary = await SettlementModel.monthlySummary({ role: req.user.role, userId: req.user.id });

    const history = await SettlementModel.findAll({ role: req.user.role, userId: req.user.id, page: 1, limit: 50 });

    return successResponse(res, 200, 'Earnings analytics fetched', {
      thisMonth: summary.thisMonth,
      lastMonth: summary.lastMonth,
      tripHistory: history.settlements.map(projectSettlement),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { listSettlements, getBrokerAnalytics };
