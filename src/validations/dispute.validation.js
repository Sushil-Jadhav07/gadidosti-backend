const ISSUE_TYPES = [
  'damaged_goods', 'payment_delay', 'cancellation_fee', 'route_dispute',
  'late_delivery', 'fuel_surcharge', 'wrong_items', 'weight_discrepancy',
];

const createDisputeValidation = [];
const resolveDisputeValidation = [];

module.exports = { ISSUE_TYPES, createDisputeValidation, resolveDisputeValidation };
