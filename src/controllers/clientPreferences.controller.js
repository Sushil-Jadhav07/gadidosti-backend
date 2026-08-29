const SavedAddressModel = require('../models/savedAddress.model');
const SavedPaymentMethodModel = require('../models/savedPaymentMethod.model');
const { successResponse, errorResponse } = require('../utils/response');

const ADDRESS_TYPES = ['pickup', 'dropoff'];

const projectAddress = (row) => ({
  id: row.id,
  label: row.label,
  address: row.address,
  floor: row.floor || null,
  lat: row.lat != null ? Number(row.lat) : null,
  lng: row.lng != null ? Number(row.lng) : null,
  city: row.city || null,
  addressType: row.address_type || 'pickup',
  contactName: row.contact_name || null,
  contactPhone: row.contact_phone || null,
  isDefault: row.is_default,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ─── GET /api/addresses ────────────────────────────────────────────────────
const listAddresses = async (req, res, next) => {
  try {
    const rows = await SavedAddressModel.findByClient(req.user.id);
    return successResponse(res, 200, 'Saved addresses fetched', { addresses: rows.map(projectAddress) });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/addresses ───────────────────────────────────────────────────
const createAddress = async (req, res, next) => {
  try {
    const { label, address, floor, lat, lng, city, address_type, contact_name, contact_phone } = req.body;
    if (!label?.trim()) return errorResponse(res, 422, 'A name for this address is required (e.g. "Home", "Warehouse")');
    if (!address?.trim()) return errorResponse(res, 422, 'The address itself is required');
    if (address_type != null && !ADDRESS_TYPES.includes(address_type)) {
      return errorResponse(res, 422, `address_type must be one of: ${ADDRESS_TYPES.join(', ')}`);
    }

    const created = await SavedAddressModel.create({
      clientId: req.user.id,
      label: label.trim(),
      address: address.trim(),
      floor: floor?.trim() || null,
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
      city: city?.trim() || null,
      addressType: address_type || 'pickup',
      contactName: contact_name?.trim() || null,
      contactPhone: contact_phone?.trim() || null,
    });
    return successResponse(res, 201, 'Address saved', { address: projectAddress(created) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/addresses/:id ──────────────────────────────────────────────
const updateAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { label, address, floor, lat, lng, city, address_type, contact_name, contact_phone } = req.body;
    if (label != null && !label.trim()) return errorResponse(res, 422, 'Name cannot be empty');
    if (address != null && !address.trim()) return errorResponse(res, 422, 'Address cannot be empty');
    if (address_type != null && !ADDRESS_TYPES.includes(address_type)) {
      return errorResponse(res, 422, `address_type must be one of: ${ADDRESS_TYPES.join(', ')}`);
    }

    // Explicit whitelist — never pass req.body straight through to the model's dynamic
    // UPDATE ... SET builder, which turns object keys directly into SQL column names.
    const updated = await SavedAddressModel.update(id, req.user.id, {
      label: label != null ? label.trim() : undefined,
      address: address != null ? address.trim() : undefined,
      floor: floor !== undefined ? (floor?.trim() || null) : undefined,
      lat: lat !== undefined ? (lat != null ? Number(lat) : null) : undefined,
      lng: lng !== undefined ? (lng != null ? Number(lng) : null) : undefined,
      city: city !== undefined ? (city?.trim() || null) : undefined,
      address_type: address_type || undefined,
      contact_name: contact_name !== undefined ? (contact_name?.trim() || null) : undefined,
      contact_phone: contact_phone !== undefined ? (contact_phone?.trim() || null) : undefined,
    });
    if (!updated) return errorResponse(res, 404, 'Address not found');
    return successResponse(res, 200, 'Address updated', { address: projectAddress(updated) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/addresses/:id/default ──────────────────────────────────────
const setDefaultAddress = async (req, res, next) => {
  try {
    const updated = await SavedAddressModel.setDefault(req.params.id, req.user.id);
    if (!updated) return errorResponse(res, 404, 'Address not found');
    return successResponse(res, 200, 'Default address updated', { address: projectAddress(updated) });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/addresses/:id ─────────────────────────────────────────────
const deleteAddress = async (req, res, next) => {
  try {
    const removed = await SavedAddressModel.remove(req.params.id, req.user.id);
    if (!removed) return errorResponse(res, 404, 'Address not found');
    return successResponse(res, 200, 'Address removed');
  } catch (err) {
    next(err);
  }
};

const projectPaymentMethod = (row) => ({
  id: row.id,
  methodType: row.method_type,
  label: row.label,
  details: row.details || {},
  isDefault: row.is_default,
  createdAt: row.created_at,
});

const METHOD_TYPES = ['upi', 'card', 'netbanking', 'wallet'];
// Defense in depth — no caller of this controller currently sends these, but `details` is a
// free-form JSONB blob and PaymentMethods.jsx's add form is a simulated card-entry UI a client
// could paste anything into, so anything resembling a full card number or PIN/CVV is stripped
// unconditionally before it ever reaches the database — that's "Sensitive Authentication Data"
// under PCI-DSS, which must never be retained after authorization, real gateway or not. Expiry
// month/year is deliberately NOT on this list: it's ordinary "Cardholder Data" (same category
// as the last-4-digits/brand this table already stores), not Sensitive Authentication Data —
// real card-on-file APIs (Stripe, etc.) return exp_month/exp_year for exactly this reason.
const FORBIDDEN_DETAIL_KEYS = ['cvv', 'cvv2', 'pin', 'cardnumber', 'card_number', 'number'];
const sanitizeDetails = (details) => {
  if (!details || typeof details !== 'object') return {};
  const clean = {};
  for (const [key, value] of Object.entries(details)) {
    if (FORBIDDEN_DETAIL_KEYS.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') clean[key] = value;
  }
  return clean;
};

// ─── GET /api/payment-methods ──────────────────────────────────────────────
const listPaymentMethods = async (req, res, next) => {
  try {
    const rows = await SavedPaymentMethodModel.findByClient(req.user.id);
    return successResponse(res, 200, 'Saved payment methods fetched', { paymentMethods: rows.map(projectPaymentMethod) });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/payment-methods ─────────────────────────────────────────────
const createPaymentMethod = async (req, res, next) => {
  try {
    const { method_type, label, details } = req.body;
    if (!METHOD_TYPES.includes(method_type)) {
      return errorResponse(res, 422, `method_type must be one of: ${METHOD_TYPES.join(', ')}`);
    }
    if (!label?.trim()) return errorResponse(res, 422, 'A label for this payment method is required');

    const created = await SavedPaymentMethodModel.create({
      clientId: req.user.id,
      methodType: method_type,
      label: label.trim(),
      details: sanitizeDetails(details),
    });
    return successResponse(res, 201, 'Payment method saved', { paymentMethod: projectPaymentMethod(created) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/payment-methods/:id/default ────────────────────────────────
const setDefaultPaymentMethod = async (req, res, next) => {
  try {
    const updated = await SavedPaymentMethodModel.setDefault(req.params.id, req.user.id);
    if (!updated) return errorResponse(res, 404, 'Payment method not found');
    return successResponse(res, 200, 'Default payment method updated', { paymentMethod: projectPaymentMethod(updated) });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/payment-methods/:id ────────────────────────────────────────
const deletePaymentMethod = async (req, res, next) => {
  try {
    const removed = await SavedPaymentMethodModel.remove(req.params.id, req.user.id);
    if (!removed) return errorResponse(res, 404, 'Payment method not found');
    return successResponse(res, 200, 'Payment method removed');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listAddresses, createAddress, updateAddress, setDefaultAddress, deleteAddress,
  listPaymentMethods, createPaymentMethod, setDefaultPaymentMethod, deletePaymentMethod,
};
