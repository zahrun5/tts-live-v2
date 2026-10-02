const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const tiktokManager = require('../services/tiktokManager');
const roomManager = require('../services/roomManager');
const { TIKTOK_RE, VALID_GAMES } = require('../config');

// Bungkus handler async biar error nggak bikin request menggantung.
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error('[API] error:', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

async function currentUser(req) {
  return User.findById(req.user.id);
}

router.get('/me', auth, wrap(async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
  res.json({ user: user.toObject(), isConnected: tiktokManager.getStatus(user.username) });
}));

router.post('/settings', auth, wrap(async (req, res) => {
  const { activeGame, randomGames, avatarType } = req.body || {};
  let { tiktokUsername } = req.body || {};

  const update = {};
  if (typeof tiktokUsername === 'string') {
    tiktokUsername = tiktokUsername.trim().replace(/^@/, '');
    if (tiktokUsername && !TIKTOK_RE.test(tiktokUsername)) {
      return res.status(400).json({ error: 'Username TikTok tidak valid' });
    }
    update.tiktokUsername = tiktokUsername;
  }
  if (activeGame !== undefined) {
    if (activeGame !== 'game-random' && !VALID_GAMES.includes(activeGame)) {
      return res.status(400).json({ error: 'Game tidak dikenal' });
    }
    update.activeGame = activeGame;
  }
  if (Array.isArray(randomGames)) {
    const clean = [...new Set(randomGames.filter(g => VALID_GAMES.includes(g)))];
    if (clean.length > 0) update.randomGames = clean;
  }
  if (typeof avatarType === 'string' && ['emoji', 'tiktok'].includes(avatarType)) {
    update.avatarType = avatarType;
  }

  const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select('-password');
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });

  const room = await roomManager.getRoom(user.username);
  const result = await room.applySettings({ activeGame: user.activeGame, randomGames: user.randomGames, avatarType: user.avatarType });
  if (result.switched) room.emit('force-reload'); // fallback kalau game:switched terlewat

  res.json({ message: 'Pengaturan disimpan', user, ...result });
}));

router.post('/tiktok/toggle', auth, wrap(async (req, res) => {
  const { action } = req.body || {};
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
  if (action === 'start') {
    if (!user.tiktokUsername) {
      return res.status(400).json({ error: 'Isi username TikTok target terlebih dahulu' });
    }
    await tiktokManager.startLive(user.username, user.tiktokUsername);
    return res.json({ message: 'Terhubung ke TikTok Live!', isConnected: true });
  }
  tiktokManager.stopLive(user.username);
  res.json({ message: 'Terputus dari TikTok', isConnected: false });
}));

router.post('/tiktok/test-connect', auth, wrap(async (req, res) => {
  const name = String((req.body || {}).tiktokUsername || '').trim().replace(/^@/, '');
  if (!name || !TIKTOK_RE.test(name)) return res.status(400).json({ error: 'Username tidak valid' });
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
  await tiktokManager.startLive(user.username, name);
  res.json({ message: 'Berhasil terhubung ke @' + name + '! Chat real-time akan muncul di overlay.' });
}));

router.post('/overlay/reload', auth, wrap(async (req, res) => {
  const room = await roomManager.getRoom(req.user.username);
  room.emit('force-reload');
  res.json({ message: 'Reload command sent' });
}));

// Cuma buat user itu sendiri, dan cuma balikin NAMA game aktif (bukan jawaban).
router.get('/game-state/:username', auth, wrap(async (req, res) => {
  if (req.params.username !== req.user.username) return res.status(403).json({ error: 'Bukan akun kamu' });
  const room = await roomManager.getRoom(req.user.username);
  const allStats = room.getAllGameStats();
  res.json({ state: { actualGame: room.activeGameId, mode: room.mode }, stats: allStats });
}));

// Daftar semua jawaban soal aktif buat admin (kalau game macet). Ber-auth,
// cuma balik untuk room milik user yang login.
router.get('/game/answers', auth, wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const room = await roomManager.getRoom(req.user.username);
  if (!room) return res.status(404).json({ error: 'Room tidak ditemukan' });
  const result = room.getAdminAnswers();
  res.status(result.ok ? 200 : 400).json(result);
}));

router.post('/game/skip', auth, wrap(async (req, res) => {
  const room = await roomManager.getRoom(req.user.username);
  const result = await room.performForceNext('skip');
  if (!result.ok) return res.status(500).json({ error: result.error });
  res.json({ message: 'Soal baru dimuat!' });
}));

router.post('/game/reveal', auth, wrap(async (req, res) => {
  const room = await roomManager.getRoom(req.user.username);
  const result = await room.performReveal();
  res.status(result.ok ? 200 : 400).json(result);
}));

router.post('/game/reset-leaderboard', auth, wrap(async (req, res) => {
  const room = await roomManager.getRoom(req.user.username);
  room.resetLeaderboard();
  res.json({ message: 'Leaderboard direset' });
}));

// Komentar palsu lewat jalur yang SAMA dengan chat TikTok asli
// (bubble -> vote -> parse -> validasi -> skor), buat ngetes tanpa live.
router.post('/game/test-comment', auth, wrap(async (req, res) => {
  const comment = String((req.body || {}).comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'Komentar tidak boleh kosong' });
  const room = await roomManager.getRoom(req.user.username);
  await room.handleChat({ player: req.user.username + '-tester', text: comment });
  res.json({ message: 'Test comment sent!' });
}));

module.exports = router;
