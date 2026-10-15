const path = require('path');
const fs = require('fs');

// Biar file game (yang disalin ke DATA_DIR) tetap bisa require('axios'), dst.
process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), process.env.NODE_PATH]
  .filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const config = require('./config');
const { USERNAME_RE, VALID_GAMES } = config;
const security = require('./middleware/security');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.ALLOWED_ORIGINS, // whitelist dari .env, tidak pernah '*'
    methods: ['GET', 'POST']
  }
});

app.set('io', io);

// Security headers + CORS whitelist + global rate limit
// Jumlah hop proxy di depan app (Cloudflare Tunnel/nginx = 1). Salah set bikin semua
// user terlihat dari satu IP (rate limit ikut berbagi) atau IP bisa dipalsukan.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
security.applyAll(app);

app.use(express.json({ limit: '100kb' }));

const User = require('./models/User');
const roomManager = require('./services/roomManager');
const PUBLIC_DIR = path.join(__dirname, 'public');

roomManager.init({
  io,
  publicDir: PUBLIC_DIR,
  // Return setelan user dari DB, atau null kalau user nggak ada.
  settingsLoader: async (username) => {
    const u = await User.findOne({ username }).lean();
    return u ? { activeGame: u.activeGame, randomGames: u.randomGames, avatarType: u.avatarType || 'emoji' } : null;
  }
});

mongoose.connect(config.MONGO_URI)
  .then(() => {
    console.log('[DB] MongoDB Terhubung!');
    // Setelah restart: bangunkan room yang tadinya sedang live supaya TikTok tersambung lagi.
    roomManager.restoreLiveRooms().catch(err => console.error('[Room] restoreLiveRooms error:', err.message));
  })
  .catch(err => {
    console.error('[DB] Gagal konek MongoDB, proses dihentikan agar PM2 restart:', err.message);
    process.exit(1);
  });

// Legal pages (statis, no JS, SEO-friendly)
app.use('/legal', express.static(path.join(PUBLIC_DIR, 'legal'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=3600')
}));

app.use('/api/auth', require('./routes/auth'));
// Google OAuth: route didefinisikan di /auth/google.js, di-mount lewat routes/auth.js
// (lihat require di atas) — tidak di-mount terpisah di sini untuk hindari double-route.

// Health check endpoint (publik, tanpa auth) — buat monitoring/docker/uptime-kuma.
app.get('/api/health', (req, res) => {
  const billing = require('./billing/midtrans');
  res.json({
    ok: true,
    service: 'tts-live-v2',
    version: require('./package.json').version,
    uptime: Math.round(process.uptime()),
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    midtrans: { ready: billing.status().ready },
    timestamp: new Date().toISOString()
  });
});

app.use('/api/sys', require('./routes/api'));     // /api/sys/me, /api/sys/settings, ...
app.use('/api/billing', require('./routes/billing'));
app.use('/api/gift-mappings', require('./routes/giftMapping'));
app.use('/api/onboarding', require('./onboarding'));

// Script bersama yang dipanggil HTML game dengan path absolut (/shared/...).
// (Di versi lama ini nggak ke-mount, jadi vote-overlay & watcher 404.)
app.use('/shared', express.static(path.join(PUBLIC_DIR, 'shared'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  }
}));

// Gambar bendera Tebak Bendera. Nama file = token acak yang nggak berubah, jadi aman di-cache lama.
app.use('/flags', express.static(path.join(PUBLIC_DIR, 'tebak-bendera/flags'), {
  maxAge: '30d',
  immutable: true
}));

// Dashboard React (hasil `npm run build` di folder client)
app.use(express.static(path.join(__dirname, '../client/dist')));

