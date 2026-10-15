const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// JWT secret: ambil dari env; kalau nggak ada, bikin acak SEKALI lalu simpan
// di DATA_DIR/.jwt-secret (biar token nggak invalid tiap restart, dan
// nggak ada secret yang ke-commit di repo).
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.jwt-secret');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  } catch (e) { /* lanjut bikin baru */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.log('[Config] JWT secret baru dibuat di ' + file);
  return secret;
}

// Plan tiering: free = trial 30 hari, basic/pro = butuh Midtrans aktif
// Definisi lengkap ada di config/plans.js (sumber tunggal) — config.js re-export
// supaya module lain yang lama import dari './config' tetap kompatibel.
const { PLAN_PRICES: _PLAN_PRICES } = require('./config/plans');
const PLAN_PRICES = _PLAN_PRICES;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3050')
  .split(',').map(s => s.trim()).filter(Boolean);

module.exports = {
  DATA_DIR,
  PORT: process.env.PORT || 3050,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ttslive',
  JWT_SECRET: loadJwtSecret(),
  ALLOW_REGISTER: process.env.ALLOW_REGISTER !== 'false',
  USERNAME_RE: /^[a-zA-Z0-9_-]{3,32}$/,
  TIKTOK_RE: /^[A-Za-z0-9._]{1,40}$/,
  VALID_GAMES: ['tts', 'family100', 'susun-kata-acak', 'cari-kata', 'sambung-kata', 'susun-kalimat', 'hitung-cepat', 'spam-tap', 'memory-card', 'labirin', 'ular-tangga',  'sinonim-dan-bahasa-daerah', 'lengkapi-kalimat', 'tts-tema', 'huruf-hilang', 'tebak-bendera'],
  // Phase 1 additions
  PLAN_PRICES,
  ALLOWED_ORIGINS,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_CALLBACK_URL || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3050/api/auth/google/callback',
  MIDTRANS_SERVER_KEY: process.env.MIDTRANS_SERVER_KEY || '',
  MIDTRANS_CLIENT_KEY: process.env.MIDTRANS_CLIENT_KEY || '',
  MIDTRANS_IS_PRODUCTION: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:3050',
  COOKIE_SECRET: process.env.COOKIE_SECRET || ''
};
