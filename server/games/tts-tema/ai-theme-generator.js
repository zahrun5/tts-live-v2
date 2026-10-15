/**
 * AI Theme Generator - TTS Tema
 *
 * Format game: SATU pertanyaan per ronde (gaya Family 100), contoh
 * "Sebutkan nama buah-buahan". Jawabannya banyak kata yang saling menyilang di
 * grid. TIDAK ada clue per kata -- penonton cukup menebak kata apa pun yang
 * cocok dengan pertanyaan itu.
 *
 * Output AI: { theme, words }
 * - theme : lanjutan kalimat "Sebutkan ..." (mis. "nama buah-buahan")
 * - words : array kata (4-8 kata, panjang 3-9 huruf)
 *
 * Kata dilempar ke word-placement.js (re-use dari sambung-kata) buat ditaruh
 * ke grid menyilang. Yang disimpan ke puzzle.json cuma kata yang BERHASIL
 * ditempatkan.
 */

const fs = require('fs');
const path = require('path');
const { placeWords } = require('./word-placement');
const { normalizeGrid } = require('./grid-normalization');
const { validateTTS } = require('./validator');
const { callAI: requestAI } = require('../../ai-client');
const { saveFallbackGroup, pickFallbackGroup } = require('./fallback-manager');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');
const USED_THEMES_FILE = path.join(__dirname, 'used-themes.json');

const MAX_AI_ATTEMPTS = 3;
const USED_HISTORY_LIMIT = 40; // jangan ulang tema dalam 40 ronde terakhir (bank sudah cukup besar)
const MIN_WORDS = 4;
const MAX_WORDS = 8;
const MIN_LEN = 3;
const MAX_LEN = 9;

// Template tema dinamis (sama style-nya kayak Cari Kata tapi ditambah beberapa
// angle supaya TTS Tema gak monoton).
const THEME_TEMPLATES = [
  // Kategori spesifik
  'Hewan yang hidup di {air/darat/udara/kebun}',
  'Buah berwarna {merah/kuning/hijau/ungu}',
  'Profesi yang bekerja di {rumah sakit/sekolah/kantor/lapangan/pabrik}',
  'Kendaraan {darat/air/udara/umum}',
  'Makanan yang {manis/asin/pedas/asam/gurih}',
  'Alat yang dipakai di {dapur/kamar mandi/taman/garasi/kantor}',
  'Benda yang terbuat dari {kayu/plastik/logam/kaca/kain}',
  'Olahraga menggunakan {bola/raket/air/tangan}',
  'Pakaian untuk {pesta/olahraga/tidur/kerja/sekolah}',
  'Tanaman {bunga/sayur/buah/hias/obat}',

  // Kombinasi huruf
  'Hewan yang namanya diawali huruf {A/B/K/M/S/G}',
  'Nama kota di Indonesia huruf depan {B/J/S/M/P/Y}',
  'Buah yang namanya ada huruf {N/G/M/R/L}',
  'Profesi yang berakhiran huruf {R/N/I/S/A}',

  // Kombinasi jumlah
  'Benda yang punya {roda/kaki/sayap/tangkai}',
  'Hewan berkaki {dua/empat/banyak/tidak berkaki}',
  'Buah yang punya {biji/kulit tebal/kulit tipis/duri}',

  // Lokasi spesifik
  'Benda yang ada di {kamar tidur/dapur/ruang tamu/kamar mandi/kantor/sekolah}',
  'Hewan yang hidup di {hutan/laut/sungai/sawah/kebun/rumah}',
  'Tanaman yang tumbuh di {air/gunung/pantai/dataran rendah/pekarangan}',

  // Ukuran & bentuk
  'Benda {kecil/besar/sedang} yang sering dipakai sehari-hari',
  'Hewan {besar/kecil} yang jinak',
  'Buah berukuran {besar/kecil/sedang}',

  // Waktu & musim
  'Makanan untuk {sarapan/makan siang/camilan/makan malam}',
  'Kegiatan yang dilakukan {pagi/siang/malam} hari',
  'Hewan yang aktif di {siang/malam/sore}',

  // Fungsi spesifik
  'Alat untuk {memotong/memasak/membersihkan/menulis/mencuci}',
  'Benda untuk {menyimpan/mengangkut/melindungi/menghias}',
  'Pakaian untuk melindungi {kepala/tangan/kaki/badan/mata}',

  // Sudut unik (biar variasi tema gak ngulang)
  'Suara/bunyi yang sering kita dengar di {rumah/pasar/sekolah/jalan}',
  'Benda yang sering diberi warna {merah/biru/kuning/hijau}',
  'Aroma yang keluar dari {dapur/taman/pasar/kamar mandi}',
  'Gerakan tubuh saat {berlari/berjalan/bermain/bersantai}',
  'Bagian tubuh yang sering dilindungi {topi/masker/sarung tangan/sepatu}',
];

