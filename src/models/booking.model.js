const pool = require('../config/db');

// Shared join so every read gets the denormalized display fields the UI needs
// (broker/client/driver names, driver phone, truck reg) without duplicating columns.
const SELECT_WITH_JOINS = `
  SELECT b.*,
         broker.name  AS broker_name,
         client.name  AS client_name,
         client.phone AS client_phone,
         client.email AS client_email,
         driver.name  AS driver_name,
         driver.phone AS driver_phone,
         t.registration AS truck_reg
  FROM bookings b
  LEFT JOIN users broker ON broker.id = b.broker_id
  LEFT JOIN users client ON client.id = b.client_id
  LEFT JOIN users driver ON driver.id = b.driver_id
  LEFT JOIN trucks t     ON t.id = b.truck_id
`;

class BookingModel {
  static async create({
    clientId, brokerId, driverId, truckId, pickupLocation, pickupLat, pickupLng,
    dropLocation, dropLat, dropLng, truckType, truckCategory, weight, weightUnit,
    quantity, material, transportType, scheduledDate, amount, currentStep,
    pricingBreakdown, distance, platformFee,
  }) {
    const result = await pool.query(
      `INSERT INTO bookings (
         client_id, broker_id, driver_id, truck_id, pickup_location, pickup_lat, pickup_lng,
         drop_location, drop_lat, drop_lng, truck_type, truck_category, weight, weight_unit,
         quantity, material, transport_type, scheduled_date, amount, current_step,
         pricing_breakdown, distance, platform_fee
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        clientId, brokerId || null, driverId || null, truckId || null, pickupLocation, pickupLat || null, pickupLng || null,
        dropLocation, dropLat || null, dropLng || null, truckType || null, truckCategory || null, weight || null, weightUnit || 'tons',
        quantity || null, material || null, transportType, scheduledDate || null, amount || null, currentStep || 0,
        pricingBreakdown ? JSON.stringify(pricingBreakdown) : null, distance || null, platformFee || null,
      ]
    );
    return result.rows[0];
  }

  static async addTimelineStep(bookingId, { step, done = true, occurredAt, position }) {
    const result = await pool.query(
      `INSERT INTO booking_timeline (booking_id, step, done, occurred_at, position)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, booking_id, step, done, occurred_at, position`,
      [bookingId, step, done, occurredAt || new Date(), position || 0]
    );
    return result.rows[0];
  }

  static async getTimeline(bookingId) {
    const result = await pool.query(
      `SELECT id, step, done, occurred_at, position FROM booking_timeline
       WHERE booking_id = $1 ORDER BY position ASC, occurred_at ASC`,
      [bookingId]
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE b.id = $1`, [id]);
    return result.rows[0] || null;
  }

  // Role-scoped list: client -> own bookings, broker -> assigned to them, admin -> all with filters
  static async findAll({ role, userId, status, page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role === 'client') {
      conditions.push(`b.client_id = $${idx++}`);
      params.push(userId);
    } else if (role === 'broker') {
      conditions.push(`b.broker_id = $${idx++}`);
      params.push(userId);
    } else if (role === 'driver') {
      conditions.push(`b.driver_id = $${idx++}`);
      params.push(userId);
    }
    // admin: no scoping condition — sees all

    if (status) {
      conditions.push(`b.status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM bookings b ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY b.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      bookings: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  static async advanceStatus(id, { status, currentStep, brokerId, driverId, truckId }) {
    const result = await pool.query(
      `UPDATE bookings
       SET status = $1,
           current_step = COALESCE($2, current_step),
           broker_id = COALESCE($3, broker_id),
           driver_id = COALESCE($4, driver_id),
           truck_id = COALESCE($5, truck_id),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [status, currentStep, brokerId || null, driverId || null, truckId || null, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = BookingModel;
