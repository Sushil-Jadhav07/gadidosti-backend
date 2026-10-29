const path = require('path');
const PDFDocument = require('pdfkit');

const BRAND_NAVY = '#041E42';
const BRAND_BLUE = '#1976FF';
const MUTED = '#6B7280';
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'gadidost-logo.png');

const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');

// Builds a one-page Bilty (Lorry Receipt / Goods Consignment Note) PDF — a SEPARATE document
// from the GST tax invoice (invoicePdf.js), not a styled copy of it. A Bilty is the
// transporter's own goods-receipt, proving what was handed over, by whom, to whom, and on what
// truck — it carries no GST/CGST/SGST breakdown, since it isn't a tax document at all.
//
// Takes the same raw booking row shape as buildInvoicePdfBuffer (BookingModel.findById's SELECT
// b.* plus joins) and the admin_settings row — see bilty.controller.js / trip.controller.js's
// delivered-status hook for the two places this gets called from.
const buildBiltyPdfBuffer = (booking, companySettings = {}) => new Promise((resolve, reject) => {
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
    // Logo missing/unreadable — fall back to text-only wordmark, don't fail the document.
  }
  doc.fillColor('#fff').fontSize(20).font('Helvetica-Bold').text('GadiDost', marginX + 52, 32);
  // company_display_name is a plain admin-set name (Settings) — shown ahead of the GST-verified
  // legal name so this never depends on that verification having succeeded.
  doc.fillColor('#B9C6DA').fontSize(9).font('Helvetica')
    .text(companySettings?.company_display_name || companySettings?.company_legal_name || 'GadiDost Logistics', marginX + 52, 55);
  if (companySettings?.company_gstin) {
    doc.fillColor('#B9C6DA').fontSize(8).font('Helvetica').text(`GSTIN: ${companySettings.company_gstin}`, marginX + 52, 68);
  }

  doc.fillColor('#fff').fontSize(16).font('Helvetica-Bold').text('LORRY RECEIPT', marginX, 32, { width: contentWidth, align: 'right' });
  doc.fillColor('#B9C6DA').fontSize(9).font('Helvetica')
    .text(`Bilty No: ${booking.bilty_number || '-'}`, marginX, 55, { width: contentWidth, align: 'right' })
    .text(`Booking ref: ${booking.booking_number || '-'} · ${formatDate(booking.created_at)}`, marginX, 68, { width: contentWidth, align: 'right' });

  let y = 140;

  // Consignee defaults to the client themselves (the common case — a client booking their own
  // shipment) unless a receiver was named at booking time (Step 1's "Receiver Pays" — see
  // booking.controller.js's createBooking), in which case that named party is who the goods are
  // actually being delivered TO for billing/GST purposes.
  const hasNamedReceiver = booking.billed_to === 'receiver' && booking.billing_party_name;
  const consignorName = booking.client_name || '-';
  const consigneeName = hasNamedReceiver ? booking.billing_party_name : (booking.client_name || '-');
  const consigneeGstin = hasNamedReceiver ? booking.billing_party_gstin : booking.client_gstin;

  // ─── Consignor / Consignee (two columns) ─────────────────────────────────
  const colWidth = contentWidth / 2 - 10;
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('CONSIGNOR (FROM)', marginX, y);
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('CONSIGNEE (TO)', marginX + colWidth + 20, y);
  y += 16;

  doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(consignorName, marginX, y, { width: colWidth });
  doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(consigneeName, marginX + colWidth + 20, y, { width: colWidth });
  y += 14;

  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(booking.client_phone || '-', marginX, y, { width: colWidth });
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(hasNamedReceiver ? `GSTIN: ${consigneeGstin || 'Not registered'}` : (booking.client_phone || '-'), marginX + colWidth + 20, y, { width: colWidth });
  y += 13;

  doc.fillColor(MUTED).fontSize(9).text(`GSTIN: ${booking.client_gstin || 'Not registered'}`, marginX, y, { width: colWidth });
  if (!hasNamedReceiver) {
    doc.fillColor(MUTED).fontSize(9).text(`GSTIN: ${consigneeGstin || 'Not registered'}`, marginX + colWidth + 20, y, { width: colWidth });
  }
  y += 20;

  // ─── Shipment + transport details ────────────────────────────────────────
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

  const stats = [
    ['Material', booking.material || '-'],
    ['Weight/Qty', booking.weight ? `${booking.weight} ${booking.weight_unit || ''} x ${booking.quantity ?? '-'}`.trim() : '-'],
    ['Distance', booking.distance ? `${booking.distance} km` : '-'],
    ['Truck No.', booking.truck_reg || '-'],
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

  // ─── Transporter / driver ─────────────────────────────────────────────────
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('TRANSPORTER', marginX, y);
  y += 16;
  const transporterBits = [
    ['Broker', booking.broker_name || '-'],
    ['Driver', booking.driver_name || '-'],
    ['Driver Phone', booking.driver_phone || '-'],
  ];
  const tbWidth = contentWidth / transporterBits.length;
  transporterBits.forEach(([label, value], i) => {
    const x = marginX + i * tbWidth;
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, y, { width: tbWidth - 8 });
    doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(value, x, y + 12, { width: tbWidth - 8 });
  });
  y += 40;

  doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
  y += 20;

  // ─── Freight (no GST breakdown — this is not a tax document) ─────────────
  doc.fillColor(BRAND_BLUE).fontSize(11).font('Helvetica-Bold').text('FREIGHT', marginX, y);
  y += 20;

  const rowH = 22;
  const tableX = marginX;
  const tableW = contentWidth;
  doc.rect(tableX, y, tableW, rowH).fillOpacity(1).fill('#F3F6FF').fillOpacity(1);
  doc.fillColor(BRAND_NAVY).fontSize(11).font('Helvetica-Bold').text('Freight Amount', tableX + 10, y + 6, { width: tableW - 150 });
  doc.fillColor(BRAND_NAVY).fontSize(11).font('Helvetica-Bold').text(money(booking.amount), tableX, y + 6, { width: tableW - 10, align: 'right' });
  y += rowH;
  doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  y += 14;

  const paymentBits = [
    ['Payment Status', booking.payment_status ? booking.payment_status.toUpperCase() : '-'],
    ['Payment Mode', booking.payment_mode || '-'],
  ];
  const pbWidth = contentWidth / paymentBits.length;
  paymentBits.forEach(([label, value], i) => {
    const x = marginX + i * pbWidth;
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, y, { width: pbWidth - 8 });
    doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(value, x, y + 12, { width: pbWidth - 8 });
  });
  y += 50;

  // ─── Signatures ───────────────────────────────────────────────────────────
  const sigY = Math.max(y, doc.page.height - 140);
  doc.moveTo(marginX, sigY).lineTo(marginX + 160, sigY).strokeColor('#9CA3AF').lineWidth(1).stroke();
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text('Consignor Signature', marginX, sigY + 4);
  doc.moveTo(pageWidth - marginX - 160, sigY).lineTo(pageWidth - marginX, sigY).strokeColor('#9CA3AF').lineWidth(1).stroke();
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text('Receiver Signature', pageWidth - marginX - 160, sigY + 4);

  // ─── Footer ───────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 60;
  doc.moveTo(marginX, footerY).lineTo(pageWidth - marginX, footerY).strokeColor('#E5E7EB').lineWidth(1).stroke();
  doc.fillColor('#9CA3AF').fontSize(8).font('Helvetica')
    .text('This is a system-generated Lorry Receipt — not a tax invoice. GadiDost / SSK Logistics.', marginX, footerY + 10, { width: contentWidth, align: 'center' })
    .text(`Generated on ${formatDateTime(new Date())}`, marginX, footerY + 22, { width: contentWidth, align: 'center' });

  doc.end();
});

module.exports = { buildBiltyPdfBuffer };
