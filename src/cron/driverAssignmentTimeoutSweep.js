const cron = require('node-cron');
const BookingModel = require('../models/booking.model');
const NotificationModel = require('../models/notification.model');
const logger = require('../utils/logger');

const TIMEOUT_MINUTES = 5;

// Runs every minute: finds bookings the client confirmed a broker for (status='confirmed')
// that still have no driver assigned 5+ minutes later, notifies that broker "driver not
// available", and marks each one so it's never notified twice. The broker's fix is the
// existing POST /api/jobs/{id}/assign-driver — trying a different driver from their own
// fleet — no new negotiation endpoint exists for this, by design (see conversation).
const sweep = async () => {
  try {
    const overdue = await BookingModel.findConfirmedAwaitingDriver(TIMEOUT_MINUTES);
    if (!overdue.length) return;

    for (const booking of overdue) {
      await NotificationModel.create({
        userId: booking.broker_id,
        title: 'Driver not available',
        message: `Booking ${booking.booking_number} was confirmed ${TIMEOUT_MINUTES}+ minutes ago and still has no driver assigned. Assign a driver from your fleet, or a different one if your first choice isn't available.`,
        type: 'booking',
        meta: { booking_id: booking.id },
      });

      await BookingModel.markDriverTimeoutNotified(booking.id);
      logger.info(`Driver-timeout notification sent to broker ${booking.broker_id} for booking ${booking.id}`);
    }
  } catch (err) {
    logger.error(`Driver assignment timeout sweep failed: ${err.message}`);
  }
};

// Called once from server.js at startup. Runs every minute — cheap query (indexed status +
// null checks), and 5-minute granularity doesn't need finer scheduling than that.
const startDriverAssignmentTimeoutSweep = () => {
  cron.schedule('* * * * *', sweep);
  logger.info('🔔 Driver assignment timeout sweep scheduled (every minute)');
};

module.exports = { startDriverAssignmentTimeoutSweep, sweep };
