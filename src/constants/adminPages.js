// Canonical list of admin-dashboard page keys — one per Sidebar.jsx item in
// gadidosti-admin-dashboard. Used to whitelist what an admin can grant a 'staff' account access
// to (see auth.validation.js's updateUserPagePermissionsValidation and auth.middleware.js's
// requireAdminPage). Keep in sync with that app's src/utils/permissions.js PAGE_KEYS.
const ADMIN_PAGE_KEYS = [
  'dashboard', 'bookings', 'drivers', 'trucks', 'tracking', 'chats', 'monthly_hiring',
  'users', 'brokers', 'pricing', 'invoices', 'incidents', 'disputes', 'kyc', 'analytics', 'settings',
];

module.exports = { ADMIN_PAGE_KEYS };
