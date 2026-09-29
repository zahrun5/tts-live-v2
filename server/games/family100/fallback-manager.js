const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'fallback');
const MAX_QUESTIONS_PER_FILE = 100;

// Fuzzy similarity: Jaccard of word sets
function similarity(a, b) {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Cache: bank tidak berubah di runtime
let _bankCache = null;
function getAllFallbackQuestions(forceRefresh = false) {
  if (!forceRefresh && _bankCache) return _bankCache;
  const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json'));
  let allQuestions = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (Array.isArray(data)) allQuestions = allQuestions.concat(data);
    } catch (e) {
      console.error(`Gagal baca fallback file ${file}:`, e.message);
    }
  }
  _bankCache = allQuestions;
  return allQuestions;
}

function saveFallbackQuestion(question, answers) {
  try {
    const allExisting = getAllFallbackQuestions();

    // Exact duplicate check
    const exactDupe = allExisting.some(q => q.question === question);
    if (exactDupe) {
      console.log(`⏭ Skip (exact dupe): "${question.slice(0, 50)}"`);
      return false;
    }

    // Fuzzy duplicate check — skip kalau mirip > 0.5
    for (const q of allExisting) {
      const sim = similarity(question, q.question);
      if (sim > 0.5) {
        console.log(`⏭ Skip (sim=${(sim*100).toFixed(0)}%): "${question.slice(0,40)}" ~ "${q.question.slice(0,40)}"`);
        return false;
      }
    }

    // Cari file terakhir
    const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json')).sort();
    let targetFile = 'bank-001.json';
    let targetData = [];

    if (files.length > 0) {
      const lastFile = files[files.length - 1];
      const lastData = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, lastFile), 'utf8'));

      if (lastData.length < MAX_QUESTIONS_PER_FILE) {
        targetFile = lastFile;
        targetData = lastData;
      } else {
        const nextNum = parseInt(lastFile.match(/\d+/)[0], 10) + 1;
        targetFile = `bank-${String(nextNum).padStart(3, '0')}.json`;
      }
    }

    targetData.push({ question, answers });
    fs.writeFileSync(path.join(FALLBACK_DIR, targetFile), JSON.stringify(targetData, null, 2), 'utf8');
    _bankCache = null; // invalidate cache
    console.log(`💾 Soal AI disimpan ke fallback (${targetFile}, sim=0%)`);
    return true;
  } catch (e) {
    console.error('⚠️ Gagal simpan soal ke fallback:', e.message);
    return false;
  }
}

function pickFallbackQuestion(usedQuestions) {
  const all = getAllFallbackQuestions();
  if (all.length === 0) return null;

  const notUsed = all.filter(q => !usedQuestions.includes(q.question));

  if (notUsed.length > 0) {
    return notUsed[0];
  }

  // Semua udah kepakai, reset
  return all[0];
}

function getTotalCount() {
  return getAllFallbackQuestions().length;
}

function clearCache() {
  _bankCache = null;
}

module.exports = {
  getAllFallbackQuestions,
  saveFallbackQuestion,
  pickFallbackQuestion,
  getTotalCount,
  clearCache
};
