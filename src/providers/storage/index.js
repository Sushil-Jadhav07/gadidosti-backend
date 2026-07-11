const FakeLocalStorageProvider = require('./FakeLocalStorageProvider');

// STORAGE_PROVIDER=fake (default). To add real cloud storage later:
//   const S3StorageProvider = require('./S3StorageProvider');
//   if (process.env.STORAGE_PROVIDER === 's3') return new S3StorageProvider();
const getStorageProvider = () => {
  switch (process.env.STORAGE_PROVIDER) {
    default:
      return new FakeLocalStorageProvider();
  }
};

module.exports = { getStorageProvider };
