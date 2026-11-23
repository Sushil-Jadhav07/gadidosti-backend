const winston = require('winston');

// Was 'warn' in production, which silently dropped every logger.info() call before it ever
// reached a transport — including the booking-broadcast matching diagnostics (booking.
// controller.js's "found N candidate(s)..." lines) that turned out to be the only way to tell
// *why* a Find Truck search found zero drivers, short of re-deriving the same eligibility query
// by hand against the live DB after the fact. 'info' keeps normal request noise out (that's
// still 'debug'-only) while keeping these one-line-per-event diagnostics.
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, stack }) =>
      stack ? `${timestamp} [${level}]: ${message}\n${stack}` : `${timestamp} [${level}]: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

module.exports = logger;
