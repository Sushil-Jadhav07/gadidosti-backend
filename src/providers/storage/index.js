const FakeLocalStorageProvider = require('./FakeLocalStorageProvider');
const PostgresStorageProvider = require('./PostgresStorageProvider');

// STORAGE_PROVIDER=fake (default, local disk — dev only) or postgres (bytea
// column, survives Render's ephemeral filesystem). To add real cloud storage later:
//   const S3StorageProvider = require('./S3StorageProvider');
//   if (process.env.STORAGE_PROVIDER === 's3') return new S3StorageProvider();
const getStorageProvider = () => {
  switch (process.env.STORAGE_PROVIDER) {
    case 'postgres':
      return new PostgresStorageProvider();
    default:
      return new FakeLocalStorageProvider();
  }
};

module.exports = { getStorageProvider };
