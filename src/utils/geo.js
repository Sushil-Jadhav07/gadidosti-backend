// Straight-line (great-circle) distance in km — no routing engine, so this is a rough
// estimate, not turn-by-turn distance.
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Shared "how fast is a truck" assumption for straight-line ETA estimates derived from
// haversineKm — no routing engine, so this is a rough estimate, not turn-by-turn ETA.
const AVERAGE_SPEED_KMPH = 40;

// The one "nearby enough" radius used everywhere a driver's proximity to a pickup point actually
// matters — the "Find Truck" broadcast's default (booking.controller.js's
// DEFAULT_BROADCAST_RADIUS_KM) and the broker's own driver-assignment restriction
// (job.controller.js's assignDriver) both reference this single constant instead of each
// hardcoding "50" separately, so the two can't silently drift apart later.
const NEARBY_DRIVER_RADIUS_KM = 50;

module.exports = { haversineKm, AVERAGE_SPEED_KMPH, NEARBY_DRIVER_RADIUS_KM };
