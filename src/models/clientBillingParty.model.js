const pool = require('../config/db');

// Saved "Receiver Pays" parties — populated automatically from booking.controller.js's
// createBooking the first time a client types a new name+GSTIN, then offered back as
// selectable chips on their next booking instead of being retyped (same reuse pattern as
// Saved Addresses).
class ClientBillingPartyModel {
  static async listForClient(clientId) {
    const result = await pool.query(
      `SELECT id, name, gstin, created_at FROM client_billing_parties WHERE client_id = $1 ORDER BY created_at DESC`,
      [clientId]
    );
    return result.rows;
  }

  // GSTIN is what dedupes (UNIQUE (client_id, gstin)) — re-entering the same GSTIN with a
  // different name just refreshes the saved label, it never creates a second row for the same
  // party.
  static async upsert(clientId, { name, gstin }) {
    const result = await pool.query(
      `INSERT INTO client_billing_parties (client_id, name, gstin)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_id, gstin) DO UPDATE SET name = $2, updated_at = NOW()
       RETURNING id, name, gstin, created_at`,
      [clientId, name, gstin]
    );
    return result.rows[0];
  }
}

module.exports = ClientBillingPartyModel;
