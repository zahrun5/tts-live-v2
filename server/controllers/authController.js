const User = require('../models/User');
const bcrypt = require('bcryptjs'); // Pake bcryptjs biar aman di semua arsitektur ARM
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_ttslive_v2_2026';

exports.register = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: 'Username sudah terpakai' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();

    res.status(201).json({ message: 'Registrasi berhasil, silakan login.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error saat registrasi', details: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Username tidak ditemukan' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Password salah' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, tiktokUsername: user.tiktokUsername }, 
      JWT_SECRET, 
      { expiresIn: '7d' } // Token berlaku seminggu
    );

    res.json({ 
      message: 'Login berhasil', 
      token, 
      user: {
        username: user.username,
        tiktokUsername: user.tiktokUsername
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error saat login', details: err.message });
  }
};
