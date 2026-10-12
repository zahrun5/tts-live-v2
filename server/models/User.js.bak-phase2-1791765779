const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, match: /^[a-zA-Z0-9_-]{3,32}$/ },
  password: { type: String, required: false, default: null }, // bisa null kalau user daftar via Google
  email: { type: String, default: '', lowercase: true, trim: true, index: true, sparse: true },
  googleId: { type: String, default: '', index: true, sparse: true },
  avatar: { type: String, default: '' }, // URL foto profil (kalau ada)
  tiktokUsername: { type: String, default: '' },
  activeGame: { type: String, default: 'tts' },
  randomGames: { type: [String], default: ['tts', 'susun-kata-acak', 'family100', 'trivia', 'cari-kata', 'sambung-kata', 'susun-kalimat', 'sinonim-kata'] },
  role: { type: String, default: 'user' },
  avatarType: { type: String, default: 'emoji' },
  // Onboarding: false sampai user selesai 4-step wizard
  onboardingCompleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
