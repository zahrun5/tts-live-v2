const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const tiktokManager = require('../services/tiktokManager');

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  const isConnected = tiktokManager.getStatus(user.username);
  const userData = user.toObject();
  delete userData.password;
  res.json({ user: userData, isConnected });
});

router.post('/settings', auth, async (req, res) => {
  const { tiktokUsername, activeGame, randomGames } = req.body;
  const prevUser = await User.findById(req.user.id);
  const prevGame = prevUser ? prevUser.activeGame : null;

  const updateData = { tiktokUsername, activeGame };
  if (Array.isArray(randomGames) && randomGames.length > 0) {
    updateData.randomGames = randomGames;
  }
  const user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true }).select('-password');

  // Soal digenerate DI SINI, begitu game beneran ganti (atau belum ada ronde
  // aktif sama sekali) -- tidak lagi nunggu tombol "Sambungkan ke Live".
  const gameService = require('../services/gameService');
  const currentState = gameService.getGameState(user.username);
  if (activeGame && (activeGame !== prevGame || !currentState)) {
    const isRandom = activeGame === 'game-random' && user.randomGames && user.randomGames.length > 0;
    gameService.initGame(
      user.username,
      activeGame,
      req.app.get('io'),
      isRandom ? user.randomGames : null
    );
  }

  // Force reload overlay saat game berganti (tiap tipe game HTML-nya beda)
  if (activeGame && activeGame !== prevGame) {
    req.app.get('io').to(`room_${user.username}`).emit('force-reload');
  }

  res.json({ message: 'Pengaturan disimpan', user });
});

router.post('/tiktok/toggle', auth, async (req, res) => {
  const { action } = req.body;
  const user = await User.findById(req.user.id);
  try {
    if (action === 'start') {
      if (!user.tiktokUsername) {
        return res.status(400).json({ error: 'Isi username TikTok target terlebih dahulu' });
      }
      const gameService = require('../services/gameService');
      // Sambungkan murni urusan connect/disconnect TikTok
      await tiktokManager.startLive(user.username, user.tiktokUsername, req.app.get('io'));
      res.json({ message: 'Terhubung ke TikTok Live!', isConnected: true });
    } else {
      tiktokManager.stopLive(user.username);
      res.json({ message: 'Terputus dari TikTok', isConnected: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Gagal terhubung' });
  }
});

router.post('/overlay/reload', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  req.app.get('io').to(`room_${user.username}`).emit('force-reload');
  res.json({ message: 'Reload command sent' });
});

router.get('/game-state/:username', async (req, res) => {
  const gameService = require('../services/gameService');
  const state = gameService.getGameState(req.params.username);
  res.json({ state });
});

// Endpoint publik buat dashboard: status soal aktif (tanpa auth)
router.get('/public/active-game/:username', async (req, res) => {
  const gameService = require('../services/gameService');
  const state = gameService.getGameState(req.params.username);
  res.json({
    hasState: !!state,
    actualGame: state?.actualGame || null,
    type: state?.type || null,
    round: state?.round || 0
  });
});

router.post('/game/skip', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  const gameService = require('../services/gameService');
  gameService.skipRound(user.username, req.app.get('io'));
  res.json({ message: 'Soal baru dimuat!' });
});

router.post('/game/test-comment', auth, async (req, res) => {
  const { comment } = req.body;
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Komentar tidak boleh kosong' });
  const user = await User.findById(req.user.id);
  const fakeComment = {
    comment: comment.trim(),
    uniqueId: user.username + '-tester',
    profilePictureUrl: '',
  };
  const gameService = require('../services/gameService');
  gameService.checkAnswer(user.username, fakeComment, req.app.get('io'));
  req.app.get('io').to(`room_${user.username}`).emit('chat:comment', {
    player: fakeComment.uniqueId,
    text: fakeComment.comment,
    avatar: fakeComment.profilePictureUrl,
  });
  res.json({ message: 'Test comment sent!' });
});

router.post('/tiktok/test-connect', auth, async (req, res) => {
  const { tiktokUsername } = req.body;
  if (!tiktokUsername) return res.status(400).json({ error: 'Username wajib diisi' });
  const user = await User.findById(req.user.id);
  try {
    tiktokManager.stopLive(user.username);
    await tiktokManager.startLive(user.username, tiktokUsername, req.app.get('io'));
    res.json({ message: 'Berhasil terhubung ke @' + tiktokUsername + '! Chat real-time akan muncul di overlay.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Gagal terhubung ke streamer' });
  }
});

module.exports = router;
