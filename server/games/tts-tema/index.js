/**
 * TTS Tema - main module
 *
 * Game: "TTS Family 100" -- SATU pertanyaan per ronde (mis. "Sebutkan nama
 * buah-buahan"), jawabannya banyak kata yang saling menyilang di grid TTS.
 * Tidak ada clue per kata; kata apa pun yang cocok dengan pertanyaan boleh dijawab.
 *
 * Pool kata: gabungan dari fallback-themes.json (bank statis yang sudah
 * disiapkan) + hasil AI worker (bank-*.json) + KBBI + pool Cari Kata /
 * Family 100 (di-extract kemudian).
 *
 * Aturan penting (Mamang):
 *  - CSS mirip dengan Sambung Kata (bukan TTS yang sekarang, supaya gak
 *    keluar layar di HP)
 *  - Grid gak boleh dempetan / ujung nyentuh ujung kata lain (sudah
 *    dijamin oleh word-placement.js yang re-use dari Sambung Kata)
 */

const fs = require('fs');
const path = require('path');
const { generateNewRound } = require('./ai-theme-generator');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');

let puzzle = null;
let state = {};   // { "number-direction": bool }
let revealedCells = new Set();

function wordKey(w) {
  return `${w.number}-${w.direction}`;
}

function loadPuzzleFromDisk() {
  if (!fs.existsSync(PUZZLE_PATH)) {
    console.warn('[TTS Tema] puzzle.json belum ada, generate dulu...');
    return false;
  }
  try {
    puzzle = JSON.parse(fs.readFileSync(PUZZLE_PATH, 'utf8'));
    state = {};
    revealedCells = new Set();
    puzzle.words.forEach(w => { state[wordKey(w)] = !!w.found; });
    return true;
  } catch (e) {
    console.error('[TTS Tema] Gagal load puzzle.json:', e.message);
    return false;
  }
}

function buildStatePayload() {
  if (!puzzle) return { error: 'Belum ada soal' };

  return {
    theme: puzzle.theme,
    rows: puzzle.rows,
    cols: puzzle.cols,
    words: puzzle.words.map(w => ({
      number: w.number,
      direction: w.direction,
      row: w.row,
      col: w.col,
      length: w.answer.length,
      answer: state[wordKey(w)] ? w.answer : null,
      found: !!state[wordKey(w)]
    })),
    foundCount: puzzle.words.filter(w => state[wordKey(w)]).length,
    totalCount: puzzle.words.length
  };
}

function isComplete() {
  if (!puzzle) return false;
  return Object.values(state).every(solved => solved === true);
}

function handleAnswer({ answer }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };
  if (!puzzle) return { ok: false, msg: 'Belum ada soal aktif' };

  const norm = s => s.toString().trim().toUpperCase().replace(/[^A-Z]/g, '');
  const normAnswer = norm(answer);

  if (normAnswer.length < 3) return { ok: false, msg: 'Minimal 3 huruf' };

  const match = puzzle.words.find(w => !state[wordKey(w)] && norm(w.answer) === normAnswer);

  if (!match) {
    const alreadySolved = puzzle.words.some(w => state[wordKey(w)] && norm(w.answer) === normAnswer);
    if (alreadySolved) return { ok: false, msg: 'Sudah terisi' };
    return { ok: false, msg: 'Salah' };
  }

  state[wordKey(match)] = true;

  let newCellCount = 0;
  for (let i = 0; i < match.answer.length; i++) {
    const r = match.row + (match.direction === 'down' ? i : 0);
    const c = match.col + (match.direction === 'across' ? i : 0);
    const key = `${r},${c}`;
    if (!revealedCells.has(key)) {
      revealedCells.add(key);
      newCellCount++;
    }
  }

  return {
    ok: true,
    msg: 'Benar!',
    points: newCellCount,
    meta: {
      number: match.number,
      answer: match.answer,
      direction: match.direction
    }
  };
}

async function preGenerate() {
  // Boleh coba AI dulu karena ronde aktif belum selesai
  const result = await generateNewRound(false);
  if (!result.success) return { success: false, error: result.error };
  return { success: true, source: result.source };
}

async function onComplete() {
  // HARUS instan -- skip AI, langsung fallback
  const result = await generateNewRound(true);
  if (!result.success) return { success: false, error: result.error };
  loadPuzzleFromDisk();
  return { success: true, source: result.source };
}

function reset() {
  Object.keys(state).forEach(k => state[k] = false);
  revealedCells = new Set();
}

// Fitur "nyerah": buka 1 kata acak yang belum ketemu
function revealRandomAnswer() {
  if (!puzzle) return { ok: false, msg: 'Belum ada soal' };

  const unsolved = puzzle.words.filter(w => !state[wordKey(w)]);
  if (unsolved.length === 0) return { ok: false, msg: 'Semua kata sudah ketemu' };

  const pick = unsolved[Math.floor(Math.random() * unsolved.length)];
  state[wordKey(pick)] = true;

  for (let i = 0; i < pick.answer.length; i++) {
    const r = pick.row + (pick.direction === 'down' ? i : 0);
    const c = pick.col + (pick.direction === 'across' ? i : 0);
    revealedCells.add(`${r},${c}`);
  }

  return {
    ok: true,
    meta: { number: pick.number, answer: pick.answer, foundBy: 'Nyerah 🏳️' }
  };
}

async function parseComment(text) {
  const cleaned = text.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned || cleaned.length < 3) return null;
  return { answer: cleaned };
}

function getBankStats() {
  const { getTotalCount } = require('./fallback-manager');
  const fs = require('fs');
  const path = require('path');
  const USED_FILE = path.join(__dirname, 'used-themes.json');

  let used = 0;
  try {
    if (fs.existsSync(USED_FILE)) {
      used = JSON.parse(fs.readFileSync(USED_FILE, 'utf8')).length;
    }
  } catch (e) {}

  return {
    total: getTotalCount(),
    used
  };
}

function resetBankCycle() {
  const USED_FILE = path.join(__dirname, 'used-themes.json');
  fs.writeFileSync(USED_FILE, JSON.stringify([], null, 2), 'utf8');
  return true;
}

// Khusus admin/dashboard: semua jawaban soal aktif (termasuk yang belum terjawab).
function getAdminAnswers() {
  if (!puzzle) return { title: 'Belum ada soal', items: [] };
  return {
    title: `TTS Tema: ${puzzle.theme}`,
    items: puzzle.words.map(w => ({
      label: `Kata ${w.number}`,
      hint: `${w.answer.length} huruf`,
      answer: w.answer,
      solved: !!state[wordKey(w)]
    }))
  };
}

module.exports = {
  id: 'tts-tema',
  init: loadPuzzleFromDisk,
  buildStatePayload,
  getAdminAnswers,
  handleAnswer,
  isComplete,
  onComplete,
  preGenerate,
  reset,
  revealRandomAnswer,
  parseComment,
  getBankStats,
  resetBankCycle
};
