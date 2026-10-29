const BookingModel = require('../models/booking.model');
const AdminSettingsModel = require('../models/adminSettings.model');
const { buildBiltyPdfBuffer } = require('../utils/biltyPdf');
const { getEmailProvider } = require('../providers/email');
const { errorResponse, successResponse } = require('../utils/response');
const logger = require('../utils/logger');

// Same ownership shape as invoice.controller.js's assertCanView — kept local for the same
// reason that file's copy is: every controller here defines its own access check for its own
// resource rather than sharing one central function.
const assertCanView = (booking, user) => {
  if (user.role === 'admin') return true;
  if (user.role === 'client') return booking.client_id === user.id;
  if (user.role === 'broker') return booking.broker_id === user.id;
  if (user.role === 'driver') return booking.driver_id === user.id;
  return false;
};

// Shared by both the manual "Send Bilty" endpoint below and trip.controller.js's auto-send on
// delivery — generates the PDF (lazily assigning a bilty_number the first time, see
// BookingModel.getOrCreateBiltyNumber) and emails it straight to the client's own address.
// Unlike invoice emailing, there's no compose step — a Bilty always goes to the client who
// booked the shipment, never an arbitrary recipient.
const generateAndEmailBilty = async (booking) => {
  if (!booking.client_email) {
    return { sent: false, reason: 'Client has no email on file' };
  }
  const biltyNumber = await BookingModel.getOrCreateBiltyNumber(booking.id);
  const companySettings = await AdminSettingsModel.get();
  const pdfBuffer = await buildBiltyPdfBuffer({ ...booking, bilty_number: biltyNumber }, companySettings);

  const result = await getEmailProvider().send({
    to: booking.client_email,
    subject: `Lorry Receipt (Bilty) for ${booking.booking_number}`,
    html: `<p>Your shipment for booking ${booking.booking_number} has been delivered. The Lorry Receipt (Bilty) is attached for your records.</p>`,
    attachments: [{ filename: `bilty-${booking.booking_number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });

  if (!result.success) return { sent: false, reason: 'Email provider failed to send' };
  return { sent: true, biltyNumber };
};

// ─── GET /api/bookings/:id/bilty ───────────────────────────────────────────────
const downloadBilty = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (!assertCanView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this booking');

    const biltyNumber = await BookingModel.getOrCreateBiltyNumber(booking.id);
    const companySettings = await AdminSettingsModel.get();
    const pdfBuffer = await buildBiltyPdfBuffer({ ...booking, bilty_number: biltyNumber }, companySettings);

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="bilty-${booking.booking_number}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bookings/:id/bilty/send ─────────────────────────────────────────
// One-click resend to the client — the broker/driver/admin on this booking can trigger this any
// time (e.g. the automatic on-delivery send failed, or the client asks for another copy); it's
// always addressed to the client's own email, same as the automatic send.
const sendBilty = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (!assertCanView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this booking');
    if (!booking.client_email) return errorResponse(res, 422, 'This client has no email on file to send the Bilty to');

    const result = await generateAndEmailBilty(booking);
    if (!result.sent) return errorResponse(res, 502, result.reason || 'Failed to send Bilty');

    logger.info(`Bilty for booking ${booking.id} (${result.biltyNumber}) emailed to ${booking.client_email} by ${req.user.role} ${req.user.id}`);
    return successResponse(res, 200, 'Bilty sent', { biltyNumber: result.biltyNumber });
  } catch (err) {
    next(err);
  }
};

module.exports = { downloadBilty, sendBilty, generateAndEmailBilty };
