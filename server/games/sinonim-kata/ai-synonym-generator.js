/**
 * AI Synonym Generator - Sinonim Kata
 *
 * Dua tahap, keduanya lewat ai-client.js (rotasi model terpusat):
 *   1. GENERATE - minta AI bikin ±12 entri { word, synonyms } dengan tema
 *      acak (biar tiap batch beda arah) dan daftar kata yang harus dihindari.
 *   2. VERIFIKASI - panggilan kedua: AI diminta mencoret sinonim yang kurang
 *      tepat. Hasilnya cuma boleh MENGURANGI (irisan dengan hasil tahap 1),
 *      jadi AI nggak bisa menyelipkan kata baru yang belum diperiksa.
 *
 * Kalau tahap verifikasi gagal (error/timeout), batch dibuang -- soal yang
 * belum diverifikasi TIDAK PERNAH disimpan ke bank.
 *
 * Dipanggil dari ai-worker.js (background, isi bank terus sampai target).
 */

const { callAI } = require('../../ai-client');
const { getAllEntries, sanitizeEntry, normalizeWord } = require('./fallback-manager');

const BATCH_SIZE = 12;
const AVOID_SAMPLE = 60;
// Rotasi model: 'easy' | 'medium' | 'hard' (lihat ai-client.js). 'medium' cukup
// buat sinonim dan nggak nguras kuota model 'hard'.
const AI_DIFFICULTY = 'medium';

const CATEGORIES = [
  'sifat dan keadaan (mis. indah, kuat, sulit)',
  'kata kerja sehari-hari (mis. pergi, melihat, bicara)',
  'perasaan dan emosi',
  'benda dan tempat di sekitar rumah',
  'alam, cuaca, dan lingkungan',
  'bagian tubuh dan kesehatan',
  'keluarga, orang, dan pergaulan',
  'waktu, jumlah, dan ukuran',
  'makanan, minuman, dan aktivitas harian',
  'sekolah, pekerjaan, dan uang'
];

