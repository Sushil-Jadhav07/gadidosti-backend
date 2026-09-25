const MonthlyHiringEnquiryModel = require('../models/monthlyHiringEnquiry.model');
const MonthlyVehicleListingModel = require('../models/monthlyVehicleListing.model');
const TruckModel = require('../models/truck.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const projectEnquiry = (row) => ({
  id: row.id,
  clientId: row.client_id,
  clientName: row.client_name,
  clientPhone: row.client_phone,
  clientEmail: row.client_email,
  location: row.location,
  truckCategory: row.truck_category,
  durationMonths: row.duration_months,
  pricingType: row.pricing_type,
  budgetAmount: row.budget_amount != null ? Number(row.budget_amount) : null,
  description: row.description,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const projectListing = (row) => ({
  id: row.id,
  ownerId: row.owner_id,
  ownerName: row.owner_name,
  ownerPhone: row.owner_phone,
  ownerRole: row.owner_role,
  truckId: row.truck_id,
  truckRegistration: row.truck_registration,
  truckType: row.truck_type,
  truckCategory: row.truck_category,
  truckCapacity: row.truck_capacity,
  pricingType: row.pricing_type,
  rateAmount: Number(row.rate_amount),
  availabilityNotes: row.availability_notes,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ─── POST /api/monthly-hiring/enquiries ────────────────────────────────────────
// Client-side lead capture — deliberately NOT wired into the booking/trip system. Creating one
// just records it for admin to follow up on manually; nothing here notifies a driver/broker or
// creates any matching booking.
const createEnquiry = async (req, res, next) => {
  try {
    const { location, truck_category, duration_months, pricing_type, budget_amount, description } = req.body;

    const enquiry = await MonthlyHiringEnquiryModel.create({
      clientId: req.user.id,
      location,
      truckCategory: truck_category,
      durationMonths: duration_months,
      pricingType: pricing_type,
      budgetAmount: budget_amount,
      description,
    });

    logger.info(`Monthly hiring enquiry ${enquiry.id} raised by client ${req.user.id}`);
    return successResponse(res, 201, 'Enquiry submitted — our team will get in touch soon', { enquiry: projectEnquiry(await MonthlyHiringEnquiryModel.findById(enquiry.id)) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/monthly-hiring/enquiries/mine ────────────────────────────────────
const listMyEnquiries = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const { items, total } = await MonthlyHiringEnquiryModel.findByClient(req.user.id, { page: parseInt(page), limit: parseInt(limit) });
    return successResponse(res, 200, 'Enquiries fetched', {
      enquiries: items.map(projectEnquiry),
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/monthly-hiring/listings ─────────────────────────────────────────
// Driver or broker lists a truck they already own/drive as available for monthly hire. Same
// "just a lead, no matching" philosophy as createEnquiry above.
const createListing = async (req, res, next) => {
  try {
    const { truck_id, pricing_type, rate_amount, availability_notes } = req.body;

    const truck = await TruckModel.findById(truck_id);
    if (!truck) return errorResponse(res, 404, 'Truck not found');
    // A broker owns the truck record; a driver is only ever the one currently assigned to it —
    // either can list it, but only if it's actually theirs.
    const isOwner = truck.broker_id === req.user.id || truck.driver_id === req.user.id;
    if (!isOwner) return errorResponse(res, 403, 'You can only list a truck you own or drive');

    const listing = await MonthlyVehicleListingModel.create({
      ownerId: req.user.id,
      truckId: truck_id,
      pricingType: pricing_type,
      rateAmount: rate_amount,
      availabilityNotes: availability_notes,
    });

    logger.info(`Monthly vehicle listing ${listing.id} created by ${req.user.role} ${req.user.id} for truck ${truck_id}`);
    return successResponse(res, 201, 'Vehicle listed for monthly hire', { listing: projectListing(await MonthlyVehicleListingModel.findById(listing.id)) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/monthly-hiring/listings/mine ─────────────────────────────────────
const listMyListings = async (req, res, next) => {
  try {
    const listings = await MonthlyVehicleListingModel.findByOwner(req.user.id);
    return successResponse(res, 200, 'Listings fetched', { listings: listings.map(projectListing) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/monthly-hiring/listings/:id ────────────────────────────────────
// Owner toggles their own listing active/inactive (e.g. truck's no longer available) — not a
// general edit endpoint, just the one field worth changing after the fact.
const updateListingStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updated = await MonthlyVehicleListingModel.updateStatus(id, req.user.id, status);
    if (!updated) return errorResponse(res, 404, 'Listing not found');
    return successResponse(res, 200, 'Listing updated', { listing: projectListing(await MonthlyVehicleListingModel.findById(id)) });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/monthly-hiring/listings/:id ───────────────────────────────────
const deleteListing = async (req, res, next) => {
  try {
    const { id } = req.params;
    const removed = await MonthlyVehicleListingModel.remove(id, req.user.id);
    if (!removed) return errorResponse(res, 404, 'Listing not found');
    return successResponse(res, 200, 'Listing removed');
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/monthly-hiring/enquiries ───────────────────────────────────
const adminListEnquiries = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const { items, total } = await MonthlyHiringEnquiryModel.findAll({ status, page: parseInt(page), limit: parseInt(limit) });
    return successResponse(res, 200, 'Enquiries fetched', {
      enquiries: items.map(projectEnquiry),
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/admin/monthly-hiring/enquiries/:id/status ─────────────────────
// The only state admin tracks on an enquiry — open (new lead) / contacted (someone followed up)
// / closed (matched, or the client's no longer interested). Purely for admin's own bookkeeping;
// doesn't notify the client or do anything else.
const adminUpdateEnquiryStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updated = await MonthlyHiringEnquiryModel.updateStatus(id, status);
    if (!updated) return errorResponse(res, 404, 'Enquiry not found');
    return successResponse(res, 200, 'Enquiry updated', { enquiry: projectEnquiry(await MonthlyHiringEnquiryModel.findById(id)) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/monthly-hiring/listings ────────────────────────────────────
const adminListListings = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const { items, total } = await MonthlyVehicleListingModel.findAll({ status, page: parseInt(page), limit: parseInt(limit) });
    return successResponse(res, 200, 'Listings fetched', {
      listings: items.map(projectListing),
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createEnquiry, listMyEnquiries,
  createListing, listMyListings, updateListingStatus, deleteListing,
  adminListEnquiries, adminUpdateEnquiryStatus, adminListListings,
};
