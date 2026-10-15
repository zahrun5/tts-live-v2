const User = require('../models/User');
const Subscription = require('../models/Subscription');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ALLOW_REGISTER, USERNAME_RE, TIKTOK_RE, VALID_GAMES } = require('../config');
const { ensureFreeSubscription } = require('../services/subscriptionHelper');
const { ensureDefaults: ensureGiftDefaults } = require('../gifts/defaults');
const emailService = require('../services/email');

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email || '',
    avatar: user.avatar || '',
    tiktokUsername: user.tiktokUsername || '',
    onboardingCompleted: !!user.onboardingCompleted
  };
}

exports.register = async (req, res) => {
  try {
    if (!ALLOW_REGISTER) return res.status(403).json({ error: 'Registrasi ditutup' });
    const { username, password, email: userEmail } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username 3-32 karakter: huruf, angka, _ atau -' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }
    if (await User.findOne({ username })) {
      return res.status(400).json({ error: 'Username sudah terpakai' });
    }
    const userData = { username, password: await bcrypt.hash(password, 10) };
    if (typeof userEmail === 'string' && userEmail.includes('@')) {
      userData.email = userEmail.toLowerCase().trim();
    }
    const user = new User(userData);
    await user.save();
    // Bikin subscription free 30 hari
    await ensureFreeSubscription(user._id);
    // Seed default gift mapping (rose/tiktok/lion)
    await ensureGiftDefaults(user._id);
    // Kirim welcome email (kalau ada)
    if (user.email) emailService.welcome({ to: user.email, username: user.username });
    res.status(201).json({ message: 'Registrasi berhasil, silakan login.' });
  } catch (err) {
    console.error('[Auth] register error:', err.message);
    res.status(500).json({ error: 'Server error saat registrasi' });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }
    const user = await User.findOne({ username });
    if (!user || !user.password) return res.status(401).json({ error: 'Username atau password salah' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Username atau password salah' });

    // Pastikan ada subscription (kalau migrasi user lama belum punya)
    await ensureFreeSubscription(user._id);
    // Seed default gift mapping (idempotent)
    await ensureGiftDefaults(user._id);

    const token = signToken(user);
    res.json({ message: 'Login berhasil', token, user: publicUser(user) });
  } catch (err) {
    console.error('[Auth] login error:', err.message);
    res.status(500).json({ error: 'Server error saat login' });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

/** Reusable: dari profile Google -> { token, user }. Dipakai routes/auth.js & auth/google.js. */
exports.handleGoogleProfile = async ({ googleId, email, name, picture }) => {
  if (!googleId) throw new Error('googleId kosong');
  if (!email) throw new Error('email kosong');

  email = String(email).toLowerCase().trim();
  let user = await User.findOne({ googleId });
  if (!user) {
    // Email di akun password TIDAK diverifikasi saat registrasi. Kalau langsung
    // ditautkan ke Google, orang bisa mendaftar dengan email korban lalu ikut
    // masuk saat korban login Google. Jadi akun berpassword tidak ditautkan otomatis.
    const byEmail = await User.findOne({ email });
    if (byEmail) {
      if (byEmail.password) {
        const err = new Error('Email ini sudah terdaftar dengan password. Login dengan username dan password.');
        err.code = 'EMAIL_USED_BY_PASSWORD_ACCOUNT';
        throw err;
      }
      user = byEmail; // akun sebelumnya dibuat via Google (tanpa password): aman ditautkan
    }
  }
  if (!user) {
    let baseUsername = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'user';
    if (baseUsername.length < 3) baseUsername = (baseUsername + 'user').slice(0, 24);
    let username = baseUsername;
    let n = 0;
    while (await User.findOne({ username })) {
      n += 1;
      username = (baseUsername + n).slice(0, 32);
    }
    user = new User({
      username,
      password: null,
      email: email.toLowerCase(),
      googleId,
      avatar: picture || ''
    });
    await user.save();
    await ensureFreeSubscription(user._id);
    await ensureGiftDefaults(user._id);
    emailService.welcome({ to: email, username });
  } else if (!user.googleId) {
    user.googleId = googleId;
    if (!user.avatar && picture) user.avatar = picture;
    if (!user.email) user.email = email.toLowerCase();
    await user.save();
    await ensureFreeSubscription(user._id);
    await ensureGiftDefaults(user._id);
  }
  const token = signToken(user);
  return { token, user: publicUser(user) };
};

// Onboarding: tandai selesai, simpan tiktokUsername & activeGame.
exports.completeOnboarding = async (req, res) => {
  try {
    const { tiktokUsername, activeGame, randomGames } = req.body || {};
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
    if (typeof tiktokUsername === 'string') {
      const name = tiktokUsername.replace(/^@/, '').trim();
      if (name && !TIKTOK_RE.test(name)) return res.status(400).json({ error: 'Username TikTok tidak valid' });
      user.tiktokUsername = name;
    }
    if (typeof activeGame === 'string') {
      // activeGame dipakai menyusun path file overlay, wajib dari daftar game resmi.
      if (activeGame !== 'game-random' && !VALID_GAMES.includes(activeGame)) {
        return res.status(400).json({ error: 'Game tidak dikenal' });
      }
      user.activeGame = activeGame;
    }
    if (Array.isArray(randomGames)) {
      const clean = [...new Set(randomGames.filter(g => VALID_GAMES.includes(g)))];
      if (clean.length > 0) user.randomGames = clean;
    }
    user.onboardingCompleted = true;
    await user.save();
    res.json({ message: 'Onboarding selesai', user: publicUser(user) });
  } catch (err) {
    console.error('[Auth] onboarding error:', err.message);
    res.status(500).json({ error: 'Gagal simpan onboarding' });
  }
};
