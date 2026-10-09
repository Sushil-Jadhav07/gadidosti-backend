const cron = require('node-cron');
const TripJoinRequestModel = require('../models/tripJoinRequest.model');
const NotificationModel = require('../models/notification.model');
const { emitTripJoinRequestUpdate } = require('../controllers/tripJoinRequest.controller');
const logger = require('../utils/logger');

// Same two-stage handover as driver_requests' own sweep (driverRequestTimeoutSweep.js) — driver
// gets a window to respond, then their broker is looped in, then the request expires outright
// rather than leaving the client's part-load booking waiting forever.
const DRIVER_RESPONSE_TIMEOUT_MINUTES = 2;
const BROKER_RESPONSE_TIMEOUT_MINUTES = 5;

const sweep = async () => {
  try {
    const overdue = await TripJoinRequestModel.findOverdueForDriverResponse(DRIVER_RESPONSE_TIMEOUT_MINUTES);
    if (!overdue.length) return;

    for (const request of overdue) {
      await TripJoinRequestModel.markDriverTimedOut(request.id);

      await NotificationModel.create({
        userId: request.broker_id,
        title: 'Driver Not Responding',
        message: `Your driver hasn't responded to a part-load request (${request.booking_number}) in ${DRIVER_RESPONSE_TIMEOUT_MINUTES}+ minutes. You can now accept or decline on their behalf.`,
        type: 'booking',
        meta: { booking_id: request.booking_id, trip_join_request_id: request.id },
      });

      const fresh = await TripJoinRequestModel.findById(request.id);
      emitTripJoinRequestUpdate(request.broker_id, fresh);

      logger.info(`Trip-join-request timeout: broker ${request.broker_id} notified for request ${request.id} (driver ${request.driver_id} did not respond)`);
    }
  } catch (err) {
    logger.error(`Trip join request timeout sweep failed: ${err.message}`);
  }
};

// Second stage: the broker took over (driver_timeout_at set) but still hasn't acted — decline
// the request outright (v1 has no mutual-confirm state to roll back, unlike driver_requests)
// and tell the client to search again.
const brokerSweep = async () => {
  try {
    const overdue = await TripJoinRequestModel.findOverdueForBrokerResponse(BROKER_RESPONSE_TIMEOUT_MINUTES);
    if (!overdue.length) return;

    for (const request of overdue) {
      const expired = await TripJoinRequestModel.decline(request.id);
      if (!expired) continue;

      await NotificationModel.create({
        userId: request.client_id,
        title: 'Part-Load Request Expired',
        message: `Neither the driver nor the broker responded to your part-load request for booking ${request.booking_number}. Please search for another truck.`,
        type: 'booking',
        meta: { booking_id: request.booking_id, trip_join_request_id: request.id },
      });

      const fresh = await TripJoinRequestModel.findById(request.id);
      emitTripJoinRequestUpdate(request.client_id, fresh);

      logger.info(`Trip-join-request broker timeout: request ${request.id} expired (broker ${request.broker_id} did not respond)`);
    }
  } catch (err) {
    logger.error(`Trip join request broker timeout sweep failed: ${err.message}`);
  }
};

const startTripJoinRequestTimeoutSweep = () => {
  cron.schedule('* * * * *', sweep);
  cron.schedule('* * * * *', brokerSweep);
  logger.info('🔔 Trip join request timeout sweep scheduled (every minute)');
};

module.exports = { startTripJoinRequestTimeoutSweep, sweep, brokerSweep };