// Overlay OBS: HTML game aktif milik user + config ter-inject.
app.get('/overlay/:username', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const room = await roomManager.getRoom(req.params.username);
    if (!room) return res.status(404).send('User tidak ditemukan');

    const gamePath = path.join(PUBLIC_DIR, room.activeGameId, 'index.html');
    if (!fs.existsSync(gamePath)) return res.status(404).send('Game UI tidak ditemukan');

    // JSON.stringify + escape "<" supaya nilai apa pun nggak bisa nutup tag <script>.
    const cfg = JSON.stringify({ username: room.username })
      .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const injection = `<script>window.TTS_LIVE_V2_CONFIG = ${cfg};</script>\n`;

    let html = fs.readFileSync(gamePath, 'utf8');
    html = html.includes('</head>')
      ? html.replace('</head>', () => injection + '</head>')
      : injection + html;
    res.type('html').send(html);
  } catch (err) {
    console.error('[Overlay] error:', err);
    res.status(500).send('Error loading overlay');
  }
});

// ── OVERLAY SHELL (iframe wrapper, fullscreen-safe) ──────────────────────────
// Halaman wrapper permanen; game di-load di iframe supaya fullscreen tidak
// hilang saat ganti game (iframe.src di-swap, bukan reload parent).
app.get('/overlay-shell/:username', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const room = await roomManager.getRoom(req.params.username);
    if (!room) return res.status(404).send('User tidak ditemukan');
    let html = fs.readFileSync(path.join(PUBLIC_DIR, 'shared/overlay-shell.html'), 'utf8');
    const safeName = JSON.stringify(room.username).replace(/</g, '\\u003c');
    const inject = '<script>window.__SHELL_USERNAME__ = ' + safeName + ';</script>\n';
    html = html.replace('</head>', () => inject + '</head>');
    res.type('html').send(html);
  } catch (err) { res.status(500).send('Error'); }
});

// Versi game HTML untuk di-load di dalam iframe (sama seperti /overlay/:username tapi pakai gameId tertentu)
app.get('/overlay-game/:username/:gameId', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const room = await roomManager.getRoom(req.params.username);
    if (!room) return res.status(404).send('User tidak ditemukan');
    const gameId = req.params.gameId;
    // Whitelist: gameId tidak boleh dipakai langsung untuk menyusun path file.
    if (!VALID_GAMES.includes(gameId)) return res.status(404).send('Game tidak ditemukan');
    const gamePath = path.join(PUBLIC_DIR, gameId, 'index.html');
    if (!fs.existsSync(gamePath)) return res.status(404).send('Game tidak ditemukan');
    const cfg = JSON.stringify({ username: room.username })
      .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const injection = '<script>window.TTS_LIVE_V2_CONFIG = ' + cfg + ';</script>\n';
    let html = fs.readFileSync(gamePath, 'utf8');
    html = html.includes('</head>') ? html.replace('</head>', () => injection + '</head>') : injection + html;
    res.type('html').send(html);
  } catch (err) { res.status(500).send('Error'); }
});

// Game V1 masih manggil ini buat state awal; di V2 state dikirim lewat socket,
// jadi jawab kosong (bukan HTML SPA) biar nggak bikin error parse.
app.get('/api/grid', (req, res) => res.json({}));

// SPA fallback (bukan untuk API / socket.io / file statis yang hilang)
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || path.extname(req.path)) return next();
  const indexFile = path.join(__dirname, '../client/dist', 'index.html');
  if (!fs.existsSync(indexFile)) return res.status(503).send('Dashboard belum di-build: jalankan `npm run build` di folder client.');
  res.sendFile(indexFile);
});

io.on('connection', (socket) => {
  socket.on('join-overlay', async (username) => {
    try {
      const room = await roomManager.getRoom(username);
      if (!room) return;
      socket.join(room.roomName);
      room.sendFullState(socket);
    } catch (err) {
      console.error('[Socket] join-overlay gagal:', err.message);
    }
  });

  // Shell overlay: join room + kirim gameId aktif buat load iframe pertama kali
  socket.on('join-shell', async (username) => {
    try {
      const room = await roomManager.getRoom(username);
      if (!room) return;
      socket.join(room.roomName);
      socket.emit('shell:init', { gameId: room.activeGameId });
    } catch (err) {
      console.error('[Socket] join-shell gagal:', err.message);
    }
  });
});

// Jangan biarkan satu error liar mematikan overlay semua user.
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

server.listen(config.PORT, () => {
  console.log(`[TTS-Live-V2] Server di port ${config.PORT}`);
});
