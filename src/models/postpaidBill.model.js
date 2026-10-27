const pool = require('../config/db');

class PostpaidBillModel {
  // Everything a postpaid client currently owes that hasn't been paid off yet — bookings not
  // yet bundled into any bill ('to_be_billed') PLUS bookings already bundled into a bill that's
  // still unpaid ('billed'). This is what the credit-limit check compares against, and what a
  // bill-generation sweep bundles up.
  static async getOutstandingBookings(clientId) {
    const result = await pool.query(
      `SELECT id, booking_number, amount FROM bookings
       WHERE client_id = $1 AND payment_status IN ('to_be_billed', 'billed')
       ORDER BY created_at ASC`,
      [clientId]
    );
    return result.rows;
  }

  static async getOutstandingTotal(clientId) {
    const result = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM bookings
       WHERE client_id = $1 AND payment_status IN ('to_be_billed', 'billed')`,
      [clientId]
    );
    return Number(result.rows[0].total);
  }

  // Bundles every currently-'to_be_billed' booking for this client into one new bill, flips
  // those bookings to 'billed', and records the line items. Returns null if there's nothing to
  // bill (never creates an empty/zero bill).
  static async generate(clientId, { trigger = 'monthly', periodStart = null, periodEnd = null } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const toBill = await client.query(
        `SELECT id, amount FROM bookings WHERE client_id = $1 AND payment_status = 'to_be_billed' FOR UPDATE`,
        [clientId]
      );
      if (toBill.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const total = toBill.rows.reduce((sum, b) => sum + Number(b.amount || 0), 0);
      const bill = await client.query(
        `INSERT INTO postpaid_bills (client_id, period_start, period_end, total_amount, trigger)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [clientId, periodStart, periodEnd, total, trigger]
      );
      const billId = bill.rows[0].id;

      for (const booking of toBill.rows) {
        await client.query(
          `INSERT INTO postpaid_bill_items (bill_id, booking_id, amount) VALUES ($1, $2, $3)`,
          [billId, booking.id, booking.amount]
        );
      }
      await client.query(
        `UPDATE bookings SET payment_status = 'billed' WHERE id = ANY($1::uuid[])`,
        [toBill.rows.map((b) => b.id)]
      );

      await client.query('COMMIT');
      return bill.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT pb.*, u.name AS client_name, u.phone AS client_phone
       FROM postpaid_bills pb JOIN users u ON u.id = pb.client_id
       WHERE pb.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async getItems(billId) {
    const result = await pool.query(
      `SELECT pbi.id, pbi.booking_id, pbi.amount, b.booking_number, b.pickup_location, b.drop_location, b.created_at AS booking_date
       FROM postpaid_bill_items pbi JOIN bookings b ON b.id = pbi.booking_id
       WHERE pbi.bill_id = $1 ORDER BY b.created_at ASC`,
      [billId]
    );
    return result.rows;
  }

  static async findAll({ clientId, status, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (clientId) {
      conditions.push(`pb.client_id = $${idx++}`);
      params.push(clientId);
    }
    if (status) {
      conditions.push(`pb.status = $${idx++}`);
      params.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM postpaid_bills pb ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await pool.query(
      `SELECT pb.*, u.name AS client_name, u.phone AS client_phone
       FROM postpaid_bills pb JOIN users u ON u.id = pb.client_id
       ${where}
       ORDER BY pb.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return { bills: rows.rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10), total_pages: Math.ceil(total / limit) || 0 };
  }

  static async markSent(id) {
    const result = await pool.query(
      `UPDATE postpaid_bills SET sent_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Flips the bill and every booking in it to 'paid' — admin manual logging (paymentMode e.g.
  // 'bank_transfer'/'cash'/'upi', note free-text) or a verified Razorpay payment (paymentMode
  // 'razorpay').
  static async markPaid(id, { paymentMode, note } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bill = await client.query(
        `UPDATE postpaid_bills SET status = 'paid', paid_at = NOW(), payment_mode = $1, note = COALESCE($2, note), updated_at = NOW()
         WHERE id = $3 AND status = 'pending' RETURNING *`,
        [paymentMode || null, note || null, id]
      );
      if (!bill.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const items = await client.query(`SELECT booking_id FROM postpaid_bill_items WHERE bill_id = $1`, [id]);
      if (items.rowCount > 0) {
        await client.query(
          `UPDATE bookings SET payment_status = 'paid', amount_paid = amount, paid_at = NOW() WHERE id = ANY($1::uuid[])`,
          [items.rows.map((r) => r.booking_id)]
        );
      }
      await client.query('COMMIT');
      return bill.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Every postpaid client who currently has at least one 'to_be_billed' booking — the monthly
  // sweep's candidate list.
  static async findClientsWithOutstandingToBeBilled() {
    const result = await pool.query(
      `SELECT DISTINCT u.id FROM users u
       JOIN bookings b ON b.client_id = u.id
       WHERE u.billing_type = 'postpaid' AND b.payment_status = 'to_be_billed'`
    );
    return result.rows.map((r) => r.id);
  }
}

module.exports = PostpaidBillModel;
