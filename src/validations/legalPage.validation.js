const { body, param } = require('express-validator');
const { LEGAL_AUDIENCES, LEGAL_PAGE_KEYS } = require('../constants/legalPages');

const audienceParamValidation = [
  param('audience').isIn(LEGAL_AUDIENCES).withMessage(`audience must be one of: ${LEGAL_AUDIENCES.join(', ')}`),
];

const pageKeyParamValidation = [
  ...audienceParamValidation,
  param('pageKey').isIn(LEGAL_PAGE_KEYS).withMessage(`pageKey must be one of: ${LEGAL_PAGE_KEYS.join(', ')}`),
];

// PATCH /api/legal-pages/:id — admin only. title/content are both optional on a single PATCH
// (the admin editor can save just one field), but at least one must be non-empty to be worth
// a write — enforced in the controller, not here, since "both omitted" isn't a validation-rule
// shape express-validator expresses cleanly against two independently-optional fields.
const updateLegalPageValidation = [
  body('title').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 200 }).withMessage('title must be 200 characters or fewer'),
  body('content').optional({ nullable: true }).isString().withMessage('content must be a string'),
];

// POST /api/legal-pages/:audience/account-deletion-request — public. At least one of
// email/phone is required so there's some way to actually identify and follow up on the
// requester; name/reason are both optional context.
const accountDeletionRequestValidation = [
  ...audienceParamValidation,
  body('name').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 200 }).withMessage('name must be 200 characters or fewer'),
  body('email').optional({ nullable: true, checkFalsy: true }).trim().isEmail().withMessage('Enter a valid email address'),
  body('phone').optional({ nullable: true, checkFalsy: true }).trim().matches(/^\d{10}$/).withMessage('phone must be 10 digits'),
  body('reason').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 2000 }).withMessage('reason must be 2000 characters or fewer'),
  body().custom((value) => {
    if (!value?.email && !value?.phone) {
      throw new Error('Either email or phone is required');
    }
    return true;
  }),
];

const updateAccountDeletionRequestValidation = [
  body('status').optional({ nullable: true, checkFalsy: true }).isIn(['pending', 'completed', 'rejected']).withMessage('status must be one of: pending, completed, rejected'),
  body('admin_notes').optional({ nullable: true }).isString().isLength({ max: 2000 }).withMessage('admin_notes must be 2000 characters or fewer'),
];

// POST /api/account-deletion-requests/me — authenticated. No audience/name/email/phone here —
// all of that comes from req.user (see submitMyAccountDeletionRequest), not user input.
const myAccountDeletionRequestValidation = [
  body('reason').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 2000 }).withMessage('reason must be 2000 characters or fewer'),
];

// POST /api/account-deletion-requests/:id/delete-account — admin only. admin_notes is the only
// optional body field; the rest of the action is driven entirely by the :id param.
const deleteAccountFromRequestValidation = [
  body('admin_notes').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 2000 }).withMessage('admin_notes must be 2000 characters or fewer'),
];

module.exports = {
  audienceParamValidation,
  pageKeyParamValidation,
  updateLegalPageValidation,
  accountDeletionRequestValidation,
  updateAccountDeletionRequestValidation,
  myAccountDeletionRequestValidation,
  deleteAccountFromRequestValidation,
};
