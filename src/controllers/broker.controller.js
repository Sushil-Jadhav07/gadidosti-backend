const BrokerProfileModel = require('../models/brokerProfile.model');
const { successResponse } = require('../utils/response');

const projectBrokerProfile = (row) => ({
  serviceCity: row?.service_city ?? null,
  isOnline: row?.is_online ?? true,
});

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

module.exports = { updateServiceCity, updateAvailability };
