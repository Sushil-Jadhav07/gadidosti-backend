const PricingModel = require('../models/pricing.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');

// ─── GET /api/admin/pricing ───────────────────────────────────────────────────
const getPricingConfig = async (req, res, next) => {
  try {
    const row = await PricingModel.getConfig();
    if (!row) return errorResponse(res, 404, 'Pricing configuration not found');
    return successResponse(res, 200, 'Pricing configuration fetched', row.config);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/pricing ───────────────────────────────────────────────────
const updatePricingConfig = async (req, res, next) => {
  try {
    const config = req.body;

    const updated = await PricingModel.updateConfig(config);
    if (!updated) return errorResponse(res, 404, 'Pricing configuration not found');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'PRICING_CONFIG_UPDATED',
      entity: 'pricing_config',
      entityId: updated.id,
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Pricing configuration updated', updated.config);
  } catch (err) {
    next(err);
  }
};

module.exports = { getPricingConfig, updatePricingConfig };
