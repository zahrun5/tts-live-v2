/**
 * AI Theme Generator - TTS Tema
 *
 * Minta AI kasih 1 tema + daftar kata + clue VARIATIF per kata. Penting:
 * clue untuk satu ronde HARUS variatif (gak boleh semua "Buah X", gak boleh
 * "ada di dapur X" doang), sesuai aturan Mamang.
 *
 * Output: { theme, words, clues: { word: [clue1, clue2, ...] } }
 * - words : array kata (4-10 kata, panjang 3-9 huruf)
 * - clues : minimal 2 variasi clue per kata dengan angle berbeda
 *
 * Output dilempar ke word-placement.js (re-use dari sambung-kata) buat
 * naro kata ke grid menyilang. Yang simpan ke puzzle.json cuma kata yang
 * BERHASIL ditempatkan, lengkap dengan clue hasil assignCluesForRound().
 */

const fs = require('fs');
const path = require('path');
const { placeWords } = require('./word-placement');
const { normalizeGrid } = require('./grid-normalization');
const { validateTTS } = require('./validator');
const { callAI: requestAI } = require('../../ai-client');
const { saveFallbackGroup, pickFallbackGroup } = require('./fallback-manager');
const { assignCluesForRound, hasRepetitiveCategory } = require('./clue-variation');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');
const USED_THEMES_FILE = path.join(__dirname, 'used-themes.json');

const MAX_AI_ATTEMPTS = 3;
const USED_HISTORY_LIMIT = 20;
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

  // Prompt eksplisit soal clue variation -- ini aturan Mamang.
  return `Buat 1 tema SPESIFIK untuk game "TTS Tema" (semacam Family 100 versi TTS) bahasa Indonesia.

TEMA IDE:
"${themeIdea}"

SYARAT KATA:
1. Kasih ${targetWords} kata bahasa Indonesia yang sesuai tema.
2. Tiap kata cuma huruf A-Z (tanpa spasi, tanpa tanda hubung, tanpa angka).
3. Panjang tiap kata ${MIN_LEN}-${MAX_LEN} huruf.
4. Kata harus UMUM & dikenal anak SMP/SMA (bukan istilah teknis/jarang/bahasa daerah).
5. Jangan ulangi kata.
6. PENTING: kata-katanya harus BISA saling menyilang (minimal 2 huruf yang sama). Kalau semua kata gak ada huruf yang sama, game-nya gak bisa dibikin.

SYARAT CLUE (INI PENTING):
1. Setiap kata HARUS punya MINIMAL 2 clue dengan sudut pandang BERBEDA.
2. CONTOH clue untuk kata "MANGGA":
   - Sudut definisi: "Buah yang sering jadi rujak"
   - Sudut sifat: "Warnanya hijau atau kuning, bijinya berserat"
   - Sudut kegunaan: "Bisa diolah jadi jus atau manisan"
   - Sudut perumpamaan: "Manis asam menyegarkan"
3. JANGAN buat clue yang dimulai dengan kata/frasa yang sama. Misal semua clue gak boleh mulai "Buah yang..." atau "Hewan yang...". Variasi-in!
4. JANGAN sebut kategori besar secara eksplisit di clue (misal jangan "Buah..." kalau tema bisa ditebak dari clue). Pakai sifat/ciri/lokasi kegunaan.
5. Panjang clue MAKSIMAL 12 kata.${excludeList}

Jawab HANYA dalam format JSON (tanpa teks lain, tanpa markdown backticks):
{
  "theme": "tema spesifik di sini",
  "words": ["KATA1", "KATA2", ...],
  "clues": {
    "KATA1": ["clue variasi 1 untuk KATA1", "clue variasi 2 untuk KATA1"],
    "KATA2": ["clue variasi 1 untuk KATA2", "clue variasi 2 untuk KATA2"]
  }
}`;
}

