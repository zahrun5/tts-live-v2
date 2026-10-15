# TTS-Live V2 (SaaS)

Platform multi-user buat game interaktif TikTok Live. Tiap user punya room sendiri:
overlay OBS di `/overlay/<username>`, dashboard di `/login`.

## Yang berubah dari versi sebelumnya

Masalah utama versi lama: modul game V1 **nggak dipakai**, diganti `gameProxy.js`
yang cuma baca bank soal. Sekarang:

- `server/games/*` = modul game V1 apa adanya (validasi jawaban, skor, grid, bank soal, ronde).
- `server/services/room.js` = port `server.js` V1, tapi per-user (leaderboard, avatar, vote, rotasi game).
- Tiap user dapat **salinan folder games sendiri** di `server/data/rooms/<username>/`
  (file `.js` selalu di-refresh dari template, file state/bank tidak ditimpa),
  jadi state di disk nggak bentrok antar user.
- HTML game = HTML V1 asli + satu baris `<script src="/shared/v2-bootstrap.js">`
  (join room di event `connect`, jadi overlay hidup lagi setelah server restart / reconnect).
- `/shared/*` sekarang ke-mount (dulu 404, bikin vote-overlay & watcher error).
- Jawaban nggak bocor lagi: state ke overlay pakai `buildStatePayload()` V1 (jawaban `null` sampai terjawab).
- Leaderboard & game aktif disimpan di `data/rooms/<username>/room-state.json` (selamat dari restart).
- Keamanan: username divalidasi, config overlay di-escape (anti XSS), JWT secret nggak lagi di repo,
  endpoint state publik dihapus, pesan login generik.
- TikTok: nama pemain dibaca seperti V1, `EULER_API_KEY` dipakai, auto-reconnect (5x, backoff).

## Setup

```bash
# 1. Dependensi & build dashboard
cd server && npm install
cd ../client && npm install && npm run build

# 2. MongoDB (Docker)
docker run -d --name ttslive-mongo -p 27017:27017 \
  -v /home/harun/tts-live-v2/db-data:/data/db --restart unless-stopped mongo:4.4.18

# 3. Config: salin server/.env.example ke server/.env, isi nilai asli (JANGAN di-commit)
# 4. Jalankan
pm2 start server/ecosystem.config.js && pm2 save
```

Tes tanpa MongoDB/TikTok/Google: `cd server && npm test` (unit: sanitasi, vote, gift, webhook Midtrans, OAuth).
`npm run test:smoke` = smoke test lama (Express + Socket.IO + semua game); saat ini 8 cek di dalamnya gagal sejak sebelum perbaikan keamanan, perlu disesuaikan dengan alur game terbaru.

## Catatan

- JWT secret dibaca dari `JWT_SECRET` di `.env` (atau dibuat acak sekali di `data/.jwt-secret`). Jangan pernah menaruh secret di repo; kalau ada secret yang pernah ter-commit, anggap sudah bocor dan ganti.
- Cloudflare Tunnel + WebSocket: ingress butuh `originRequest: { noTLSVerify: true, http2Origin: false }`.
- Generate soal AI (`ai-client.js`) tetap seperti V1 (URL & model hardcode); ronde otomatis pakai bank soal, tanpa AI.
- Rate limit sudah aktif (login 5/menit, registrasi 3/jam, global 200/menit per IP). Tutup registrasi dengan `ALLOW_REGISTER=false` kalau sudah cukup user.
- Login Google memakai `state` anti-CSRF dan kode sekali-pakai (60 detik) yang ditukar lewat `POST /api/auth/google/exchange`; token tidak lagi lewat URL. Setelah update, **build ulang client** (`cd client && npm run build`).
- Nama dan foto penonton selalu di-escape (`public/shared/safe.js`) dan dibersihkan di server (`services/sanitize.js`). Game baru wajib memuat `<script src="/shared/safe.js">` dan memakai `escapeHtml()`/`safeUrl()` untuk apa pun yang masuk `innerHTML`.
- Akun berpassword tidak otomatis ditautkan ke Google lewat email (email belum diverifikasi saat daftar).
