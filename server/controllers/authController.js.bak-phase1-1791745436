const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ALLOW_REGISTER, USERNAME_RE } = require('../config');

exports.register = async (req, res) => {
  try {
    if (!ALLOW_REGISTER) return res.status(403).json({ error: 'Registrasi ditutup' });
    const { username, password } = req.body || {};
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
    const user = new User({ username, password: await bcrypt.hash(password, 10) });
    await user.save();
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
    const ok = user && await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Username atau password salah' });

    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      message: 'Login berhasil',
      token,
      user: { username: user.username, tiktokUsername: user.tiktokUsername }
    });
  } catch (err) {
    console.error('[Auth] login error:', err.message);
    res.status(500).json({ error: 'Server error saat login' });
  }
};