async function callAIGenerator(usedThemes = []) {
  const prompt = buildPrompt(usedThemes);

  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal TTS Tema (Family 100 versi TTS) bahasa Indonesia. Selalu jawab dalam format JSON object saja, tanpa teks tambahan, tanpa markdown backticks.'
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

  // Validasi clue per kata: minimal 1 clue per kata. Kalau clue per kata
  // adalah string (bukan array), bungkus jadi array.
  const cleanedClues = {};
  if (parsed.clues && typeof parsed.clues === 'object') {
    for (const word of validWords) {
      const clue = parsed.clues[word] || parsed.clues[word.toUpperCase()] || parsed.clues[word.toLowerCase()];
      if (Array.isArray(clue)) {
        cleanedClues[word] = clue.filter(c => typeof c === 'string' && c.trim().length > 0);
      } else if (typeof clue === 'string' && clue.trim().length > 0) {
        cleanedClues[word] = [clue.trim()];
      } else {
        cleanedClues[word] = [];
      }
    }
  }

  return { theme, words: validWords, clues: cleanedClues };
}

// Bangun input untuk word-placement (pakai direction random -- kata pertama
// always across, berikutnya alternate biar visual grid-nya gak monoton).
function buildPlacementInput(words, cluesByWord) {
  // Acak urutan kata, tapi simpan index aslinya supaya clue mapping tetep bener
  const indexed = words.map((w, i) => ({ word: w, originalIndex: i }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }

  return indexed.map((entry, i) => ({
    answer: entry.word,
    direction: i % 2 === 0 ? 'across' : 'down',
    clue: '' // clue di-assign setelah placement biar gak nyangkut di placement logic
  }));
}

function writePuzzle(theme, normalized, clues, words, sourceWords) {
  // Inject clue ke hasil normalized -- clue per kata matching dengan answer
  const enrichedWords = normalized.words.map(w => ({
    ...w,
    clue: clues[w.answer] || `Salah satu ${theme.toLowerCase()}`,
    found: false
  }));

  const puzzle = {
    theme,
    rows: normalized.rows,
    cols: normalized.cols,
    words: enrichedWords,
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

        const { theme, words, clues } = await callAIGenerator(usedThemes);
        console.log(`   Tema: ${theme}, ${words.length} kata valid`);

        // Build placement input dengan direction
        const inputWords = buildPlacementInput(words, clues);
        const placementResult = placeWords(inputWords, { maxGridSize: 50 });

        if (!placementResult.success) {
          lastError = placementResult.error;
          console.warn(`⚠️  [TTS Tema] Gagal placement: ${lastError}`);
          continue;
        }

        const normalized = normalizeGrid(placementResult.placement);
        const validation = validateTTS(normalized);
        if (!validation.valid) {
          lastError = validation.reason;
          console.warn(`⚠️  [TTS Tema] Gagal validasi: ${lastError}`);
          continue;
        }

        // Assign clue variatif per kata untuk ronde ini
        const assignedClues = assignCluesForRound(words, clues, theme);

        // Cek apakah clue repetitive -- kalau iya, coba lagi (max 1 retry)
        if (hasRepetitiveCategory(assignedClues)) {
          console.log(`   ⚠️  Clue masih repetitive setelah assign, lanjut aja`);
        }

        saveUsedThemes(usedThemes, theme);
        // Simpan ke bank (gak masuk used kalau duplikat)
        saveFallbackGroup({ theme, words, clues });

        const puzzle = writePuzzle(theme, normalized, assignedClues, words, words);
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

    const inputWords = buildPlacementInput(group.words, group.clues || {});
    const placementResult = placeWords(inputWords, { maxGridSize: 50 });

    if (!placementResult.success) {
      lastError = placementResult.error;
      continue;
    }

    const normalized = normalizeGrid(placementResult.placement);
    const validation = validateTTS(normalized);
    if (!validation.valid) {
      lastError = validation.reason;
      continue;
    }

    const assignedClues = assignCluesForRound(group.words, group.clues || {}, group.theme);
    saveUsedThemes(usedThemes, group.theme);

    const puzzle = writePuzzle(group.theme, normalized, assignedClues, group.words, group.words);
    console.log(`✓ [TTS Tema] Berhasil pakai bank "${group.theme}" (${puzzle.words.length} kata)`);
    return { success: true, puzzle, source: `bank:${group.theme}` };
  }

  return { success: false, error: `Bank fallback gak ada yang cocok. Error terakhir: ${lastError}` };
}

module.exports = { generateNewRound, callAIGenerator };
