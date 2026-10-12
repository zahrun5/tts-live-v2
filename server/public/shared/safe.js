/* shared/safe.js
 * Helper anti-XSS untuk semua overlay game.
 * Nama pemain, jawaban, dan URL foto profil berasal dari penonton TikTok
 * (tidak dipercaya), jadi SELALU lewat helper ini sebelum masuk innerHTML.
 *
 * Sengaja dipasang lewat window.* (bukan function/const global) supaya tidak
 * bentrok dengan deklarasi lokal `function escapeHtml` di masing-masing game.
 */
(function () {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  // Escape teks biasa DAN nilai atribut HTML.
  window.escapeHtml = window.escapeHtml || function (value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, function (c) { return ESC[c]; });
  };

  // URL gambar yang aman: hanya http(s) dan data:image, tanpa karakter yang bisa
  // keluar dari atribut. Kalau tidak lolos, balikin string kosong (gambar tidak tampil).
  window.safeUrl = window.safeUrl || function (value) {
    if (!value) return '';
    var url = String(value).trim();
    if (url.length > 2048) return '';
    if (!/^(https?:\/\/|data:image\/(png|jpeg|jpg|gif|webp);base64,)/i.test(url)) return '';
    if (/["'<>`\s\\]/.test(url)) return '';
    return url;
  };
})();
