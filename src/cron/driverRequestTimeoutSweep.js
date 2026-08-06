const cron = require('node-cron');
const DriverRequestModel = require('../models/driverRequest.model');
const NotificationModel = require('../models/notification.model');
const logger = require('../utils/logger');

// Driver gets a hard 2-minute window to respond before their broker is looped in.
const DRIVER_RESPONSE_TIMEOUT_MINUTES = 2;

// If the broker also doesn't act within this many minutes of taking over, the request is
// expired outright so the client isn't left waiting indefinitely — they're expected to go
// back to GET /api/vehicles/trucks/nearby and pick a different truck. Broker gets longer than
// the driver since they may be juggling responses across their whole fleet.
const BROKER_RESPONSE_TIMEOUT_MINUTES = 5;

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

// Second stage: the broker took over (driver_timeout_at set) but still hasn't acted after
// BROKER_RESPONSE_TIMEOUT_MINUTES — expire the request rather than leave it open forever, and
// tell the client to restart their truck search. No truck/driver was ever reserved for this
// request (that only happens on client-accept), so nothing needs to be freed up here.
const brokerSweep = async () => {
  try {
    const overdue = await DriverRequestModel.findOverdueForBrokerResponse(BROKER_RESPONSE_TIMEOUT_MINUTES);
    if (!overdue.length) return;

    for (const request of overdue) {
      const expired = await DriverRequestModel.respondentDecline(request.id);
      if (!expired) continue;

      // Broker-assign origin: the broker picked this driver themselves, so it's on them to
      // try someone else from their fleet — the client never searched trucks in this flow.
      if (request.job_request_id) {
        await NotificationModel.create({
          userId: request.broker_id,
          title: 'Assignment Not Confirmed',
          message: `Neither your driver nor you responded in time to the ride you assigned for booking ${request.booking_number}. Please assign a different driver from your fleet.`,
          type: 'booking',
          meta: { booking_id: request.booking_id, driver_request_id: request.id },
        });
      } else {
        await NotificationModel.create({
          userId: request.client_id,
          title: 'Request Expired',
          message: `Neither the driver nor the broker responded to your request for booking ${request.booking_number}. Please search for another truck.`,
          type: 'booking',
          meta: { booking_id: request.booking_id, driver_request_id: request.id },
        });
      }

      logger.info(`Driver-request broker timeout: request ${request.id} expired (broker ${request.broker_id} did not respond)`);
    }
  } catch (err) {
    logger.error(`Broker timeout sweep failed: ${err.message}`);
  }
};

// Called once from server.js at startup.
const startDriverRequestTimeoutSweep = () => {
  cron.schedule('* * * * *', sweep);
  cron.schedule('* * * * *', brokerSweep);
  logger.info('🔔 Driver request timeout sweep scheduled (every minute)');
};

module.exports = { startDriverRequestTimeoutSweep, sweep, brokerSweep };
