const { body } = require('express-validator');

const TRANSPORT_TYPES = ['intra', 'inter'];

const isWithinCity = (location, city) =>
  String(location || '').toLowerCase().includes(String(city || '').toLowerCase());

// city is only meaningful (and required) for an intra-city booking — the single city both
// pickup and drop must fall within. Inter-city bookings cross city lines by definition, so
// no city field applies there, and pickup/drop are free to be anywhere.
// "Within the city" is checked as a plain case-insensitive substring match against the
// address text (e.g. city="Indore" matches "...Indore, Madhya Pradesh 452005") — there's no
// geocoding-based city lookup wired into validation, since the default LOCATION_PROVIDER=fake
// has no real address data to check against.
const createBookingValidation = [
  body('pickup_location').trim().notEmpty().withMessage('pickup_location is required'),
  body('drop_location').trim().notEmpty().withMessage('drop_location is required'),
  body('transport_type').optional({ nullable: true, checkFalsy: true })
    .isIn(TRANSPORT_TYPES).withMessage(`transport_type must be one of: ${TRANSPORT_TYPES.join(', ')}`),

  body('city')
    .if((_, { req }) => (req.body.transport_type || 'intra') === 'intra')
    .trim().notEmpty().withMessage('city is required for an intra-city booking'),

  body('pickup_location').custom((value, { req }) => {
    if ((req.body.transport_type || 'intra') !== 'intra' || !req.body.city) return true;
    if (!isWithinCity(value, req.body.city)) {
      throw new Error(`pickup_location must be within ${req.body.city} for an intra-city booking`);
    }
    return true;
  }),
  body('drop_location').custom((value, { req }) => {
    if ((req.body.transport_type || 'intra') !== 'intra' || !req.body.city) return true;
    if (!isWithinCity(value, req.body.city)) {
      throw new Error(`drop_location must be within ${req.body.city} for an intra-city booking`);
    }
    return true;
  }),
];

module.exports = { createBookingValidation };
