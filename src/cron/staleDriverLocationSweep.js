const cron = require('node-cron');
const DriverProfileModel = require('../models/driverProfile.model');
const NotificationModel = require('../models/notification.model');
const logger = require('../utils/logger');

// A web-app tab in the background (phone locked, tab backgrounded) stops sending GPS pings
// within seconds on most mobile browsers — 5 minutes gives a real signal gap (tunnel, dead
// zone) room to recover before either branch below fires.
const STALE_LOCATION_MINUTES = 5;

// Runs every 2 minutes:
//   1. status='available' drivers whose GPS has gone stale get auto-flipped to 'offline' —
//      keeps GET /api/vehicles/trucks/nearby honest (it already requires status='available'
//      AND a location, so this doesn't need to touch that query at all, just this one).
//   2. status='on_trip' drivers whose GPS has gone stale get their broker notified once
//      (their status is left alone — an active trip shouldn't disappear over a signal gap).
const sweep = async () => {
  try {
    const staleAvailable = await DriverProfileModel.findAvailableWithStaleLocation(STALE_LOCATION_MINUTES);
    for (const userId of staleAvailable) {
      await DriverProfileModel.setOffline(userId);
      logger.info(`Driver ${userId} auto-set offline — no location update in ${STALE_LOCATION_MINUTES}+ min while available`);
    }

    const staleOnTrip = await DriverProfileModel.findOnTripWithStaleLocation(STALE_LOCATION_MINUTES);
    for (const driver of staleOnTrip) {
      await NotificationModel.create({
        userId: driver.broker_id,
        title: 'Driver Location Not Updating',
        message: `${driver.driver_name}'s live location (truck ${driver.truck_reg || 'unknown'}) hasn't updated in ${STALE_LOCATION_MINUTES}+ minutes during an active trip. Check in with them if this continues.`,
        type: 'general',
        meta: { driver_id: driver.user_id, truck_id: driver.truck_id },
      });
      await DriverProfileModel.markStaleNotified(driver.user_id);
      logger.info(`Broker ${driver.broker_id} notified — driver ${driver.user_id}'s location stale mid-trip`);
    }
  } catch (err) {
    logger.error(`Stale driver location sweep failed: ${err.message}`);
  }
};

const startStaleDriverLocationSweep = () => {
  cron.schedule('*/2 * * * *', sweep);
  logger.info('🔔 Stale driver location sweep scheduled (every 2 minutes)');
};

module.exports = { startStaleDriverLocationSweep, sweep };