function getRandomThemeIdea() {
  const template = THEME_TEMPLATES[Math.floor(Math.random() * THEME_TEMPLATES.length)];
  return template.replace(/\{([^}]+)\}/g, (match, options) => {
    const choices = options.split('/');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

function buildPrompt(usedThemes = []) {
  const targetWords = MIN_WORDS + Math.floor(Math.random() * (MAX_WORDS - MIN_WORDS + 1));
  const themeIdea = getRandomThemeIdea();

  const excludeList = usedThemes.length
    ? `\n\nJANGAN pakai tema ini (udah pernah dipakai): ${usedThemes.join(', ')}`
    : '';

  return `Buat 1 soal untuk game "TTS Tema" bahasa Indonesia. Formatnya seperti Family 100: SATU pertanyaan, jawabannya banyak kata.

TEMA IDE:
"${themeIdea}"

CONTOH SOAL YANG BENAR:
Pertanyaan: "Sebutkan nama buah-buahan" -> jawaban: MANGGA, JERUK, APEL, NANAS, PISANG
Pertanyaan: "Sebutkan hewan peliharaan" -> jawaban: KUCING, ANJING, IKAN, BURUNG

SYARAT:
1. Tulis "theme" = lanjutan kalimat "Sebutkan ..." tanpa kata "Sebutkan" (contoh: "nama buah-buahan", "hewan peliharaan", "alat dapur"). Maksimal 6 kata.
2. Kasih ${targetWords} kata jawaban bahasa Indonesia yang cocok dengan pertanyaan itu.
3. Tiap kata cuma huruf A-Z (tanpa spasi, tanpa tanda hubung, tanpa angka).
4. Panjang tiap kata ${MIN_LEN}-${MAX_LEN} huruf.
5. Kata harus UMUM & dikenal anak SMP/SMA (bukan istilah teknis/jarang/bahasa daerah).
6. Jangan ulangi kata.
7. Semua kata harus benar-benar jawaban yang masuk akal untuk pertanyaan itu.
8. Kata-katanya harus BISA saling menyilang (minimal ada huruf yang sama antar kata).
9. JANGAN bikin clue / petunjuk per kata. Cukup pertanyaan + daftar kata.${excludeList}

Jawab HANYA dalam format JSON (tanpa teks lain, tanpa markdown backticks):
{
  "theme": "nama buah-buahan",
  "words": ["MANGGA", "JERUK", "APEL"]
}`;
}

async function callAIGenerator(usedThemes = []) {
  const prompt = buildPrompt(usedThemes);

  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal TTS Tema (satu pertanyaan, banyak jawaban, gaya Family 100) bahasa Indonesia. Selalu jawab dalam format JSON object saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: prompt }
  ], { temperature: 0.9, max_tokens: 1500, timeout: 30000, difficulty: 'easy' });

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON valid: ${content.slice(0, 200)}`);
  }

  const theme = String(parsed.theme || '').trim();
  if (!theme) throw new Error('AI tidak kasih tema yang valid');

  if (!Array.isArray(parsed.words)) {
    throw new Error('AI tidak mengembalikan array words');
  }

  // Validasi KETAT server-side
  const seen = new Set();
  const validWords = [];
  for (const raw of parsed.words) {
    const word = String(raw || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (word.length < MIN_LEN || word.length > MAX_LEN) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    validWords.push(word);
  }

  if (validWords.length < MIN_WORDS) {
    throw new Error(`Kata valid cuma ${validWords.length}, minimal ${MIN_WORDS}`);
  }

  return { theme, words: validWords };
}

// Bangun input untuk word-placement (pakai direction random -- kata pertama
// always across, berikutnya alternate biar visual grid-nya gak monoton).
function buildPlacementInput(words) {
  const shuffled = [...words];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((word, i) => ({
    answer: word,
    direction: i % 2 === 0 ? 'across' : 'down'
  }));
}

// Coba beberapa susunan acak lalu pilih grid yang paling "gemuk" (kotak terbesar di
// layar HP). Grid yang melebar ke samping (mis. 19x7) bikin kotak kecil. Skor memakai
// area acuan 9x12 dan boleh diputar 90 derajat (overlay sendiri memutar sesuai layar).
const PLACEMENT_TRIES = 20;
const REF_W = 9, REF_H = 12;

function gridScore(rows, cols) {
  return Math.max(
    Math.min(REF_W / cols, REF_H / rows),
    Math.min(REF_W / rows, REF_H / cols)
  );
}

function placeBest(words) {
  let best = null;
  let lastError = null;
  for (let i = 0; i < PLACEMENT_TRIES; i++) {
    const placementResult = placeWords(buildPlacementInput(words), { maxGridSize: 50 });
    if (!placementResult.success) { lastError = placementResult.error; continue; }
    const normalized = normalizeGrid(placementResult.placement);
    const validation = validateTTS(normalized);
    if (!validation.valid) { lastError = validation.reason; continue; }
    const score = gridScore(normalized.rows, normalized.cols);
    if (!best || score > best.score) best = { normalized, score };
  }
  return best ? { success: true, normalized: best.normalized } : { success: false, error: lastError };
}

function writePuzzle(theme, normalized, sourceWords) {
  const words = normalized.words.map(w => {
    const { clue, ...rest } = w; // pastikan tidak ada clue yang ikut
    return { ...rest, found: false };
  });

  const puzzle = {
    theme,
    rows: normalized.rows,
    cols: normalized.cols,
    words,
    sourceWords, // untuk validasi jawaban (supaya konsisten dengan input)
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(PUZZLE_PATH, JSON.stringify(puzzle, null, 2), 'utf8');
  return puzzle;
}

// ---------- Riwayat tema (biar gak keulang) ----------

function loadUsedThemes() {
  try {
    if (!fs.existsSync(USED_THEMES_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_THEMES_FILE, 'utf8'));
  } catch (e) {
    console.error('Gagal baca used-themes.json, mulai dari kosong:', e.message);
    return [];
  }
}

function saveUsedThemes(used, newOne) {
  const merged = [...used, newOne].slice(-USED_HISTORY_LIMIT);
  fs.writeFileSync(USED_THEMES_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

// ---------- Main entrypoint ----------

async function generateNewRound(skipAI = false) {
  const usedThemes = loadUsedThemes();
  let lastError = null;

  if (!skipAI) {
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
      try {
        console.log(`🤖 [TTS Tema] Percobaan ${attempt}/${MAX_AI_ATTEMPTS}...`);

        const { theme, words } = await callAIGenerator(usedThemes);
        console.log(`   Tema: ${theme}, ${words.length} kata valid`);

        const placed = placeBest(words);
        if (!placed.success) {
          lastError = placed.error;
          console.warn(`⚠️  [TTS Tema] Gagal placement/validasi: ${lastError}`);
          continue;
        }
        const normalized = placed.normalized;

        saveUsedThemes(usedThemes, theme);
        // Simpan ke bank (gak masuk used kalau duplikat)
        saveFallbackGroup({ theme, words });

        const puzzle = writePuzzle(theme, normalized, words);
        console.log(`✓ [TTS Tema] Berhasil (tema: ${theme}, ${puzzle.words.length} kata di grid ${normalized.rows}x${normalized.cols})`);
        return { success: true, puzzle, source: 'ai' };
      } catch (err) {
        lastError = err.message;
        console.warn(`⚠️  [TTS Tema] Percobaan ${attempt} error: ${lastError}`);
      }
    }
    console.log('🔄 [TTS Tema] Semua percobaan AI gagal, pakai bank fallback...');
  } else {
    console.log('⚡ [TTS Tema] Skip AI, langsung pakai bank fallback...');
  }

  // Fallback path
  const MAX_BANK_ATTEMPTS = 5;
  for (let i = 0; i < MAX_BANK_ATTEMPTS; i++) {
    const group = pickFallbackGroup(usedThemes, MIN_WORDS);
    if (!group) break;

    const placed = placeBest(group.words);
    if (!placed.success) {
      lastError = placed.error;
      continue;
    }
    const normalized = placed.normalized;

    saveUsedThemes(usedThemes, group.theme);

    const puzzle = writePuzzle(group.theme, normalized, group.words);
    console.log(`✓ [TTS Tema] Berhasil pakai bank "${group.theme}" (${puzzle.words.length} kata)`);
    return { success: true, puzzle, source: `bank:${group.theme}` };
  }

  return { success: false, error: `Bank fallback gak ada yang cocok. Error terakhir: ${lastError}` };
}

module.exports = { generateNewRound, callAIGenerator };
