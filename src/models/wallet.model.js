const pool = require('../config/db');

class WalletModel {
  static async getOrCreate(userId) {
    const existing = await pool.query(`SELECT * FROM wallets WHERE user_id = $1`, [userId]);
    if (existing.rows[0]) return existing.rows[0];

    const created = await pool.query(
      `INSERT INTO wallets (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId]
    );
    return created.rows[0];
  }

  // Atomic credit — client recharge, a refund, or a driver/broker's earning on trip completion.
  static async credit(userId, amount, { type, referenceBookingId, referenceOrderId, note } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const wallet = await client.query(
        `INSERT INTO wallets (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING id`,
        [userId]
      );
      const updated = await client.query(
        `UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [amount, wallet.rows[0].id]
      );
      await client.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, reference_booking_id, reference_order_id, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [wallet.rows[0].id, type, amount, updated.rows[0].balance, referenceBookingId || null, referenceOrderId || null, note || null]
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Atomic debit, guarded against going negative in the same statement that checks the balance —
  // rowCount === 0 means insufficient funds (the row exists but balance < amount), which the
  // caller surfaces as a 402, not a 500. Used for a client's booking payment and for a superadmin
  // logging a driver/broker payout (note carries the payout's free-text reference).
  static async debit(userId, amount, { type, referenceBookingId, referenceOrderId, note } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
         WHERE user_id = $2 AND balance >= $1
         RETURNING *`,
        [amount, userId]
      );
      if (updated.rowCount === 0) {
        await client.query('ROLLBACK');
        return { insufficientFunds: true };
      }
      await client.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, reference_booking_id, reference_order_id, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [updated.rows[0].id, type, amount, updated.rows[0].balance, referenceBookingId || null, referenceOrderId || null, note || null]
      );
      await client.query('COMMIT');
      return { wallet: updated.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Caches the amount a recharge order was actually created for, keyed to this user — so
  // verify-time credits that server-known amount, never a client-claimed one. Overwritten by
  // the next recharge order the user opens (latest-wins, same as the Aadhaar OTP ref cache).
  static async savePendingRecharge(userId, { orderId, amount }) {
    await this.getOrCreate(userId);
    await pool.query(
      `UPDATE wallets SET pending_recharge_order_id = $1, pending_recharge_amount = $2, updated_at = NOW() WHERE user_id = $3`,
      [orderId, amount, userId]
    );
  }

  static async getPendingRecharge(userId) {
    const result = await pool.query(
      `SELECT pending_recharge_order_id AS order_id, pending_recharge_amount AS amount FROM wallets WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  static async clearPendingRecharge(userId) {
    await pool.query(
      `UPDATE wallets SET pending_recharge_order_id = NULL, pending_recharge_amount = NULL, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
  }

  // Admin's Payouts page — every driver/broker alongside their earnings-wallet balance and
  // effective commission rate, in one query. LEFT JOIN wallets since a person who's never
  // completed a trip has no wallet row yet (balance reads as 0 via COALESCE, not missing).
  static async listPayoutCandidates({ role, search, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [`u.role IN ('driver', 'broker')`];
    const params = [];
    let idx = 1;

    if (role) {
      conditions.push(`u.role = $${idx++}`);
      params.push(role);
    }
    if (search) {
      conditions.push(`(u.name ILIKE $${idx} OR u.phone ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(`SELECT COUNT(*) FROM users u ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await pool.query(
      `SELECT u.id, u.name, u.phone, u.role, u.commission_rate,
              COALESCE(w.balance, 0) AS balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       ${where}
       ORDER BY COALESCE(w.balance, 0) DESC, u.name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return { candidates: rows.rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10), total_pages: Math.ceil(total / limit) || 0 };
  }

  static async listTransactions(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const wallet = await this.getOrCreate(userId);

    const countResult = await pool.query(`SELECT COUNT(*) FROM wallet_transactions WHERE wallet_id = $1`, [wallet.id]);
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await pool.query(
      `SELECT * FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [wallet.id, limit, offset]
    );

    return { transactions: rows.rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10), total_pages: Math.ceil(total / limit) || 0 };
  }
}

module.exports = WalletModel;
