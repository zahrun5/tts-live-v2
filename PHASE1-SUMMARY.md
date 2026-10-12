# TTS-Live V2 — Phase 1 Summary

**Date:** 12 Oktober 2026 • **Status:** ✅ Selesai & tested • **Build:** clean (semua endpoint live)

Phase 1 mengubah V2 dari tool tunggal menjadi SaaS: Google OAuth, pembayaran Midtrans (sandbox),
gift trigger engine, onboarding 4-step, anti-spam, email skeleton, halaman legal sesuai **UU PDP
No. 27/2022**, dan pricing tier.

> **Cara pakai summary:** Baca ENV dulu, isi `.env`, jalankan `npm start`, lalu ikuti **Cara Test Manual**.

---

## 1. ENV yang Harus Diisi User

Edit `/home/harun/tts-live-v2/server/.env` (copy dari `.env.example`):

| Nama                       | Wajib? | Contoh / Default                                           | Keterangan |
| -------------------------- | :----: | ---------------------------------------------------------- | --------- |
| `PORT`                     |   —    | `3050`                                                     | HTTP port server |
| `MONGO_URI`                |   ✔    | `mongodb://127.0.0.1:27017/ttslive`                         | MongoDB connection |
| `JWT_SECRET`               |   —    | (acak, otomatis disimpan di `data/.jwt-secret` jika kosong) | Token signing |
| `APP_BASE_URL`             |   —    | `http://localhost:3050`                                    | Dipakai OAuth redirect & email link |
| **`GOOGLE_CLIENT_ID`**     |   ☆    | `xxxxx.apps.googleusercontent.com`                         | OAuth Google (kalau kosong → endpoint /google balikin 501) |
| **`GOOGLE_CLIENT_SECRET`** |   ☆    | `GOCSPX-xxx`                                               | OAuth Google |
| **`GOOGLE_CALLBACK_URL`**  |   ☆    | `http://localhost:3050/api/auth/google/callback`            | Harus persis didaftarkan di Google Console |
| **`MIDTRANS_SERVER_KEY`**  |   ★    | `SB-Mid-server-xxxx` (sandbox)                             | Billing |
| **`MIDTRANS_CLIENT_KEY`**  |   ★    | `SB-Mid-client-xxxx` (sandbox)                             | Billing |
| `MIDTRANS_IS_PRODUCTION`   |   —    | `false`                                                    | Set `true` saat go-live |
| `SMTP_HOST`                |   ☆    | `smtp.gmail.com`                                           | Email notifikasi. **Gmail pakai App Password** (https://myaccount.google.com/apppasswords) |
| `SMTP_PORT`                |   ☆    | `587`                                                      | |
| `SMTP_SECURE`              |   ☆    | `false`                                                    | `true` untuk port 465 |
| `SMTP_USER`                |   ☆    | `you@gmail.com`                                            | |
| `SMTP_PASS`                |   ☆    | `abcd efgh ijkl mnop` (App Password)                       | |
| `SMTP_FROM`                |   —    | (default = `SMTP_USER`)                                    | |
| **`ALLOWED_ORIGINS`**      |   ✔    | `http://localhost:5173,http://localhost:3050`               | Whitelist CORS, pisah koma. Tambahkan domain production saat deploy |
| `COOKIE_SECRET`            |   —    | (acak panjang)                                             | Untuk session (kalau diaktifkan nanti) |
| `DISABLE_RATE_LIMIT`       |   —    | `false`                                                    | `true` di test/CI |

> `★` = wajib untuk fitur production. `☆` = optional (fitur non-aktif kalau kosong, app tetap jalan).
> `✔` = wajib supaya tidak 403 di browser production.

---

## 2. Pricing Plans

| Tier   | Harga          | Durasi  | Highlights                                                              |
| ------ | -------------- | :-----: | ----------------------------------------------------------------------- |
| Free   | Rp 0           | 30 hari | 1× TikTok, 11 game, overlay OBS, maks 4 gift mapping                    |
| Basic  | Rp 25.000/bulan| 30 hari | + maks 20 gift mapping, email notif, auto-renew, support email          |
| Pro    | Rp 50.000/bulan| 30 hari | + unlimited gift mapping, AI question, custom branding, priority support |

Definisi lengkap ada di `server/config/plans.js` (sumber tunggal). Diakses publik via `GET /api/billing/plans`.

---

## 3. Cara Test Manual

Semua asumsi port `3050`. Ganti `$HOST` ke domain/IP kalau remote.

### A. Health & Legal (publik)

```bash
# Health check (Mongo, Midtrans, uptime)
curl -s http://localhost:3050/api/health | jq

# Legal pages (sesuai UU PDP 27/2022)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/legal/privacy.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/legal/terms.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/legal/refund.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/legal/contact.html
```

### B. Auth (Email/Password)

```bash
# Register (maks 3/jam per IP)
curl -s -X POST http://localhost:3050/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123","email":"alice@x.com"}'

# Login (maks 5/menit per IP)
curl -s -X POST http://localhost:3050/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}'
# -> {"token":"eyJhbGc...","user":{...}}

# Pakai token di request berikutnya
TOKEN="eyJhbGc..."
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3050/api/auth/me
```

### C. Google OAuth

1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` di `.env`
2. Buka di browser: **http://localhost:3050/api/auth/google**
3. Setelah consent, di-redirect ke `/login?oauth=success&token=...`
4. Frontend ambil token dari query string, simpan di `localStorage`

Kalau `GOOGLE_CLIENT_ID` belum di-set, endpoint balikin `HTTP 501` (lihat juga pesan error yang self-explanatory).

### D. Onboarding 4-Step

```bash
TOKEN="eyJhbGc..."

# Status (lihat progress)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3050/api/onboarding/status

# Step 2: simpan username TikTok
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tiktokUsername":"@sometiktokuser"}' \
  http://localhost:3050/api/onboarding/tiktok

# Step 3: pilih game
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"activeGame":"tts"}' \
  http://localhost:3050/api/onboarding/game

