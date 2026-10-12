// middleware/security.js
// Bundling: helmet (header) + CORS whitelist + IP-based rate limit.
//
// Dipakai di index.js:
//   const security = require('./middleware/security');
//   security.applyAll(app, { trustProxy: true });
//
// ENV terkait:
//   ALLOWED_ORIGINS   (comma-separated) — default: localhost:5173, 127.0.0.1:5173, localhost:3050
//   DISABLE_RATE_LIMIT (true = matikan semua rate limit, untuk test)
//
const helmet = require('helmet');
const cors = require('cors');
const { globalLimiter } = require('./rateLimit');
const config = require('../config');

function applyAll(app, opts = {}) {
  // Trust proxy kalau di belakang nginx/cloudflare
  if (opts.trustProxy) app.set('trust proxy', 1);

  // 1. Security headers
  app.use(helmet({
    contentSecurityPolicy: false,  // SPA dashboard butuh inline style/script
    crossOriginEmbedderPolicy: false
  }));

  // 2. CORS whitelist
  const origins = config.ALLOWED_ORIGINS;
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);              // curl / postman / mobile
      if (origins.includes('*') || origins.includes(origin)) return cb(null, true);
      cb(new Error('Origin tidak diizinkan: ' + origin));
    },
    credentials: false
  }));

  // 3. Global rate limit per IP
  app.use(globalLimiter);
}

module.exports = { applyAll };
