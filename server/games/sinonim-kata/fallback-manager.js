/**
 * Fallback Manager - Sinonim Kata
 *
 * Bank soal disimpan sebagai banyak file kecil di fallback/*.json.
 * Isi tiap file: array of { word, synonyms: [..] }, contoh:
 *   { "word": "indah", "synonyms": ["cantik", "elok", "molek", "permai"] }
 *
 * - seed-001.json  = bank awal (ditulis manual).
 * - batch-<timestamp>.json = hasil AI worker nanti. SATU batch = SATU file
 *   baru yang tidak pernah diedit lagi (syncTemplate di room.js cuma
 *   menyalin file non-.js yang BELUM ada di folder room user, jadi file
 *   yang terus ditambah isinya nggak akan pernah sampai ke room yang
 *   sudah punya file itu).
 */

const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'fallback');
const MIN_SYNONYMS = 3;
const MAX_SYNONYMS = 8;

if (!fs.existsSync(FALLBACK_DIR)) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
}

// Huruf kecil a-z saja, tanpa spasi/tanda hubung.
function normalizeWord(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

function isSingleWord(s) {
  return /^[a-z]+$/.test(String(s || '').trim().toLowerCase());
}

// Validasi + bersihkan satu entri. Return null kalau nggak layak dipakai.
function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isSingleWord(raw.word)) return null;

  const word = normalizeWord(raw.word);
  if (word.length < 3 || word.length > 12) return null;

  const seen = new Set([word]);
  const synonyms = [];
  for (const s of Array.isArray(raw.synonyms) ? raw.synonyms : []) {
    if (!isSingleWord(s)) continue;
    const n = normalizeWord(s);
    if (n.length < 2 || n.length > 15 || seen.has(n)) continue;
    seen.add(n);
    synonyms.push(n);
  }

  if (synonyms.length < MIN_SYNONYMS) return null;
  return { word, synonyms: synonyms.slice(0, MAX_SYNONYMS) };
}

// Semua entri valid dari semua file bank, tanpa duplikat kata soal.
function getAllEntries() {
  const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json')).sort();
  const byWord = new Map();

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (!Array.isArray(data)) continue;
      for (const raw of data) {
        const entry = sanitizeEntry(raw);
        if (entry && !byWord.has(entry.word)) byWord.set(entry.word, entry);
      }
    } catch (e) {
      console.error(`Gagal baca fallback file ${file}:`, e.message);
    }
  }

  return [...byWord.values()];
}

// Dipakai AI worker nanti: simpan satu batch sebagai SATU file baru.
// Return jumlah entri yang benar-benar tersimpan (yang belum ada di bank).
function saveBatch(entries) {
  try {
    const existing = new Set(getAllEntries().map(e => e.word));
    const fresh = [];
    for (const raw of entries || []) {
      const entry = sanitizeEntry(raw);
      if (entry && !existing.has(entry.word)) {
        existing.add(entry.word);
        fresh.push(entry);
      }
    }
    if (fresh.length === 0) return 0;

    const file = `batch-${Date.now()}.json`;
    fs.writeFileSync(path.join(FALLBACK_DIR, file), JSON.stringify(fresh, null, 2), 'utf8');
    console.log(`💾 [Sinonim Kata] ${fresh.length} soal baru disimpan (${file})`);
    return fresh.length;
  } catch (e) {
    console.error('⚠️ Gagal simpan batch Sinonim Kata:', e.message);
    return 0;
  }
}

function getTotalCount() {
  return getAllEntries().length;
}

module.exports = { normalizeWord, sanitizeEntry, getAllEntries, saveBatch, getTotalCount };
