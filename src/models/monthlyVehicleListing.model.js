const pool = require('../config/db');

// FK'd to an existing trucks row rather than re-collecting truck details — the driver/broker
// already registered this truck elsewhere in the system, so its category/registration/capacity
// come along for free via the join instead of being duplicated (and potentially drifting out of
// sync) here.
const SELECT_WITH_JOINS = `
  SELECT l.*, owner.name AS owner_name, owner.phone AS owner_phone, owner.role AS owner_role,
         t.registration AS truck_registration, t.type AS truck_type, t.category AS truck_category, t.capacity AS truck_capacity
  FROM monthly_vehicle_listings l
  JOIN users owner ON owner.id = l.owner_id
  JOIN trucks t     ON t.id = l.truck_id
`;

class MonthlyVehicleListingModel {
  static async create({ ownerId, truckId, pricingType, rateAmount, availabilityNotes }) {
    const result = await pool.query(
      `INSERT INTO monthly_vehicle_listings (owner_id, truck_id, pricing_type, rate_amount, availability_notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ownerId, truckId, pricingType, rateAmount, availabilityNotes || null]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE l.id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findByOwner(ownerId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE l.owner_id = $1 ORDER BY l.created_at DESC`, [ownerId]);
    return result.rows;
  }

  // Admin-only listing — every listing, optionally narrowed by status, newest first.
  static async findAll({ status, page = 1, limit = 20 } = {}) {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE l.status = $${params.length}`;
    }
    const offset = (page - 1) * limit;
    const listParams = [...params, limit, offset];
    const [items, count] = await Promise.all([
      pool.query(
        `${SELECT_WITH_JOINS} ${where} ORDER BY l.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      ),
      pool.query(`SELECT COUNT(*) FROM monthly_vehicle_listings l ${where}`, params),
    ]);
    return { items: items.rows, total: parseInt(count.rows[0].count, 10) };
  }

  static async updateStatus(id, ownerId, status) {
    const result = await pool.query(
      `UPDATE monthly_vehicle_listings SET status = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3 RETURNING *`,
      [status, id, ownerId]
    );
    return result.rows[0] || null;
  }

  static async remove(id, ownerId) {
    const result = await pool.query(
      `DELETE FROM monthly_vehicle_listings WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [id, ownerId]
    );
    return result.rows[0] || null;
  }
}

module.exports = MonthlyVehicleListingModel;
