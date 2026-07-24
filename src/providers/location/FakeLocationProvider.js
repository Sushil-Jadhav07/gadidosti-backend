const LocationProvider = require('./LocationProvider');

// No real geocoding/maps API is wired up yet.
// getDistance uses the same static city-pair lookup table that used to live inline
// in config.controller.js — moved here so config.controller.js only calls the interface.
const DISTANCE_MAP = {
  'Mumbai|Pune': 150, 'Pune|Mumbai': 150,
  'Mumbai|Nashik': 165, 'Nashik|Mumbai': 165,
  'Pune|Nashik': 210, 'Nashik|Pune': 210,
  'Mumbai|Surat': 280, 'Surat|Mumbai': 280,
  'Mumbai|Ahmedabad': 530, 'Ahmedabad|Mumbai': 530,
  'Pune|Goa': 450, 'Goa|Pune': 450,
  'Delhi|Jaipur': 280, 'Jaipur|Delhi': 280,
  'Delhi|Indore': 830, 'Indore|Delhi': 830,
  'Bengaluru|Chennai': 350, 'Chennai|Bengaluru': 350,
  'Hyderabad|Chennai': 630, 'Chennai|Hyderabad': 630,
  'Nagpur|Aurangabad': 470, 'Aurangabad|Nagpur': 470,
  'Kolhapur|Pune': 230, 'Pune|Kolhapur': 230,
};

class FakeLocationProvider extends LocationProvider {
  async geocode({ address }) {
    return null;
  }

  async getDistance({ from, to }) {
    const key = `${from}|${to}`;
    if (!(key in DISTANCE_MAP)) return null;
    const distanceKm = DISTANCE_MAP[key];
    // No real duration data to fake — approximate at a flat 50 km/h so durationMin exists
    // at all (GoogleMapsLocationProvider always returns one), and durationInTrafficMin
    // just equals it (no traffic surge in dev/test, since there's nothing real to base one on).
    const durationMin = Math.round((distanceKm / 50) * 60);
    return { distanceKm, durationMin, durationInTrafficMin: durationMin };
  }

  // No routing engine here — inherits LocationProvider's default (returns null).
}

module.exports = FakeLocationProvider;
