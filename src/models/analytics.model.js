const pool = require('../config/db');
const { AVERAGE_SPEED_KMPH } = require('../utils/geo');

// % delta helper for the dashboard's up/down-arrow stats. 0 previous with
// a positive current reads as a full "+100%" gain rather than dividing by zero.
const pctChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

class AnalyticsModel {
  // Dashboard counts are all-time; the *Change fields compare the last 30 days
  // of new records against the 30 days before that (a simple rolling-window delta,
  // not a live recompute of e.g. "active trips 30 days ago" which isn't a stored fact).
  static async dashboard() {
    const [totalBookings, totalTrucks, revenueAgg, activeTrips, stalePending] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM bookings`),
      pool.query(`SELECT COUNT(*) FROM trucks`),
      pool.query(`SELECT COALESCE(SUM(platform_fee), 0) AS total FROM settlements`),
      pool.query(`SELECT COUNT(*) FROM trips WHERE status NOT IN ('delivered', 'completed', 'cancelled')`),
      // Job requests no longer expire, so a booking with no broker response just sits
      // 'pending' forever with nothing to flag it. Surface it here instead so ops
      // notices — 2 hours is a operational threshold, not a hard cutoff or auto-action.
      pool.query(`SELECT COUNT(*) FROM bookings WHERE status = 'pending' AND created_at < NOW() - INTERVAL '2 hours'`),
    ]);

    const windowed = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM bookings WHERE created_at >= NOW() - INTERVAL '30 days') AS bookings_now,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days') AS bookings_prev,
        (SELECT COUNT(*) FROM trucks WHERE created_at >= NOW() - INTERVAL '30 days') AS trucks_now,
        (SELECT COUNT(*) FROM trucks WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days') AS trucks_prev,
        (SELECT COUNT(*) FROM trips WHERE created_at >= NOW() - INTERVAL '30 days') AS trips_now,
        (SELECT COUNT(*) FROM trips WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days') AS trips_prev,
        (SELECT COALESCE(SUM(platform_fee), 0) FROM settlements WHERE created_at >= NOW() - INTERVAL '30 days') AS revenue_now,
        (SELECT COALESCE(SUM(platform_fee), 0) FROM settlements WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days') AS revenue_prev
    `);
    const w = windowed.rows[0];

