/**
 * Lengkapi Kalimat - Game melengkapi kata yang kosong di kalimat
 *
 * Setiap RONDE berisi 4 sampai 6 KALIMAT (acak). Tiap kalimat punya 1 kata
 * kosong (____) yang posisinya bisa di awal, tengah, atau akhir kalimat.
 * Penonton menjawab dengan kata yang cocok lewat komentar:
 *   - "<nomor> <jawaban>"  contoh: "3 pasar"  (juga "no 3 pasar" / "pasar no 3")
 *   - jawaban langsung tanpa nomor -- dicocokkan ke semua kalimat yang belum
 *     terjawab (aman, karena kalimat dalam 1 ronde dipilih yang jawabannya
 *     saling lepas dan nggak saling membocorkan).
 * Ronde selesai (isComplete -> true) kalau SEMUA kalimat sudah terjawab.
 *
 * - Siapa pertama benar per kalimat, dapat POINTS_PER_SOAL poin
 * - Vote SKIP: ganti seluruh ronde (kalimat baru semua)
 * - Vote NYERAH: reveal 1 kalimat acak yang belum terjawab
 * - Soal selalu diambil dari bank (fallback/seed-*.json); nggak ada panggilan
 *   AI saat live. Mau nambah soal: cukup bikin file seed-002.json dst.
 *
 * Format bank:  { "sentence": "Ibu membeli sayur di ____ dekat rumah.",
 *                 "answers": ["pasar", "warung", "toko"] }
 *   answers[0] = bentuk yang ditampilkan saat terjawab (pakai huruf besar
 *   kalau nama diri: "Bandung"); semua isi answers diterima sebagai jawaban.
 */

const fs = require('fs');
const path = require('path');
const { BLANK, normalizeWord, getAllEntries, getTotalCount } = require('./fallback-manager');

const STATE_FILE = path.join(__dirname, 'state.json');
const USED_FILE = path.join(__dirname, 'used-sentences.json');
const POTENTIAL_LOG = path.join(__dirname, 'potential-answers.json');

const POINTS_PER_SOAL = 10;
const MIN_SOAL = 4;
const MAX_SOAL = 6;
const ASSEMBLE_ATTEMPTS = 40;
const POSITIONS = ['awal', 'tengah', 'akhir'];

let state = { items: [] }; // { items: [{ number, sentence, pos, answers, norms, solved, solvedBy, winnerAnswer }] }

// ---------- Util ----------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function loadUsed() {
  try {
    if (!fs.existsSync(USED_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

function saveUsed(used, newOnes, limit) {
  try {
    const merged = [...used.filter(k => !newOnes.includes(k)), ...newOnes].slice(-limit);
    fs.writeFileSync(USED_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('⚠️ [Lengkapi Kalimat] Gagal simpan used-sentences:', e.message);
  }
}

function saveStateToDisk() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('⚠️ [Lengkapi Kalimat] Gagal simpan state:', e.message);
  }
}

function buildItem(number, entry) {
  return {
    number,
    sentence: entry.sentence,
    pos: entry.pos,
    answers: entry.answers,
    norms: entry.norms,
    solved: false,
    solvedBy: null,
    winnerAnswer: null
  };
}

// ---------- Perakitan ronde ----------

// Dua kalimat boleh satu ronde kalau jawabannya nggak beririsan DAN jawaban
// salah satunya nggak kebetulan tertulis di kalimat yang lain (bocoran).
function compatible(entry, picks) {
  return picks.every(p => {
    if (p.norms.some(n => entry.norms.includes(n))) return false;
    if (entry.norms.some(n => p.tokens.has(n))) return false;
    if (p.norms.some(n => entry.tokens.has(n))) return false;
    return true;
  });
}

function tryAdd(pool, picks, count, filter) {
  for (const entry of shuffle(pool)) {
    if (picks.length >= count) return;
    if (filter && !filter(entry)) continue;
    if (picks.includes(entry)) continue;
    if (compatible(entry, picks)) picks.push(entry);
  }
}

// Prioritaskan kalimat yang belum dipakai; kalau kurang, pinjam yang sudah
// pernah dipakai. Usahakan 3 posisi (awal/tengah/akhir) semuanya muncul.
function assembleRound(usedKeys) {
  const all = getAllEntries();
  const usedSet = new Set(usedKeys);
  const fresh = all.filter(e => !usedSet.has(e.key));
  const stale = all.filter(e => usedSet.has(e.key));

  for (let target = randInt(MIN_SOAL, MAX_SOAL); target >= MIN_SOAL; target--) {
    for (let attempt = 0; attempt < ASSEMBLE_ATTEMPTS; attempt++) {
      const picks = [];
      for (const pos of shuffle(POSITIONS)) {
        tryAdd(fresh, picks, picks.length + 1, e => e.pos === pos);
      }
      tryAdd(fresh, picks, target);
      tryAdd(stale, picks, target);
      if (picks.length >= target) return shuffle(picks).slice(0, target);
    }
  }
  return null;
}

async function generateNewRound() {
  const used = loadUsed();
  const picks = assembleRound(used);

  if (!picks) {
    return {
      success: false,
      error: `Bank Lengkapi Kalimat belum cukup (butuh minimal ${MIN_SOAL} kalimat yang jawabannya tidak bentrok, bank sekarang ${getTotalCount()})`
    };
  }

  const limit = Math.max(MAX_SOAL * 2, Math.floor(getTotalCount() * 0.7));
  saveUsed(used, picks.map(p => p.key), limit);
  state = { items: picks.map((entry, i) => buildItem(i + 1, entry)) };
  saveStateToDisk();
  console.log(`✓ [Lengkapi Kalimat] Bank: ${picks.length} kalimat`);
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
      sentence: it.sentence,
      pos: it.pos,
      solved: it.solved,
      solvedBy: it.solvedBy,
      // Jawaban hanya dibocorin setelah kalimat ini terjawab
      answer: it.solved ? it.winnerAnswer : null
    })),
    totalSoal: state.items.length,
    solvedSoal: state.items.filter(it => it.solved).length
  };
}

