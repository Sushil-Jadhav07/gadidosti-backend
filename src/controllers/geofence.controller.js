const ExcelJS = require('exceljs');
const GeofenceModel = require('../models/geofence.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const PINCODE_REGEX = /^\d{6}$/;
// A generous ceiling, not a realistic whitelist size on its own — India has ~19,300 pincodes
// total, so this comfortably covers even a full national list in one upload. Rows beyond this
// are rejected outright (422) rather than silently truncated; BULK_INSERT_CHUNK_SIZE below is
// the separate, unrelated limit on how many rows go into one INSERT statement at a time.
const MAX_BULK_ROWS = 20000;
// Postgres caps a single query at 65535 bind parameters — bulkCreate uses 2 per row, so 5000 is
// nowhere near that ceiling on its own; it's here because the admin explicitly asked for
// uploads to be processed "5000 at a time" rather than one giant statement.
const BULK_INSERT_CHUNK_SIZE = 5000;

// ─── GET /api/admin/geofencing/pincodes ──────────────────────────────────────────
const listPincodes = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 25 } = req.query;
    const result = await GeofenceModel.list({ search, page: parseInt(page, 10), limit: Math.min(parseInt(limit, 10) || 25, 100) });
    return successResponse(res, 200, 'Pincodes fetched', result);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/geofencing/pincodes ─────────────────────────────────────────
const createPincode = async (req, res, next) => {
  try {
    const { pincode, label } = req.body;
    const created = await GeofenceModel.create({ pincode, label });

    await AuditLogModel.log({
      userId: req.user.id, action: 'GEOFENCE_PINCODE_ADDED', entity: 'allowed_pincodes',
      entityId: created.id, meta: { pincode }, ipAddress: req.ip,
    });

    logger.info(`Pincode ${pincode} added to geofence whitelist by ${req.user.id}`);
    return successResponse(res, 201, 'Pincode added', { pincode: created });
  } catch (err) {
    if (err.code === '23505') return errorResponse(res, 409, 'This pincode is already on the whitelist');
    next(err);
  }
};

// ─── PATCH /api/admin/geofencing/pincodes/:id ────────────────────────────────────
const setPincodeActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const updated = await GeofenceModel.setActive(id, active);
    if (!updated) return errorResponse(res, 404, 'Pincode not found');

    await AuditLogModel.log({
      userId: req.user.id, action: 'GEOFENCE_PINCODE_TOGGLED', entity: 'allowed_pincodes',
      entityId: id, meta: { active }, ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Pincode updated', { pincode: updated });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/admin/geofencing/pincodes/:id ───────────────────────────────────
const deletePincode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const removed = await GeofenceModel.remove(id);
    if (!removed) return errorResponse(res, 404, 'Pincode not found');

    await AuditLogModel.log({
      userId: req.user.id, action: 'GEOFENCE_PINCODE_REMOVED', entity: 'allowed_pincodes',
      entityId: id, ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Pincode removed', {});
  } catch (err) {
    next(err);
  }
};

// Reads the uploaded sheet (buffer, from multer memory storage) into plain {pincode, label}
// rows. Finds the Pincode/Label columns by header NAME (case-insensitive), not fixed position,
// so both the sample template and an admin's own re-ordered copy of it work the same way; falls
// back to column order (pincode first, label second) only if no recognizable header is found at
// all. Handles .csv (hand-parsed — this is a plain two-column format, not worth a dependency)
// and .xlsx (via exceljs) the same way from there.
const extractRows = async (file) => {
  const isCsv = /\.csv$/i.test(file.originalname || '') || file.mimetype === 'text/csv';
  let rawRows;

  if (isCsv) {
    const text = file.buffer.toString('utf8');
    rawRows = text
      .split(/\r\n|\n|\r/)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const cells = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
          } else if (ch === ',' && !inQuotes) {
            cells.push(cur);
            cur = '';
          } else {
            cur += ch;
          }
        }
        cells.push(cur);
        return cells.map((c) => c.trim());
      });
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const sheet = workbook.worksheets[0];
    rawRows = [];
    if (sheet) {
      sheet.eachRow((row) => {
        const values = row.values.slice(1).map((v) => {
          if (v == null) return '';
          if (typeof v === 'object' && v.text != null) return String(v.text).trim();
          if (typeof v === 'object' && v.result != null) return String(v.result).trim();
          return String(v).trim();
        });
        rawRows.push(values);
      });
    }
  }

  if (!rawRows.length) return [];

  const header = rawRows[0].map((cell) => String(cell || '').trim().toLowerCase());
  let pincodeIdx = header.findIndex((h) => h.includes('pincode') || h === 'pin');
  let labelIdx = header.findIndex((h) => h.includes('label') || h.includes('city') || h.includes('name'));
  const hasHeader = pincodeIdx !== -1;
  if (!hasHeader) {
    pincodeIdx = 0;
    if (labelIdx === -1) labelIdx = 1;
  }
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
  const rowOffset = hasHeader ? 2 : 1; // matches the row number the admin would see in Excel

  return dataRows
    .filter((row) => row.some((cell) => String(cell || '').trim() !== ''))
    .map((row, i) => ({
      rowNumber: i + rowOffset,
      pincode: String(row[pincodeIdx] || '').trim(),
      label: labelIdx !== -1 ? String(row[labelIdx] || '').trim() : '',
    }));
};

