const pool = require('../config/db');

// Aadhaar is stored in full but never returned in full — mask to the
// "XXXX-XXXX-1234" format the UI expects everywhere it's displayed.
const SELECT_WITH_JOINS = `
  SELECT dp.user_id, dp.broker_id, dp.license_no, dp.license_expiry,
         CASE WHEN dp.aadhaar IS NOT NULL THEN 'XXXX-XXXX-' || right(dp.aadhaar, 4) ELSE NULL END AS aadhaar,
         dp.truck_id, dp.total_trips, dp.avatar, dp.status, dp.created_at, dp.updated_at,
         dp.current_lat, dp.current_lng, dp.last_location_at,
         u.name, u.phone, u.kyc_status,
         t.registration AS truck_reg
  FROM driver_profiles dp
  JOIN users u ON u.id = dp.user_id
  LEFT JOIN trucks t ON t.id = dp.truck_id
`;

class DriverProfileModel {
  static async create({ userId, brokerId, licenseNo, licenseExpiry, aadhaar, truckId, avatar }) {
    const result = await pool.query(
      `INSERT INTO driver_profiles (user_id, broker_id, license_no, license_expiry, aadhaar, truck_id, avatar)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING user_id`,
      [userId, brokerId, licenseNo || null, licenseExpiry || null, aadhaar || null, truckId || null, avatar || null]
    );
    return this.findById(result.rows[0].user_id);
  }

  static async findById(userId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE dp.user_id = $1`, [userId]);
    return result.rows[0] || null;
  }

  static async exists(userId) {
    const result = await pool.query(`SELECT 1 FROM driver_profiles WHERE user_id = $1`, [userId]);
    return result.rowCount > 0;
  }

  // When nearLat/nearLng are given, ranks drivers by straight-line (Haversine) distance from
  // that point instead of the default created_at ordering, and only considers status='available'
  // (optionally further narrowed by truckType). Drivers with no location, or a location older than
  // 15 minutes, are treated as "location unknown" — kept in the results but sorted last rather
  // than excluded, since a broker may still want to see/assign them.
  static async findAll({ role, brokerId, status, page = 1, limit = 10, nearLat, nearLng, truckType } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role === 'broker') {
      conditions.push(`dp.broker_id = $${idx++}`);
      params.push(brokerId);
    }

    const hasNear = nearLat !== undefined && nearLat !== null && !Number.isNaN(nearLat)
      && nearLng !== undefined && nearLng !== null && !Number.isNaN(nearLng);

    if (hasNear) {
      conditions.push(`dp.status = 'available'`);
      if (truckType) {
        conditions.push(`t.type = $${idx++}`);
        params.push(truckType);
      }
    } else if (status) {
      conditions.push(`dp.status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM driver_profiles dp LEFT JOIN trucks t ON t.id = dp.truck_id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    let distanceSelect = '';
    let orderBy = 'dp.created_at DESC';
    let distanceParams = [];

    if (hasNear) {
      const latIdx = idx++;
      const lngIdx = idx++;
      distanceParams = [nearLat, nearLng];
      // Haversine great-circle distance in km; clamp the acos() argument to [-1, 1] to
      // guard against floating-point drift pushing it just outside that domain.
      distanceSelect = `,
        (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians($${latIdx})) * cos(radians(dp.current_lat)) * cos(radians(dp.current_lng) - radians($${lngIdx}))
          + sin(radians($${latIdx})) * sin(radians(dp.current_lat))
        )))) AS distance_km,
        (dp.last_location_at IS NOT NULL AND dp.last_location_at > NOW() - INTERVAL '15 minutes') AS has_recent_location`;
      orderBy = 'has_recent_location DESC, distance_km ASC NULLS LAST, dp.created_at DESC';
    }

    const rows = await pool.query(
      `${SELECT_WITH_JOINS}${distanceSelect} ${where} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, ...distanceParams, limit, offset]
    );

    return {
      drivers: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  static async updateLocation(userId, { lat, lng }) {
    const result = await pool.query(
      `UPDATE driver_profiles
       SET current_lat = $1, current_lng = $2, last_location_at = NOW(), updated_at = NOW()
       WHERE user_id = $3
       RETURNING user_id, current_lat, current_lng, last_location_at`,
      [lat, lng, userId]
    );
    return result.rows[0] || null;
  }

  static async findLocation(userId) {
    const result = await pool.query(
      `SELECT current_lat, current_lng, last_location_at FROM driver_profiles WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  static async update(userId, { licenseNo, licenseExpiry, aadhaar, truckId, avatar, status }) {
    const result = await pool.query(
      `UPDATE driver_profiles SET
         license_no = COALESCE($1, license_no),
         license_expiry = COALESCE($2, license_expiry),
         aadhaar = COALESCE($3, aadhaar),
         truck_id = COALESCE($4, truck_id),
         avatar = COALESCE($5, avatar),
         status = COALESCE($6, status),
         updated_at = NOW()
       WHERE user_id = $7
       RETURNING user_id`,
      [licenseNo, licenseExpiry, aadhaar, truckId, avatar, status, userId]
    );
    if (!result.rows[0]) return null;
    return this.findById(userId);
  }

  static async incrementTotalTrips(userId) {
    await pool.query(`UPDATE driver_profiles SET total_trips = total_trips + 1, updated_at = NOW() WHERE user_id = $1`, [userId]);
  }

  // Unlinks the driver from this broker's fleet — deletes the driver_profiles row only.
  // The underlying users row (the driver's account) is untouched, so they can be
  // re-added later or linked to another broker.
  static async remove(userId) {
    await pool.query(`DELETE FROM driver_profiles WHERE user_id = $1`, [userId]);
  }

  static async isReferencedByBookings(userId) {
    const result = await pool.query(`SELECT 1 FROM bookings WHERE driver_id = $1 LIMIT 1`, [userId]);
    return result.rowCount > 0;
  }
}

module.exports = DriverProfileModel;