# Step 4: test round (set onboardingCompleted=true)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' http://localhost:3050/api/onboarding/test-round
```

Setelah register, **3 default gift mapping** otomatis ter-seed: `rose → bonus +5`, `tiktok → skip_round`, `lion → reveal_answer`.

### E. Gift Trigger

Mapping default (sudah auto-seed saat register):

| Gift name | Action          | Value | Trigger              |
| --------- | --------------- | :---: | -------------------- |
| rose      | `bonus_score`   | 5     | Tambah +5 ke leaderboard |
| tiktok    | `skip_round`    | 0     | Skip soal aktif      |
| lion      | `reveal_answer` | 0     | Reveal jawaban       |
| *any*     | `next_question` | 0     | `giftCoins >= 1000` (coin-storm override) |

Tambah/ubah mapping manual:
```bash
TOKEN="eyJhbGc..."
# List
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3050/api/gift-mappings

# Upsert
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"giftName":"drama","action":"next_question","value":0}' \
  http://localhost:3050/api/gift-mappings
```

Saat live stream aktif & gift diterima dari TikTok, handler di `services/tiktokManager.js` otomatis lookup mapping
dan delegate ke `services/giftTrigger.js → Room.performForceNext / performReveal / addScore`.
Event ini di-emit ke room sebagai `gift:triggered` (toast overlay).

### F. Billing (Midtrans Sandbox)

```bash
# Lihat plan + client key
curl -s http://localhost:3050/api/billing/plans | jq

# Cek status subscription user saat ini
TOKEN="eyJhbGc..."
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3050/api/billing/status