function buildClueList() {
  return state.items.map(it => ({
    number: it.number,
    sentence: it.sentence,
    solved: it.solved,
    answer: it.solved ? it.winnerAnswer : null
  }));
}

function isComplete() {
  return state.items.length > 0 && state.items.every(it => it.solved);
}

function logPotentialAnswer(item, norm, player) {
  try {
    let log = {};
    if (fs.existsSync(POTENTIAL_LOG)) log = JSON.parse(fs.readFileSync(POTENTIAL_LOG, 'utf8'));
    const key = item.sentence;
    if (!log[key]) log[key] = {};
    if (!log[key][norm]) log[key][norm] = { count: 0, first_seen: new Date().toISOString(), users: [] };
    log[key][norm].count++;
    if (player && !log[key][norm].users.includes(player)) log[key][norm].users.push(player);
    log[key][norm].last_seen = new Date().toISOString();
    fs.writeFileSync(POTENTIAL_LOG, JSON.stringify(log, null, 2), 'utf8');
  } catch (e) {
    console.error('[Lengkapi Kalimat] Gagal log potential answer:', e.message);
  }
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
    // Jawaban ditulis langsung tanpa nomor -- cocokkan ke semua kalimat belum terjawab
    candidates = state.items;
  }

  const match = candidates.find(it => !it.solved && it.norms.includes(norm));

  if (!match) {
    if (candidates.every(it => it.solved)) {
      return { ok: false, msg: hasNumber ? 'Soal ini sudah terjawab' : 'Semua soal sudah terjawab' };
    }
    // Kata yang sudah tertulis di kalimat jelas bukan jawabannya
    const echoed = candidates.find(it => !it.solved && it.sentence.toUpperCase().split(/[^A-Z]+/).includes(norm));
    if (echoed) return { ok: false, msg: 'Kata itu sudah ada di kalimatnya' };

    // Catat jawaban salah (hanya kalau nomornya jelas) buat dicek: siapa tau valid
    if (hasNumber && candidates[0]) logPotentialAnswer(candidates[0], norm, player);
    return { ok: false, msg: 'Salah' };
  }

  match.solved = true;
  match.solvedBy = player || 'Anonim';
  match.winnerAnswer = match.answers[match.norms.indexOf(norm)];
  saveStateToDisk();

  return {
    ok: true,
    msg: 'Benar!',
    points: POINTS_PER_SOAL,
    meta: { number: match.number, sentence: match.sentence, answer: match.winnerAnswer, solvedBy: match.solvedBy }
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

// ---------- Fitur "nyerah": reveal 1 kalimat acak yang belum terjawab ----------

function revealRandomAnswer() {
  const unsolved = state.items.filter(it => !it.solved);
  if (unsolved.length === 0) return { ok: false, msg: 'Semua soal sudah terjawab' };

  const pick = unsolved[Math.floor(Math.random() * unsolved.length)];
  pick.solved = true;
  pick.solvedBy = 'Nyerah 🏳️';
  pick.winnerAnswer = pick.answers[0];
  saveStateToDisk();

  return {
    ok: true,
    meta: { number: pick.number, sentence: pick.sentence, answer: pick.winnerAnswer, foundBy: 'Nyerah 🏳️' }
  };
}

// ---------- Comment parser (regex, tanpa AI) ----------
// Format 1: "<nomor> <jawaban>"                  contoh: "3 pasar"
// Format 2: "nomor/no/nomer/number <nomor> <jawaban>"
// Format 3: "<jawaban> nomor/no/nomer/number <nomor>"
// Format 4: jawaban 1 kata TANPA nomor -- dicocokkan ke semua kalimat belum terjawab
// Jawaban selalu 1 kata (huruf a-z, boleh 1 tanda hubung); selain itu diabaikan.
function cleanSingleWord(s) {
  const w = String(s || '').trim().replace(/[.!?,]+$/, '');
  return /^[a-zA-Z]+(?:-[a-zA-Z]+)?$/.test(w) && w.length >= 2 && w.length <= 20 ? w.toLowerCase() : null;
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
  return { total: getTotalCount(), used: loadUsed().length };
}

function resetBankCycle() {
  try {
    fs.writeFileSync(USED_FILE, JSON.stringify([], null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

// Khusus admin/dashboard: semua kalimat aktif beserta jawaban yang diterima.
function getAdminAnswers() {
  return {
    title: 'Lengkapi Kalimat',
    items: state.items.map(it => ({
      label: `Soal ${it.number}`,
      hint: `${it.sentence} → ${it.answers.join(', ')}`,
      answer: it.answers[0],
      solved: !!it.solved
    }))
  };
}

function tryGhostAnswer() {
  const unsolved = state.items.filter(it => !it.solved);
  if (unsolved.length === 0) return null;
  const pick = unsolved[Math.floor(Math.random() * unsolved.length)];
  return { number: pick.number, answer: pick.answers[0].toLowerCase() };
}

module.exports = {
  id: 'lengkapi-kalimat',
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
  resetBankCycle,
  tryGhostAnswer
};
