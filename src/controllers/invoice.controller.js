const BookingModel = require('../models/booking.model');
const NotificationModel = require('../models/notification.model');
const { buildInvoicePdfBuffer } = require('../utils/invoicePdf');
const { getEmailProvider } = require('../providers/email');
const { errorResponse, successResponse } = require('../utils/response');
const logger = require('../utils/logger');

// Same ownership shape as booking.controller.js's assertCanView — kept local rather than
// shared/exported since every controller in this codebase defines its own access-check
// function for its own resource rather than a central one.
const assertCanView = (booking, user) => {
  if (user.role === 'admin') return true;
  if (user.role === 'client') return booking.client_id === user.id;
  if (user.role === 'broker') return booking.broker_id === user.id;
  if (user.role === 'driver') return booking.driver_id === user.id;
  return false;
};

// ─── GET /api/bookings/:id/invoice ────────────────────────────────────────────
// Streams a generated PDF back — used by both the client's "Download Invoice" button and the
// broker/driver equivalent on their detail pages.
const downloadInvoice = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (!assertCanView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this booking');

    const pdfBuffer = await buildInvoicePdfBuffer(booking);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="invoice-${booking.booking_number}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bookings/:id/invoice/email ─────────────────────────────────────
// Manual send only — the frontend always supplies to/subject/message from a compose UI (the
// client emailing themselves a copy, or the broker sending it to the client); nothing here
// auto-sends or guesses a default recipient.
const emailInvoice = async (req, res, next) => {
  try {
    const { to, subject, message } = req.body;
    if (!to || !subject || !message) return errorResponse(res, 422, 'to, subject, and message are required');

    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (!assertCanView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this booking');

    const pdfBuffer = await buildInvoicePdfBuffer(booking);
    const result = await getEmailProvider().send({
      to,
      subject,
      html: `<p>${String(message).replace(/\n/g, '<br>')}</p>`,
      attachments: [{ filename: `invoice-${booking.booking_number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (!result.success) return errorResponse(res, 502, 'Failed to send email');

    logger.info(`Invoice for booking ${booking.id} emailed to ${to} by ${req.user.role} ${req.user.id}`);
    return successResponse(res, 200, 'Invoice sent');
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bookings/:id/invoice/notify ────────────────────────────────────
// One-click "send to portal" — broker/driver notifies the client that their invoice is ready
// to view, without needing the client's email/phone. Pure notification, no PDF work: the
// client already has full download access to their own booking's invoice.
const notifyPortal = async (req, res, next) => {
  try {
    if (!['broker', 'driver', 'admin'].includes(req.user.role)) {
      return errorResponse(res, 403, 'Only the broker or driver on this booking can share the invoice this way');
    }

    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (!assertCanView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this booking');
    if (!booking.client_id) return errorResponse(res, 422, 'This booking has no client to notify');

    await NotificationModel.create({
      userId: booking.client_id,
      title: 'Invoice Shared',
      message: `Your ${req.user.role} shared your invoice for ${booking.booking_number} — view it in My Bookings.`,
      type: 'payment',
      meta: { booking_id: booking.id },
    });

    logger.info(`Invoice for booking ${booking.id} shared to client portal by ${req.user.role} ${req.user.id}`);
    return successResponse(res, 200, 'Client notified');
  } catch (err) {
    next(err);
  }
};

module.exports = { downloadInvoice, emailInvoice, notifyPortal };
