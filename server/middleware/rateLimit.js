// middleware/rateLimit.js
// Anti-spam dengan express-rate-limit. Dipakai di route tertentu.
// Kalau NODE_ENV=test, semua limit dimatikan.
const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true';

function makeLimiter(windowMs, max, msg) {
  if (isTest) return (req, res, next) => next();
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: msg || 'Terlalu banyak percobaan, coba lagi nanti.' })
  });
}

const authLimiter = makeLimiter(60 * 1000, 5, 'Terlalu banyak percobaan login. Tunggu 1 menit.');
const registerLimiter = makeLimiter(60 * 60 * 1000, 3, 'Batas registrasi tercapai. Coba lagi 1 jam.');
const billingLimiter = makeLimiter(60 * 1000, 10, 'Terlalu banyak request billing. Tunggu sebentar.');
const globalLimiter = makeLimiter(60 * 1000, 200, 'Terlalu banyak request. Tunggu sebentar.');

module.exports = { authLimiter, registerLimiter, billingLimiter, globalLimiter, makeLimiter };
