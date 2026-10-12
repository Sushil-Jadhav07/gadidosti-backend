const pool = require('../config/db');

// lastTrip is denormalized here (not stored) — it's the route of the truck's
// most recent booking, purely for the fleet list view.
// current_lat/current_lng/last_location_at: a truck has no GPS of its own — this is really the
// assigned driver's own live position (driver_profiles), surfaced here so the broker's fleet
// map (Trucks.jsx) can plot each truck without a second round-trip. Joined on t.driver_id, not
// dp.truck_id, so it degrades to null (not another driver's stale position) the moment a truck
// has no driver linked, or a driver has never reported a location — matching the same "only a
// live join, never a wrong one" reasoning findNearby already uses.
const SELECT_WITH_JOINS = `
  SELECT t.*,
         driver.name AS driver_name,
         dp.current_lat AS driver_current_lat,
         dp.current_lng AS driver_current_lng,
         dp.current_heading AS driver_heading,
         dp.last_location_at AS driver_last_location_at,
         (SELECT b.pickup_location || ' -> ' || b.drop_location
            FROM bookings b WHERE b.truck_id = t.id
            ORDER BY b.created_at DESC LIMIT 1) AS last_trip
  FROM trucks t
  LEFT JOIN users driver ON driver.id = t.driver_id
  LEFT JOIN driver_profiles dp ON dp.user_id = t.driver_id
`;

