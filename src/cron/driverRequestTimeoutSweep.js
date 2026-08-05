const cron = require('node-cron');
const DriverRequestModel = require('../models/driverRequest.model');
const NotificationModel = require('../models/notification.model');
const logger = require('../utils/logger');

// "2-3 min" — picked the upper bound so a driver who's just a little slow (bad signal, mid-call)
// doesn't immediately lose their window; adjust freely if you want it tighter.
const DRIVER_RESPONSE_TIMEOUT_MINUTES = 3;

// Runs every minute: finds driver_requests still awaiting the driver's response (status
// 'pending', never timed out yet) more than DRIVER_RESPONSE_TIMEOUT_MINUTES after it became
// their turn, notifies their broker that they can now respond in the driver's place, and
// marks driver_timeout_at so the driver is locked out of this specific request from here on
// (enforced in driverRequest.controller.js's assertCanRespond) — and so this sweep never
// re-notifies the same request twice.
const sweep = async () => {
  try {
    const overdue = await DriverRequestModel.findOverdueForDriverResponse(DRIVER_RESPONSE_TIMEOUT_MINUTES);
    if (!overdue.length) return;

    for (const request of overdue) {
      await DriverRequestModel.markDriverTimedOut(request.id);

      await NotificationModel.create({
        userId: request.broker_id,
        title: 'Driver Not Responding',
        message: `Your driver hasn't responded to a booking request (${request.booking_number}) in ${DRIVER_RESPONSE_TIMEOUT_MINUTES}+ minutes. You can now accept, decline, or counter on their behalf.`,
        type: 'booking',
        meta: { booking_id: request.booking_id, driver_request_id: request.id },
      });

      logger.info(`Driver-request timeout: broker ${request.broker_id} notified for request ${request.id} (driver ${request.driver_id} did not respond)`);
    }
  } catch (err) {
    logger.error(`Driver request timeout sweep failed: ${err.message}`);
  }
};

// Called once from server.js at startup.
const startDriverRequestTimeoutSweep = () => {
  cron.schedule('* * * * *', sweep);
  logger.info('🔔 Driver request timeout sweep scheduled (every minute)');
};

module.exports = { startDriverRequestTimeoutSweep, sweep };
