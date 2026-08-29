const express = require('express');
const router = express.Router();

const {
  listAddresses, createAddress, updateAddress, setDefaultAddress, deleteAddress,
  listPaymentMethods, createPaymentMethod, setDefaultPaymentMethod, deletePaymentMethod,
} = require('../controllers/clientPreferences.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Saved addresses — client-only, reused to prefill pickup/drop in BookTruck.jsx.
router.get('/addresses', authenticate, authorize('client'), listAddresses);
router.post('/addresses', authenticate, authorize('client'), createAddress);
router.patch('/addresses/:id', authenticate, authorize('client'), updateAddress);
router.patch('/addresses/:id/default', authenticate, authorize('client'), setDefaultAddress);
router.delete('/addresses/:id', authenticate, authorize('client'), deleteAddress);

// Saved payment methods — non-sensitive display data only, see clientPreferences.controller.js.
router.get('/payment-methods', authenticate, authorize('client'), listPaymentMethods);
router.post('/payment-methods', authenticate, authorize('client'), createPaymentMethod);
router.patch('/payment-methods/:id/default', authenticate, authorize('client'), setDefaultPaymentMethod);
router.delete('/payment-methods/:id', authenticate, authorize('client'), deletePaymentMethod);

module.exports = router;
