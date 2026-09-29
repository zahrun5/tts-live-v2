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

# 3. Config (opsional): salin server/.env.example ke server/.env
# 4. Jalankan
pm2 start server/ecosystem.config.js && pm2 save
```

Tes tanpa MongoDB/TikTok: `cd server && npm test` (Express + Socket.IO + semua game beneran jalan).

## Catatan

- **Ganti JWT secret lama** (`mamang_harun_rahasia_v2_2026`) kalau repo pernah publik; token lama otomatis invalid.
- Cloudflare Tunnel + WebSocket: ingress butuh `originRequest: { noTLSVerify: true, http2Origin: false }`.
- Generate soal AI (`ai-client.js`) tetap seperti V1 (URL & model hardcode); ronde otomatis pakai bank soal, tanpa AI.
- Belum ada rate-limit login; tutup registrasi dengan `ALLOW_REGISTER=false` kalau sudah cukup user.
