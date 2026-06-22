const express = require('express');
const router = express.Router();
const pool = require('../config/db');

/**
 * @swagger
 * /api/health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     description: Returns server and database status. Use this to verify the API is running.
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:     { type: boolean, example: true }
 *                 status:      { type: string, example: healthy }
 *                 environment: { type: string, example: development }
 *                 timestamp:   { type: string, format: date-time }
 *                 database:    { type: string, example: connected }
 *                 uptime:      { type: number, example: 3600 }
 */
router.get('/health', async (req, res) => {
  let dbStatus = 'connected';
  try {
    await pool.query('SELECT 1');
  } catch {
    dbStatus = 'disconnected';
  }

  res.json({
    success: true,
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    uptime: Math.floor(process.uptime()),
  });
});

module.exports = router;
