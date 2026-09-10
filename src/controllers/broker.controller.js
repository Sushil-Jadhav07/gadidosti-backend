const BrokerProfileModel = require('../models/brokerProfile.model');
const { successResponse } = require('../utils/response');

const projectBrokerProfile = (row) => ({
  serviceCity: row?.service_city ?? null,
  isOnline: row?.is_online ?? true,
});

// ─── GET /api/broker/profile ─────────────────────────────────────────────────
// Lets the broker's own Profile page load service_city/is_online to show/edit — nothing
// previously exposed these for reading (GET /api/users/profile doesn't join broker_profiles),
// which is part of why the frontend's "Address" section never actually persisted a city:
// there was no save endpoint wired up AND no way to load the saved value back in either.
const getBrokerProfile = async (req, res, next) => {
  try {
    const profile = await BrokerProfileModel.ensure(req.user.id);
    return successResponse(res, 200, 'Broker profile fetched', { profile: projectBrokerProfile(profile) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/broker/service-city ──────────────────────────────────────────
const updateServiceCity = async (req, res, next) => {
  try {
    const { service_city } = req.body;
    const profile = await BrokerProfileModel.setServiceCity(req.user.id, service_city);
    return successResponse(res, 200, 'Service city updated', { profile: projectBrokerProfile(profile) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/broker/availability ──────────────────────────────────────────
const updateAvailability = async (req, res, next) => {
  try {
    const { is_online } = req.body;
    const profile = await BrokerProfileModel.setOnline(req.user.id, is_online);
    return successResponse(res, 200, 'Availability updated', { profile: projectBrokerProfile(profile) });
  } catch (err) {
    next(err);
  }
};

module.exports = { getBrokerProfile, updateServiceCity, updateAvailability };
