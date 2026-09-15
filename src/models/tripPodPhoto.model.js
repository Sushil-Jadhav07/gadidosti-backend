const pool = require('../config/db');

class TripPodPhotoModel {
  static MAX_PHOTOS_PER_TRIP = 6;
  // Confirmed requirement — a trip can't advance to 'completed' with fewer than this many
  // proof-of-delivery items uploaded (photo or video, mixed freely). Enforced in
  // trip.controller.js's updateTripStatus, not here or at upload time, since the driver may
  // reasonably upload them one at a time across separate calls.
  static MIN_UPLOADS_PER_TRIP = 2;

  static async create(tripId, url, mediaType = 'image') {
    const result = await pool.query(
      `INSERT INTO trip_pod_photos (trip_id, url, media_type) VALUES ($1, $2, $3) RETURNING *`,
      [tripId, url, mediaType]
    );
    return result.rows[0];
  }

  static async findByTrip(tripId) {
    const result = await pool.query(
      `SELECT id, url, media_type, uploaded_at FROM trip_pod_photos WHERE trip_id = $1 ORDER BY uploaded_at ASC`,
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
