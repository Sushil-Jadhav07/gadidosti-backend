const { successResponse } = require('../utils/response');

const VEHICLE_TYPES = [
  { id: 'small', name: 'Tata Ace / Pickup', capacity: 'Up to 1 Ton' },
  { id: 'medium', name: 'Medium Truck', capacity: 'Up to 5 Tons' },
  { id: 'large', name: 'Large Truck', capacity: 'Up to 20 Tons' },
  { id: 'part', name: 'Part Truck', capacity: 'Share capacity with others', featured: true, savePercent: 40 },
];

const MATERIAL_TYPES = ['Electronics', 'FMCG', 'Construction', 'Furniture', 'Pharma Products', 'Textiles', 'Auto Parts', 'Other'];

const CITIES = ['Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Jaipur', 'Ahmedabad', 'Surat', 'Nashik', 'Nagpur', 'Kolhapur', 'Indore', 'Goa', 'Aurangabad'];

const DISTANCE_MAP = {
  'Mumbai|Pune': 150,
  'Pune|Mumbai': 150,
  'Mumbai|Nashik': 165,
  'Nashik|Mumbai': 165,
  'Pune|Nashik': 210,
  'Nashik|Pune': 210,
  'Mumbai|Surat': 280,
  'Surat|Mumbai': 280,
  'Mumbai|Ahmedabad': 530,
  'Ahmedabad|Mumbai': 530,
  'Pune|Goa': 450,
  'Goa|Pune': 450,
  'Delhi|Jaipur': 280,
  'Jaipur|Delhi': 280,
  'Delhi|Indore': 830,
  'Indore|Delhi': 830,
  'Bengaluru|Chennai': 350,
  'Chennai|Bengaluru': 350,
  'Hyderabad|Chennai': 630,
  'Chennai|Hyderabad': 630,
  'Nagpur|Aurangabad': 470,
  'Aurangabad|Nagpur': 470,
  'Kolhapur|Pune': 230,
  'Pune|Kolhapur': 230,
};

const listVehicleTypes = async (req, res) => successResponse(res, 200, 'Vehicle types fetched', { vehicleTypes: VEHICLE_TYPES });
const listMaterialTypes = async (req, res) => successResponse(res, 200, 'Material types fetched', { materialTypes: MATERIAL_TYPES });
const listCities = async (req, res) => successResponse(res, 200, 'Cities fetched', { cities: CITIES });

const getDistance = async (req, res) => {
  const { pickup, drop } = req.body;
  const key = `${pickup}|${drop}`;
  const distance = DISTANCE_MAP[key] || 500;
  return successResponse(res, 200, 'Distance fetched', { distance });
};

module.exports = { listVehicleTypes, listMaterialTypes, listCities, getDistance };
