const cron = require('node-cron');
const BookingModel = require('../models/booking.model');
const UserModel = require('../models/user.model');
const NotificationModel = require('../models/notification.model');
const { rebroadcastDriverFanOut, DEFAULT_BROADCAST_RADIUS_KM } = require('../controllers/booking.controller');
const logger = require('../utils/logger');

const TIMEOUT_MINUTES = 30;
// One-time widen on escalation, not a gradual climb — capped well past the normal 50km default
// so a genuinely sparse area doesn't end up broadcasting nationwide.
const MAX_WIDENED_RADIUS_KM = 150;

// Any booking still 'pending' 30+ minutes after creation with nobody having responded —
// "Find Truck"/"Part Truck" broadcasts, a single-broker pick, or the legacy broker-broadcast
// fallback alike — used to sit there silently forever: no admin alert, no widening of the
// search, nothing but the client's own manual "Search Again" (see FindTruckSearch.jsx). This
// closes that gap: notifies every admin/staff (in-app + push, already automatic via
// NotificationModel.create), and — only for the two search_mode values that actually broadcast
// to drivers — widens the radius once and re-notifies newly-in-range drivers who weren't
// candidates at the original (smaller) radius.
const sweep = async () => {
  try {
    const stuck = await BookingModel.findStuckPending(TIMEOUT_MINUTES);
    if (!stuck.length) return;

    const { users: admins } = await UserModel.findAll({ role: 'admin', limit: 100 });

    for (const booking of stuck) {
      let widenedTo = null;
      if (['truck', 'part_load'].includes(booking.search_mode)) {
        const currentRadius = booking.search_radius_km || DEFAULT_BROADCAST_RADIUS_KM;
        widenedTo = Math.min(currentRadius * 2, MAX_WIDENED_RADIUS_KM);
        if (widenedTo > currentRadius) {
          await BookingModel.update(booking.id, { search_radius_km: widenedTo });
          try {
            const notifiedCount = await rebroadcastDriverFanOut({ ...booking, search_radius_km: widenedTo });
            logger.info(`Booking ${booking.id} (${booking.booking_number}) stuck ${TIMEOUT_MINUTES}+ min — widened ${currentRadius}km -> ${widenedTo}km, notified ${notifiedCount} newly-in-range driver(s)`);
          } catch (err) {
            logger.error(`Booking ${booking.id}: widen-and-rebroadcast failed — ${err.message}`);
          }
        } else {
          widenedTo = null; // already at/above the cap — nothing to widen, still notify admin below
        }
      }

      const pickupText = booking.pickup_location || 'an unspecified pickup point';
      const dropText = booking.drop_location || 'an unspecified drop point';
      const message = widenedTo
        ? `Booking ${booking.booking_number} (${pickupText} to ${dropText}) has had no response for ${TIMEOUT_MINUTES}+ minutes — search radius widened to ${widenedTo}km. Check Assign Bookings if it's still unresolved.`
        : `Booking ${booking.booking_number} (${pickupText} to ${dropText}) has had no response for ${TIMEOUT_MINUTES}+ minutes. Assign a driver/broker directly from Assign Bookings.`;

      await Promise.all((admins || []).map((admin) => NotificationModel.create({
        userId: admin.id,
        title: 'Booking needs attention',
        message,
        type: 'booking',
        meta: { booking_id: booking.id },
      })));

      await BookingModel.markSearchTimeoutNotified(booking.id);
      logger.info(`Booking ${booking.id} (${booking.booking_number}) search-stuck notification sent to ${(admins || []).length} admin(s)`);
    }
  } catch (err) {
    logger.error(`Booking search stuck sweep failed: ${err.message}`);
  }
};

// Called once from server.js at startup.
const startBookingSearchStuckSweep = () => {
  cron.schedule('* * * * *', sweep);
  logger.info('🔔 Booking search stuck sweep scheduled (every minute)');
};

module.exports = { startBookingSearchStuckSweep, sweep };
