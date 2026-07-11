const cron = require('node-cron');
const JobRequestModel = require('../models/jobRequest.model');
const BookingModel = require('../models/booking.model');
const NotificationModel = require('../models/notification.model');
const logger = require('../utils/logger');

// Runs every 30s: lapses any pending job_request past its expiry, then checks whether
// that was the last live offer for its booking. If so, the booking would otherwise sit
// silently at 'pending' forever (see the broadcast comment in booking.controller.js's
// createBooking) — this marks it 'no_broker_available' and notifies the client instead.
const runOfferExpirySweep = async () => {
  try {
    const touchedBookingIds = await JobRequestModel.expirePending();

    for (const bookingId of touchedBookingIds) {
      const booking = await BookingModel.findById(bookingId);
      if (!booking || booking.status !== 'pending') continue;

      const allLapsed = await JobRequestModel.allLapsedForBooking(bookingId);
      if (!allLapsed) continue;

      await BookingModel.update(bookingId, { status: 'no_broker_available' });
      await NotificationModel.create({
        userId: booking.client_id,
        title: 'No Broker Available',
        message: 'No broker accepted your booking in time. Please try again or contact support.',
        type: 'booking',
        meta: { booking_id: bookingId },
      });

      logger.warn(`Booking ${bookingId} -> no_broker_available (all job offers lapsed)`);
    }
  } catch (err) {
    logger.error(`Offer expiry sweep failed: ${err.message}`);
  }
};

const startOfferExpirySweep = () => {
  cron.schedule('*/30 * * * * *', runOfferExpirySweep);
  logger.info('Offer-expiry cron sweep scheduled (every 30s)');
};

module.exports = { startOfferExpirySweep, runOfferExpirySweep };
