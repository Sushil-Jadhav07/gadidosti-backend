const express = require('express');
const router = express.Router();

const {
  createEnquiry, listMyEnquiries,
  createListing, listMyListings, updateListingStatus, deleteListing,
  adminListEnquiries, adminUpdateEnquiryStatus, adminListListings,
} = require('../controllers/monthlyHiring.controller');
const { authenticate, authorize, requireAdminPage } = require('../middleware/auth.middleware');
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
// 'staff' now included, gated per-page (see db/58staff_page_permissions.sql) — the blanket
// exclusion noted in db/48add_staff_role.sql is exactly what this replaces.
router.get('/admin/monthly-hiring/enquiries', authenticate, authorize('admin', 'staff'), requireAdminPage('monthly_hiring'), adminListEnquiries);
router.patch('/admin/monthly-hiring/enquiries/:id/status', authenticate, authorize('admin', 'staff'), requireAdminPage('monthly_hiring'), adminUpdateEnquiryStatusValidation, validate, adminUpdateEnquiryStatus);
router.get('/admin/monthly-hiring/listings', authenticate, authorize('admin', 'staff'), requireAdminPage('monthly_hiring'), adminListListings);

module.exports = router;