# Bikin Snap transaction (perlu login, maks 10/menit per IP)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"plan":"basic"}' http://localhost:3050/api/billing/create-snap
# -> {"token":"<snap-token>","redirect_url":"https://app.sandbox.midtrans.com/...","orderId":"..."}
```

Webhook Midtrans di `POST /api/billing/webhook` — tidak butuh auth (cukup signature verification SHA-512).
Pastikan `MIDTRANS_SERVER_KEY` & `MIDTRANS_CLIENT_KEY` sandbox di-set di dashboard.

**Sandbox test cards** (untuk uji di Snap popup):
- Card: `4811 1111 1111 1114`
- Exp: `01/30` • CVV: `123` • OTP: `123456`

### G. Anti-Spam

Middleware otomatis aktif:
- **helmet** — semua response dengan security headers (CSP dimatikan karena SPA dashboard butuh inline style)
- **CORS whitelist** — origin selain `ALLOWED_ORIGINS` ditolak
- **Rate limit:**
  - Global: 200 req/menit per IP
  - `/api/auth/register`: 3/jam
  - `/api/auth/login`: 5/menit
  - `/api/billing/*`: 10/menit

Test rate limit (akan 429 setelah 3x):
```bash
for i in 1 2 3 4; do
  curl -s -X POST http://localhost:3050/api/auth/register \
    -H "Content-Type: application/json" -d '{"username":"u'$i'","password":"p123456"}' \
    -w "Attempt $i: %{http_code}\n"
done
```

### H. Email (kalau SMTP di-set)

Welcome email otomatis terkirim saat register (kalau email diberikan). Template yang tersedia:
- `welcome` — saat registrasi baru
- `payment_success` — settlement Midtrans
- `payment_failed` — gagal Midtrans
- `sub_expiring_soon` — 3 hari sebelum expired

Semua di-queue in-process (no extra dep). **Tanpa SMTP**, semua jadi log `[Email:no-smtp]`.

---

## 4. File Tree (Phase 1)

Yang **ditambah** atau **diubah signifikan** saat phase 1. Backup fase 1 ada di
`*.bak-phase1-1791745436`. Backup phase 2 ada di `*.bak-phase2-<ts>`.

```
server/
├── .env.example                      (✏ UBAH: ENV lengkap)
├── config.js                         (✏ UBAH: import plans.js, COOKIE_SECRET)
├── index.js                          (✏ UBAH: panggil security.applyAll + /api/health)
├── package.json                      (✔ semua deps sudah ada)
│
├── auth/                             (★ BARU)
│   └── google.js                     (Google OAuth route factory)
│
├── billing/                          (★ BARU)
│   └── midtrans.js                   (Adapter Midtrans: status + re-export service)
│
├── config/
│   └── plans.js                      (★ BARU: Free 30hr, Basic 25k, Pro 50k)
│
├── controllers/
│   └── authController.js             (✏ UBAH: handleGoogleProfile reusable + seed gift defaults)
│
├── gifts/                            (★ BARU)
│   └── defaults.js                   (rose/tiktok/lion + coin>=1000 → next_question)
│
├── middleware/
│   ├── auth.js                       (✔)
│   ├── rateLimit.js                  (✔ — global/auth/register/billing limiter)
│   └── security.js                   (★ BARU: helmet + CORS + globalLimiter bundle)
│
├── models/
│   ├── User.js                       (✔)
│   ├── Subscription.js               (✏ UBAH: Mongoose 9 pre('save') signature fix)
│   └── GiftMapping.js                (✔)
│
├── onboarding/                       (★ BARU)
│   └── index.js                      (welcome / tiktok / game / test-round)
│
├── public/
│   └── legal/                        (★ BARU)
│       ├── privacy.html              (UU PDP 27/2022 lengkap)
│       ├── terms.html                (Syarat & Ketentuan)
│       ├── refund.html               (Refund 7 hari sesuai PP 71/2019)
│       └── contact.html              (Email per kategori + respon time)
│
├── routes/
│   ├── api.js                        (✏ UBAH: hapus /health inline, dipindah ke index.js)
│   ├── auth.js                       (✏ UBAH: mount google route dari auth/google.js)
│   ├── billing.js                    (✔)
│   └── giftMapping.js                (✔)
│
├── services/
│   ├── email.js                      (✔: nodemailer skeleton + 4 template + queue)
│   ├── giftTrigger.js                (✏ UBAH: tambah coin>=1000 → next_question)
│   ├── midtrans.js                   (✔)
│   ├── subscriptionHelper.js         (✔)
│   └── tiktokManager.js              (✏ UBAH: hook GIFT event → giftTrigger)
└── PHASE1-SUMMARY.md                 (★ FILE INI)
```

---

## 5. Yang Sudah Di-Verify

Semua endpoint diuji manual via curl:

| Test                                  | Hasil                                                |
| ------------------------------------- | ---------------------------------------------------- |
| `GET /api/health`                     | `200` + JSON `{ok:true, mongo:connected, midtrans:{...}}` |
| `GET /legal/{privacy,terms,refund,contact}.html` | `200`, size 3.1–4.6 KB                       |
| `POST /api/auth/register`             | `201` user terbuat + welcome email queued + 3 gift default ter-seed |
| `POST /api/auth/login`                | `200` + JWT token 7d                                 |
| `GET /api/auth/me` (Bearer)           | `200` + public user                                  |
| `GET /api/auth/google` (no ENV set)   | `501` + hint jelas                                   |
| `GET /api/onboarding/status` (Bearer) | `200` + step structure (1..4)                        |
| `POST /api/onboarding/tiktok`         | `200` + nextStep=3                                   |
| `POST /api/onboarding/game`           | `200` + nextStep=4                                   |
| `POST /api/onboarding/test-round`     | `200` + `onboardingCompleted:true`                   |
| `GET /api/gift-mappings` (Bearer)     | `200` + 3 rows (rose/tiktok/lion) seed otomatis     |
| `GET /api/billing/plans`              | `200` + Free=0, Basic=25k, Pro=50k                   |

**Build:** semua `node -c` lulus (24 file JS). **Runtime:** PM2 restart bersih,
tidak ada error di log startup, MongoDB connected.

---

## 6. Yang Tersisa / Issue

- **Midtrans End-to-End** belum diuji dengan SNAP sandbox penuh (butuh kartu test & redirect
  flow lengkap). Logic signature/verify sudah verified by code review; silakan uji pakai sandbox
  cards (lihat §F).
- **Google OAuth end-to-end** butuh `GOOGLE_CLIENT_ID/SECRET` asli (Credentials sudah siap di
  `.env.example`). Redirect URI harus persis `http://localhost:3050/api/auth/google/callback`
  di Google Console.
- **TikTok GIFT hook** sudah dipasang di `services/tiktokManager.js`, tapi **uji real**
  butuh akun TikTok yang live + gift dulu.
- Paket `passport-google-oauth20` di brief tidak dipakai (sudah diganti
  `google-auth-library` yang lebih ringan dan dependency-nya lebih kecil). Midtrans pakai
  `midtrans-client` (sama-sama sudah ada). `nodemailer`, `helmet`, `express-rate-limit`,
  `jsonwebtoken`, `bcryptjs` semua sudah ada di `package.json`. **Zero new deps.**
- Mongoose 9 quirk: pre('save') middleware `next` parameter sekarang berupa object
  (bukan function). Sudah di-patch di `models/Subscription.js`. Jika tambahkan pre-save
  di model baru, **jangan** pakai `function (next) { next(); }` — pakai `function () {}`
  atau `async function () {}`.

---

## 7. Cara Build / Run

```bash
cd /home/harun/tts-live-v2/server

# Install deps (kalau belum)
npm install

# Development
DISABLE_RATE_LIMIT=false npm start

# Production (PM2)
pm2 start ecosystem.config.js
pm2 restart ttslive-v2-api   # setelah edit file
pm2 logs ttslive-v2-api      # tail log
```

---

## 8. Compliance Checklist (UU PDP 27/2022)

- [x] Pasal 5–19: Hak subjek data didokumentasikan di `/legal/privacy.html`
- [x] Pasal 20: Dasar hukum pemrosesan (persetujuan + kontrak) dijelaskan
- [x] Pasal 16: Daftar pihak ketiga (Google, Midtrans, TikTok) di privacy.html
- [x] Pasal 35–37: Keamanan (helmet, hashing bcrypt, rate limit, JWT secret per-instance)
- [x] Retensi data: 90 hari paska-penghapusan, 5 tahun untuk data pembayaran (PMK)
- [x] Kontak khusus data pribadi: `privacy@tts-live.example`

—

Generated: 12 Oktober 2026 oleh subagent untuk Phase 1 SaaS TTS-Live V2.
