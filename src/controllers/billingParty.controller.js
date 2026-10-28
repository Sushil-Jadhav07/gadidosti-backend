const ClientBillingPartyModel = require('../models/clientBillingParty.model');
const { successResponse } = require('../utils/response');

// ─── GET /api/billing-parties ──────────────────────────────────────────────────
// Powers Step 1's "Receiver Pays" chip list — previously-saved name+GSTIN pairs this client
// can pick again instead of retyping, or ignore in favor of "+ Add New".
const listBillingParties = async (req, res, next) => {
  try {
    const parties = await ClientBillingPartyModel.listForClient(req.user.id);
    return successResponse(res, 200, 'Billing parties fetched', { parties });
  } catch (err) {
    next(err);
  }
};

module.exports = { listBillingParties };
