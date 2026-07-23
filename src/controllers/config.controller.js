const { successResponse, errorResponse } = require('../utils/response');
const { getLocationProvider } = require('../providers/location');
const PricingModel = require('../models/pricing.model');

const locationProvider = getLocationProvider();

const VEHICLE_TYPES = [
  { id: 'small', name: 'Tata Ace / Pickup', capacity: 'Up to 1 Ton' },
  { id: 'medium', name: 'Medium Truck', capacity: 'Up to 5 Tons' },
  { id: 'large', name: 'Large Truck', capacity: 'Up to 20 Tons' },
  { id: 'part', name: 'Part Truck', capacity: 'Share capacity with others', featured: true, savePercent: 40 },
];

const MATERIAL_TYPES = ['Electronics', 'FMCG', 'Construction', 'Furniture', 'Pharma Products', 'Textiles', 'Auto Parts', 'Other'];

const CITIES = ['Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Jaipur', 'Ahmedabad', 'Surat', 'Nashik', 'Nagpur', 'Kolhapur', 'Indore', 'Goa', 'Aurangabad'];

// Attaches the admin-configured base fare (pricing_config.intraCity.<id>.baseFare) to each
// vehicle type, so the truck-selection card always reflects whatever Pricing Management
// currently has saved — no hardcoded price ever ships in this response. Part truck has no
// fixed base fare (billed by capacity used %, see PricingModel.estimate), so it stays null.
const listVehicleTypes = async (req, res, next) => {
  try {
    const configRow = await PricingModel.getConfig();
    const intraCity = configRow?.config?.intraCity || {};
    const vehicleTypes = VEHICLE_TYPES.map((v) => ({
      ...v,
      basePrice: intraCity[v.id]?.baseFare ?? null,
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
    return successResponse(res, 200, 'Distance fetched', { distance: result.distanceKm });
  } catch (err) {
    next(err);
  }
};

module.exports = { listVehicleTypes, listMaterialTypes, listCities, getDistance };
