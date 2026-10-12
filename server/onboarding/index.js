// onboarding/index.js
// 4-step onboarding wizard untuk user baru:
//
//   Step 1 (welcome)       : landing — user sudah login, return status onboarding
//   Step 2 (tiktok)        : simpan tiktokUsername target live
//   Step 3 (game picker)   : pilih activeGame (atau 'game-random') + daftar randomGames
//   Step 4 (test round)    : simulasi 1 round (no-op di server, flag di user),
//                            lalu set onboardingCompleted = true
//
// Setiap step dipanggil terpisah supaya user bisa save progress.
// Tidak ada lockout — user bisa skip ke depan dengan payload yang valid.
//
// Response: { step: <int>, total: 4, onboardingCompleted: bool, user: <publicUser> }
//
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { TIKTOK_RE, VALID_GAMES } = require('../config');
const { ensureDefaults: ensureGiftDefaults } = require('../gifts/defaults');

const ONBOARDING_STEPS = [
  { step: 1, id: 'welcome',     title: 'Selamat Datang' },
  { step: 2, id: 'tiktok',      title: 'Username TikTok' },
  { step: 3, id: 'game-picker', title: 'Pilih Game' },
  { step: 4, id: 'test-round',  title: 'Test Round' }
];

function progress(user) {
  // step berikutnya yang harus diselesaikan (1..4); kalau sudah selesai -> null
  if (user.onboardingCompleted) return null;
  if (!user.tiktokUsername) return 1; // step 2
  if (!user.activeGame) return 2;     // step 3
  return 3;                            // step 4
}

function publicUser(u) {
  return {
    id: u._id, username: u.username, email: u.email || '',
    tiktokUsername: u.tiktokUsername || '',
    activeGame: u.activeGame, randomGames: u.randomGames || [],
    onboardingCompleted: !!u.onboardingCompleted
  };
}

// GET status onboarding
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
    res.json({
      total: 4,
      steps: ONBOARDING_STEPS,
      currentStep: progress(user),
      onboardingCompleted: !!user.onboardingCompleted,
      user: publicUser(user)
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal baca status onboarding' });
  }
});

// Step 1: hanya "acknowledge". Simpan touch agar frontend tau user pernah masuk.
router.post('/welcome', auth, async (req, res) => {
  try {
    // Tidak ada data wajib; default onboardingCompleted=false tetap.
    res.json({ message: 'Lanjut ke langkah 2', nextStep: 2 });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Step 2: simpan username TikTok target live
router.post('/tiktok', auth, async (req, res) => {
  try {
    const raw = (req.body && req.body.tiktokUsername) || '';
    const tiktokUsername = String(raw).trim().replace(/^@/, '');
    if (!tiktokUsername) return res.status(400).json({ error: 'tiktokUsername wajib' });
    if (!TIKTOK_RE.test(tiktokUsername)) {
      return res.status(400).json({ error: 'Username TikTok tidak valid (huruf/angka/._ saja, 1-40 karakter)' });
    }
    const user = await User.findByIdAndUpdate(
      req.user.id, { tiktokUsername }, { new: true }
    );
    res.json({ message: 'Username TikTok disimpan', nextStep: 3, user: publicUser(user) });
  } catch (err) {
    console.error('[Onboarding] tiktok error:', err.message);
    res.status(500).json({ error: 'Gagal simpan tiktokUsername' });
  }
});

// Step 3: pilih activeGame + randomGames
router.post('/game', auth, async (req, res) => {
  try {
    const { activeGame, randomGames } = req.body || {};
    const update = {};
    if (typeof activeGame === 'string') {
      if (activeGame !== 'game-random' && !VALID_GAMES.includes(activeGame)) {
        return res.status(400).json({ error: 'Game tidak dikenal' });
      }
      update.activeGame = activeGame;
    }
    if (Array.isArray(randomGames)) {
      const clean = [...new Set(randomGames.filter(g => VALID_GAMES.includes(g)))];
      if (clean.length > 0) update.randomGames = clean;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'activeGame atau randomGames wajib' });
    }
    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true });
    res.json({ message: 'Game dipilih', nextStep: 4, user: publicUser(user) });
  } catch (err) {
    console.error('[Onboarding] game error:', err.message);
    res.status(500).json({ error: 'Gagal simpan pilihan game' });
  }
});

// Step 4: test round (no-op di server). Cukup ack dan set onboardingCompleted=true.
router.post('/test-round', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
    if (!user.tiktokUsername) return res.status(400).json({ error: 'Selesaikan step 2 dulu (tiktok username)' });
    if (!user.activeGame) return res.status(400).json({ error: 'Selesaikan step 3 dulu (pilih game)' });

    // Pastikan gift mapping default sudah ada (idempotent)
    await ensureGiftDefaults(user._id);

    user.onboardingCompleted = true;
    await user.save();
    res.json({
      message: 'Onboarding selesai! Selamat datang di TTS-Live Studio.',
      onboardingCompleted: true,
      user: publicUser(user)
    });
  } catch (err) {
    console.error('[Onboarding] test-round error:', err.message);
    res.status(500).json({ error: 'Gagal selesaikan onboarding' });
  }
});

module.exports = router;
