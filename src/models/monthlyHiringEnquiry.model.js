const pool = require('../config/db');

const SELECT_WITH_JOINS = `
  SELECT e.*, client.name AS client_name, client.phone AS client_phone, client.email AS client_email
  FROM monthly_hiring_enquiries e
  JOIN users client ON client.id = e.client_id
`;

class MonthlyHiringEnquiryModel {
  static async create({ clientId, location, truckCategory, durationMonths, pricingType, budgetAmount, description }) {
    const result = await pool.query(
      `INSERT INTO monthly_hiring_enquiries (client_id, location, truck_category, duration_months, pricing_type, budget_amount, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [clientId, location, truckCategory || null, durationMonths || null, pricingType, budgetAmount || null, description || null]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE e.id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findByClient(clientId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const [items, count] = await Promise.all([
      pool.query(`${SELECT_WITH_JOINS} WHERE e.client_id = $1 ORDER BY e.created_at DESC LIMIT $2 OFFSET $3`, [clientId, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM monthly_hiring_enquiries WHERE client_id = $1`, [clientId]),
    ]);
    return { items: items.rows, total: parseInt(count.rows[0].count, 10) };
  }

  // Admin-only listing — every enquiry, optionally narrowed by status, newest first so a fresh
  // lead is never buried under old ones.
  static async findAll({ status, page = 1, limit = 20 } = {}) {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE e.status = $${params.length}`;
    }
    const offset = (page - 1) * limit;
    const listParams = [...params, limit, offset];
    const [items, count] = await Promise.all([
      pool.query(
        `${SELECT_WITH_JOINS} ${where} ORDER BY e.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      ),
      pool.query(`SELECT COUNT(*) FROM monthly_hiring_enquiries e ${where}`, params),
    ]);
    return { items: items.rows, total: parseInt(count.rows[0].count, 10) };
  }

  static async updateStatus(id, status) {
    const result = await pool.query(
      `UPDATE monthly_hiring_enquiries SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = MonthlyHiringEnquiryModel;
