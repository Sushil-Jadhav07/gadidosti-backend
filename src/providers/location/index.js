const FakeLocationProvider = require('./FakeLocationProvider');
const GoogleMapsLocationProvider = require('./GoogleMapsLocationProvider');

// Uses live Google Maps (Geocoding / Distance Matrix / Directions) whenever a
// GOOGLE_MAPS_API_KEY is configured, so local dev without a key still falls back to the
// static fake provider automatically. LOCATION_PROVIDER=fake forces the fallback even when
// a key is present, e.g. to avoid burning API quota while working on unrelated features.
const getLocationProvider = () => {
  if (process.env.LOCATION_PROVIDER === 'fake') return new FakeLocationProvider();
  if (process.env.GOOGLE_MAPS_API_KEY) return new GoogleMapsLocationProvider();
  return new FakeLocationProvider();
};

module.exports = { getLocationProvider };
