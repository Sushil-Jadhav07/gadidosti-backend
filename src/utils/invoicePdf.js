const path = require('path');
const PDFDocument = require('pdfkit');
const { computePlatformFeeGst } = require('./gstCalculator');

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
// b.* plus the joined broker_name/client_name/driver_name/truck_reg/client_email/client_gstin/
// trip_started_at/trip_delivered_at fields) and the admin_settings row (for company_gstin).
// booking_number is the invoice reference — no separate invoice-numbering scheme, since it's
// already a unique, human-readable reference.
//
// GST treatment (see gstCalculator.js for the full reasoning): GadiDost is not the GTA — the
// driver/broker is — so the freight portion (amount - platform_fee) is always shown under
// reverse charge, no GST added by GadiDost. The platform_fee itself IS GadiDost's own taxable
// supply, forward-charge @ 18%, shown as a taxable-value + CGST/SGST/IGST breakdown of the same
// already-collected fee (not a new charge).
const buildInvoicePdfBuffer = (booking, companySettings = {}) => new Promise((resolve, reject) => {
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
  // company_display_name (plain admin-set text, Settings) takes priority over the GST-verified
  // legal name so the header never depends on that verification having succeeded — falls back
  // further to the legal name, then the bare brand name, in that order.
  doc.fillColor('#B9C6DA').fontSize(9).font('Helvetica')
    .text(companySettings?.company_display_name || companySettings?.company_legal_name || 'GadiDost Logistics', marginX + 52, 55);
  if (companySettings?.company_gstin) {
    doc.fillColor('#B9C6DA').fontSize(8).font('Helvetica').text(`GSTIN: ${companySettings.company_gstin}`, marginX + 52, 68);
  }

  doc.fillColor('#fff').fontSize(16).font('Helvetica-Bold').text('TAX INVOICE', marginX, 32, { width: contentWidth, align: 'right' });
  doc.fillColor('#B9C6DA').fontSize(9).font('Helvetica')
    .text(`Invoice ref: ${booking.booking_number || '-'}`, marginX, 55, { width: contentWidth, align: 'right' })
    .text(`Date: ${formatDate(booking.created_at)}`, marginX, 68, { width: contentWidth, align: 'right' });

  let y = 140;

  // Who's actually liable for the freight's GST (RCM) — the client themselves (default) or a
  // named receiver/consignee (Step 1's "Receiver Pays"). When it's a receiver, THEIR name+GSTIN
  // go under BILL TO (and feed the platform-fee GST state match below), with the client who
  // actually booked it kept visible as a "Booked by" reference line rather than dropped.
  const billedToReceiver = booking.billed_to === 'receiver';
  const billToName = billedToReceiver ? (booking.billing_party_name || '-') : (booking.client_name || '-');
  const billToGstin = billedToReceiver ? booking.billing_party_gstin : booking.client_gstin;

  // ─── Bill To / Trip parties (two columns) ────────────────────────────────
  const colWidth = contentWidth / 2 - 10;
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('BILL TO', marginX, y);
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('TRIP', marginX + colWidth + 20, y);
  y += 16;

  doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(billToName, marginX, y, { width: colWidth });
  doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(`Broker: ${booking.broker_name || '-'}`, marginX + colWidth + 20, y, { width: colWidth });
  y += 14;

  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(billedToReceiver ? `Booked by: ${booking.client_name || '-'}` : (booking.client_phone || '-'), marginX, y, { width: colWidth });
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(`Driver: ${booking.driver_name || '-'}`, marginX + colWidth + 20, y, { width: colWidth });
  y += 13;

  doc.fillColor(MUTED).fontSize(9).text(billedToReceiver ? (booking.client_phone || '-') : (booking.client_email || '-'), marginX, y, { width: colWidth });
  doc.fillColor(MUTED).fontSize(9).text(`Truck: ${booking.truck_reg || '-'}`, marginX + colWidth + 20, y, { width: colWidth });
  y += 13;

  doc.fillColor(MUTED).fontSize(9).text(`GSTIN: ${billToGstin || 'Not registered'}`, marginX, y, { width: colWidth });
  y += 17;

  // ─── Route ────────────────────────────────────────────────────────────────
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('SHIPMENT', marginX, y);
  y += 16;
  doc.fillColor('#111').fontSize(9).font('Helvetica-Bold').text('Pickup: ', marginX, y, { continued: true })
    .font('Helvetica').fillColor(MUTED).text(booking.pickup_location || '-', { width: contentWidth - 55 });
  y = doc.y + 4;
  doc.fillColor('#111').fontSize(9).font('Helvetica-Bold').text('Drop: ', marginX, y, { continued: true })
    .font('Helvetica').fillColor(MUTED).text(booking.drop_location || '-', { width: contentWidth - 55 });
  y = doc.y + 4;
  doc.fillColor('#111').fontSize(9).font('Helvetica-Bold').text('E-Way Bill No: ', marginX, y, { continued: true })
    .font('Helvetica').fillColor(MUTED).text(booking.eway_bill_number || '-', { width: contentWidth - 55 });
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
  const freight = Math.round((amount - platformFee) * 100) / 100;
  const rowH = 22;
  const subRowH = 17;
  const tableX = marginX;
  const tableW = contentWidth;

  const drawRow = (label, value, opts = {}) => {
    const h = opts.sub ? subRowH : rowH;
    doc.rect(tableX, y, tableW, h).fillOpacity(opts.highlight ? 1 : 0).fill(opts.highlight ? '#F3F6FF' : '#fff').fillOpacity(1);
    doc.fillColor(opts.highlight ? BRAND_NAVY : opts.sub ? MUTED : '#374151').fontSize(opts.highlight ? 11 : opts.sub ? 9 : 10).font(opts.highlight ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, tableX + (opts.sub ? 22 : 10), y + (opts.sub ? 4 : 6), { width: tableW - 150 });
    doc.fillColor(opts.highlight ? BRAND_NAVY : opts.sub ? MUTED : '#374151').fontSize(opts.highlight ? 11 : opts.sub ? 9 : 10).font(opts.highlight ? 'Helvetica-Bold' : 'Helvetica')
      .text(value, tableX, y + (opts.sub ? 4 : 6), { width: tableW - 10, align: 'right' });
    y += h;
    doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  };

  doc.rect(tableX, y, tableW, rowH).stroke('#E5E7EB');
  const haltingCharge = Number(booking.trip_halting_charge || 0);
  const slaOverageCharge = Number(booking.trip_sla_overage_charge || 0);

  // Freight — the driver/broker's GTA supply, always reverse charge (see gstCalculator.js).
  // GadiDost never adds GST to this line; the small note below is the legally-required
  // disclosure that the recipient (the client, if a specified person) self-assesses and pays it.
  drawRow('Freight (Transportation Charges)', money(freight));
  doc.fillColor(MUTED).fontSize(7).font('Helvetica-Oblique')
    .text('GST on freight is payable by the recipient under Reverse Charge Mechanism (Notification No. 13/2017-Central Tax (Rate), as amended). GadiDost does not collect GST on this amount.',
      tableX + 10, y + 3, { width: tableW - 20 });
  y = doc.y + 6;

  // Platform fee — GadiDost's own forward-charge supply. The fee amount itself is unchanged
  // from what's collected everywhere else in the app; these sub-rows just decompose it into a
  // taxable value + GST split for the tax invoice (see gstCalculator.js).
  const gst = computePlatformFeeGst(platformFee, { companyGstin: companySettings?.company_gstin, clientGstin: billToGstin });
  drawRow('Platform Service Fee (incl. GST)', money(platformFee));
  drawRow(`Taxable Value`, money(gst.taxableValue), { sub: true });
  if (gst.isIntraState) {
    drawRow(`CGST @ ${(gst.rate / 2 * 100).toFixed(0)}%`, money(gst.cgst), { sub: true });
    drawRow(`SGST @ ${(gst.rate / 2 * 100).toFixed(0)}%`, money(gst.sgst), { sub: true });
  } else {
    drawRow(`IGST @ ${(gst.rate * 100).toFixed(0)}%`, money(gst.igst), { sub: true });
  }

  if (haltingCharge > 0) {
    drawRow(`Halting Charge (${Number(booking.trip_halting_hours || 0)}h overage, included above)`, money(haltingCharge));
  }
  if (slaOverageCharge > 0) {
    drawRow(`Delivery Delay Charge (${Number(booking.trip_sla_overage_hours || 0)}h overage, included above)`, money(slaOverageCharge));
  }
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
