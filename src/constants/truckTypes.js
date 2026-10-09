// The 8 specific truck types that replace the old broad small/medium/large categories for
// anything describing a truck's actual physical size — truck registration, the client's
// truck-selection picker, and the pricing rate card (see pricing.model.js's
// DEFAULT_VEHICLE_PRICING, which is keyed by these same `value`s).
//
// 'part' (part-load / shared-capacity booking) is a separate BOOKING MODE, not a truck size —
// a truck itself is never registered as 'part' (that was true before this change too), so it's
// deliberately not in this list. Callers that need to allow a client to pick "part load" at
// booking time add 'part' on top of TRUCK_TYPE_VALUES themselves (see booking.validation.js).
const TRUCK_TYPES = [
  { value: '3_wheeler', label: '3 Wheeler', capacity: '500 kg' },
  { value: 'tata_ace', label: 'Tata Ace', capacity: '750 kg' },
  { value: 'pickup_8ft', label: 'Pickup 8ft', capacity: '1 Ton' },
  { value: 'pickup_10ft', label: 'Pickup 10ft', capacity: '1.2 Ton' },
  { value: '14ft', label: '14ft Truck', capacity: '3.7 Ton' },
  { value: '17ft', label: '17ft Truck', capacity: '4.5 Ton' },
  { value: '19ft', label: '19ft Truck', capacity: '6 Ton' },
  { value: '22ft', label: '22ft Truck', capacity: '7 Ton' },
  { value: '32ft_sxl', label: '32ft SXL', capacity: '9 Ton' },
  { value: '32ft_mxl', label: '32ft MXL', capacity: '18 Ton' },
];

const TRUCK_TYPE_VALUES = TRUCK_TYPES.map((t) => t.value);

// Existing trucks/bookings keep whatever pre-retaxonomy category they already have — nothing
// force-migrates them (see db/51vehicle_pricing.sql) — so validation everywhere still needs to
// accept these three alongside the new 8 (now 10), or an ordinary update to an old, not-yet-
// recategorized truck would start failing for a field the request didn't even mean to change.
const LEGACY_TRUCK_CATEGORIES = ['small', 'medium', 'large'];

// A truck's body structure — independent of its size category. Optional (null = not specified,
// mainly for trucks registered before this field existed) everywhere it's used: truck
// registration (trucks.body_type), and as a search filter on top of the size category
// (GET /api/vehicles/trucks/nearby, the "Find Truck" broadcast match, bookings.truck_body_type).
const TRUCK_BODY_TYPES = [
  { value: 'open', label: 'Open Truck' },
  { value: 'closed', label: 'Closed Truck' },
];
const TRUCK_BODY_TYPE_VALUES = TRUCK_BODY_TYPES.map((t) => t.value);

module.exports = { TRUCK_TYPES, TRUCK_TYPE_VALUES, LEGACY_TRUCK_CATEGORIES, TRUCK_BODY_TYPES, TRUCK_BODY_TYPE_VALUES };
