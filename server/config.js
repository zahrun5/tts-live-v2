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

module.exports = {
  DATA_DIR,
  PORT: process.env.PORT || 3050,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ttslive',
  JWT_SECRET: loadJwtSecret(),
  ALLOW_REGISTER: process.env.ALLOW_REGISTER !== 'false',
  USERNAME_RE: /^[a-zA-Z0-9_-]{3,32}$/,
  TIKTOK_RE: /^[A-Za-z0-9._]{1,40}$/,
  VALID_GAMES: ['tts', 'family100', 'susun-kata-acak', 'cari-kata', 'sambung-kata', 'susun-kalimat', 'hitung-cepat', 'spam-tap', 'memory-card', 'labirin', 'ular-tangga', 'sinonim-kata', 'bahasa-daerah']
};
