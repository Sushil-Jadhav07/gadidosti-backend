const { getGstStateCode } = require('./gstStateCodes');

// GadiDost's own platform/service fee is a "support services" supply, taxed at the standard
// services rate — always forward charge (GadiDost charges and remits it itself), unlike the
// freight portion (see invoicePdf.js's RCM note, where the driver/broker is the GTA and the
// client self-assesses GST directly).
const GST_RATE = 0.18;

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Decomposes the ALREADY-COLLECTED platform_fee (GST-inclusive) into a taxable value + GST
// split for invoice display. Deliberately does not add any new charge on top — platform_fee is
// the same figure already used everywhere else (pricing, settlements, payment orders); this
// only breaks it down for the tax-invoice line items, nothing about what the client pays or
// what gets settled/paid out changes.
const computePlatformFeeGst = (platformFee, { companyGstin, clientGstin } = {}) => {
  const fee = Number(platformFee || 0);
  const taxableValue = round2(fee / (1 + GST_RATE));
  const totalGst = round2(fee - taxableValue);

  const companyStateCode = getGstStateCode(companyGstin);
  const clientStateCode = getGstStateCode(clientGstin);
  // No verified client GSTIN on file -> place of supply can't be confirmed as same-state, so
  // default to IGST (the conservative treatment when that match can't be made).
  const isIntraState = !!companyStateCode && !!clientStateCode && companyStateCode === clientStateCode;

  if (isIntraState) {
    const half = round2(totalGst / 2);
    return { taxableValue, cgst: half, sgst: half, igst: 0, totalGst, isIntraState, rate: GST_RATE };
  }
  return { taxableValue, cgst: 0, sgst: 0, igst: totalGst, totalGst, isIntraState, rate: GST_RATE };
};

module.exports = { GST_RATE, computePlatformFeeGst };
