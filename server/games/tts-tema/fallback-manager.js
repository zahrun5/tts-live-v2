/**
 * Fallback Manager - TTS Tema
 *
 * Bank tema + kata untuk TTS Tema (satu pertanyaan, banyak jawaban menyilang).
 * Format grup: { theme, words, clues }
 * - theme: nama tema (misal "Buah-buahan")
 * - words: array kata yang harus ditempatkan ke grid menyilang
 * - clues: { word: clueText } -- clue variatif per kata (supaya gak ngulang
 *          "Buah X" terus; bisa dari template, sinonim, atau pool acak).
 *
 * Bank disimpan di banyak file kecil (bank-001.json, bank-002.json, dst,
 * maks MAX_GROUPS_PER_FILE grup per file) -- sama persis pola Family 100 &
 * Sambung Kata biar gampang di-scale & gampang diinspeksi manual.
 */

const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'fallback');
const MAX_GROUPS_PER_FILE = 100;

if (!fs.existsSync(FALLBACK_DIR)) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
}

function getAllFallbackGroups() {
  // 1. Statis dari fallback-themes.json (bank awal yang sudah disiapkan manual)
  let statis = [];
  const statisPath = path.join(__dirname, 'fallback-themes.json');
  try {
    if (fs.existsSync(statisPath)) {
      statis = JSON.parse(fs.readFileSync(statisPath, 'utf8'));
    }
  } catch (e) {
    console.error('Gagal baca fallback-themes.json:', e.message);
  }

  // 2. Hasil AI dari fallback/bank-*.json (diisi terus oleh ai-worker.js)
  const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json'));
  let aiGroups = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (Array.isArray(data)) aiGroups = aiGroups.concat(data);
    } catch (e) {
      console.error(`Gagal baca fallback file ${file}:`, e.message);
    }
  }

  // Gabung: statis duluan biar tema yang udah disiapkan manual kebagian duluan
  return [...statis, ...aiGroups];
}

function saveFallbackGroup(group) {
  try {
    if (!group || !group.theme || !Array.isArray(group.words)) {
      console.error('⚠️ [TTS Tema] Grup invalid, skip save:', group);
      return false;
    }

    // Normalisasi tema: lowercase & trim untuk cek duplikat
    const themeKey = group.theme.trim().toLowerCase();

    const allExisting = getAllFallbackGroups();
    const dupe = allExisting.some(g => (g.theme || '').trim().toLowerCase() === themeKey);
    if (dupe) return false; // Tema ini udah ada, skip

    // Hanya simpan ke folder fallback/ (file bank-*.json) -- yang statis
    // di fallback-themes.json gak boleh ditimpa.
    const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json')).sort();
    let targetFile = 'bank-001.json';
    let targetData = [];

    if (files.length > 0) {
      const lastFile = files[files.length - 1];
      const lastData = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, lastFile), 'utf8'));
      if (lastData.length < MAX_GROUPS_PER_FILE) {
        targetFile = lastFile;
        targetData = lastData;
      } else {
        const nextNum = parseInt(lastFile.match(/\d+/)[0], 10) + 1;
        targetFile = `bank-${String(nextNum).padStart(3, '0')}.json`;
      }
    }

    targetData.push(group);
    fs.writeFileSync(path.join(FALLBACK_DIR, targetFile), JSON.stringify(targetData, null, 2), 'utf8');
    console.log(`💾 [TTS Tema] Tema AI "${group.theme}" disimpan ke fallback (${targetFile})`);
    return true;
  } catch (e) {
    console.error('⚠️ [TTS Tema] Gagal simpan grup ke fallback:', e.message);
    return false;
  }
}

// Pick tema acak yang belum dipakai. minWords: filter tema yang kata-nya cukup banyak.
function pickFallbackGroup(usedThemes = [], minWords = 0) {
  let all = getAllFallbackGroups();
  if (all.length === 0) return null;

  if (minWords > 0) {
    const eligible = all.filter(g => g.words.length >= minWords);
    if (eligible.length > 0) all = eligible;
  }

  const usedKeys = new Set(usedThemes.map(t => (t || '').trim().toLowerCase()));
  const notUsed = all.filter(g => !usedKeys.has((g.theme || '').trim().toLowerCase()));
  const pool = notUsed.length > 0 ? notUsed : all;

  return pool[Math.floor(Math.random() * pool.length)];
}

function getTotalCount() {
  return getAllFallbackGroups().length;
}

module.exports = {
  getAllFallbackGroups,
  saveFallbackGroup,
  pickFallbackGroup,
  getTotalCount
};
