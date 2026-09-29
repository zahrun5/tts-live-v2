# TTS-Live V2 (SaaS)

Platform SaaS multi-user untuk hosting game live interaktif di TikTok Live. Dibangun di atas pondasi TTS-Live V1.

## Stack

- **Backend:** Node.js + Express + Socket.IO (port 3050)
- **Database:** MongoDB (Docker container `ttslive-mongo`)
- **Frontend Dashboard:** React + Vite + TailwindCSS
- **TikTok Connector:** tiktok-live-connector@2.5.0
- **Tunnel:** Cloudflare Tunnel (live.albiontools.fun)
- **Game UI:** HTML/CSS/JS dari TTS-Live V1 (di-serve statis)

## Games yang Didukung

| Game | Tipe | Pool Sumber |
|---|---|---|
| TTS (Teka-Teki Silang) | Grid puzzle | `tts-live/games/tts/fallback/` |
| Family 100 | Tebak jawaban | `tts-live/games/family100/fallback/` |
| Susun Kata Acak | Acak huruf | `tts-live/games/susun-kata-acak/fallback/` |
| Cari Kata | Pencarian kata | `tts-live/games/cari-kata/fallback/` |
| Sambung Kata | Sambung huruf | `tts-live/games/sambung-kata/fallback/` |
| Susun Kalimat | Susun kata jadi kalimat | `tts-live/games/susun-kalimat/fallback/` |
| Trivia | Pilihan ganda | `tts-live/games/trivia/fallback/` |

## Arsitektur

```
User login → Dashboard React → API (auth + settings)
                              ↓
                        MongoDB (User)
                              ↓
                    Sambungkan Live → tiktokManager
                              ↓
                   gameService.initGame (emit ke room)
                              ↓
              Overlay browser (TTS_LIVE_V2_CONFIG inject)
                              ↓
                    Socket.IO → renderBoard/renderGrid/dll
```

## Setup Lokal

```bash
# 1. Install dependencies
cd server && npm install
cd ../client && npm install && npm run build

# 2. Start MongoDB (Docker)
docker run -d --name ttslive-mongo -p 27017:27017 -v /home/harun/tts-live-v2/db-data:/data/db --restart unless-stopped mongo:4.4.18

# 3. Start backend (PM2)
pm2 start /home/harun/tts-live-v2/server/ecosystem.config.js
pm2 save
```

## File Kunci

| File | Fungsi |
|---|---|
| `server/index.js` | Express entry, routing overlay, socket handlers |
| `server/routes/api.js` | REST endpoints (auth, settings, game control) |
| `server/services/gameProxy.js` | Loader soal dari V1 fallback banks |
| `server/services/gameService.js` | Game engine per-user, emit events |
| `server/services/tiktokManager.js` | Multi-instance TikTok connection |
| `server/models/User.js` | MongoDB schema (username, password, tiktokUsername, activeGame, randomGames) |
| `server/public/{game}/index.html` | Game UI dari V1 |

## Environment Variables

Lihat `server/ecosystem.config.js`:
- `MONGO_URI` (default: `mongodb://127.0.0.1:27017/ttslive`)
- `JWT_SECRET`
- `PORT` (default: 3050)

## Known Issues / Catatan Penting

1. **Cloudflare Tunnel + WebSocket** — butuh `originRequest: { noTLSVerify: true, http2Origin: false }` di ingress rule untuk enable WebSocket
2. **No-cache headers** — overlay route set `Cache-Control: no-store` supaya browser tidak cache HTML game
3. **Socket inject** — semua HTML game di V2 di-patch untuk inject `TTS_LIVE_V2_CONFIG`, `join-overlay`, dan listener status

## Testing Account (dev)

- Username: `mamangharun`
- Password: `password123`
- URL: `https://live.albiontools.fun/login`
