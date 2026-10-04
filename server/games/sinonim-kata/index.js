/**
 * Sinonim Kata - Game mencari persamaan kata
 *
 * Setiap RONDE berisi 8 SOAL. Tiap soal menampilkan 1 kata (misal INDAH),
 * penonton menjawab dengan persamaan katanya (cantik, elok, molek, ...).
 * Jawaban dikirim lewat komentar:
 *   - "<nomor> <jawaban>"  contoh: "3 cantik"  (juga "no 3 cantik" / "cantik no 3")
 *   - jawaban langsung tanpa nomor -- dicocokkan ke semua soal yang belum
 *     terjawab (aman, karena soal dalam 1 ronde dipilih yang daftar
 *     jawabannya saling lepas).
 * Ronde selesai (isComplete -> true) kalau SEMUA soal sudah terjawab.
 *
 * - Siapa pertama benar per soal, dapat POINTS_PER_SOAL poin
 * - Vote SKIP: ganti seluruh ronde (soal baru semua)
 * - Vote NYERAH: reveal 1 soal acak yang belum terjawab
 * - Soal selalu diambil dari bank (fallback/*.json); nggak ada panggilan AI
 *   saat live. Pengisian bank oleh AI worker menyusul.
 */

const fs = require('fs');
const path = require('path');
const { normalizeWord, getAllEntries, getTotalCount } = require('./fallback-manager');

const STATE_FILE = path.join(__dirname, 'state.json');
const USED_FILE = path.join(__dirname, 'used-words.json');

const POINTS_PER_SOAL = 10;
const SOAL_PER_ROUND = 8;
const USED_HISTORY_LIMIT = 500;
const ASSEMBLE_ATTEMPTS = 20;

let state = { items: [] }; // { items: [{ number, word, synonyms, solved, solvedBy, winnerAnswer }] }

// ---------- Util ----------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadUsedWords() {
  try {
    if (!fs.existsSync(USED_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

function saveUsedWords(used, newOnes) {
  try {
    const merged = [...used.filter(w => !newOnes.includes(w)), ...newOnes].slice(-USED_HISTORY_LIMIT);
    fs.writeFileSync(USED_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('⚠️ [Sinonim Kata] Gagal simpan used-words:', e.message);
  }
}

function saveStateToDisk() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('⚠️ [Sinonim Kata] Gagal simpan state:', e.message);
  }
}

function buildItem(number, entry) {
  return {
    number,
    word: entry.word,
    synonyms: entry.synonyms,
    solved: false,
    solvedBy: null,
    winnerAnswer: null
  };
}

// ---------- Perakitan ronde ----------

// Ambil sebanyak mungkin (maks `count`) soal dari `pool` yang himpunan jawaban
// terimanya (kata soal + semua sinonim) nggak beririsan dengan yang sudah diambil.
function pickDisjoint(pool, count, taken) {
  const picks = [];
  for (const entry of shuffle(pool)) {
    if (picks.length >= count) break;
    const accepted = [entry.word, ...entry.synonyms];
    if (accepted.some(w => taken.has(w))) continue;
    accepted.forEach(w => taken.add(w));
    picks.push(entry);
  }
  return picks;
}

// Prioritaskan soal yang belum pernah dipakai; kalau kurang, pinjam yang
// sudah pernah dipakai (siklus ulang) supaya ronde tetap penuh.
function assembleRound(usedWords) {
  const all = getAllEntries();
  const usedSet = new Set(usedWords);
  const fresh = all.filter(e => !usedSet.has(e.word));
  const stale = all.filter(e => usedSet.has(e.word));

  for (let attempt = 0; attempt < ASSEMBLE_ATTEMPTS; attempt++) {
    const taken = new Set();
    const picks = pickDisjoint(fresh, SOAL_PER_ROUND, taken);
    if (picks.length < SOAL_PER_ROUND) {
      picks.push(...pickDisjoint(stale, SOAL_PER_ROUND - picks.length, taken));
    }
    if (picks.length === SOAL_PER_ROUND) return shuffle(picks);
  }
  return null;
}

async function generateNewRound() {
  const used = loadUsedWords();
  const picks = assembleRound(used);

  if (!picks) {
    return {
      success: false,
      error: `Bank Sinonim Kata belum cukup (butuh ${SOAL_PER_ROUND} soal yang jawabannya tidak bentrok, bank sekarang ${getTotalCount()})`
    };
  }

  saveUsedWords(used, picks.map(p => p.word));
  state = { items: picks.map((entry, i) => buildItem(i + 1, entry)) };
  saveStateToDisk();
  console.log(`✓ [Sinonim Kata] Bank: ${picks.length} soal`);
  return { success: true, source: 'bank', count: picks.length };
}

// ---------- Game interface ----------

function init() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (loaded && Array.isArray(loaded.items)) {
        state = loaded;
        // Reset status terjawab saat server restart, ronde diulang dari awal
        state.items.forEach(it => { it.solved = false; it.solvedBy = null; it.winnerAnswer = null; });
        return;
      }
    }
  } catch (e) {}
  // State kosong; onComplete() dipanggil room saat game pertama dipakai
  state = { items: [] };
}

function buildStatePayload() {
  return {
    items: state.items.map(it => ({
      number: it.number,
      word: it.word,
      solved: it.solved,
      solvedBy: it.solvedBy,
      // Jawaban hanya dibocorin setelah soal ini terjawab
      answer: it.solved ? it.winnerAnswer : null
    })),
    totalSoal: state.items.length,
    solvedSoal: state.items.filter(it => it.solved).length
  };
}

