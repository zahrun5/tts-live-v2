const fs = require('fs');
const path = require('path');
const glob = require('glob');

const FALLBACK_DIR = path.join(__dirname, 'fallback');

function normalizeWord(word) {
  return String(word || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function getAllEntries() {
  const files = glob.sync(path.join(FALLBACK_DIR, 'seed-*.json'));
  const all = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data)) {
        all.push(...data.map(e => ({
          word: normalizeWord(e.word),
          answers: (e.answers || []).map(r => normalizeWord(r))
        })));
      }
    } catch (e) {
      console.error('⚠️ [Bahasa Daerah] Gagal load', file, e.message);
    }
  }
  return all;
}

function getTotalCount() {
  return getAllEntries().length;
}

module.exports = {
  normalizeWord,
  getAllEntries,
  getTotalCount
};