// ─── GET /api/admin/geofencing/pincodes/sample ───────────────────────────────────
// A ready-to-fill .xlsx matching exactly what bulkUploadPincodes expects — two columns,
// Pincode + Label, a bold header row, and a couple of real example rows to copy the pattern from.
const downloadSampleTemplate = async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pincodes');
    sheet.columns = [
      { header: 'Pincode', key: 'pincode', width: 15 },
      { header: 'Label', key: 'label', width: 30 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({ pincode: '452001', label: 'Indore' });
    sheet.addRow({ pincode: '400067', label: 'Kandivali West, Mumbai' });

    const buffer = await workbook.xlsx.writeBuffer();
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="pincode-upload-sample.xlsx"');
    return res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/geofencing/pincodes/bulk ────────────────────────────────────
// Parses the uploaded .xlsx/.csv, validates every row, then upserts whatever's valid in one
// statement (GeofenceModel.bulkCreate) — a few bad rows never fail the whole upload, they're
// just reported back individually alongside what did go through.
const bulkUploadPincodes = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 422, 'No file uploaded — attach an .xlsx or .csv file as "file"');

    let parsedRows;
    try {
      parsedRows = await extractRows(req.file);
    } catch (err) {
      return errorResponse(res, 422, "Could not read this file — make sure it's a valid .xlsx or .csv export");
    }

    if (!parsedRows.length) return errorResponse(res, 422, 'No rows found in this file');
    if (parsedRows.length > MAX_BULK_ROWS) {
      return errorResponse(res, 422, `This file has ${parsedRows.length} rows — the limit per upload is ${MAX_BULK_ROWS}`);
    }

    const invalid = [];
    const duplicates = [];
    // Dedupe by pincode within the file itself — a single INSERT ... ON CONFLICT statement
    // can't touch the same conflict target twice (Postgres errors on that). A repeated pincode
    // is common in real pincode exports (one PIN often covers several post offices/areas), so
    // every repeat is recorded here — not silently merged away — with the LAST occurrence's
    // label winning for the one row actually sent to the database.
    const byPincode = new Map();
    for (const row of parsedRows) {
      if (!row.pincode) {
        invalid.push({ row: row.rowNumber, reason: 'Pincode is empty' });
        continue;
      }
      if (!PINCODE_REGEX.test(row.pincode)) {
        invalid.push({ row: row.rowNumber, reason: `"${row.pincode}" is not a 6-digit pincode` });
        continue;
      }
      if (byPincode.has(row.pincode)) {
        duplicates.push({ row: row.rowNumber, pincode: row.pincode, reason: `Duplicate of an earlier row in this file — only the last occurrence of ${row.pincode} was kept` });
      }
      byPincode.set(row.pincode, { pincode: row.pincode, label: row.label || null });
    }

    // Processed in chunks of BULK_INSERT_CHUNK_SIZE rather than one giant statement — keeps
    // each INSERT's parameter count small and matches what was asked for directly ("5000 at a
    // time"), not just a single raised ceiling.
    const validRows = Array.from(byPincode.values());
    const saved = [];
    for (let i = 0; i < validRows.length; i += BULK_INSERT_CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + BULK_INSERT_CHUNK_SIZE);
      const chunkResult = await GeofenceModel.bulkCreate(chunk);
      saved.push(...chunkResult);
    }
    const insertedCount = saved.filter((r) => r.inserted).length;
    const updatedCount = saved.length - insertedCount;

    // Full lists can run into the thousands on a large file — cap what's actually sent back to
    // the browser, but keep the true counts (used in the summary line) unaffected by the cap.
    const SAMPLE_CAP = 500;

    await AuditLogModel.log({
      userId: req.user.id, action: 'GEOFENCE_PINCODES_BULK_UPLOADED', entity: 'allowed_pincodes',
      meta: { fileName: req.file.originalname, totalRows: parsedRows.length, inserted: insertedCount, updated: updatedCount, invalid: invalid.length, duplicates: duplicates.length },
      ipAddress: req.ip,
    });

    logger.info(`Bulk pincode upload by ${req.user.id}: ${insertedCount} added, ${updatedCount} updated, ${invalid.length} invalid, ${duplicates.length} duplicate (of ${parsedRows.length} rows)`);
    return successResponse(res, 200, 'Bulk upload processed', {
      totalRows: parsedRows.length,
      inserted: insertedCount,
      updated: updatedCount,
      invalidCount: invalid.length,
      duplicateCount: duplicates.length,
      invalid: invalid.slice(0, SAMPLE_CAP),
      duplicates: duplicates.slice(0, SAMPLE_CAP),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { listPincodes, createPincode, setPincodeActive, deletePincode, downloadSampleTemplate, bulkUploadPincodes };
