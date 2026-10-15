/**
 * Tebak Bendera - 6 slot, 1 ronde
 *
 * Tiap slot nampilin 1 bendera negara. Penonton ngetik nama negaranya
 * (Indonesia atau Inggris, plus singkatan umum kayak "AS", "UK", "Korsel").
 * Pola ronde sama kayak Susun Kata Acak / Huruf Hilang: semua slot harus
 * solved dulu baru ronde baru, jadi isComplete() tetap bener buat rotasi game.
 *
 * Bendera disajiin lewat token acak (bukan kode negara) supaya nama file
 * di overlay nggak bocorin jawabannya.
 */

const fs = require('fs');
const path = require('path');
const COUNTRIES = require('./countries');

const USED_FILE = path.join(__dirname, 'used-flags.json');
const USED_HISTORY_LIMIT = 120;

const TOTAL_SLOTS = 6;
const POINTS_PER_ANSWER = 10;
const ROUND_COMPLETE_DELAY_MS = 3000;

// Hilangin aksen (Côte -> Cote), uppercase, buang semua selain A-Z.
const norm = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z]/g, '');

// alias ternormalisasi -> Set index negara (1 alias bisa kena >1 negara, misal "Kongo")
const ALIAS_MAP = new Map();
COUNTRIES.forEach((c, idx) => {
  for (const a of c.aliases) {
    const k = norm(a);
    if (!k) continue;
    if (!ALIAS_MAP.has(k)) ALIAS_MAP.set(k, new Set());
    ALIAS_MAP.get(k).add(idx);
  }
});

let slots = []; // { id, idx, status: 'active'|'solved', solvedBy, solvedAt }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadUsed() {
  try {
    if (!fs.existsSync(USED_FILE)) return [];
    const arr = JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveUsed(used) {
  try {
    fs.writeFileSync(USED_FILE, JSON.stringify(used.slice(-USED_HISTORY_LIMIT)), 'utf8');
  } catch (e) {
    console.error('⚠️ [Tebak Bendera] Gagal simpan used-flags.json:', e.message);
  }
}

// Ambil 6 negara: belum kepakai di riwayat terbaru, nggak dobel, dan nggak
// ada 2 negara satu "group" (Kongo Kinshasa & Brazzaville) di ronde yang sama.
function pickBatch() {
  let used = loadUsed();
  const batch = [];
  const groups = new Set();

  while (batch.length < TOTAL_SLOTS) {
    let candidates = COUNTRIES.map((_, i) => i).filter(i =>
      !batch.includes(i) &&
      !used.includes(i) &&
      !(COUNTRIES[i].group && groups.has(COUNTRIES[i].group))
    );
    if (candidates.length === 0) {
      // Riwayat habis -> mulai siklus baru (kecuali yang lagi dipilih di batch ini)
      used = [];
      continue;
    }
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    batch.push(idx);
    if (COUNTRIES[idx].group) groups.add(COUNTRIES[idx].group);
  }

  saveUsed([...used, ...batch]);
  return batch;
}

function fillAllSlots() {
  return pickBatch().map((idx, i) => ({
    id: i + 1,
    idx,
    status: 'active',
    solvedBy: null,
    solvedAt: null
  }));
}

function init() {
  slots = fillAllSlots();
}

function buildStatePayload() {
  return {
    slots: slots.map(s => ({
      id: s.id,
      flag: COUNTRIES[s.idx].token,
      status: s.status,
      // Nama negara cuma dibuka pas udah solved; pas aktif tetap rahasia.
      answer: s.status === 'solved' ? COUNTRIES[s.idx].name : null,
      solvedBy: s.solvedBy
    })),
    foundCount: slots.filter(s => s.status === 'solved').length,
    totalCount: TOTAL_SLOTS
  };
}

function isComplete() {
  return slots.length > 0 && slots.every(s => s.status === 'solved');
}

function handleAnswer({ answer, player }) {
  const key = norm(answer);
  if (!key) return { ok: false, msg: 'Jawaban kosong' };

  const matches = ALIAS_MAP.get(key);
  if (!matches) return { ok: false, msg: 'Salah' };

  const slot = slots.find(s => s.status === 'active' && matches.has(s.idx));
  if (!slot) return { ok: false, msg: 'Salah' };

  slot.status = 'solved';
  slot.solvedBy = player || 'Anonim';
  slot.solvedAt = Date.now();

  return {
    ok: true,
    msg: 'Benar!',
    points: POINTS_PER_ANSWER,
    meta: { number: slot.id, answer: COUNTRIES[slot.idx].name }
  };
}

async function onComplete() {
  await sleep(ROUND_COMPLETE_DELAY_MS);
  slots = fillAllSlots();
  return { success: true, source: 'wordbank' };
}

// Dipanggil server pas NYERAH kepenuhin: buka 1 bendera aktif acak tanpa poin.
function revealRandomAnswer() {
  const active = slots.filter(s => s.status === 'active');
  if (active.length === 0) return { ok: false, msg: 'Semua slot udah terjawab, tunggu ronde baru' };

  const slot = active[Math.floor(Math.random() * active.length)];
  slot.status = 'solved';
  slot.solvedBy = 'Nyerah 🏳️';
  slot.solvedAt = Date.now();

  return {
    ok: true,
    meta: { number: slot.id, answer: COUNTRIES[slot.idx].name, foundBy: 'Nyerah 🏳️' }
  };
}

function reset() {
  init();
}

async function parseComment(text) {
  const raw = String(text || '').trim().slice(0, 60);
  if (norm(raw).length < 2) return null; // "AS", "UK" masih boleh
  return { answer: raw };
}

function getBankStats() {
  return { total: COUNTRIES.length, used: loadUsed().length };
}

function resetBankCycle() {
  saveUsed([]);
  return true;
}

function getAdminAnswers() {
  return {
    title: 'Tebak Bendera',
    items: slots.map(s => ({
      label: `Bendera ${s.id}`,
      hint: '',
      answer: COUNTRIES[s.idx].name,
      solved: s.status === 'solved'
    }))
  };
}

module.exports = {
  id: 'tebak-bendera',
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
