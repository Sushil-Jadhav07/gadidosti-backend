const JobRequestModel = require('../models/jobRequest.model');
const BookingModel = require('../models/booking.model');
const TripModel = require('../models/trip.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// "2 min ago" style relative-time label — the broker JobRequests list reads this, not a raw timestamp.
const timeAgo = (date) => {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
};

const expiresInMinutes = (expiresAt) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 60000));
};

const projectJobRequest = (row) => ({
  id: row.id,
  bookingId: row.booking_id,
  clientName: row.client_name,
  clientPhone: row.client_phone,
  pickup: row.pickup,
  drop: row.drop_location,
  distance: row.distance,
  truckType: row.truck_type,
  weight: row.weight ? `${row.weight} ${row.weight_unit || ''}`.trim() : null,
  amount: row.amount,
  status: row.status,
  expiresIn: expiresInMinutes(row.expires_at),
  timestamp: timeAgo(row.created_at),
});

// ─── GET /api/jobs/requests ───────────────────────────────────────────────────
const listJobRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const result = await JobRequestModel.findByBroker(req.user.id, {
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'Job requests fetched', { ...result, requests: result.requests.map(projectJobRequest) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/accept ──────────────────────────────────────
const acceptJobRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { driver_id, truck_id } = req.body;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your job request');
    if (jobRequest.status !== 'pending') return errorResponse(res, 400, `Job request is already ${jobRequest.status}`);
    if (expiresInMinutes(jobRequest.expires_at) === 0) {
      await JobRequestModel.setStatus(id, 'expired');
      return errorResponse(res, 400, 'This job request has expired');
    }

    const booking = await BookingModel.findById(jobRequest.booking_id);

    const trip = await TripModel.create({
      bookingId: booking.id,
      driverId: driver_id || booking.driver_id,
      brokerId: req.user.id,
      pickupAddress: booking.pickup_location,
      pickupLat: booking.pickup_lat,
      pickupLng: booking.pickup_lng,
      dropAddress: booking.drop_location,
      dropLat: booking.drop_lat,
      dropLng: booking.drop_lng,
      distance: booking.distance,
      cargoMaterial: booking.material,
      cargoWeight: booking.weight,
      cargoQuantity: booking.quantity,
      cargoValue: booking.amount,
      earnings: booking.amount && booking.platform_fee ? booking.amount - booking.platform_fee : booking.amount,
    });

    await BookingModel.advanceStatus(booking.id, {
      status: 'confirmed',
      currentStep: 1,
      brokerId: req.user.id,
      driverId: driver_id,
      truckId: truck_id,
    });
    await BookingModel.addTimelineStep(booking.id, { step: 'confirmed', position: 1 });

    await JobRequestModel.setStatus(id, 'accepted');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_ACCEPTED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: booking.id, trip_id: trip.id },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: booking.client_id,
      title: 'Booking Confirmed',
      message: `Your booking has been accepted by a broker and is now confirmed.`,
      type: 'booking',
      meta: { booking_id: booking.id },
    });

    logger.info(`Job request ${id} accepted by broker ${req.user.id} -> trip ${trip.id}`);
    return successResponse(res, 200, 'Job request accepted', { trip });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/decline ─────────────────────────────────────
const declineJobRequest = async (req, res, next) => {
  try {
    const { id } = req.params;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your job request');
    if (jobRequest.status !== 'pending') return errorResponse(res, 400, `Job request is already ${jobRequest.status}`);

    const updated = await JobRequestModel.setStatus(id, 'declined');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_DECLINED',
      entity: 'job_requests',
      entityId: id,
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Job request declined', { request: updated });
  } catch (err) {
    next(err);
  }
};

module.exports = { listJobRequests, acceptJobRequest, declineJobRequest };
