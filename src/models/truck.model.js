const pool = require('../config/db');

// lastTrip is denormalized here (not stored) — it's the route of the truck's
// most recent booking, purely for the fleet list view.
const SELECT_WITH_JOINS = `
  SELECT t.*,
         driver.name AS driver_name,
         (SELECT b.pickup_location || ' -> ' || b.drop_location
            FROM bookings b WHERE b.truck_id = t.id
            ORDER BY b.created_at DESC LIMIT 1) AS last_trip
  FROM trucks t
  LEFT JOIN users driver ON driver.id = t.driver_id
`;

class TruckModel {
  static async create({ brokerId, driverId, registration, type, category, capacity, make, year, insuranceExpiry }) {
    const result = await pool.query(
      `INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [brokerId, driverId || null, registration, type || null, category || null, capacity || null, make || null, year || null, insuranceExpiry || null]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE t.id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findByRegistration(registration) {
    const result = await pool.query(`SELECT id FROM trucks WHERE registration = $1`, [registration]);
    return result.rows[0] || null;
  }

  static async findAll({ role, brokerId, status, page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role === 'broker') {
      conditions.push(`t.broker_id = $${idx++}`);
      params.push(brokerId);
    }
    if (status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM trucks t ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY t.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      trucks: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  static async update(id, { driverId, type, category, capacity, make, year, insuranceExpiry, status }) {
    const result = await pool.query(
      `UPDATE trucks SET
         driver_id = COALESCE($1, driver_id),
         type = COALESCE($2, type),
         category = COALESCE($3, category),
         capacity = COALESCE($4, capacity),
         make = COALESCE($5, make),
         year = COALESCE($6, year),
         insurance_expiry = COALESCE($7, insurance_expiry),
         status = COALESCE($8, status),
         updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [driverId, type, category, capacity, make, year, insuranceExpiry, status, id]
    );
    return result.rows[0] || null;
  }

  // Hard delete — safe only when no booking references this truck (enforced in controller).
  static async remove(id) {
    await pool.query(`DELETE FROM trucks WHERE id = $1`, [id]);
  }

  static async isReferencedByBookings(id) {
    const result = await pool.query(`SELECT 1 FROM bookings WHERE truck_id = $1 LIMIT 1`, [id]);
    return result.rowCount > 0;
  }
}

module.exports = TruckModel;
