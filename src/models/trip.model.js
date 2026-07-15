const pool = require('../config/db');

const SELECT_WITH_JOINS = `
  SELECT tr.*,
         broker.name  AS broker_name,  broker.phone  AS broker_phone,
         driver.name  AS driver_name,  driver.phone  AS driver_phone,
         client.id    AS client_id,    client.name  AS client_name, client.phone AS client_phone,
         b.truck_id, b.booking_number, t.registration AS truck_reg
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

  // trips.booking_id is UNIQUE — a booking has at most one trip.
  static async findByBookingId(bookingId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE tr.booking_id = $1`, [bookingId]);
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

  static async findAll({ role, userId, status, page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role === 'broker') {
      conditions.push(`tr.broker_id = $${idx++}`);
      params.push(userId);
    } else if (role === 'driver') {
      conditions.push(`tr.driver_id = $${idx++}`);
      params.push(userId);
    }

    const statuses = typeof status === 'string'
      ? status.split(',').map((value) => value.trim()).filter(Boolean)
      : [];
    if (statuses.length === 1) {
      conditions.push(`tr.status = $${idx++}`);
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      conditions.push(`tr.status = ANY($${idx++})`);
      params.push(statuses);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM trips tr ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY tr.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      trips: rows.rows,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
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

  // Atomic compare-and-swap for the one transition that triggers settlement/total_trips
  // side effects — only flips a trip to 'completed' if it isn't already, so two racing or
  // duplicate PATCH /status calls (e.g. the driver app firing delivered->completed twice)
  // can't both win and double up the payout.
  static async completeIfNotAlready(id) {
    const result = await pool.query(
      `UPDATE trips SET status = 'completed',
              started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END,
              updated_at = NOW()
       WHERE id = $1 AND status != 'completed' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Swaps the driver on an already-created trip — used when a broker reassigns a different
  // driver mid-trip (e.g. after an incident), instead of creating a second trip row (which
  // would violate trips.booking_id's UNIQUE constraint).
  static async reassignDriver(id, driverId) {
    const result = await pool.query(
      `UPDATE trips SET driver_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [driverId, id]
    );
    return result.rows[0] || null;
  }

  static async updatePodUrl(id, podUrl) {
    const result = await pool.query(
      `UPDATE trips SET pod_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [podUrl, id]
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

  // Used when a driver declines a not-yet-started trip — trip_timeline rows cascade-delete
  // with it (ON DELETE CASCADE), so the booking can be freshly reassigned to another driver
  // via the normal (non-reassignment) assignDriver path.
  static async remove(id) {
    await pool.query(`DELETE FROM trips WHERE id = $1`, [id]);
  }
}

module.exports = TripModel;
