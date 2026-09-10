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

  // Mutually-exclusive "Find Truck" (broadcast to nearby drivers) vs "Search for Broker"
  // (pick one broker) — both optional; omitting search_mode entirely keeps the legacy
  // broadcast-to-all-eligible-brokers behavior (see booking.controller.js's broadcastBooking).
  body('search_mode').optional({ nullable: true, checkFalsy: true })
    .isIn(['truck', 'broker']).withMessage('search_mode must be one of: truck, broker'),
  body('search_radius_km').optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0.5, max: 200 }).withMessage('search_radius_km must be between 0.5 and 200'),
  body('broker_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('broker_id must be a valid UUID'),

  // Book Later — is_scheduled requires scheduled_date to actually mean something (the deferred
  // broadcast time is computed from it).
  body('is_scheduled').optional({ nullable: true }).isBoolean().withMessage('is_scheduled must be a boolean'),
  body('scheduled_date').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('scheduled_date must be a valid date-time'),
  body('is_scheduled').custom((value, { req }) => {
    if (!value) return true;
    if (!req.body.scheduled_date) throw new Error('scheduled_date is required when is_scheduled is true');
    if (new Date(req.body.scheduled_date).getTime() <= Date.now()) throw new Error('scheduled_date must be in the future when is_scheduled is true');
    return true;
  }),
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