function pickRandom(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function extractJsonArray(content, label) {
  let parsed;
  try {
    const jsonMatch = String(content).match(/\[[\s\S]*\]/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(String(content).trim());
  } catch (e) {
    throw new Error(`Response AI (${label}) bukan JSON array valid: ${String(content).slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`AI (${label}) tidak mengembalikan array`);
  return parsed;
}

function buildGeneratePrompt(category, avoidWords) {
  return `Buat ${BATCH_SIZE} soal game "sinonim kata" (persamaan kata) bahasa Indonesia untuk live streaming TikTok.

Tiap soal: satu KATA SOAL dan daftar SINONIM-nya.

SYARAT:
1. Kata soal: 1 kata saja (huruf a-z, 3-12 huruf), umum dan dikenal penonton awam, tingkat MUDAH.
2. Sinonim: 3 sampai 6 kata per soal. Tiap sinonim 1 kata saja (huruf kecil a-z, tanpa spasi/tanda hubung/angka).
3. Sinonim harus benar-benar sepadan makna dan jenis katanya dengan kata soal. Boleh kata baku maupun kata yang lazim dipakai sehari-hari. Jangan masukkan kata yang cuma berhubungan/berlawanan makna.
4. Jangan pakai kata turunan berimbuhan dari kata soal sebagai sinonim (mis. makan -> memakan).
5. Jangan pakai kata kasar, makian, SARA, atau konten dewasa.
6. Kata soal dan sinonimnya tidak boleh muncul di soal lain dalam daftar yang sama.
7. Fokus tema: ${category}.
8. JANGAN pakai kata soal berikut (sudah ada): ${avoidWords.length ? avoidWords.join(', ') : '(belum ada)'}.

Jawab HANYA dalam format JSON array (tanpa teks lain, tanpa markdown backticks), contoh:
[{"word":"indah","synonyms":["cantik","elok","molek","permai"]},{"word":"takut","synonyms":["gentar","ngeri","jeri","kecut"]}]`;
}

function buildVerifyPrompt(entries) {
  return `Periksa daftar soal "sinonim kata" bahasa Indonesia berikut. Tugasmu: CORET sinonim yang kurang tepat.

Sebuah sinonim dipertahankan HANYA kalau memenuhi semua ini:
- maknanya sepadan dengan kata soal (bukan sekadar berhubungan atau berlawanan),
- jenis katanya sama dengan kata soal,
- benar-benar kata bahasa Indonesia (baku atau lazim dipakai sehari-hari).

Aturan: JANGAN menambah kata baru dan JANGAN mengubah ejaan. Kalau ragu, coret. Kalau suatu soal tersisa kurang dari 3 sinonim, hapus seluruh soalnya.

Daftar soal:
${JSON.stringify(entries)}

Jawab HANYA dengan JSON array dalam format yang sama (tanpa teks lain, tanpa markdown backticks), berisi soal yang lolos beserta sinonim yang dipertahankan.`;
}

// Hasil verifikasi cuma boleh mengurangi: sinonim yang lolos harus ada di
// entri asal tahap 1. Entri yang sisa < 3 sinonim dibuang oleh sanitizeEntry.
function applyVerification(original, verifiedRaw) {
  const byWord = new Map(original.map(e => [e.word, e]));
  const out = [];
  const seen = new Set();

  for (const raw of verifiedRaw) {
    const word = normalizeWord(raw && raw.word);
    const src = byWord.get(word);
    if (!src || seen.has(word)) continue;

    const allowed = new Set(src.synonyms);
    const kept = (Array.isArray(raw.synonyms) ? raw.synonyms : [])
      .map(s => normalizeWord(s))
      .filter(s => allowed.has(s));

    const entry = sanitizeEntry({ word, synonyms: kept });
    if (entry) {
      seen.add(word);
      out.push(entry);
    }
  }
  return out;
}

/**
 * @returns {Promise<Array<{word: string, synonyms: string[]}>>}
 *   entri yang sudah lolos validasi lokal + verifikasi AI (bisa kosong).
 * @throws kalau panggilan AI (generate/verifikasi) gagal total.
 */
async function callAIGenerator() {
  const existing = new Set(getAllEntries().map(e => e.word));
  const avoid = pickRandom([...existing], AVOID_SAMPLE);
  const category = pickRandom(CATEGORIES, 1)[0];

  // ----- Tahap 1: generate -----
  const gen = await callAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal game sinonim kata bahasa Indonesia. Selalu jawab dalam format JSON array saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: buildGeneratePrompt(category, avoid) }
  ], { temperature: 0.8, max_tokens: 1500, timeout: 30000, difficulty: AI_DIFFICULTY });

  const candidates = [];
  const seenWords = new Set();
  const usedAnywhere = new Set(); // kata soal & sinonim yang sudah dipakai di batch ini
  for (const raw of extractJsonArray(gen.content, 'generate')) {
    const entry = sanitizeEntry(raw);
    if (!entry || existing.has(entry.word) || seenWords.has(entry.word)) continue;
    // satu batch nggak boleh punya kata yang sama di dua soal (kurangi bentrok antar soal)
    const accepted = [entry.word, ...entry.synonyms];
    if (accepted.some(w => usedAnywhere.has(w))) continue;
    accepted.forEach(w => usedAnywhere.add(w));
    seenWords.add(entry.word);
    candidates.push(entry);
  }

  if (candidates.length === 0) return [];

  // ----- Tahap 2: verifikasi -----
  const ver = await callAI([
    {
      role: 'system',
      content: 'Kamu adalah penyunting kamus bahasa Indonesia yang teliti. Selalu jawab dalam format JSON array saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: buildVerifyPrompt(candidates) }
  ], { temperature: 0.1, max_tokens: 1500, timeout: 30000, difficulty: AI_DIFFICULTY });

  return applyVerification(candidates, extractJsonArray(ver.content, 'verifikasi'));
}

module.exports = { callAIGenerator, applyVerification };
