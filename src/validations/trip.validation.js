const { body } = require('express-validator');

const updateTripStatusValidation = [];
const updateTripLocationValidation = [];

const reportIssueValidation = [
  body('reason').isIn(['accident', 'breakdown', 'traffic_block', 'medical', 'other']).withMessage('Invalid reason'),
  body('notes').optional().isString(),
];

const resolveIncidentValidation = [
  body('resolution').isString().trim().notEmpty().withMessage('resolution is required'),
];

const MECHANIC_STATUS_VALUES = ['requested', 'mechanic_assigned', 'in_progress', 'resolved'];

const updateMechanicRequestValidation = [
  body('status').optional({ nullable: true, checkFalsy: true }).isIn(MECHANIC_STATUS_VALUES).withMessage(`status must be one of: ${MECHANIC_STATUS_VALUES.join(', ')}`),
  body('mechanicName').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 150 }).withMessage('mechanicName must be 150 characters or fewer'),
  body('mechanicPhone').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 20 }).withMessage('mechanicPhone must be 20 characters or fewer'),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 1000 }).withMessage('notes must be 1000 characters or fewer'),
];

module.exports = {
  updateTripStatusValidation, updateTripLocationValidation, reportIssueValidation, resolveIncidentValidation,
  updateMechanicRequestValidation,
};