    return {
      totalBookings: parseInt(totalBookings.rows[0].count),
      activeTrips: parseInt(activeTrips.rows[0].count),
      totalRevenue: parseFloat(revenueAgg.rows[0].total),
      registeredTrucks: parseInt(totalTrucks.rows[0].count),
      stalePendingBookings: parseInt(stalePending.rows[0].count),
      bookingsChange: pctChange(parseInt(w.bookings_now), parseInt(w.bookings_prev)),
      activeTripsChange: pctChange(parseInt(w.trips_now), parseInt(w.trips_prev)),
      revenueChange: pctChange(parseFloat(w.revenue_now), parseFloat(w.revenue_prev)),
      trucksChange: pctChange(parseInt(w.trucks_now), parseInt(w.trucks_prev)),
    };
  }

  static async gmvOverMonths() {
    const result = await pool.query(`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COALESCE(SUM(amount), 0) AS gmv
      FROM bookings
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1
    `);
    return result.rows.map((r) => ({ month: r.month, gmv: parseFloat(r.gmv) }));
  }

  static async revenueOverMonths() {
    const result = await pool.query(`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COALESCE(SUM(platform_fee), 0) AS revenue
      FROM settlements
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1
    `);
    return result.rows.map((r) => ({ month: r.month, revenue: parseFloat(r.revenue) }));
  }

  static async topClients(limit = 5) {
    const result = await pool.query(
      `SELECT u.name, COALESCE(SUM(b.amount), 0) AS spend
       FROM bookings b JOIN users u ON u.id = b.client_id
       GROUP BY u.id, u.name ORDER BY spend DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map((r) => ({ name: r.name, spend: parseFloat(r.spend) }));
  }

  // % of each broker's trucks currently on_trip
  static async fleetUtilization() {
    const result = await pool.query(`
      SELECT u.name AS broker,
             ROUND(100.0 * COUNT(*) FILTER (WHERE t.status = 'on_trip') / NULLIF(COUNT(*), 0), 1) AS utilization
      FROM trucks t JOIN users u ON u.id = t.broker_id
      GROUP BY u.id, u.name ORDER BY u.name
    `);
    return result.rows.map((r) => ({ broker: r.broker, utilization: parseFloat(r.utilization) || 0 }));
  }

  // Last 12 days of booking volume (day granularity chosen over week — gives the
  // sparkline enough resolution without needing months of seed data to look meaningful).
  static async bookingConversionSparkline() {
    const result = await pool.query(`
      SELECT d::date AS day, COALESCE((
        SELECT COUNT(*) FROM bookings b WHERE date_trunc('day', b.created_at) = d
      ), 0) AS count
      FROM generate_series(NOW() - INTERVAL '11 days', NOW(), INTERVAL '1 day') AS d
      ORDER BY d
    `);
    return result.rows.map((r) => parseInt(r.count));
  }

  // Client-scoped mirror of dashboard() above — same four metrics, same "delayed" heuristic,
  // just filtered to one client_id instead of platform-wide. Used by the client app's own
  // dashboard (GET /api/analytics/client).
  static async clientDashboard(clientId) {
    const [totalBookings, cancelledBookings, activeBookings, delayedTrips, paidInvoices, newBookings] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM bookings WHERE client_id = $1`, [clientId]),
      pool.query(`SELECT COUNT(*) FROM bookings WHERE client_id = $1 AND status = 'cancelled'`, [clientId]),
      pool.query(`SELECT COUNT(*) FROM bookings WHERE client_id = $1 AND status NOT IN ('delivered', 'completed', 'cancelled')`, [clientId]),
      pool.query(
        `SELECT COUNT(*) FROM trips tr JOIN bookings b ON b.id = tr.booking_id
         WHERE b.client_id = $1 AND tr.status IN ('en_route_pickup', 'picked_up', 'in_transit')
           AND tr.started_at IS NOT NULL AND tr.distance IS NOT NULL AND tr.distance > 0
           AND NOW() > tr.started_at + ((tr.distance / $2::numeric) * 60 * 1.5) * INTERVAL '1 minute'`,
        [clientId, AVERAGE_SPEED_KMPH]
      ),
      pool.query(`SELECT COUNT(*) FROM bookings WHERE client_id = $1 AND payment_status = 'paid'`, [clientId]),
      pool.query(`SELECT COUNT(*) FROM bookings WHERE client_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`, [clientId]),
    ]);

    return {
      totalBookings: parseInt(totalBookings.rows[0].count),
      cancelledBookings: parseInt(cancelledBookings.rows[0].count),
      activeBookings: parseInt(activeBookings.rows[0].count),
      delayedBookings: parseInt(delayedTrips.rows[0].count),
      paidInvoices: parseInt(paidInvoices.rows[0].count),
      newBookingsLast7Days: parseInt(newBookings.rows[0].count),
    };
  }

  // Last 14 days of this client's spend, one point per day — the "Revenue" chart's client-side
  // equivalent (there's no platform revenue to show a client, just what they've spent).
  static async clientSpendSparkline(clientId) {
    const result = await pool.query(
      `SELECT d::date AS day, COALESCE((
         SELECT SUM(amount) FROM bookings b WHERE b.client_id = $1 AND date_trunc('day', b.created_at) = d
       ), 0) AS amount
       FROM generate_series(NOW() - INTERVAL '13 days', NOW(), INTERVAL '1 day') AS d
       ORDER BY d`,
      [clientId]
    );
    return result.rows.map((r) => ({ day: r.day, amount: parseFloat(r.amount) }));
  }

  // This client's booking count for each of the last 7 days (Sun..Sat-style "weekly overview").
  static async clientWeeklyBookings(clientId) {
    const result = await pool.query(
      `SELECT d::date AS day, COALESCE((
         SELECT COUNT(*) FROM bookings b WHERE b.client_id = $1 AND date_trunc('day', b.created_at) = d
       ), 0) AS count
       FROM generate_series(NOW() - INTERVAL '6 days', NOW(), INTERVAL '1 day') AS d
       ORDER BY d`,
      [clientId]
    );
    return result.rows.map((r) => ({ day: r.day, count: parseInt(r.count) }));
  }
}

module.exports = AnalyticsModel;
