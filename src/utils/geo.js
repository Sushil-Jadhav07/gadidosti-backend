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

// Compass bearing (0-360, 0 = north) from point 1 to point 2 — used by the part-load matching
// heuristic (TruckModel.findOnTripForPartLoad) to judge whether a new booking's pickup/drop is
// roughly "on the way" for a truck already mid-trip, without a real routing engine.
const bearingDeg = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

// Smallest angle between two bearings (0-180) — how far "off course" b2 is from b1, regardless
// of which side. E.g. angleDiffDeg(10, 350) === 20, not 340.
const angleDiffDeg = (b1, b2) => {
  const diff = Math.abs(b1 - b2) % 360;
  return diff > 180 ? 360 - diff : diff;
};

module.exports = { haversineKm, AVERAGE_SPEED_KMPH, bearingDeg, angleDiffDeg };
