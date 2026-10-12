// services/giftTrigger.js
// Lookup mapping "gift name -> action" untuk satu user, lalu eksekusi lewat Room.
// Dipakai handler WebcastEvent.GIFT di tiktokManager. Tidak mengubah gameplay inti;
// cuma delegasi ke method yang sudah ada di Room.
const GiftMapping = require('../models/GiftMapping');
const { COIN_NEXT_QUESTION_THRESHOLD } = require('../gifts/defaults');

/**
 * Ambil mapping aktif untuk (userId, giftName). giftName dicocokkan case-insensitive.
 * Return null kalau tidak ada / disabled.
 */
async function findMapping(userId, giftName) {
  if (!userId || !giftName) return null;
  const norm = String(giftName).trim().toLowerCase();
  const list = await GiftMapping.find({ userId, enabled: true }).lean();
  // Cari exact match duluan, lalu fallback contains
  const exact = list.find(m => m.giftName.toLowerCase() === norm);
  if (exact) return exact;
  const partial = list.find(m => norm.includes(m.giftName.toLowerCase()));
  return partial || null;
}

/**
 * Eksekusi mapping lewat Room. Return { handled, action, value, message }
 * Kalau mapping null -> { handled: false }.
 */
async function applyMapping(room, mapping) {
  if (!room || !mapping) return { handled: false };
  const out = { handled: true, action: mapping.action, value: mapping.value, message: '' };
  try {
    switch (mapping.action) {
      case 'skip_round': {
        const r = await room.performForceNext('skip');
        out.message = r.ok ? 'Soal di-skip oleh gift' : ('Gagal skip: ' + (r.error || 'unknown'));
        break;
      }
      case 'next_question': {
        const r = await room.performForceNext('next');
        out.message = r.ok ? 'Soal baru dimuat oleh gift' : ('Gagal next: ' + (r.error || 'unknown'));
        break;
      }
      case 'reveal_answer': {
        const r = await room.performReveal();
        out.message = r.ok ? 'Jawaban di-reveal' : 'Reveal tidak tersedia';
        break;
      }
      case 'bonus_score': {
        // Bonus score: tambahkan poin ke leaderboard dengan nama pemain.
        const v = Number(mapping.value) || 0;
        if (v > 0 && typeof room.addScore === 'function') {
          room.addScore('gift-bonus', v);
        }
        out.message = `Bonus +${v} poin`;
        break;
      }
      default:
        out.handled = false;
        out.message = 'Aksi tidak dikenal: ' + mapping.action;
    }
  } catch (e) {
    out.handled = false;
    out.message = 'Error: ' + e.message;
  }
  return out;
}

/**
 * Top-level: dipanggil tiktokManager saat event GIFT.
 * Aturan coin threshold: kalau giftCoins >= COIN_NEXT_QUESTION_THRESHOLD,
 * langsung trigger next_question (override mapping by name).
 * Return seperti applyMapping.
 */
async function handleGiftEvent({ room, userId, giftName, giftCoins, sender }) {
  // Rule 1: total coin tinggi -> next_question
  if (Number(giftCoins) >= COIN_NEXT_QUESTION_THRESHOLD) {
    const r = await applyMapping(room, { action: 'next_question', value: 0 });
    try {
      room.emit('gift:triggered', {
        giftName: giftName || 'coin-storm',
        giftCoins: giftCoins || 0,
        sender: sender || 'anonymous',
        action: 'next_question',
        value: COIN_NEXT_QUESTION_THRESHOLD,
        message: `🎁 ${giftCoins} coin -> soal baru!`
      });
    } catch (e) { /* noop */ }
    return r;
  }

  // Rule 2: lookup by gift name
  const mapping = await findMapping(userId, giftName);
  if (!mapping) return { handled: false, reason: 'no-mapping' };
  const result = await applyMapping(room, mapping);
  // Emit ke room biar overlay bisa nampilin toast/animasi
  try {
    room.emit('gift:triggered', {
      giftName,
      giftCoins: giftCoins || 0,
      sender: sender || 'anonymous',
      action: mapping.action,
      value: mapping.value,
      message: result.message
    });
  } catch (e) { /* noop */ }
  return result;
}

module.exports = { findMapping, applyMapping, handleGiftEvent };
