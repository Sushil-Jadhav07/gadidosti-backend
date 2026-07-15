const pool = require('../config/db');

// Shared join so every read gets the denormalized display fields the UI needs
// (broker/client/driver names, driver phone, truck reg, POD) without duplicating columns.
// pod_url lives on trips, not bookings — joined in here so both the admin and client
// booking detail views can show it without needing a separate GET /api/trips/:id call
// (which clients can't make anyway — that route is broker/driver/admin only).
const SELECT_WITH_JOINS = `
  SELECT b.*,
         broker.name  AS broker_name,
         client.name  AS client_name,
         client.phone AS client_phone,
         client.email AS client_email,
         driver.name  AS driver_name,
         driver.phone AS driver_phone,
         t.registration AS truck_reg,
         trip.pod_url AS pod_url
  FROM bookings b
  LEFT JOIN users broker ON broker.id = b.broker_id
  LEFT JOIN users client ON client.id = b.client_id
  LEFT JOIN users driver ON driver.id = b.driver_id
  LEFT JOIN trucks t     ON t.id = b.truck_id
  LEFT JOIN trips trip   ON trip.booking_id = b.id
`;

class BookingModel {
  // Short human-readable reference shown in the UI instead of the raw UUID, e.g. "BKG-202412-001".
  // Sequence resets each calendar month; a short retry loop handles the rare concurrent-insert collision.
  static async generateBookingNumber() {
    const prefix = `BKG-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
    const countResult = await pool.query(`SELECT COUNT(*) FROM bookings WHERE booking_number LIKE $1`, [`${prefix}-%`]);
    const startSeq = parseInt(countResult.rows[0].count, 10) + 1;

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `${prefix}-${String(startSeq + attempt).padStart(3, '0')}`;
      const exists = await pool.query(`SELECT 1 FROM bookings WHERE booking_number = $1`, [candidate]);
      if (!exists.rows.length) return candidate;
    }
    return `${prefix}-${Date.now().toString().slice(-6)}`;
  }

  static async create({
    clientId, brokerId, driverId, truckId, pickupLocation, pickupLat, pickupLng,
    dropLocation, dropLat, dropLng, truckType, truckCategory, weight, weightUnit,
    quantity, material, transportType, scheduledDate, amount, currentStep,
    pricingBreakdown, distance, platformFee, paymentStatus,
  }) {
    const bookingNumber = await this.generateBookingNumber();
    const result = await pool.query(
      `INSERT INTO bookings (
         booking_number, client_id, broker_id, driver_id, truck_id, pickup_location, pickup_lat, pickup_lng,
         drop_location, drop_lat, drop_lng, truck_type, truck_category, weight, weight_unit,
         quantity, material, transport_type, scheduled_date, amount, current_step,
         pricing_breakdown, distance, platform_fee, payment_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [
        bookingNumber, clientId, brokerId || null, driverId || null, truckId || null, pickupLocation, pickupLat || null, pickupLng || null,
        dropLocation, dropLat || null, dropLng || null, truckType || null, truckCategory || null, weight || null, weightUnit || 'tons',
        quantity || null, material || null, transportType, scheduledDate || null, amount != null ? amount : null, currentStep || 0,
        pricingBreakdown ? JSON.stringify(pricingBreakdown) : null, distance != null ? distance : null, platformFee != null ? platformFee : null,
        paymentStatus || 'pending',
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

  // Accepts either the raw UUID or the human-readable booking_number (e.g. "BKG-202412-001") —
  // callers (search boxes, support lookups) shouldn't need to know which one they have.
  static async findById(idOrBookingNumber) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrBookingNumber || '');
    const column = isUuid ? 'b.id' : 'b.booking_number';
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE ${column} = $1`, [idOrBookingNumber]);
    return result.rows[0] || null;
  }

  // Role-scoped list: client -> own bookings, broker -> assigned to them, admin -> all with filters
  static async findAll({ role, userId, status, sort = 'desc', page = 1, limit = 10 } = {}) {
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

    const statuses = typeof status === 'string'
      ? status.split(',').map((value) => value.trim()).filter(Boolean)
      : [];
    if (statuses.length === 1) {
      conditions.push(`b.status = $${idx++}`);
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      conditions.push(`b.status = ANY($${idx++})`);
      params.push(statuses);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM bookings b ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const order = String(sort).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY b.created_at ${order} LIMIT $${idx} OFFSET $${idx + 1}`,
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

  // Same as advanceStatus, but only commits if the booking is still in fromStatus — the
  // compare-and-swap that stops two brokers racing to accept the same broadcast booking.
  static async advanceStatusIfCurrent(id, fromStatus, { status, currentStep, brokerId, driverId, truckId }) {
    const result = await pool.query(
      `UPDATE bookings
       SET status = $1,
           current_step = COALESCE($2, current_step),
           broker_id = COALESCE($3, broker_id),
           driver_id = COALESCE($4, driver_id),
           truck_id = COALESCE($5, truck_id),
           updated_at = NOW()
       WHERE id = $6 AND status = $7
       RETURNING *`,
      [status, currentStep, brokerId || null, driverId || null, truckId || null, id, fromStatus]
    );
    return result.rows[0] || null;
  }

  static async update(id, fields) {
    const keys = Object.keys(fields).filter((key) => fields[key] !== undefined);
    if (!keys.length) return this.findById(id);

    const assignments = keys.map((key, index) => `${key} = $${index + 1}`);
    const values = keys.map((key) => fields[key]);
    const result = await pool.query(
      `UPDATE bookings
       SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${keys.length + 1}
       RETURNING *`,
      [...values, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = BookingModel;
