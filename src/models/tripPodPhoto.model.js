const pool = require('../config/db');

class TripPodPhotoModel {
  static MAX_PHOTOS_PER_TRIP = 6;

  static async create(tripId, url) {
    const result = await pool.query(
      `INSERT INTO trip_pod_photos (trip_id, url) VALUES ($1, $2) RETURNING *`,
      [tripId, url]
    );
    return result.rows[0];
  }

  static async findByTrip(tripId) {
    const result = await pool.query(
      `SELECT id, url, uploaded_at FROM trip_pod_photos WHERE trip_id = $1 ORDER BY uploaded_at ASC`,
      [tripId]
    );
    return result.rows;
  }

  static async countByTrip(tripId) {
    const result = await pool.query(`SELECT COUNT(*) FROM trip_pod_photos WHERE trip_id = $1`, [tripId]);
    return parseInt(result.rows[0].count, 10);
  }
}

module.exports = TripPodPhotoModel;
