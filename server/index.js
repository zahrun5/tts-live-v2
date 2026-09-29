const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.set('io', io);
global.ioInstance = io;

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ttslive')
  .then(() => console.log('[DB] MongoDB Terhubung!'))
  .catch(err => console.error('[DB] Gagal:', err));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sys', apiRoutes);

// Public game state (no auth - overlay needs this)
app.get('/api/public/game-state/:username', (req, res) => {
  const gameService = require('./services/gameService');
  const state = gameService.getGameState(req.params.username);
  res.json({ state });
});

// Static: React SPA (Dashboard)
app.use(express.static(path.join(__dirname, '../client/dist')));

// Static: Game V1 UI files
app.use('/game', express.static(path.join(__dirname, 'public')));

// Rute Overlay Game
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.startsWith('/overlay/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.get('/overlay/:username', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const User = require('./models/User');
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).send('User tidak ditemukan');
    const game = user.activeGame || 'tts';
    const gamePath = path.join(__dirname, 'public', game, 'index.html');
    if (require('fs').existsSync(gamePath)) {
      let html = require('fs').readFileSync(gamePath, 'utf8');
      const injection = `<script>window.TTS_LIVE_V2_CONFIG = { username: "${user.username}", tiktokUsername: "${user.tiktokUsername}" };</script>`;
      html = html.replace('</head>', injection + '\n</head>');
      res.send(html);
    } else {
      res.status(404).send('Game UI tidak ditemukan');
    }
  } catch (err) {
    res.status(500).send('Error loading overlay');
  }
});

// SPA Fallback - hanya untuk non-API paths
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

// Socket.IO
io.on('connection', (socket) => {
  socket.on('join-overlay', (username) => {
    socket.join(`room_${username}`);
    console.log(`[Socket] Overlay joined: room_${username}`);

    const gameService = require('./services/gameService');
    const state = gameService.getGameState(username);
    if (state && state.actualGame) {
      // Re-emit state sesuai tipe game aktual
      const g = state.actualGame;
      let payload = { type: g };
      if (g === 'tts' || g === 'sambung-kata') {
        payload = { ...payload, rows: state.rows, cols: state.cols, words: state.words };
      } else if (g === 'susun-kata-acak') {
        payload = { ...payload, slots: state.slots };
      } else if (g === 'family100') {
        payload = { ...payload, question: state.question, answers: state.answers };
      } else if (g === 'cari-kata') {
        payload = { ...payload, theme: state.theme, words: state.words };
      } else if (g === 'susun-kalimat') {
        payload = { ...payload, items: state.items };
      } else if (g === 'trivia') {
        payload = { ...payload, category: state.category, question: state.question, options: state.options };
      }
      socket.emit('update', payload);
      socket.emit('leaderboard:update', state.leaderboard || []);
    }

    const tiktokManager = require('./services/tiktokManager');
    socket.emit('status', { connected: tiktokManager.getStatus(username) });
  });
});

const PORT = process.env.PORT || 3050;
server.listen(PORT, () => {
  console.log(`[TTS-Live-V2] Server di port ${PORT}`);
});