function buildClueList() {
  return state.items.map(it => ({
    number: it.number,
    word: it.word,
    solved: it.solved,
    answer: it.solved ? it.winnerAnswer : null
  }));
}

function isComplete() {
  return state.items.length > 0 && state.items.every(it => it.solved);
}

function handleAnswer({ number, answer, player }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };

  // Jawaban harus 1 kata
  if (/\s/.test(String(answer).trim())) return { ok: false, msg: 'Salah' };
  const norm = normalizeWord(answer);
  if (!norm) return { ok: false, msg: 'Jawaban kosong' };

  const hasNumber = number !== null && number !== undefined && !Number.isNaN(Number(number));

  let candidates;
  if (hasNumber) {
    candidates = state.items.filter(it => it.number === Number(number));
    if (candidates.length === 0) return { ok: false, msg: 'Nomor tidak ditemukan' };
  } else {
    // Jawaban ditulis langsung tanpa nomor -- cocokkan ke semua soal belum terjawab
    candidates = state.items;
  }

  const match = candidates.find(it => !it.solved && it.synonyms.includes(norm));

  if (!match) {
    if (candidates.every(it => it.solved)) {
      return { ok: false, msg: hasNumber ? 'Soal ini sudah terjawab' : 'Semua soal sudah terjawab' };
    }
    if (candidates.some(it => !it.solved && it.word === norm)) {
      return { ok: false, msg: 'Itu kata soalnya, cari persamaannya' };
    }
    return { ok: false, msg: 'Salah' };
  }

  match.solved = true;
  match.solvedBy = player || 'Anonim';
  match.winnerAnswer = norm;
  saveStateToDisk();

  return {
    ok: true,
    msg: 'Benar!',
    points: POINTS_PER_SOAL,
    meta: { number: match.number, word: match.word, answer: norm, solvedBy: match.solvedBy }
  };
}

async function onComplete() {
  // Dipanggil saat ronde selesai / skip / pertama kali game dipakai
  return generateNewRound();
}

function reset() {
  state.items.forEach(it => { it.solved = false; it.solvedBy = null; it.winnerAnswer = null; });
  saveStateToDisk();
}

// ---------- Fitur "nyerah": reveal 1 soal acak yang belum terjawab ----------

function revealRandomAnswer() {
  const unsolved = state.items.filter(it => !it.solved);
  if (unsolved.length === 0) return { ok: false, msg: 'Semua soal sudah terjawab' };

  const pick = unsolved[Math.floor(Math.random() * unsolved.length)];
  pick.solved = true;
  pick.solvedBy = 'Nyerah 🏳️';
  pick.winnerAnswer = pick.synonyms[0];
  saveStateToDisk();

  return {
    ok: true,
    meta: { number: pick.number, word: pick.word, answer: pick.winnerAnswer, foundBy: 'Nyerah 🏳️' }
  };
}

// ---------- Comment parser (regex, tanpa AI) ----------
// Format 1: "<nomor> <jawaban>"                  contoh: "3 cantik"
// Format 2: "nomor/no/nomer/number <nomor> <jawaban>"
// Format 3: "<jawaban> nomor/no/nomer/number <nomor>"
// Format 4: jawaban 1 kata TANPA nomor -- dicocokkan ke semua soal belum terjawab
// Jawaban selalu 1 kata (huruf a-z saja); selain itu diabaikan.
function cleanSingleWord(s) {
  const w = String(s || '').trim().replace(/[.!?,]+$/, '');
  return /^[a-zA-Z]{2,20}$/.test(w) ? w.toLowerCase() : null;
}

async function parseComment(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  if (['skip', 'ganti', 'nyerah'].includes(lower)) return null;

  const normalized = cleaned.replace(/\s+/g, ' ');

  let match = normalized.match(/^(\d+)[.\s]+(.+)$/);
  if (match) {
    const answer = cleanSingleWord(match[2]);
    return answer ? { number: parseInt(match[1], 10), answer } : null;
  }

  match = normalized.match(/(?:nomor|no|nomer|number)\s*(\d+)\s+(.+)$/i);
  if (match) {
    const answer = cleanSingleWord(match[2]);
    return answer ? { number: parseInt(match[1], 10), answer } : null;
  }

  match = normalized.match(/^(.+?)\s+(?:nomor|no|nomer|number)\s*(\d+)$/i);
  if (match) {
    const answer = cleanSingleWord(match[1]);
    return answer ? { number: parseInt(match[2], 10), answer } : null;
  }

  const answer = cleanSingleWord(normalized);
  return answer ? { number: null, answer } : null;
}

// ---------- Bank stats ----------

function getBankStats() {
  return { total: getTotalCount(), used: loadUsedWords().length };
}

function resetBankCycle() {
  try {
    fs.writeFileSync(USED_FILE, JSON.stringify([], null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

// Khusus admin/dashboard: semua soal aktif beserta jawaban yang diterima.
// `answer` sengaja cuma 1 kata (dipakai ghost bot buat jawab otomatis);
// daftar lengkap jawaban yang diterima ada di `hint`.
function getAdminAnswers() {
  return {
    title: 'Sinonim Kata',
    items: state.items.map(it => ({
      label: `Soal ${it.number}`,
      hint: `${it.word.toUpperCase()} → ${it.synonyms.join(', ')}`,
      answer: it.synonyms[0],
      solved: !!it.solved
    }))
  };
}

module.exports = {
  id: 'sinonim-kata',
  init,
  buildStatePayload,
  getAdminAnswers,
  buildClueList,
  handleAnswer,
  isComplete,
  onComplete,
  reset,
  revealRandomAnswer,
  parseComment,
  getBankStats,
  resetBankCycle
};
