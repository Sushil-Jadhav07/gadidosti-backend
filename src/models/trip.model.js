const pool = require('../config/db');

const SELECT_WITH_JOINS = `
  SELECT tr.*,
         broker.name  AS broker_name,  broker.phone  AS broker_phone,
         driver.name  AS driver_name,  driver.phone  AS driver_phone,
         client.name  AS client_name,  client.phone  AS client_phone,
         b.truck_id, t.registration AS truck_reg
  FROM trips tr
  JOIN bookings b       ON b.id = tr.booking_id
  JOIN users client     ON client.id = b.client_id
  LEFT JOIN users broker ON broker.id = tr.broker_id
  LEFT JOIN users driver ON driver.id = tr.driver_id
  LEFT JOIN trucks t     ON t.id = b.truck_id
`;

class TripModel {
  static async create({
    bookingId, driverId, brokerId, pickupContactPerson, pickupContactPhone, pickupAddress,
    pickupTime, pickupLat, pickupLng, dropContactPerson, dropContactPhone, dropAddress,
    dropTime, dropLat, dropLng, distance, estimatedTime, cargoMaterial, cargoWeight,
    cargoQuantity, cargoSpecialInstructions, cargoValue, earnings,
  }) {
    const result = await pool.query(
      `INSERT INTO trips (
         booking_id, driver_id, broker_id, pickup_contact_person, pickup_contact_phone, pickup_address,
         pickup_time, pickup_lat, pickup_lng, drop_contact_person, drop_contact_phone, drop_address,
         drop_time, drop_lat, drop_lng, distance, estimated_time, cargo_material, cargo_weight,
         cargo_quantity, cargo_special_instructions, cargo_value, earnings
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        bookingId, driverId || null, brokerId || null, pickupContactPerson || null, pickupContactPhone || null, pickupAddress || null,
        pickupTime || null, pickupLat || null, pickupLng || null, dropContactPerson || null, dropContactPhone || null, dropAddress || null,
        dropTime || null, dropLat || null, dropLng || null, distance || null, estimatedTime || null, cargoMaterial || null, cargoWeight || null,
        cargoQuantity || null, cargoSpecialInstructions || null, cargoValue || null, earnings || null,
      ]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE tr.id = $1`, [id]);
    return result.rows[0] || null;
  }

  // Driver's current in-progress trip — anything not yet delivered/completed/cancelled.
  static async findActiveByDriver(driverId) {
    const result = await pool.query(
      `${SELECT_WITH_JOINS} WHERE tr.driver_id = $1
       AND tr.status NOT IN ('delivered', 'completed', 'cancelled')
       ORDER BY tr.created_at DESC LIMIT 1`,
      [driverId]
    );
    return result.rows[0] || null;
  }

  // The driver's next assigned-but-not-yet-started trip (status still 'confirmed').
  // Excludes activeTripId so the same trip never appears as both active and upcoming.
  static async findUpcomingByDriver(driverId, activeTripId) {
    const conditions = [`tr.driver_id = $1`, `tr.status = 'confirmed'`];
    const params = [driverId];
    let idx = 2;
    if (activeTripId) {
      conditions.push(`tr.id != $${idx++}`);
      params.push(activeTripId);
    }
    const result = await pool.query(
      `${SELECT_WITH_JOINS} WHERE ${conditions.join(' AND ')}
       ORDER BY tr.pickup_time ASC NULLS LAST, tr.created_at ASC LIMIT 1`,
      params
    );
    return result.rows[0] || null;
  }

  static async findAllByBroker(brokerId, { status, page = 1, limit = 10 } = {}) {
    const conditions = [`tr.broker_id = $1`];
    const params = [brokerId];
    let idx = 2;
    if (status) {
      conditions.push(`tr.status = $${idx++}`);
      params.push(status);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(`SELECT COUNT(*) FROM trips tr ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY tr.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      trips: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  static async updateStatus(id, status) {
    const result = await pool.query(
      `UPDATE trips SET status = $1,
              started_at = CASE WHEN started_at IS NULL AND $1 NOT IN ('confirmed', 'pending') THEN NOW() ELSE started_at END,
              updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return result.rows[0] || null;
  }

  static async updateLocation(id, { lat, lng }) {
    const result = await pool.query(
      `UPDATE trips SET current_lat = $1, current_lng = $2, updated_at = NOW() WHERE id = $3 RETURNING id, current_lat, current_lng`,
      [lat, lng, id]
    );
    return result.rows[0] || null;
  }

  static async addTimelineStep(tripId, { step, done = true, occurredAt, position }) {
    const result = await pool.query(
      `INSERT INTO trip_timeline (trip_id, step, done, occurred_at, position)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, trip_id, step, done, occurred_at, position`,
      [tripId, step, done, occurredAt || new Date(), position || 0]
    );
    return result.rows[0];
  }

  static async getTimeline(tripId) {
    const result = await pool.query(
      `SELECT id, step, done, occurred_at, position FROM trip_timeline
       WHERE trip_id = $1 ORDER BY position ASC, occurred_at ASC`,
      [tripId]
    );
    return result.rows;
  }
}

module.exports = TripModel;
