const User = require('../models/User');
const Subscription = require('../models/Subscription');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { JWT_SECRET, ALLOW_REGISTER, USERNAME_RE, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = require('../config');
const { ensureFreeSubscription } = require('../services/subscriptionHelper');
const email = require('../services/email');

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
    // Kirim welcome email (kalau ada)
    if (user.email) email.welcome({ to: user.email, username: user.username });
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

/**
 * Google OAuth: alur authorization code.
 * GET /api/auth/google -> redirect ke Google.
 * GET /api/auth/google/callback -> tukar code, dapat profile, upsert user, return JWT.
 */
exports.googleStart = (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google OAuth belum dikonfigurasi (GOOGLE_CLIENT_ID kosong)' });
  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['openid', 'email', 'profile']
  });
  res.redirect(url);
};

exports.googleCallback = async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google OAuth belum dikonfigurasi' });
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'Kode OAuth tidak ada' });
    const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    // Ambil profile via userinfo
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;
    if (!email) return res.status(400).json({ error: 'Email Google tidak tersedia' });

    // Cari user: by googleId dulu, lalu by email (link akun).
    let user = await User.findOne({ googleId });
    if (!user) user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Bikin user baru. Username = bagian lokal dari email, fallback 'user'+rand.
      let baseUsername = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'user';
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
      email.welcome({ to: email, username });
    } else if (!user.googleId) {
      // Link akun existing
      user.googleId = googleId;
      if (!user.avatar && picture) user.avatar = picture;
      if (!user.email) user.email = email.toLowerCase();
      await user.save();
      await ensureFreeSubscription(user._id);
    }

    const token = signToken(user);
    // Redirect ke frontend dengan token (fragment biar JS yg ambil)
    const appUrl = process.env.APP_BASE_URL || 'http://localhost:3050';
    res.redirect(`${appUrl}/login?oauth=success&token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(publicUser(user)))}`);
  } catch (err) {
    console.error('[Auth] google callback error:', err.message);
    res.status(500).json({ error: 'Google OAuth gagal: ' + err.message });
  }
};

// Onboarding: tandai selesai, simpan tiktokUsername & activeGame.
exports.completeOnboarding = async (req, res) => {
  try {
    const { tiktokUsername, activeGame, randomGames } = req.body || {};
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
    if (typeof tiktokUsername === 'string') user.tiktokUsername = tiktokUsername.replace(/^@/, '').trim();
    if (typeof activeGame === 'string') user.activeGame = activeGame;
    if (Array.isArray(randomGames)) user.randomGames = randomGames;
    user.onboardingCompleted = true;
    await user.save();
    res.json({ message: 'Onboarding selesai', user: publicUser(user) });
  } catch (err) {
    console.error('[Auth] onboarding error:', err.message);
    res.status(500).json({ error: 'Gagal simpan onboarding' });
  }
};
