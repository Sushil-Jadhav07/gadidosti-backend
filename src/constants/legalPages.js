// Public legal/compliance pages (Privacy Policy, Terms, etc.) — one set per audience, editable
// from the admin dashboard, served without auth for app-store compliance links. See
// db/63legal_pages.sql / migrate.js for the table, legalPage.model.js for reads/writes.
const LEGAL_AUDIENCES = ['client', 'driver', 'broker'];

// account_deletion is special — besides its own admin-edited explanatory content (what data gets
// deleted, how), the public page also renders a request form that POSTs to
// /api/legal-pages/:audience/account-deletion-request (see legalPage.controller.js).
const LEGAL_PAGE_KEYS = [
  'privacy_policy',
  'terms_conditions',
  'account_deletion',
  'contact_support',
  'refund_policy',
  'safety_policy',
];

const LEGAL_PAGE_DEFAULT_TITLES = {
  privacy_policy: 'Privacy Policy',
  terms_conditions: 'Terms & Conditions',
  account_deletion: 'Account Deletion Request',
  contact_support: 'Contact / Support',
  refund_policy: 'Cancellation & Refund Policy',
  safety_policy: 'Safety Policy',
};

module.exports = { LEGAL_AUDIENCES, LEGAL_PAGE_KEYS, LEGAL_PAGE_DEFAULT_TITLES };
