const path = require('path');
const fs = require('fs');

// Biar file game (yang disalin ke DATA_DIR) tetap bisa require('axios'), dst.
process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), process.env.NODE_PATH]
  .filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.set('io', io);
app.use(cors());
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
  .then(() => console.log('[DB] MongoDB Terhubung!'))
  .catch(err => console.error('[DB] Gagal:', err.message));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/sys', require('./routes/api'));

// Script bersama yang dipanggil HTML game dengan path absolut (/shared/...).
// (Di versi lama ini nggak ke-mount, jadi vote-overlay & watcher 404.)
app.use('/shared', express.static(path.join(PUBLIC_DIR, 'shared')));

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
});

// Jangan biarkan satu error liar mematikan overlay semua user.
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

server.listen(config.PORT, () => {
  console.log(`[TTS-Live-V2] Server di port ${config.PORT}`);
});
