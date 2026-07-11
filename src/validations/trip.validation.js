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

module.exports = {
  updateTripStatusValidation, updateTripLocationValidation, reportIssueValidation, resolveIncidentValidation,
};
