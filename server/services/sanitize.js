// services/sanitize.js
// Pembersih data dari penonton TikTok (tidak dipercaya) sebelum masuk Room /
// dikirim ke overlay. Ini lapisan KEDUA; overlay tetap meng-escape sendiri
// (lihat public/shared/safe.js).

const MAX_NAME_LEN = 40;
const MAX_URL_LEN = 2048;

/** Nama pemain: buang karakter kontrol & bidi override, rapikan spasi, batasi panjang. */
function cleanPlayerName(value, fallback = 'Anonim') {
  const s = String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN);
  return s || fallback;
}

/** URL foto profil: hanya http(s), tanpa karakter yang bisa keluar dari atribut HTML. */
function cleanProfileUrl(value) {
  if (!value || typeof value !== 'string') return '';
  const url = value.trim();
  if (url.length > MAX_URL_LEN) return '';
  if (!/^https?:\/\//i.test(url)) return '';
  if (/["'<>`\s\\]/.test(url)) return '';
  return url;
}

module.exports = { cleanPlayerName, cleanProfileUrl, MAX_NAME_LEN };
