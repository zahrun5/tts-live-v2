// gifts/defaults.js
// Mapping default gift TikTok -> aksi di game. Dipakai saat user pertama kali
// connect ke TikTok Live (atau saat register, via ensureDefaults).
//
// Daftar default sesuai brief:
//   rose     -> bonus_score +5
//   tiktok   -> skip_round
//   lion     -> reveal_answer
//   coins >= 1000 -> next_question
//
// 'coins' bukan nama gift, jadi ditangani terpisah di giftTrigger.handleGiftEvent
// (lihat handler GIFT di tiktokManager).
const GiftMapping = require('../models/GiftMapping');

const DEFAULT_GIFT_MAPPINGS = [
  { giftName: 'rose',     action: 'bonus_score',   value: 5,   enabled: true },
  { giftName: 'tiktok',   action: 'skip_round',    value: 0,   enabled: true },
  { giftName: 'lion',     action: 'reveal_answer', value: 0,   enabled: true }
];

// Batas coin (bukan nama gift) yang memicu next_question
const COIN_NEXT_QUESTION_THRESHOLD = 1000;

/** Idempotent: insert default mapping untuk user kalau belum ada. */
async function ensureDefaults(userId) {
  if (!userId) return;
  for (const m of DEFAULT_GIFT_MAPPINGS) {
    await GiftMapping.updateOne(
      { userId, giftName: m.giftName },
      { $setOnInsert: { ...m, userId } },
      { upsert: true }
    );
  }
}

module.exports = {
  DEFAULT_GIFT_MAPPINGS,
  COIN_NEXT_QUESTION_THRESHOLD,
  ensureDefaults
};
