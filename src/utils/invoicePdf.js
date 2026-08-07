const PDFDocument = require('pdfkit');

const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');

// Builds a one-page invoice PDF from a raw booking row (BookingModel.findById's shape —
// b.* plus the joined broker_name/client_name/driver_name/truck_reg/client_email fields).
// booking_number is the invoice reference — no separate invoice-numbering scheme, since the
// booking number is already a unique, human-readable reference.
const buildInvoicePdfBuffer = (booking) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  doc.fontSize(20).text('GadiDost', { continued: true }).fontSize(12).text('  Invoice', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#666')
    .text(`Invoice ref: ${booking.booking_number}`)
    .text(`Date: ${formatDate(booking.created_at)}`);
  doc.moveDown(1);

  doc.fillColor('#000').fontSize(12).text('Bill To', { underline: true });
  doc.fontSize(10)
    .text(booking.client_name || '-')
    .text(booking.client_phone || '')
    .text(booking.client_email || '');
  doc.moveDown(1);

  doc.fontSize(12).text('Shipment', { underline: true });
  doc.fontSize(10)
    .text(`Pickup: ${booking.pickup_location || '-'}`)
    .text(`Drop: ${booking.drop_location || '-'}`)
    .text(`Distance: ${booking.distance ? `${booking.distance} km` : '-'}`)
    .text(`Material: ${booking.material || '-'}  |  Weight: ${booking.weight ? `${booking.weight} ${booking.weight_unit || ''}`.trim() : '-'}  |  Qty: ${booking.quantity ?? '-'}`)
    .text(`Truck: ${booking.truck_reg || '-'}  |  Driver: ${booking.driver_name || '-'}`)
    .text(`Broker: ${booking.broker_name || '-'}`);
  doc.moveDown(1);

  doc.fontSize(12).text('Amount', { underline: true });
  const amount = Number(booking.amount || 0);
  const platformFee = Number(booking.platform_fee || 0);
  doc.fontSize(10)
    .text(`Amount: ${money(amount)}`)
    .text(`Platform Fee: ${money(platformFee)}`)
    .fontSize(11).text(`Total: ${money(amount)}`, { underline: false });
  doc.moveDown(0.5);
  doc.fontSize(10)
    .text(`Payment Status: ${booking.payment_status || '-'}`)
    .text(`Payment Mode: ${booking.payment_mode || '-'}`)
    .text(`Paid At: ${booking.paid_at ? formatDate(booking.paid_at) : '-'}`);

  doc.moveDown(2);
  doc.fontSize(8).fillColor('#999').text('This is a system-generated invoice.', { align: 'center' });

  doc.end();
});

module.exports = { buildInvoicePdfBuffer };
