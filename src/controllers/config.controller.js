const { successResponse, errorResponse } = require('../utils/response');
const { getLocationProvider } = require('../providers/location');
const PricingModel = require('../models/pricing.model');
const { TRUCK_TYPES } = require('../constants/truckTypes');

const locationProvider = getLocationProvider();

// The 8 specific truck types (see constants/truckTypes.js) plus 'part' (part-load — a booking
// mode, not a truck size, kept exactly as it was) — this is the live source BookTruck.jsx's
// Step 3 truck-selection cards render from.
const VEHICLE_TYPES = [
  ...TRUCK_TYPES.map((t) => ({ id: t.value, name: t.label, capacity: t.capacity })),
  { id: 'part', name: 'Part Truck', capacity: 'Share capacity with others', featured: true, savePercent: 40 },
];

const MATERIAL_TYPES = ['Electronics', 'FMCG', 'Construction', 'Furniture', 'Pharma Products', 'Textiles', 'Auto Parts', 'Other'];

const CITIES = ['Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Jaipur', 'Ahmedabad', 'Surat', 'Nashik', 'Nagpur', 'Kolhapur', 'Indore', 'Goa', 'Aurangabad'];

// Attaches the admin-configured minimum fare (pricing_config.vehiclePricing.<id>.minimumFare) to
// each vehicle type, so the truck-selection card always reflects whatever Pricing Management
// currently has saved — no hardcoded price ever ships in this response. Part truck has no fixed
// minimum fare (billed by capacity used %, see PricingModel.estimate), so it stays null.
const listVehicleTypes = async (req, res, next) => {
  try {
    const configRow = await PricingModel.getConfig();
    const vehiclePricing = configRow?.config?.vehiclePricing || {};
    const vehicleTypes = VEHICLE_TYPES.map((v) => ({
      ...v,
      basePrice: vehiclePricing[v.id]?.minimumFare ?? PricingModel.DEFAULT_VEHICLE_PRICING[v.id]?.minimumFare ?? null,
    }));
    return successResponse(res, 200, 'Vehicle types fetched', { vehicleTypes });
  } catch (err) {
    next(err);
  }
};
const listMaterialTypes = async (req, res) => successResponse(res, 200, 'Material types fetched', { materialTypes: MATERIAL_TYPES });
const listCities = async (req, res) => successResponse(res, 200, 'Cities fetched', { cities: CITIES });

const getDistance = async (req, res, next) => {
  try {
    const { pickup, drop } = req.body;
    const result = await locationProvider.getDistance({ from: pickup, to: drop });
    if (!result) {
      return errorResponse(res, 404, `Distance unavailable for ${pickup} -> ${drop}. Please check the spelling or try a different location.`);
    }
    // durationMin/durationInTrafficMin are surfaced here so the client can pass them
    // straight through to POST /api/pricing/estimate — that's what drives the traffic
    // surge multiplier in PricingModel.estimate().
    return successResponse(res, 200, 'Distance fetched', {
      distance: result.distanceKm,
      durationMin: result.durationMin,
      durationInTrafficMin: result.durationInTrafficMin,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { listVehicleTypes, listMaterialTypes, listCities, getDistance };
