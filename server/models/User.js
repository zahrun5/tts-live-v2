const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  tiktokUsername: { type: String, default: '' },
  activeGame: { type: String, default: 'tts' },
  randomGames: { type: [String], default: ['tts', 'susun-kata-acak', 'family100', 'trivia', 'cari-kata', 'sambung-kata'] },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
