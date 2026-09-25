const express = require('express');
const router = express.Router();

const {
  createEnquiry, listMyEnquiries,
  createListing, listMyListings, updateListingStatus, deleteListing,
  adminListEnquiries, adminUpdateEnquiryStatus, adminListListings,
} = require('../controllers/monthlyHiring.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createEnquiryValidation, createListingValidation, updateListingStatusValidation, adminUpdateEnquiryStatusValidation,
} = require('../validations/monthlyHiring.validation');

// ─── Client: enquiries ──────────────────────────────────────────────────────────
router.post('/monthly-hiring/enquiries', authenticate, authorize('client'), createEnquiryValidation, validate, createEnquiry);
router.get('/monthly-hiring/enquiries/mine', authenticate, authorize('client'), listMyEnquiries);

// ─── Driver/broker: vehicle listings ────────────────────────────────────────────
router.post('/monthly-hiring/listings', authenticate, authorize('driver', 'broker'), createListingValidation, validate, createListing);
router.get('/monthly-hiring/listings/mine', authenticate, authorize('driver', 'broker'), listMyListings);
router.patch('/monthly-hiring/listings/:id', authenticate, authorize('driver', 'broker'), updateListingStatusValidation, validate, updateListingStatus);
router.delete('/monthly-hiring/listings/:id', authenticate, authorize('driver', 'broker'), deleteListing);

// ─── Admin ───────────────────────────────────────────────────────────────────────
// 'staff' deliberately excluded — same as every other authorize('admin')-only route (see
// db/48add_staff_role.sql: staff has no permission differences from admin defined yet).
router.get('/admin/monthly-hiring/enquiries', authenticate, authorize('admin'), adminListEnquiries);
router.patch('/admin/monthly-hiring/enquiries/:id/status', authenticate, authorize('admin'), adminUpdateEnquiryStatusValidation, validate, adminUpdateEnquiryStatus);
router.get('/admin/monthly-hiring/listings', authenticate, authorize('admin'), adminListListings);

module.exports = router;
