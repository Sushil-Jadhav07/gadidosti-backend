const cron = require('node-cron');
const BookingModel = require('../models/booking.model');
const { broadcastBooking } = require('../controllers/booking.controller');
const logger = require('../utils/logger');

// Book Later: fires the deferred broker/driver broadcast for scheduled bookings once their
// broadcast_at time arrives — see booking.controller.js's createBooking (which skips the
// broadcast entirely for a scheduled booking, just sets broadcast_at) and BookingModel's
// findDueForScheduledBroadcast (whose broadcast_triggered_at IS NULL clause is the idempotency
// guard, same convention as the other sweeps in this directory).
const sweep = async () => {
  try {
    const due = await BookingModel.findDueForScheduledBroadcast();
    if (!due.length) return;

    for (const booking of due) {
      await broadcastBooking(booking);
      await BookingModel.markBroadcastTriggered(booking.id);
      logger.info(`Scheduled booking ${booking.id} broadcast fired (was due ${booking.broadcast_at})`);
    }
  } catch (err) {
    logger.error(`Scheduled booking broadcast sweep failed: ${err.message}`);
  }
};

// Called once from server.js at startup.
const startScheduledBookingBroadcastSweep = () => {
  cron.schedule('* * * * *', sweep);
  logger.info('🔔 Scheduled booking broadcast sweep scheduled (every minute)');
};

module.exports = { startScheduledBookingBroadcastSweep, sweep };
