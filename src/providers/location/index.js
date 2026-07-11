const FakeLocationProvider = require('./FakeLocationProvider');

// LOCATION_PROVIDER=fake (default). To add Google Maps later:
//   const GoogleMapsLocationProvider = require('./GoogleMapsLocationProvider');
//   if (process.env.LOCATION_PROVIDER === 'google_maps') return new GoogleMapsLocationProvider();
const getLocationProvider = () => {
  switch (process.env.LOCATION_PROVIDER) {
    default:
      return new FakeLocationProvider();
  }
};

module.exports = { getLocationProvider };
