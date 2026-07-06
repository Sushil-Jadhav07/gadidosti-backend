const pool = require('../config/db');

const SELECT_WITH_JOINS = `
  SELECT s.*,
         (b.pickup_location || ' -> ' || b.drop_location) AS route,
         t.registration AS truck,
         driver.name AS driver_name
  FROM settlements s
  JOIN bookings b        ON b.id = s.booking_id
  LEFT JOIN trucks t     ON t.id = b.truck_id
  LEFT JOIN users driver ON driver.id = s.driver_id
`;

class SettlementModel {
  static async create({ bookingId, brokerId, driverId, amount, platformFee, status = 'pending' }) {
    const result = await pool.query(
      `INSERT INTO settlements (booking_id, broker_id, driver_id, amount, platform_fee, status, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6 = 'paid' THEN NOW() ELSE NULL END)
       RETURNING *`,
      [bookingId, brokerId || null, driverId || null, amount, platformFee || 0, status]
    );
    return result.rows[0];
  }

  static async findAll({ role, userId, page = 1, limit = 10 } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role === 'broker') {
      conditions.push(`s.broker_id = $${idx++}`);
      params.push(userId);
    } else if (role === 'driver') {
      conditions.push(`s.driver_id = $${idx++}`);
      params.push(userId);
    }
    // admin: unscoped

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countResult = await pool.query(`SELECT COUNT(*) FROM settlements s ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY s.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      settlements: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  // {thisMonth, lastMonth} net earnings totals for the broker/driver analytics screen
  static async monthlySummary({ role, userId }) {
    const column = role === 'driver' ? 'driver_id' : 'broker_id';
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(net_earnings) FILTER (WHERE date_trunc('month', created_at) = date_trunc('month', NOW())), 0) AS this_month,
         COALESCE(SUM(net_earnings) FILTER (WHERE date_trunc('month', created_at) = date_trunc('month', NOW() - INTERVAL '1 month')), 0) AS last_month
       FROM settlements WHERE ${column} = $1`,
      [userId]
    );
    return {
      thisMonth: parseFloat(result.rows[0].this_month),
      lastMonth: parseFloat(result.rows[0].last_month),
    };
  }
}

module.exports = SettlementModel;
