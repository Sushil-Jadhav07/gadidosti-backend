const pool = require('../config/db');
const TripModel = require('../models/trip.model');
const BookingModel = require('../models/booking.model');
const DriverProfileModel = require('../models/driverProfile.model');
const TruckModel = require('../models/truck.model');
const SettlementModel = require('../models/settlement.model');
const TripIncidentModel = require('../models/tripIncident.model');
const MechanicRequestModel = require('../models/mechanicRequest.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getStorageProvider } = require('../providers/storage');
const { toAbsoluteUrl } = require('../utils/fileUrl');

const storageProvider = getStorageProvider();
const STATUS_STEPS = ['pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'];

// A trip is "active" (still underway, incident-reportable) once it's past creation
// but before it's wrapped up one way or another.
const ACTIVE_TRIP_STATUSES = ['confirmed', 'en_route_pickup', 'picked_up', 'in_transit'];

// Subset of the booking status stepper that applies once a trip exists.
const TRIP_STEPS = ['confirmed', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'];

const projectTrip = (row, timeline) => ({
  id: row.id,
  bookingId: row.booking_id,
  bookingNumber: row.booking_number,
  status: row.status,
  broker: row.broker_name || null,
  brokerPhone: row.broker_phone || null,
  driverId: row.driver_id,
  driverName: row.driver_name || null,
  driverPhone: row.driver_phone || null,
  clientName: row.client_name,
  clientPhone: row.client_phone,
  truckId: row.truck_id,
  truckReg: row.truck_reg || null,
  pickup: {
    location: row.pickup_address,
    address: row.pickup_address,
    contactPerson: row.pickup_contact_person,
    contactPhone: row.pickup_contact_phone,
    time: row.pickup_time,
    lat: row.pickup_lat,
    lng: row.pickup_lng,
  },
  drop: {
    location: row.drop_address,
    address: row.drop_address,
    contactPerson: row.drop_contact_person,
    contactPhone: row.drop_contact_phone,
    time: row.drop_time,
    lat: row.drop_lat,
    lng: row.drop_lng,
  },
  distance: row.distance,
  estimatedTime: row.estimated_time,
  cargo: {
    material: row.cargo_material,
    weight: row.cargo_weight,
    quantity: row.cargo_quantity,
    specialInstructions: row.cargo_special_instructions,
    value: row.cargo_value,
  },
  earnings: row.earnings,
  startedAt: row.started_at,
  currentLocation: { lat: row.current_lat, lng: row.current_lng },
  podUrl: row.pod_url,
  timeline: timeline.map((t) => ({ step: t.step, done: t.done, time: t.occurred_at })),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const assertCanView = (trip, user) => {
  if (user.role === 'admin') return true;
  if (user.role === 'broker') return trip.broker_id === user.id;
  if (user.role === 'driver') return trip.driver_id === user.id;
  return false;
};

// Incidents are visible to a wider audience than the full trip record (which includes
// broker/driver-sensitive fields like earnings and phone numbers) — the client who owns
// the booking can see incidents on their own trip, but not the full trip via GET /api/trips/:id.
const assertCanViewIncidents = (trip, user) => {
  if (assertCanView(trip, user)) return true;
  if (user.role === 'client') return trip.client_id === user.id;
  return false;
};

const projectMechanicRequest = (row) => (row.mechanic_request_id ? {
  id: row.mechanic_request_id,
  status: row.mechanic_status,
  mechanicName: row.mechanic_name,
  mechanicPhone: row.mechanic_phone,
  notes: row.mechanic_notes,
  updatedAt: row.mechanic_updated_at,
} : null);

const projectIncident = (row) => ({
  id: row.id,
  tripId: row.trip_id,
  driverId: row.driver_id,
  reason: row.reason,
  notes: row.notes,
  status: row.status,
  reportedAt: row.reported_at,
  resolvedAt: row.resolved_at,
  resolution: row.resolution,
  // Only populated for reason='breakdown' — the mechanic dispatch/assignment sub-workflow.
  mechanicRequest: projectMechanicRequest(row),
});

const listTrips = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await TripModel.findAll({
      role: req.user.role,
      userId: req.user.id,
      status,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
    });

    const trips = await Promise.all(result.trips.map(async (row) => {
      const timeline = await TripModel.getTimeline(row.id);
      return projectTrip(row, timeline);
    }));

    return successResponse(res, 200, 'Trips fetched', { ...result, trips });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trips/active ────────────────────────────────────────────────────
const getActiveTrip = async (req, res, next) => {
  try {
    const trip = await TripModel.findActiveByDriver(req.user.id);
    if (!trip) return successResponse(res, 200, 'No active trip', { trip: null });

    const timeline = await TripModel.getTimeline(trip.id);
    return successResponse(res, 200, 'Active trip fetched', { trip: projectTrip(trip, timeline) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trips/upcoming ───────────────────────────────────────────────────
// The driver's next assigned trip that hasn't started yet (status still 'confirmed').
// Distinct from /trips/active, which only ever returns one in-progress trip at a time —
// this lets the UI show "what's next" without it duplicating the active trip card.
const getUpcomingTrip = async (req, res, next) => {
  try {
    const active = await TripModel.findActiveByDriver(req.user.id);
    const trip = await TripModel.findUpcomingByDriver(req.user.id, active?.id);
    if (!trip) return successResponse(res, 200, 'No upcoming trip', { trip: null });

    const timeline = await TripModel.getTimeline(trip.id);
    return successResponse(res, 200, 'Upcoming trip fetched', { trip: projectTrip(trip, timeline) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trips/:id ───────────────────────────────────────────────────────
const getTrip = async (req, res, next) => {
  try {
    const trip = await TripModel.findById(req.params.id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (!assertCanView(trip, req.user)) return errorResponse(res, 403, 'You do not have access to this trip');

    const timeline = await TripModel.getTimeline(trip.id);
    return successResponse(res, 200, 'Trip fetched', { trip: projectTrip(trip, timeline) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/trips/:id/status ──────────────────────────────────────────────
const updateTripStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (!assertCanView(trip, req.user)) return errorResponse(res, 403, 'You do not have access to this trip');

    // Settlement/trip-count must fire exactly once per trip. The driver flow sends two
    // separate status updates for one trip (in_transit -> delivered, then, once POD is
    // uploaded, delivered -> completed) — only the transition *into* 'completed' pays out.
    // Uses an atomic compare-and-swap (not a read-then-write check) so two racing or
    // duplicate/retried PATCH calls can't both win and double up the settlement.
    let isNewCompletion = false;
    if (status === 'completed') {
      const completed = await TripModel.completeIfNotAlready(id);
      if (!completed) {
        // Already completed — idempotent no-op, don't re-run timeline/booking sync or settlement.
        const full = await TripModel.findById(id);
        const timeline = await TripModel.getTimeline(id);
        return successResponse(res, 200, 'Trip already completed', { trip: projectTrip(full, timeline) });
      }
      isNewCompletion = true;
    } else {
      await TripModel.updateStatus(id, status);
    }
    const stepIndex = TRIP_STEPS.indexOf(status);
    await TripModel.addTimelineStep(id, { step: status, position: stepIndex >= 0 ? stepIndex : 99 });

    // Mirror the same status/step onto the parent booking so the client's tracker stays in sync.
    const bookingStepIndex = ['pending', 'confirmed', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'].indexOf(status);
    await BookingModel.advanceStatus(trip.booking_id, { status, currentStep: bookingStepIndex >= 0 ? bookingStepIndex : undefined });
    await BookingModel.addTimelineStep(trip.booking_id, { step: status, position: bookingStepIndex >= 0 ? bookingStepIndex : 99 });

    if (isNewCompletion) {
      if (trip.driver_id) await DriverProfileModel.incrementTotalTrips(trip.driver_id);

      const booking = await BookingModel.findById(trip.booking_id);
      await SettlementModel.create({
        bookingId: trip.booking_id,
        brokerId: trip.broker_id,
        driverId: trip.driver_id,
        amount: booking.amount || 0,
        platformFee: booking.platform_fee || 0,
      });

      if (trip.driver_id) {
        await NotificationModel.create({
          userId: trip.driver_id,
          title: 'Trip Completed',
          message: 'Your trip has been completed. Settlement is pending processing.',
          type: 'payment',
          meta: { trip_id: id },
        });
      }
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_STATUS_UPDATED',
      entity: 'trips',
      entityId: id,
      meta: { new_status: status },
      ipAddress: req.ip,
    });

    logger.info(`Trip ${id} status -> ${status} by ${req.user.id}`);
    const full = await TripModel.findById(id);
    const timeline = await TripModel.getTimeline(id);
    return successResponse(res, 200, 'Trip status updated', { trip: projectTrip(full || trip, timeline) });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/trips/:id/decline ──────────────────────────────────────────────
// Lets a driver decline a trip that's been assigned to them but that they haven't
// started yet (trips are created with status 'confirmed' and stay there until the
// driver taps "Start Trip to Pickup", which moves it to 'en_route_pickup'). Once
// started, this is no longer available — report-issue is the right path instead,
// since cargo may already be picked up.
const declineTrip = async (req, res, next) => {
  try {
    const { id } = req.params;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (trip.driver_id !== req.user.id) return errorResponse(res, 403, 'Not your trip');
    if (trip.status !== 'confirmed') {
      return errorResponse(res, 409, 'This trip has already started and can no longer be declined. Report an incident instead.');
    }

    if (trip.driver_id) await DriverProfileModel.update(trip.driver_id, { status: 'available' });
    if (trip.truck_id) await TruckModel.update(trip.truck_id, { status: 'available' });

    await BookingModel.update(trip.booking_id, {
      status: 'confirmed',
      current_step: STATUS_STEPS.indexOf('confirmed'),
      driver_id: null,
      truck_id: null,
    });
    await BookingModel.addTimelineStep(trip.booking_id, { step: 'driver_declined', position: 99 });

    await TripModel.remove(id);

    if (trip.broker_id) {
      await NotificationModel.create({
        userId: trip.broker_id,
        title: 'Driver Declined Trip',
        message: `${trip.driver_name || 'Your driver'} declined the assignment for ${trip.pickup_address} -> ${trip.drop_address}. Please assign another driver.`,
        type: 'booking',
        meta: { booking_id: trip.booking_id },
      });
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_DECLINED',
      entity: 'trips',
      entityId: id,
      meta: { booking_id: trip.booking_id },
      ipAddress: req.ip,
    });

    logger.info(`Trip ${id} declined by driver ${req.user.id}`);
    return successResponse(res, 200, 'Trip declined');
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/trips/:id/location ────────────────────────────────────────────
const updateTripLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { lat, lng } = req.body;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (req.user.role === 'driver' && trip.driver_id !== req.user.id) return errorResponse(res, 403, 'Not your trip');

    const updated = await TripModel.updateLocation(id, { lat, lng });
    return successResponse(res, 200, 'Location updated', { currentLocation: { lat: updated.current_lat, lng: updated.current_lng } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/trips/:id/report-issue ─────────────────────────────────────────
const reportIssue = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason, notes } = req.body;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (trip.driver_id !== req.user.id) return errorResponse(res, 403, 'Not your trip');
    if (!ACTIVE_TRIP_STATUSES.includes(trip.status)) return errorResponse(res, 409, 'Trip is not in an active state');

    const incident = await TripIncidentModel.create({ tripId: id, driverId: req.user.id, reason, notes });
    const reasonLabel = reason.replace(/_/g, ' ');

    // Breakdown reports get a linked mechanic_requests row so the broker can track
    // dispatch/assignment progress separately from the incident's own resolved/unresolved state.
    if (reason === 'breakdown') {
      await MechanicRequestModel.create({ tripIncidentId: incident.id });
    }

    if (trip.broker_id) {
      await NotificationModel.create({
        userId: trip.broker_id,
        title: reason === 'breakdown' ? 'Driver Needs a Mechanic' : 'Trip Incident Reported',
        message: reason === 'breakdown'
          ? `Your driver reported a breakdown on trip ${trip.booking_number || id} and needs a mechanic arranged.`
          : `Your driver reported a ${reasonLabel} on trip ${trip.booking_number || id}. The trip may be delayed or need reassignment.`,
        type: 'incident',
        meta: { trip_id: id, incident_id: incident.id, reason },
      });
    }

    if (trip.client_id) {
      await NotificationModel.create({
        userId: trip.client_id,
        title: 'Delivery Update',
        message: `Your driver reported a ${reasonLabel}. Your shipment may be delayed or reassigned — our team has been notified.`,
        type: 'incident',
        meta: { trip_id: id, incident_id: incident.id, reason },
      });
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_INCIDENT_REPORTED',
      entity: 'trip_incidents',
      entityId: incident.id,
      meta: { trip_id: id, reason },
      ipAddress: req.ip,
    });

    logger.info(`Trip incident reported: trip ${id} reason=${reason} by driver ${req.user.id}`);
    // Re-fetch so the response includes the joined mechanic_requests row created above.
    const full = await TripIncidentModel.findById(incident.id);
    return successResponse(res, 201, 'Incident reported. Broker and client have been notified.', { incident: projectIncident(full) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trips/:id/incidents ─────────────────────────────────────────────
const listIncidents = async (req, res, next) => {
  try {
    const trip = await TripModel.findById(req.params.id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (!assertCanViewIncidents(trip, req.user)) return errorResponse(res, 403, 'You do not have access to this trip');

    const incidents = await TripIncidentModel.findByTrip(trip.id);
    return successResponse(res, 200, 'Incidents fetched', { incidents: incidents.map(projectIncident) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/trips/:id/incidents/:incidentId/resolve ──────────────────────
const resolveIncident = async (req, res, next) => {
  try {
    const { id, incidentId } = req.params;
    const { resolution } = req.body;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (req.user.role === 'broker' && trip.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your trip');

    const incident = await TripIncidentModel.findById(incidentId);
    if (!incident || incident.trip_id !== id) return errorResponse(res, 404, 'Incident not found');
    if (incident.status === 'resolved') return errorResponse(res, 409, 'Incident already resolved');

    await TripIncidentModel.resolve(incidentId, resolution);

    // Keep the linked mechanic request in sync — resolving the incident from this generic
    // flow (not the dedicated mechanic-status endpoint) should still close out the mechanic
    // workflow, otherwise the broker/admin mechanic-status view would be stuck open forever.
    if (incident.mechanic_request_id && incident.mechanic_status !== 'resolved') {
      await MechanicRequestModel.update(incident.mechanic_request_id, { status: 'resolved' });
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_INCIDENT_RESOLVED',
      entity: 'trip_incidents',
      entityId: incidentId,
      meta: { trip_id: id },
      ipAddress: req.ip,
    });

    if (trip.driver_id) {
      await NotificationModel.create({
        userId: trip.driver_id,
        title: 'Incident Resolved',
        message: 'The incident you reported has been marked resolved by your broker.',
        type: 'incident',
        meta: { trip_id: id, incident_id: incidentId },
      });
    }

    logger.info(`Trip incident ${incidentId} resolved by ${req.user.id}`);
    const full = await TripIncidentModel.findById(incidentId);
    return successResponse(res, 200, 'Incident resolved', { incident: projectIncident(full) });
  } catch (err) {
    next(err);
  }
};

const MECHANIC_STATUS_MESSAGES = {
  mechanic_assigned: (mr) => `A mechanic${mr.mechanic_name ? ` (${mr.mechanic_name}${mr.mechanic_phone ? `, ${mr.mechanic_phone}` : ''})` : ''} has been arranged for your breakdown.`,
  in_progress: () => 'The mechanic is now working on your vehicle.',
  resolved: () => 'Your breakdown has been resolved — you can resume the trip.',
};

// ─── PATCH /api/trips/:id/incidents/:incidentId/mechanic ─────────────────────
// Broker/admin dispatch workflow for a breakdown — separate from the generic resolve above so
// the broker can track "mechanic on the way" / "in progress" progress before the incident itself
// is closed out. Marking this 'resolved' also resolves the underlying trip_incidents row.
const updateMechanicRequest = async (req, res, next) => {
  try {
    const { id, incidentId } = req.params;
    const { status, mechanicName, mechanicPhone, notes } = req.body;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (req.user.role === 'broker' && trip.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your trip');

    const incident = await TripIncidentModel.findById(incidentId);
    if (!incident || incident.trip_id !== id) return errorResponse(res, 404, 'Incident not found');
    if (incident.reason !== 'breakdown' || !incident.mechanic_request_id) {
      return errorResponse(res, 400, 'This incident has no linked mechanic request');
    }

    const updated = await MechanicRequestModel.update(incident.mechanic_request_id, { status, mechanicName, mechanicPhone, notes });

    if (status === 'resolved' && incident.status !== 'resolved') {
      await TripIncidentModel.resolve(incidentId, notes || 'Resolved via mechanic assignment.');
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'MECHANIC_REQUEST_UPDATED',
      entity: 'mechanic_requests',
      entityId: updated.id,
      meta: { trip_id: id, incident_id: incidentId, status },
      ipAddress: req.ip,
    });

    if (trip.driver_id && status && MECHANIC_STATUS_MESSAGES[status]) {
      await NotificationModel.create({
        userId: trip.driver_id,
        title: 'Mechanic Update',
        message: MECHANIC_STATUS_MESSAGES[status](updated),
        type: 'incident',
        meta: { trip_id: id, incident_id: incidentId },
      });
    }

    logger.info(`Mechanic request ${updated.id} updated by ${req.user.id} (status=${status || 'unchanged'})`);
    const full = await TripIncidentModel.findById(incidentId);
    return successResponse(res, 200, 'Mechanic request updated', { incident: projectIncident(full) });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/trips/:id/pod ──────────────────────────────────────────────────
// Same pattern as kyc.controller.js's uploadKycDocument — multipart file handed to the
// active StorageProvider (upload.middleware.js, multer memory storage), then the
// returned URL is stored on the trip. Only the assigned driver may upload, and only
// while the trip is in_transit or already delivered (POD is captured as part of the
// "Mark Delivered" step, before the driver advances the trip to completed).
const uploadPod = async (req, res, next) => {
  try {
    const { id } = req.params;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (trip.driver_id !== req.user.id) return errorResponse(res, 403, 'Not your trip');
    if (!['in_transit', 'delivered'].includes(trip.status)) {
      return errorResponse(res, 409, 'Proof of delivery can only be uploaded while the trip is in transit or delivered');
    }
    if (!req.file) return errorResponse(res, 422, 'No file uploaded — attach it as multipart form field "file"');

    const { url } = await storageProvider.upload({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      folder: `pod/${id}`,
      resource: 'pod',
      resourceId: id,
    });
    const absoluteUrl = toAbsoluteUrl(req, url);

    const updated = await TripModel.updatePodUrl(id, absoluteUrl);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_POD_UPLOADED',
      entity: 'trips',
      entityId: id,
      ipAddress: req.ip,
    });

    logger.info(`POD uploaded for trip ${id} by driver ${req.user.id}`);
    return successResponse(res, 200, 'Proof of delivery uploaded', { podUrl: updated.pod_url });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trips/pod/file/:id ──────────────────────────────────────────────
// Serves a file uploaded when STORAGE_PROVIDER=postgres (pod_files.data), mirroring
// kyc.controller.js's getKycFile. Visible to anyone who can view the trip itself
// (client/broker/driver/admin), not just the uploading driver.
const getPodFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT trip_id, filename, mime_type, data FROM pod_files WHERE id = $1`,
      [id]
    );
    const file = rows[0];
    if (!file) return errorResponse(res, 404, 'File not found');

    const trip = await TripModel.findById(file.trip_id);
    if (!trip || !assertCanViewIncidents(trip, req.user)) {
      return errorResponse(res, 403, 'You do not have access to this file');
    }

    res.set('Content-Type', file.mime_type);
    res.set('Content-Disposition', `inline; filename="${file.filename}"`);
    return res.send(file.data);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listTrips, getActiveTrip, getUpcomingTrip, getTrip, updateTripStatus, declineTrip, updateTripLocation,
  reportIssue, listIncidents, resolveIncident, updateMechanicRequest, uploadPod, getPodFile,
};
