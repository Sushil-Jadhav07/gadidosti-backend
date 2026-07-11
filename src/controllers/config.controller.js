const { successResponse, errorResponse } = require('../utils/response');
const { getLocationProvider } = require('../providers/location');

const locationProvider = getLocationProvider();

const VEHICLE_TYPES = [
  { id: 'small', name: 'Tata Ace / Pickup', capacity: 'Up to 1 Ton' },
  { id: 'medium', name: 'Medium Truck', capacity: 'Up to 5 Tons' },
  { id: 'large', name: 'Large Truck', capacity: 'Up to 20 Tons' },
  { id: 'part', name: 'Part Truck', capacity: 'Share capacity with others', featured: true, savePercent: 40 },
];

const MATERIAL_TYPES = ['Electronics', 'FMCG', 'Construction', 'Furniture', 'Pharma Products', 'Textiles', 'Auto Parts', 'Other'];

const CITIES = ['Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Jaipur', 'Ahmedabad', 'Surat', 'Nashik', 'Nagpur', 'Kolhapur', 'Indore', 'Goa', 'Aurangabad'];

const listVehicleTypes = async (req, res) => successResponse(res, 200, 'Vehicle types fetched', { vehicleTypes: VEHICLE_TYPES });
const listMaterialTypes = async (req, res) => successResponse(res, 200, 'Material types fetched', { materialTypes: MATERIAL_TYPES });
const listCities = async (req, res) => successResponse(res, 200, 'Cities fetched', { cities: CITIES });

const getDistance = async (req, res, next) => {
  try {
    const { pickup, drop } = req.body;
    const result = await locationProvider.getDistance({ from: pickup, to: drop });
    if (!result) {
      return errorResponse(res, 404, `Distance unavailable for ${pickup} -> ${drop}. This city pair isn't in our lookup table yet.`);
    }
    return successResponse(res, 200, 'Distance fetched', { distance: result.distanceKm });
  } catch (err) {
    next(err);
  }
};

module.exports = { listVehicleTypes, listMaterialTypes, listCities, getDistance };
