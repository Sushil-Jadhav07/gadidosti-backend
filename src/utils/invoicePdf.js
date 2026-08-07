const path = require('path');
const PDFDocument = require('pdfkit');

const BRAND_NAVY = '#041E42';
const BRAND_BLUE = '#1976FF';
const MUTED = '#6B7280';
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'gadidost-logo.png');

const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const formatDuration = (minutes) => {
  if (minutes == null || Number.isNaN(minutes)) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
};

// Builds a one-page invoice PDF from a raw booking row (BookingModel.findById's shape —
// b.* plus the joined broker_name/client_name/driver_name/truck_reg/client_email/
// trip_started_at/trip_delivered_at fields). booking_number is the invoice reference — no
// separate invoice-numbering scheme, since it's already a unique, human-readable reference.
const buildInvoicePdfBuffer = (booking) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  const pageWidth = doc.page.width;
  const marginX = 50;
  const contentWidth = pageWidth - marginX * 2;

  // ─── Header band ──────────────────────────────────────────────────────────
  doc.rect(0, 0, pageWidth, 110).fill(BRAND_NAVY);
  try {
    doc.image(LOGO_PATH, marginX, 28, { height: 40 });
  } catch {
    // Logo missing/unreadable — fall back to text-only wordmark, don't fail the invoice.
  }
  doc.fillColor('#fff').fontSize(20).font('Helvetica-Bold').text('GadiDost', marginX + 52, 32);
  doc.fillColor('#B9C6DA').fontSize(9).font('Helvetica').text('SSK Logistics', marginX + 52, 55);

  doc.fillColor('#fff').fontSize(16).font('Helvetica-Bold').text('TAX INVOICE', marginX, 32, { width: contentWidth, align: 'right' });
  doc.fillColor('#B9C6DA').fontSize(9).font('Helvetica')
    .text(`Invoice ref: ${booking.booking_number || '-'}`, marginX, 55, { width: contentWidth, align: 'right' })
    .text(`Date: ${formatDate(booking.created_at)}`, marginX, 68, { width: contentWidth, align: 'right' });

  let y = 140;

  // ─── Bill To / Trip parties (two columns) ────────────────────────────────
  const colWidth = contentWidth / 2 - 10;
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('BILL TO', marginX, y);
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('TRIP', marginX + colWidth + 20, y);
  y += 16;

  doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(booking.client_name || '-', marginX, y, { width: colWidth });
  doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(`Broker: ${booking.broker_name || '-'}`, marginX + colWidth + 20, y, { width: colWidth });
  y += 14;

  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(booking.client_phone || '-', marginX, y, { width: colWidth });
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(`Driver: ${booking.driver_name || '-'}`, marginX + colWidth + 20, y, { width: colWidth });
  y += 13;

  doc.fillColor(MUTED).fontSize(9).text(booking.client_email || '-', marginX, y, { width: colWidth });
  doc.fillColor(MUTED).fontSize(9).text(`Truck: ${booking.truck_reg || '-'}`, marginX + colWidth + 20, y, { width: colWidth });
  y += 30;

  // ─── Route ────────────────────────────────────────────────────────────────
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('SHIPMENT', marginX, y);
  y += 16;
  doc.fillColor('#111').fontSize(9).font('Helvetica-Bold').text('Pickup: ', marginX, y, { continued: true })
    .font('Helvetica').fillColor(MUTED).text(booking.pickup_location || '-', { width: contentWidth - 55 });
  y = doc.y + 4;
  doc.fillColor('#111').fontSize(9).font('Helvetica-Bold').text('Drop: ', marginX, y, { continued: true })
    .font('Helvetica').fillColor(MUTED).text(booking.drop_location || '-', { width: contentWidth - 55 });
  y = doc.y + 10;

  const timeTakenMinutes = booking.trip_started_at && booking.trip_delivered_at
    ? Math.round((new Date(booking.trip_delivered_at) - new Date(booking.trip_started_at)) / 60000)
    : null;

  const stats = [
    ['Distance', booking.distance ? `${booking.distance} km` : '-'],
    ['Time Taken', formatDuration(timeTakenMinutes)],
    ['Material', booking.material || '-'],
    ['Weight/Qty', booking.weight ? `${booking.weight} ${booking.weight_unit || ''} x ${booking.quantity ?? '-'}`.trim() : '-'],
  ];
  const statWidth = contentWidth / stats.length;
  stats.forEach(([label, value], i) => {
    const x = marginX + i * statWidth;
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, y, { width: statWidth - 8 });
    doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(value, x, y + 12, { width: statWidth - 8 });
  });
  y += 40;

  doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
  y += 20;

  // ─── Amount table ─────────────────────────────────────────────────────────
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('AMOUNT', marginX, y);
  y += 20;

  const amount = Number(booking.amount || 0);
  const platformFee = Number(booking.platform_fee || 0);
  const rowH = 22;
  const tableX = marginX;
  const tableW = contentWidth;

  const drawRow = (label, value, opts = {}) => {
    doc.rect(tableX, y, tableW, rowH).fillOpacity(opts.highlight ? 1 : 0).fill(opts.highlight ? '#F3F6FF' : '#fff').fillOpacity(1);
    doc.fillColor(opts.highlight ? BRAND_NAVY : '#374151').fontSize(opts.highlight ? 11 : 10).font(opts.highlight ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, tableX + 10, y + 6, { width: tableW - 140 });
    doc.fillColor(opts.highlight ? BRAND_NAVY : '#374151').fontSize(opts.highlight ? 11 : 10).font(opts.highlight ? 'Helvetica-Bold' : 'Helvetica')
      .text(value, tableX, y + 6, { width: tableW - 10, align: 'right' });
    y += rowH;
    doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  };

  doc.rect(tableX, y, tableW, rowH).stroke('#E5E7EB');
  drawRow('Amount', money(amount));
  drawRow('Platform Fee', money(platformFee));
  drawRow('Total', money(amount), { highlight: true });
  y += 14;

  const paymentBits = [
    ['Payment Status', booking.payment_status ? booking.payment_status.toUpperCase() : '-'],
    ['Payment Mode', booking.payment_mode || '-'],
    ['Paid At', booking.paid_at ? formatDateTime(booking.paid_at) : '-'],
  ];
  const pbWidth = contentWidth / paymentBits.length;
  paymentBits.forEach(([label, value], i) => {
    const x = marginX + i * pbWidth;
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, y, { width: pbWidth - 8 });
    doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(value, x, y + 12, { width: pbWidth - 8 });
  });

  // ─── Footer ───────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 60;
  doc.moveTo(marginX, footerY).lineTo(pageWidth - marginX, footerY).strokeColor('#E5E7EB').lineWidth(1).stroke();
  doc.fillColor('#9CA3AF').fontSize(8).font('Helvetica')
    .text('This is a system-generated invoice — GadiDost / SSK Logistics.', marginX, footerY + 10, { width: contentWidth, align: 'center' })
    .text(`Generated on ${formatDateTime(new Date())}`, marginX, footerY + 22, { width: contentWidth, align: 'center' });

  doc.end();
});

module.exports = { buildInvoicePdfBuffer };
