// models/GiftMapping.js
// Aturan "kalau dapat gift X, lakukan aksi Y".
// Dipakai service/giftTrigger.js + handler WebcastEvent.GIFT di tiktokManager.
const mongoose = require('mongoose');

const giftMappingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  giftName: { type: String, required: true }, // nama gift dari TikTok, case-insensitive
  action: {
    type: String,
    enum: ['skip_round', 'bonus_score', 'next_question', 'reveal_answer'],
    required: true
  },
  value: { type: Number, default: 0 }, // mis. 50 untuk bonus_score, atau jumlah skip
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

giftMappingSchema.index({ userId: 1, giftName: 1 }, { unique: true });

module.exports = mongoose.model('GiftMapping', giftMappingSchema);