class TruckModel {
  // driverId here used to only ever write trucks.driver_id, leaving driver_profiles.truck_id
  // (the OTHER half of the link — required by findNearbyForBroadcast's WHERE t.driver_id =
  // dp.user_id AND dp.truck_id = t.id) completely untouched, and never cleared that driver's
  // previous truck's driver_id either. A driver could end up listed on two trucks in the fleet
  // list (trucks.driver_id) while driver_profiles.truck_id kept pointing at whichever truck it
  // was last set to — silently invisible to Find Truck if that one didn't match, regardless of
  // KYC/online/location, with nothing in the UI to explain why. assignDriver already keeps both
  // sides in sync for a *reassignment*; this now does the same at creation time.
  static async create({ brokerId, driverId, registration, type, category, capacity, make, year, insuranceExpiry, bodyType, capacityTons }) {
    if (!driverId) {
      const result = await pool.query(
        `INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry, body_type, capacity_tons)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [brokerId, null, registration, type || null, category || null, capacity || null, make || null, year || null, insuranceExpiry || null, bodyType || null, capacityTons || null]
      );
      return result.rows[0];
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry, body_type, capacity_tons)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [brokerId, driverId, registration, type || null, category || null, capacity || null, make || null, year || null, insuranceExpiry || null, bodyType || null, capacityTons || null]
      );
      const truck = result.rows[0];
      // Same two steps assignDriver uses for a reassignment — this driver can't stay linked to
      // whatever truck they had before, and driver_profiles.truck_id must actually point here.
      await client.query(`UPDATE trucks SET driver_id = NULL, updated_at = NOW() WHERE driver_id = $1 AND id != $2`, [driverId, truck.id]);
      await client.query(`UPDATE driver_profiles SET truck_id = $1, updated_at = NOW() WHERE user_id = $2`, [truck.id, driverId]);
      await client.query('COMMIT');
      return truck;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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

  static async update(id, { driverId, type, category, capacity, make, year, insuranceExpiry, status, bodyType, capacityTons }) {
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
         body_type = COALESCE($9, body_type),
         capacity_tons = COALESCE($10, capacity_tons),
         updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [driverId, type, category, capacity, make, year, insuranceExpiry, status, bodyType, capacityTons, id]
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
  static async findNearby({ lat, lng, category, capacity, bodyType, radiusKm, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    // The two always-true casts give Postgres explicit type context for $1/$2 (lat/lng) in the
    // COUNT query below — without them, whenever this call has no radiusKm (the only other place
    // $1/$2 get used, via distanceExpr) AND at least one of category/capacity/bodyType IS given
    // (so the WHERE text ends up referencing a higher-numbered placeholder like $3), Postgres
    // can't infer $1/$2's type from a query that never otherwise mentions them and 500s with
    // "could not determine data type of parameter $1". The main rows query below is unaffected
    // (distanceExpr always gives $1/$2 context there), but shares this same `where` string.
    const conditions = [
      `$1::double precision IS NOT NULL`,
      `$2::double precision IS NOT NULL`,
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

    if (bodyType) {
      conditions.push(`t.body_type = $${idx++}`);
      params.push(bodyType);
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
      `SELECT t.id, t.registration, t.type, t.category, t.capacity, t.make, t.year, t.status, t.body_type,
              dp.current_lat, dp.current_lng, dp.current_heading, dp.last_location_at,
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

  // Every available truck (with an available, located, KYC-verified driver) within radiusKm of
  // a point, returning driver_id/broker_id so each can be fanned out into its own driver_requests
  // row — unlike findNearby (paginated, no driver/broker id, powers the client's manual pick-one
  // truck map), this is for the "Find Truck" broadcast mode: every match gets notified at once,
  // first to accept wins (driver_requests' existing sibling-decline handles the rest). Same
  // eligibility conditions and haversine formula as findNearby, deliberately kept in sync.
  static async findNearbyForBroadcast({ lat, lng, radiusKm, category, bodyType } = {}) {
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

    if (bodyType) {
      conditions.push(`t.body_type = $${idx++}`);
      params.push(bodyType);
    }

    const distanceExpr = `
      6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians($1)) * cos(radians(dp.current_lat)) * cos(radians(dp.current_lng) - radians($2))
        + sin(radians($1)) * sin(radians(dp.current_lat))
      )))
    `;

    conditions.push(`(${distanceExpr}) <= $${idx++}`);
    params.push(radiusKm);

    const rows = await pool.query(
      `SELECT t.id AS truck_id, t.driver_id, t.broker_id, (${distanceExpr}) AS distance_km
       FROM trucks t
       JOIN driver_profiles dp ON dp.truck_id = t.id
       JOIN users driver ON driver.id = dp.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY distance_km ASC`,
      params
    );
    return rows.rows;
  }

  // How many tons of a truck's capacity are currently spoken for — summed across every booking
  // on that truck whose cargo is still physically with the truck (assigned through in_transit;
  // 'delivered' is deliberately excluded, since that cargo is already off even though the trip
  // isn't 'completed' administratively yet). weight_unit is free-text/client-supplied (no DB
  // enum — see booking.validation.js), so this normalizes the handful of real-world values
  // rather than assuming every booking is already in tons.
  static ACTIVE_CARGO_BOOKING_STATUSES = ['assigned', 'en_route_pickup', 'picked_up', 'in_transit'];

  // JS-side equivalent of the SQL CASE expression above — used wherever a single booking's
  // weight needs converting to tons outside of a SQL aggregate (e.g. broadcastBooking computing
  // weightTons for findPartTruckCandidates, or finalizeDriverRequest's accept-time capacity
  // re-check in driverRequest.controller.js).
  static normalizeWeightToTons(weight, weightUnit) {
    const w = Number(weight) || 0;
    const unit = String(weightUnit || '').toLowerCase();
    if (unit.startsWith('kg')) return w / 1000;
    if (unit.startsWith('quintal')) return w / 10;
    return w;
  }

  static async getActiveCargoWeight(truckId) {
    const result = await pool.query(
      `SELECT COALESCE(SUM(
         CASE
           WHEN weight_unit ILIKE 'kg%' THEN COALESCE(weight, 0) / 1000.0
           WHEN weight_unit ILIKE 'quintal%' THEN COALESCE(weight, 0) / 10.0
           ELSE COALESCE(weight, 0)
         END
       ), 0) AS used_tons
       FROM bookings
       WHERE truck_id = $1 AND status = ANY($2::booking_status[])`,
      [truckId, this.ACTIVE_CARGO_BOOKING_STATUSES]
    );
    return Number(result.rows[0].used_tons);
  }

  // How many bookings are currently still physically on this truck — the other half of the v1
  // part-load cap (2 bookings per truck, see findPartTruckCandidates), checked again here at
  // ACCEPT time in driverRequest.controller.js's finalizeDriverRequest since the candidate pool
  // the client searched against can go stale between search and a driver/broker actually
  // accepting (another part-load request on the same truck could win the race in between).
  static async getActiveBookingCount(truckId) {
    const result = await pool.query(
      `SELECT COUNT(*) AS active_count FROM bookings WHERE truck_id = $1 AND status = ANY($2::booking_status[])`,
      [truckId, this.ACTIVE_CARGO_BOOKING_STATUSES]
    );
    return Number(result.rows[0].active_count);
  }

  // Part-load matching: every truck currently willing to share spare capacity with a second
  // booking — a driver opts into this explicitly (part_truck_mode) and can pause new requests
  // without fully opting out (accepting_loads); see the driver self-service toggle endpoints in
  // vehicle.controller.js. Returns the same {truck_id, driver_id, broker_id, distance_km} shape
  // as findNearbyForBroadcast so it plugs straight into booking.controller.js's existing
  // driver_requests fan-out — a Part Truck booking is matched and negotiated exactly like a
  // normal Find Truck one, just against this narrower, toggle-filtered candidate pool.
  //
  // Two very different kinds of eligible truck, unioned together:
  //   - idle (status='available'), same eligibility a normal Find Truck match already requires —
  //     a driver can toggle Part Truck mode on before ever taking a trip.
  //   - already on_trip, with real spare capacity for this booking's weight and not already at
  //     the 2-booking cap — the actual "share my spare capacity mid-trip" case.
  static async findPartTruckCandidates({ lat, lng, radiusKm, weightTons }) {
    const distanceExpr = `
      6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians($1)) * cos(radians(dp.current_lat)) * cos(radians(dp.current_lng) - radians($2))
        + sin(radians($1)) * sin(radians(dp.current_lat))
      )))
    `;

    const rows = await pool.query(
      `WITH active_cargo AS (
         SELECT truck_id, COUNT(*) AS active_count, SUM(
           CASE
             WHEN weight_unit ILIKE 'kg%' THEN COALESCE(weight, 0) / 1000.0
             WHEN weight_unit ILIKE 'quintal%' THEN COALESCE(weight, 0) / 10.0
             ELSE COALESCE(weight, 0)
           END
         ) AS used_tons
         FROM bookings
         WHERE truck_id IS NOT NULL AND status = ANY($5::booking_status[])
         GROUP BY truck_id
       )
       SELECT t.id AS truck_id, t.driver_id, t.broker_id, (${distanceExpr}) AS distance_km
       FROM trucks t
       JOIN driver_profiles dp ON dp.truck_id = t.id
       JOIN users driver ON driver.id = dp.user_id
       LEFT JOIN active_cargo ac ON ac.truck_id = t.id
       WHERE t.part_truck_mode = true
         AND t.accepting_loads = true
         AND t.driver_id = dp.user_id
         AND dp.current_lat IS NOT NULL AND dp.current_lng IS NOT NULL
         AND driver.kyc_status = 'verified'
         AND (${distanceExpr}) <= $4
         AND (
           t.status = 'available'
           OR (
             t.status = 'on_trip'
             AND t.capacity_tons IS NOT NULL
             AND COALESCE(ac.active_count, 0) < 2
             AND (t.capacity_tons - COALESCE(ac.used_tons, 0)) >= $3
           )
         )
       ORDER BY distance_km ASC`,
      [lat, lng, weightTons, radiusKm, this.ACTIVE_CARGO_BOOKING_STATUSES]
    );
    return rows.rows;
  }

  // Driver self-service toggle — PATCH /api/vehicles/drivers/me/truck-mode. Flipping OFF never
  // touches a part-load booking already assigned to this truck (that trip runs to completion
  // regardless); it only stops this truck from being matched to NEW ones, see
  // findPartTruckCandidates above.
  static async setPartTruckMode(truckId, enabled) {
    const result = await pool.query(
      `UPDATE trucks SET part_truck_mode = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [enabled, truckId]
    );
    return result.rows[0] || null;
  }

  // Driver self-service pause — PATCH /api/vehicles/drivers/me/accepting-loads. Only meaningful
  // while part_truck_mode is true; lets a driver pause new part-load requests (e.g. physically
  // full right now) without fully exiting Part Truck mode.
  static async setAcceptingLoads(truckId, enabled) {
    const result = await pool.query(
      `UPDATE trucks SET accepting_loads = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [enabled, truckId]
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
