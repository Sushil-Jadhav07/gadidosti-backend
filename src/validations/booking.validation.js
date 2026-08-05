const { body } = require('express-validator');

const TRANSPORT_TYPES = ['intra', 'inter'];

const isWithinCity = (location, city) =>
  String(location || '').toLowerCase().includes(String(city || '').toLowerCase());

// Nothing here is required — every field is optional. Values are still format/enum-checked
// when present (an invalid transport_type is still rejected), but omitting a field is always
// allowed, including pickup_location/drop_location/city.
//
// city is only meaningful for an intra-city booking — the single city both pickup and drop
// are expected to fall within. Inter-city bookings cross city lines by definition, so no city
// field applies there. The within-city check below only runs when transport_type is "intra"
// AND city AND the location being checked are all present — it's a conditional cross-check,
// not a requirement that any of them be given.
// "Within the city" is checked as a plain case-insensitive substring match against the
// address text (e.g. city="Indore" matches "...Indore, Madhya Pradesh 452005") — there's no
// geocoding-based city lookup wired into validation, since the default LOCATION_PROVIDER=fake
// has no real address data to check against.
const createBookingValidation = [
  body('pickup_location').optional({ nullable: true, checkFalsy: true }).trim(),
  body('drop_location').optional({ nullable: true, checkFalsy: true }).trim(),
  body('transport_type').optional({ nullable: true, checkFalsy: true })
    .isIn(TRANSPORT_TYPES).withMessage(`transport_type must be one of: ${TRANSPORT_TYPES.join(', ')}`),
  body('city').optional({ nullable: true, checkFalsy: true }).trim(),

  body('pickup_location').custom((value, { req }) => {
    if ((req.body.transport_type || 'intra') !== 'intra' || !req.body.city || !value) return true;
    if (!isWithinCity(value, req.body.city)) {
      throw new Error(`pickup_location must be within ${req.body.city} for an intra-city booking`);
    }
    return true;
  }),
  body('drop_location').custom((value, { req }) => {
    if ((req.body.transport_type || 'intra') !== 'intra' || !req.body.city || !value) return true;
    if (!isWithinCity(value, req.body.city)) {
      throw new Error(`drop_location must be within ${req.body.city} for an intra-city booking`);
    }
    return true;
  }),

  // Extra stops beyond the single pickup/drop pair — e.g. picking up from two warehouses
  // before heading to drop, or unloading part of the load at two different points. Each item
  // is optional and loosely shaped; nothing inside is required either.
  body('add_loading_location').optional({ nullable: true }).isArray().withMessage('add_loading_location must be an array'),
  body('add_loading_location.*.location').optional({ nullable: true, checkFalsy: true }).trim().isString(),
  body('add_loading_location.*.lat').optional({ nullable: true, checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('add_loading_location[].lat must be a valid latitude'),
  body('add_loading_location.*.lng').optional({ nullable: true, checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('add_loading_location[].lng must be a valid longitude'),

  body('add_unloading_location').optional({ nullable: true }).isArray().withMessage('add_unloading_location must be an array'),
  body('add_unloading_location.*.location').optional({ nullable: true, checkFalsy: true }).trim().isString(),
  body('add_unloading_location.*.lat').optional({ nullable: true, checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('add_unloading_location[].lat must be a valid latitude'),
  body('add_unloading_location.*.lng').optional({ nullable: true, checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('add_unloading_location[].lng must be a valid longitude'),
];

const quoteBookingValidation = [
  body('truck_category').trim().notEmpty().withMessage('truck_category is required')
    .isIn(['small', 'medium', 'large', 'part']).withMessage('truck_category must be one of: small, medium, large, part'),
  body('transport_type').optional({ nullable: true, checkFalsy: true })
    .isIn(TRANSPORT_TYPES).withMessage(`transport_type must be one of: ${TRANSPORT_TYPES.join(', ')}`),
  body('distance').notEmpty().withMessage('distance is required')
    .isFloat({ min: 0 }).withMessage('distance must be a positive number'),
  body('capacity_used_pct').optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0, max: 100 }).withMessage('capacity_used_pct must be between 0 and 100'),
  body('duration_min').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
  body('duration_in_traffic_min').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
];

module.exports = { createBookingValidation, quoteBookingValidation };
