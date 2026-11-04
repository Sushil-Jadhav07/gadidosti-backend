const PDFDocument = require('pdfkit');

const RED = '#C1121F';
const BLACK = '#111111';
const MUTED = '#374151';
const LINE = '#000000';

const money = (value) => (value == null ? '' : Number(value).toLocaleString('en-IN'));
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');

// This is a faithful digital reproduction of SSK India Logistics' actual pre-printed Lorry
// Receipt (LR/Bilty) stationery — same sections, same fields, same boilerplate wording, same
// LANDSCAPE orientation as the physical form — with the variable fields auto-filled from the
// booking instead of handwritten. The company letterhead details below (address, phones, PAN,
// GST, the fixed boilerplate paragraphs) are hardcoded on purpose, not pulled from
// admin_settings — this is one specific company's fixed physical stationery, not a generic
// admin-configurable template. GSTIN confirmed directly off the real printed form:
// 07CMFPS3661A1Z6 (PAN CMFPS3661A) — note this differs from whatever is currently saved as
// company_gstin in Settings (used for the separate Tax Invoice's GST split), worth reconciling
// separately since this PDF doesn't depend on that setting at all.
//
// A Bilty carries no GST/CGST/SGST breakdown — it isn't a tax document — but it does state WHO
// is liable for the freight's GST under Reverse Charge ("GST Payable By"), which this fills in
// from the same billed_to logic already used elsewhere (see booking.controller.js's
// createBooking and invoicePdf.js).
const buildBiltyPdfBuffer = (booking) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 0, size: 'A4', layout: 'landscape' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginX = 22;
  const contentX = marginX;
  const contentW = pageWidth - marginX * 2;

  const box = (x, y, w, h) => doc.rect(x, y, w, h).lineWidth(0.75).strokeColor(LINE).stroke();
  const vline = (x, y1, y2) => doc.moveTo(x, y1).lineTo(x, y2).lineWidth(0.75).strokeColor(LINE).stroke();
  const hline = (x1, x2, y) => doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.75).strokeColor(LINE).stroke();

  // Outer page border
  box(contentX, 20, contentW, pageHeight - 40);

  let y = 28;

  // ─── Top micro-header ───────────────────────────────────────────────────────
  doc.fillColor(RED).fontSize(7).font('Helvetica-Bold').text('Jai Dada Umdiram Ki', contentX, y, { width: contentW, align: 'center' });
  y += 9;
  doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text('SUBJECT TO DELHI JURISDICTION', contentX, y, { width: contentW, align: 'center' });
  y += 12;

  // ─── Main header: logo / company / contact ───────────────────────────────────
  const headerTop = y;
  doc.fillColor(RED).fontSize(18).font('Helvetica-Bold').text('SSK', contentX + 4, y + 1);
  doc.fillColor('#1E7A34').fontSize(6.5).font('Helvetica-Bold').text('INDIA LOGISTICS', contentX, y + 21, { width: 80, align: 'center' });

  doc.fillColor(RED).fontSize(20).font('Helvetica-Bold').text('SSK INDIA LOGISTICS', contentX, y, { width: contentW, align: 'center' });
  doc.fillColor(BLACK).fontSize(9).font('Helvetica-Bold').text('(Fleet Owner & Contractor)', contentX, y + 22, { width: contentW, align: 'center' });
  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica').text(
    'Shop No. 362-A/2, Sataya Puram Colony, Jharoda Border, Near Ashram, New Delhi-110072',
    contentX, y + 36, { width: contentW, align: 'center' }
  );
  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica').text(
    'Mail: sskindialogistics@gmail.com, Web: www.indialogistics.com',
    contentX, y + 47, { width: contentW, align: 'center' }
  );

  const phones = ['7834819005', '8929920007', '7600026312', '9619905027'];
  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica-Bold');
  phones.forEach((p, i) => doc.text(p, pageWidth - marginX - 110, headerTop + i * 9.5, { width: 100, align: 'right' }));

  y = headerTop + 60;
  hline(contentX, pageWidth - marginX, y);
  y += 3;

  // ─── Info row: 4 columns, each internally subdivided to match the real form's stacked
  // boxes (column 1: Available At / Consignor GST No.; column 3: At Owners Risk / Insurance;
  // column 4: Demurrage / Address Of Delivery / Vehicle No. / C NOTE No. — four separate
  // boxes, not one merged block). Column 2 (Caution/Notice) stays a single undivided box. ──
  const infoTop = y;
  const infoH = 160;
  const col1W = contentW * 0.14;
  const col2W = contentW * 0.32;
  const col3W = contentW * 0.17;
  const col4W = contentW - col1W - col2W - col3W;
  const col1X = contentX;
  const col2X = col1X + col1W;
  const col3X = col2X + col2W;
  const col4X = col3X + col3W;

  // Column 1 — Available At (top) / Consignor GST No. (bottom)
  const availableAtH = infoH * 0.72;
  const consignorGstH = infoH - availableAtH;
  box(col1X, infoTop, col1W, availableAtH);
  box(col1X, infoTop + availableAtH, col1W, consignorGstH);
  let cy = infoTop + 6;
  doc.fillColor(RED).fontSize(7.5).font('Helvetica-Bold').text('Available At :', col1X + 4, cy, { width: col1W - 8 });
  cy += 14;
  ['AHMEDABAD', 'SURAT', 'VAPI', 'MUMBAI', 'PUNE'].forEach((city) => {
    doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text(city, col1X + 4, cy, { width: col1W - 8 });
    cy += 13;
  });
  doc.fillColor(BLACK).fontSize(6.5).font('Helvetica-Bold').text('Consignor GST No. :', col1X + 4, infoTop + availableAtH + 6, { width: col1W - 8 });
  doc.fillColor(MUTED).fontSize(6.5).font('Helvetica').text(booking.client_gstin || '', col1X + 4, infoTop + availableAtH + 18, { width: col1W - 8 });

  // Column 2 — Caution / Notice (single undivided box)
  box(col2X, infoTop, col2W, infoH);
  cy = infoTop + 6;
  doc.fillColor(RED).fontSize(7).font('Helvetica-Bold').text('CAUTION', col2X, cy, { width: col2W, align: 'center' });
  cy += 10;
  doc.fillColor(BLACK).fontSize(6.3).font('Helvetica').text(
    'This Consignment Will Not Be Detained Diverted,Re-Routed Or Re-Booked Without Consignee Bank Writen Permission Will be Delivered At the Destination.',
    col2X + 6, cy, { width: col2W - 12, align: 'center' }
  );
  cy = doc.y + 7;
  doc.fillColor(RED).fontSize(7).font('Helvetica-Bold').text('NOTICE', col2X, cy, { width: col2W, align: 'center' });
  cy += 10;
  doc.fillColor(BLACK).fontSize(6.3).font('Helvetica').text(
    'This consignment covered in this set of special lorry receipt shall be stored at the destination under the control of the transport operator & shall be delivered to or to the order of the Consignee Bank whose name is mentioned in the lorry receipt. This consignment shall under no circumstances be delivered to anyone without the written authority form the consignee Bank or its order on a separated Letter or Authority.',
    col2X + 6, cy, { width: col2W - 12, align: 'center' }
  );

  // Column 3 — At Owners Risk / PAN / GST (top), Insurance (bottom)
  const ownerRiskH = infoH * 0.42;
  const insuranceH = infoH - ownerRiskH;
  box(col3X, infoTop, col3W, ownerRiskH);
  box(col3X, infoTop + ownerRiskH, col3W, insuranceH);
  cy = infoTop + 6;
  doc.fillColor(BLACK).fontSize(7).font('Helvetica-Bold').text('AT OWNERS RISK', col3X, cy, { width: col3W, align: 'center' });
  cy += 13;
  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica-Bold').text('Pan No. : CMFPS3661A', col3X, cy, { width: col3W, align: 'center' });
  cy += 12;
  doc.fillColor(RED).fontSize(7.5).font('Helvetica-Bold').text('GST No. : 07CMFPS3661A1Z6', col3X, cy, { width: col3W, align: 'center' });

  cy = infoTop + ownerRiskH + 6;
  doc.fillColor(BLACK).fontSize(7).font('Helvetica-Bold').text('INSURANCE', col3X, cy, { width: col3W, align: 'center' });
  cy += 10;
  doc.fillColor(BLACK).fontSize(6.3).font('Helvetica').text(
    'The Customer Has Started That He Has Not Insured The Consignment',
    col3X + 5, cy, { width: col3W - 10, align: 'center' }
  );
  cy = doc.y + 6;
  doc.fillColor(BLACK).fontSize(6.5).font('Helvetica').text('Policy No ________ Date ________', col3X + 5, cy, { width: col3W - 10 });
  cy += 10;
  doc.fillColor(BLACK).fontSize(6.5).font('Helvetica').text('Amount __________ Risk __________', col3X + 5, cy, { width: col3W - 10 });

  // Column 4 — four stacked boxes: Demurrage / Address Of Delivery / Vehicle No. / C NOTE No.
  const demurrageH = infoH * 0.30;
  const addressH = infoH * 0.22;
  const vehicleH = infoH * 0.22;
  const cnoteH = infoH - demurrageH - addressH - vehicleH;
  const demurrageY = infoTop;
  const addressY = demurrageY + demurrageH;
  const vehicleY = addressY + addressH;
  const cnoteY = vehicleY + vehicleH;
  box(col4X, demurrageY, col4W, demurrageH);
  box(col4X, addressY, col4W, addressH);
  box(col4X, vehicleY, col4W, vehicleH);
  box(col4X, cnoteY, col4W, cnoteH);

  cy = demurrageY + 6;
  doc.fillColor(BLACK).fontSize(7).font('Helvetica-Bold').text('SCHEDULE OF DEMURRAGE CHARGES', col4X, cy, { width: col4W, align: 'center' });
  cy += 11;
  doc.fillColor(BLACK).fontSize(6.3).font('Helvetica').text(
    'Demmurage Chargeable After 5 days Arrival Of Goods Rs. 7/per Qtl.Per Day On Weight Charged',
    col4X + 5, cy, { width: col4W - 10, align: 'center' }
  );

  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica-Bold').text('Address Of Delivery :', col4X + 4, addressY + 5, { width: col4W - 8 });
  doc.fillColor(MUTED).fontSize(7).font('Helvetica').text(booking.drop_location || '', col4X + 4, addressY + 16, { width: col4W - 8, height: addressH - 20, ellipsis: true });

  doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text('Vehicle No. :', col4X + 4, vehicleY + (vehicleH - 10) / 2, { width: col4W - 8, continued: true })
    .font('Helvetica').fillColor(MUTED).text(` ${booking.truck_reg || ''}`);

  doc.fillColor(BLACK).fontSize(9).font('Helvetica-Bold').text('C NOTE No. :', col4X + 4, cnoteY + (cnoteH - 11) / 2, { width: col4W - 8, continued: true })
    .font('Helvetica-Bold').fillColor(RED).text(` ${booking.bilty_number || ''}`);

  y = infoTop + infoH;

  // ─── Consignor / Consignee (left, 2 rows) beside Date / From / To (right, under column 4,
  // 3 rows) — same horizontal band, side by side, matching the real form; NOT stacked below
  // each other like an earlier version of this PDF had it. ──────────────────────────────────
  const bandH = 48;
  const partyX = contentX;
  const partyW = col4X - contentX;
  const partyRowH = bandH / 2;
  box(partyX, y, partyW, bandH);
  hline(partyX, partyX + partyW, y + partyRowH);

  const hasNamedReceiver = booking.billed_to === 'receiver' && booking.billing_party_name;
  const consignorName = booking.client_name || '';
  const consigneeName = hasNamedReceiver ? booking.billing_party_name : (booking.client_name || '');
  const consigneeGstin = hasNamedReceiver ? booking.billing_party_gstin : booking.client_gstin;

  // Width passed to the FIRST segment of a `continued: true` chain sets the wrap width for
  // every segment that follows it, not just that one label — this must be the full remaining
  // line width, not a narrow label-sized box, or long consignor/consignee details wrap early
  // and overflow this row's fixed height.
  doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text('Consignor :', partyX + 5, y + 6, { width: partyW - 10, continued: true })
    .font('Helvetica').fillColor(MUTED).text(` ${consignorName}${booking.client_phone ? ` (${booking.client_phone})` : ''}${booking.client_gstin ? ` — GSTIN: ${booking.client_gstin}` : ''}`);
  doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text('Consignee :', partyX + 5, y + partyRowH + 6, { width: partyW - 10, continued: true })
    .font('Helvetica').fillColor(MUTED).text(` ${consigneeName}${consigneeGstin ? ` — GSTIN: ${consigneeGstin}` : ''}`);

  const dftX = col4X;
  const dftW = col4W;
  const dftRowH = bandH / 3;
  box(dftX, y, dftW, bandH);
  [
    ['DATE :', formatDate(booking.created_at)],
    ['FROM :', booking.pickup_location || ''],
    ['TO :', booking.drop_location || ''],
  ].forEach(([label, value], i) => {
    const ry = y + i * dftRowH;
    if (i > 0) hline(dftX, dftX + dftW, ry);
    doc.fillColor(BLACK).fontSize(7.5).font('Helvetica-Bold').text(label, dftX + 5, ry + 5, { width: 32 });
    // `ellipsis: true` only truncates once a `height` is given — without it PDFKit just wraps
    // onto a second line instead, which overflows this fixed-height row into the one below it
    // (exactly what long addresses were doing here before this `height` was added).
    doc.fillColor(MUTED).fontSize(7).font('Helvetica').text(value, dftX + 40, ry + 5, { width: dftW - 46, height: dftRowH - 7, ellipsis: true });
  });

  y += bandH;

  // ─── Main table ────────────────────────────────────────────────────────────────
  const tableTop = y;
  const pkgW = contentW * 0.06;
  const descW = contentW * 0.30;
  const wtW = contentW * 0.11;
  const rateW = contentW * 0.14;
  const amtW = contentW * 0.13;
  const remW = contentW - pkgW - descW - wtW - rateW - amtW;
  const pkgX = contentX;
  const descX = pkgX + pkgW;
  const wtX = descX + descW;
  const rateX = wtX + wtW;
  const amtX = rateX + rateW;
  const remX = amtX + amtW;

  const headH = 16;
  box(pkgX, tableTop, pkgW, headH);
  box(descX, tableTop, descW, headH);
  box(wtX, tableTop, wtW, headH);
  box(rateX, tableTop, rateW, headH);
  box(amtX, tableTop, amtW, headH);
  box(remX, tableTop, remW, headH);
  doc.fillColor(BLACK).fontSize(7).font('Helvetica-Bold');
  doc.text('Packages', pkgX, tableTop + 5, { width: pkgW, align: 'center' });
  doc.text('Description', descX, tableTop + 5, { width: descW, align: 'center' });
  doc.text('Weight', wtX, tableTop + 5, { width: wtW, align: 'center' });
  doc.text('Rate', rateX, tableTop + 5, { width: rateW, align: 'center' });
  doc.text('Amount', amtX, tableTop + 5, { width: amtW, align: 'center' });
  doc.text('Any Other Information / Remarks', remX, tableTop + 5, { width: remW, align: 'center' });

  const bodyTop = tableTop + headH;
  const bodyH = 145;
  box(pkgX, bodyTop, pkgW, bodyH);
  box(descX, bodyTop, descW, bodyH);
  box(wtX, bodyTop, wtW, bodyH);
  box(rateX, bodyTop, rateW, bodyH);
  box(amtX, bodyTop, amtW, bodyH);
  box(remX, bodyTop, remW, bodyH);

  // Packages (quantity)
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(String(booking.quantity ?? ''), pkgX, bodyTop + 10, { width: pkgW, align: 'center' });

  // Description — material + invoice/GST reference lines + endorsement note
  let dy = bodyTop + 6;
  doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text(booking.material || '', descX + 4, dy, { width: descW - 8 });
  dy += 30;
  hline(descX, descX + descW, dy);
  dy += 4;
  const invoiceRowY = dy;
  doc.fillColor(BLACK).fontSize(6.5).font('Helvetica').text('Invoice No.: ________  Date : ________', descX + 4, dy, { width: descW - 8 });
  dy += 11;
  doc.fillColor(RED).fontSize(6.5).font('Helvetica-Bold').text(`GST NO. : ${booking.client_gstin || '________________'}`, descX + 4, dy, { width: descW - 8 });
  dy += 14;
  doc.fillColor(MUTED).fontSize(5.8).font('Helvetica-Oblique').text(
    'Endorsement Its Is Intended To use Consignee Copy Of the Set For The Purpose Of Borrowing From The Consignee Bank',
    descX + 4, dy, { width: descW - 8 }
  );

  // Weight — actual/charged split, with "Mark" labeling the same row as Invoice No. below it
  const wtMid = wtX + wtW / 2;
  vline(wtMid, bodyTop, bodyTop + bodyH);
  doc.fillColor(BLACK).fontSize(6.5).font('Helvetica-Bold').text('Actual', wtX, bodyTop + 4, { width: wtW / 2, align: 'center' });
  doc.fillColor(BLACK).fontSize(6.5).font('Helvetica-Bold').text('Charged', wtMid, bodyTop + 4, { width: wtW / 2, align: 'center' });
  hline(wtX, wtX + wtW, bodyTop + 14);
  const weightLabel = booking.weight ? `${booking.weight}` : '';
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(weightLabel, wtX, bodyTop + 20, { width: wtW / 2, align: 'center' });
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(booking.weight_unit || '', wtMid, bodyTop + 20, { width: wtW / 2, align: 'center' });
  doc.fillColor(BLACK).fontSize(7).font('Helvetica-Bold').text('Mark', wtX, invoiceRowY, { width: wtW, align: 'center' });

  // Rate — itemized charge-type rows (left blank — not tracked individually), Total = freight
  const rateLabels = ['Hamail', 'Sur.CH.', 'St.CH.', 'Collection CH.', 'D.Dty CH.', 'Other CH.', 'Risk CH.'];
  let ry2 = bodyTop + 4;
  doc.fillColor(BLACK).fontSize(6.5).font('Helvetica');
  rateLabels.forEach((label) => {
    doc.text(label, rateX + 4, ry2, { width: rateW - 8 });
    ry2 += 13;
  });
  hline(rateX, rateX + rateW, ry2 + 2);
  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica-Bold').text('Total', rateX + 4, ry2 + 6, { width: rateW - 8 });

  // Amount — total freight, aligned with the Rate column's "Total" row
  doc.fillColor(BLACK).fontSize(9).font('Helvetica-Bold').text(money(booking.amount), amtX, ry2 + 5, { width: amtW - 8, align: 'right' });

  // Remarks — To Pay / Paid
  let remY = bodyTop + 10;
  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica-Bold').text('To PAY Rs. :', remX + 4, remY, { width: remW - 8, continued: true })
    .font('Helvetica').fillColor(MUTED).text(` ${booking.payment_status === 'paid' ? '' : money(booking.amount)}`);
  remY += 16;
  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica-Bold').text('Paid RS. :', remX + 4, remY, { width: remW - 8, continued: true })
    .font('Helvetica').fillColor(MUTED).text(` ${booking.payment_status === 'paid' ? money(booking.amount_paid ?? booking.amount) : ''}`);

  y = bodyTop + bodyH;

  // ─── Footer row: jurisdiction / value / GST payable by / signatory ──────────
  const footH = 62;
  const footCol1W = contentW * 0.42;
  const footCol2W = contentW * 0.26;
  const footCol3W = contentW - footCol1W - footCol2W;
  const footCol1X = contentX;
  const footCol2X = footCol1X + footCol1W;
  const footCol3X = footCol2X + footCol2W;
  box(footCol1X, y, footCol1W, footH);
  box(footCol2X, y, footCol2W, footH);
  box(footCol3X, y, footCol3W, footH);

  doc.fillColor(MUTED).fontSize(6).font('Helvetica').text(
    'The Court In Delhi Alone Shall Have Jurisdiction In Respect Of The Claims And Matters Arising Under The Consignment Or Of the Claims And Matter Arising Under The Goods Entrusted For Transport',
    footCol1X + 5, y + 5, { width: footCol1W - 10 }
  );
  doc.fillColor(BLACK).fontSize(7.5).font('Helvetica-Bold').text('Value :', footCol1X + 5, y + footH - 16, { width: footCol1W - 10, continued: true })
    .font('Helvetica').fillColor(MUTED).text(` ${money(booking.amount)}`);

  // GST Payable By — the actual RCM answer, using the same billed_to logic as invoicePdf.js:
  // the consignee is always the party liable for the freight's GST under reverse charge.
  doc.fillColor(RED).fontSize(9).font('Helvetica-Bold').text('GST PAYABLE BY', footCol2X, y + 10, { width: footCol2W, align: 'center' });
  doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text('CONSIGNEE', footCol2X, y + 26, { width: footCol2W, align: 'center' });
  doc.fillColor(MUTED).fontSize(5.8).font('Helvetica-Oblique').text(
    '(Reverse Charge — Notification No. 13/2017-CT(Rate))',
    footCol2X + 4, y + 38, { width: footCol2W - 8, align: 'center' }
  );

  doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text('For SSK INDIA LOGISTICS', footCol3X, y + 6, { width: footCol3W, align: 'center' });
  hline(footCol3X + 15, footCol3X + footCol3W - 15, y + footH - 16);
  doc.fillColor(MUTED).fontSize(7).font('Helvetica').text('Auth. Signatory', footCol3X, y + footH - 13, { width: footCol3W, align: 'center' });

  // ─── Page footer ───────────────────────────────────────────────────────────────
  doc.fillColor(MUTED).fontSize(7).font('Helvetica').text('PAGE 1 OF 1', contentX, pageHeight - 32, { width: contentW, align: 'center' });

  doc.end();
});

module.exports = { buildBiltyPdfBuffer };
