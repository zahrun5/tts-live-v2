const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'fallback');
const BLANK = '____';

function normalizeWord(word) {
  return String(word || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// Posisi kata kosong di kalimat: 'awal' | 'tengah' | 'akhir'
function blankPosition(sentence) {
  const idx = sentence.indexOf(BLANK);
  const before = sentence.slice(0, idx).trim();
  const after = sentence.slice(idx + BLANK.length).replace(/[\s.,!?;:"')\]]+/g, '');
  if (!before) return 'awal';
  if (!after) return 'akhir';
  return 'tengah';
}

// Semua kata yang tampil di kalimat (tanpa kata kosongnya), huruf besar.
function tokenize(sentence) {
  const words = sentence.replace(BLANK, ' ').toUpperCase().match(/[A-Z]+/g) || [];
  return new Set(words);
}

function buildEntry(raw) {
  const sentence = String(raw.sentence || '').replace(/_{3,}/g, BLANK).replace(/\s+/g, ' ').trim();
  const answers = (raw.answers || []).map(a => String(a).trim()).filter(Boolean);
  // Wajib tepat 1 kata kosong dan minimal 1 jawaban
  if (sentence.split(BLANK).length !== 2 || answers.length === 0) return null;
  return {
    key: normalizeWord(sentence),
    sentence,
    answers,                          // bentuk tampil (answers[0] = utama)
    norms: answers.map(normalizeWord), // bentuk pembanding
    pos: blankPosition(sentence),
    tokens: tokenize(sentence)
  };
}

function getAllEntries() {
  let files = [];
  try {
    files = fs.readdirSync(FALLBACK_DIR).filter(f => /^seed-.*\.json$/.test(f)).sort();
  } catch (e) {
    console.error('⚠️ [Lengkapi Kalimat] Folder fallback tidak terbaca:', e.message);
    return [];
  }
  const all = [];
  const seen = new Set();
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (!Array.isArray(data)) continue;
      for (const raw of data) {
        const entry = buildEntry(raw);
        if (!entry || seen.has(entry.key)) continue;
        seen.add(entry.key);
        all.push(entry);
      }
    } catch (e) {
      console.error('⚠️ [Lengkapi Kalimat] Gagal load', file, e.message);
    }
  }
  return all;
}

function getTotalCount() {
  return getAllEntries().length;
}

module.exports = { BLANK, normalizeWord, getAllEntries, getTotalCount };
