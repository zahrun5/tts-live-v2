/**
 * Huruf Hilang - 6 slot, 1 ronde
 *
 * Tiap slot nampilin 1 kata dengan sebagian huruf disembunyiin (contoh:
 * K_RS_). Penonton ngetik kata utuhnya. Pola ronde sama kayak Susun Kata
 * Acak: semua slot harus solved dulu baru ronde baru di-generate, jadi
 * isComplete() tetap bener buat rotasi game.
 *
 * Sumber kata: wordbank Susun Kata Acak (loadWordbank), tapi riwayat
 * "udah kepakai" disimpan di file sendiri (used-words.json) biar siklusnya
 * nggak ganggu game lain.
 */

const fs = require('fs');
const path = require('path');
const { loadWordbank } = require('../susun-kata-acak/word-bank');

const USED_FILE = path.join(__dirname, 'used-words.json');
const USED_HISTORY_LIMIT = 900;

const TOTAL_SLOTS = 6;
const POINTS_PER_ANSWER = 10;
const ROUND_COMPLETE_DELAY_MS = 3000;
const MIN_WORD_LEN = 4; // kata 3 huruf kebanyakan ambigu kalau dibolongin

let slots = []; // { id, answer, masked, status: 'active'|'solved', solvedBy, solvedAt }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadUsed() {
  try {
    if (!fs.existsSync(USED_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveUsed(used) {
  try {
    fs.writeFileSync(USED_FILE, JSON.stringify(used.slice(-USED_HISTORY_LIMIT)), 'utf8');
  } catch (e) {
    console.error('⚠️ [Huruf Hilang] Gagal simpan used-words.json:', e.message);
  }
}

function pickWord(excludeWords) {
  const bank = loadWordbank().filter(w => /^[A-Z]+$/.test(w) && w.length >= MIN_WORD_LEN);
  const used = loadUsed();
  const exclude = new Set(excludeWords);

  let candidates = bank.filter(w => !used.includes(w) && !exclude.has(w));
  if (candidates.length === 0) candidates = bank.filter(w => !exclude.has(w));
  if (candidates.length === 0) candidates = bank;

  const word = candidates[Math.floor(Math.random() * candidates.length)];
  saveUsed([...used, word]);
  return word;
}

// Sembunyiin ~40% huruf (minimal 1, maksimal panjang-2). Huruf pertama
// selalu kelihatan biar ada pegangan. Hasilnya string, '_' = huruf hilang.
function maskWord(word) {
  const n = word.length;
  const hideCount = Math.min(n - 2, Math.max(1, Math.round(n * 0.4)));
  const positions = [];
  for (let i = 1; i < n; i++) positions.push(i);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const hidden = new Set(positions.slice(0, hideCount));
  return word.split('').map((c, i) => (hidden.has(i) ? '_' : c)).join('');
}

function fillAllSlots() {
  const fresh = [];
  const usedInBatch = [];
  for (let i = 1; i <= TOTAL_SLOTS; i++) {
    const word = pickWord(usedInBatch);
    usedInBatch.push(word);
    fresh.push({
      id: i,
      answer: word,
      masked: maskWord(word),
      status: 'active',
      solvedBy: null,
      solvedAt: null
    });
  }
  return fresh;
}

function init() {
  slots = fillAllSlots();
}

function buildStatePayload() {
  return {
    slots: slots.map(s => ({
      id: s.id,
      length: s.answer.length,
      masked: s.masked,
      status: s.status,
      // Jawaban cuma dibuka pas udah solved; pas aktif tetap rahasia.
      answer: s.status === 'solved' ? s.answer : null,
      solvedBy: s.solvedBy
    })),
    foundCount: slots.filter(s => s.status === 'solved').length,
    totalCount: TOTAL_SLOTS
  };
}

function isComplete() {
  return slots.length > 0 && slots.every(s => s.status === 'solved');
}

const norm = s => String(s).trim().toUpperCase().replace(/[^A-Z]/g, '');

function handleAnswer({ answer, player }) {
  const normAnswer = norm(answer || '');
  if (!normAnswer) return { ok: false, msg: 'Jawaban kosong' };

  const slot = slots.find(s => s.status === 'active' && norm(s.answer) === normAnswer);
  if (!slot) return { ok: false, msg: 'Salah' };

  slot.status = 'solved';
  slot.solvedBy = player || 'Anonim';
  slot.solvedAt = Date.now();

  return {
    ok: true,
    msg: 'Benar!',
    points: POINTS_PER_ANSWER,
    meta: { number: slot.id, answer: slot.answer }
  };
}

async function onComplete() {
  await sleep(ROUND_COMPLETE_DELAY_MS);
  slots = fillAllSlots();
  return { success: true, source: 'wordbank' };
}

// Dipanggil server pas NYERAH kepenuhin: buka 1 slot aktif acak tanpa poin.
function revealRandomAnswer() {
  const active = slots.filter(s => s.status === 'active');
  if (active.length === 0) return { ok: false, msg: 'Semua slot udah terjawab, tunggu ronde baru' };

  const slot = active[Math.floor(Math.random() * active.length)];
  slot.status = 'solved';
  slot.solvedBy = 'Nyerah 🏳️';
  slot.solvedAt = Date.now();

  return {
    ok: true,
    meta: { number: slot.id, answer: slot.answer, foundBy: 'Nyerah 🏳️' }
  };
}

function reset() {
  init();
}

async function parseComment(text) {
  const cleaned = String(text || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned || cleaned.length < 3) return null;
  return { answer: cleaned };
}

function getBankStats() {
  const total = loadWordbank().filter(w => /^[A-Z]+$/.test(w) && w.length >= MIN_WORD_LEN).length;
  return { total, used: loadUsed().length };
}

function resetBankCycle() {
  saveUsed([]);
  return true;
}

function getAdminAnswers() {
  return {
    title: 'Huruf Hilang',
    items: slots.map(s => ({
      label: `Slot ${s.id}`,
      hint: s.masked,
      answer: s.answer,
      solved: s.status === 'solved'
    }))
  };
}

module.exports = {
  id: 'huruf-hilang',
  init,
  buildStatePayload,
  getAdminAnswers,
  handleAnswer,
  isComplete,
  onComplete,
  reset,
  parseComment,
  getBankStats,
  resetBankCycle,
  revealRandomAnswer
};
