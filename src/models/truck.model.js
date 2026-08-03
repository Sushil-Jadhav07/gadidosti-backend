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

  static async findOwnedByBroker(id, brokerId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE t.id = $1 AND t.broker_id = $2`, [id, brokerId]);
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

  // Links a driver to this truck, keeping trucks.driver_id and driver_profiles.truck_id in
  // sync — every other write path here only ever touches one side of that pair. If the driver
  // is already on a different truck, or this truck already has a different driver, the old
  // link is cleared first so neither ever ends up assigned on both sides at once.
  static async assignDriver(truckId, driverId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE driver_profiles SET truck_id = NULL, updated_at = NOW() WHERE truck_id = $1`, [truckId]);
      await client.query(`UPDATE trucks SET driver_id = NULL, updated_at = NOW() WHERE driver_id = $1`, [driverId]);
      await client.query(`UPDATE trucks SET driver_id = $1, updated_at = NOW() WHERE id = $2`, [driverId, truckId]);
      await client.query(`UPDATE driver_profiles SET truck_id = $1, updated_at = NOW() WHERE user_id = $2`, [truckId, driverId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.findById(truckId);
  }

  // Available trucks (with an available, located, KYC-verified driver) near a point — powers
  // the Truck step of booking creation, before any broker/driver is assigned to the booking.
  // Requires the truck<->driver link to actually exist on both sides (t.driver_id = dp.user_id,
  // not just the join condition) since assignDriver keeps them in sync but nothing stops other
  // code paths writing just one side. Only trucks whose driver has ever reported a location are
  // considered (nothing to plot on a map otherwise), unlike the broker-fleet near-search in
  // driverProfile.model.js's findAll, which deliberately keeps location-unknown drivers in the
  // results (sorted last) since a broker still needs to see their whole fleet regardless of GPS
  // freshness.
  static async findNearby({ lat, lng, category, capacity, radiusKm, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [
      `t.status = 'available'`,
      `t.driver_id IS NOT NULL`,
      `t.driver_id = dp.user_id`,
      `dp.status = 'available'`,
      `dp.current_lat IS NOT NULL`,
      `dp.current_lng IS NOT NULL`,
      `driver.kyc_status = 'verified'`,
    ];
    const params = [lat, lng];
    let idx = 3;

    if (category) {
      conditions.push(`t.category = $${idx++}`);
      params.push(category);
    }

    if (capacity) {
      conditions.push(`LOWER(t.capacity) = LOWER($${idx++})`);
      params.push(capacity);
    }

    // Haversine great-circle distance in km; clamp the acos() argument to [-1, 1] to guard
    // against floating-point drift pushing it just outside that domain (same formula as
    // driverProfile.model.js's near-search).
    const distanceExpr = `
      6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians($1)) * cos(radians(dp.current_lat)) * cos(radians(dp.current_lng) - radians($2))
        + sin(radians($1)) * sin(radians(dp.current_lat))
      )))
    `;

    if (radiusKm != null) {
      conditions.push(`(${distanceExpr}) <= $${idx++}`);
      params.push(radiusKm);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const joins = `JOIN driver_profiles dp ON dp.truck_id = t.id JOIN users driver ON driver.id = dp.user_id`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM trucks t ${joins} ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `SELECT t.id, t.registration, t.type, t.category, t.capacity, t.make, t.year, t.status,
              dp.current_lat, dp.current_lng, dp.last_location_at,
              (${distanceExpr}) AS distance_km
       FROM trucks t
       ${joins}
       ${where}
       ORDER BY distance_km ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
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
