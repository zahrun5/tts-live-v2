/**
 * AI Question Generator - Family 100
 */

const fs = require('fs');
const path = require('path');
const { callAI: requestAI } = require('../../ai-client');
const { pickFallbackQuestion, saveFallbackQuestion } = require('./fallback-manager');

const QUESTION_PATH = path.join(__dirname, 'question.json');
const USED_QUESTIONS_FILE = path.join(__dirname, 'used-questions.json');

const MAX_AI_ATTEMPTS = 1; // Kurangi attempt biar gak bikin server hang, AI worker yang urus retry
const USED_HISTORY_LIMIT = 2000;
const TOTAL_ANSWERS = 15;
const BOARD_SLOTS = 7;

function generatePoints(count) {
  const points = [];
  const max = 30;
  const min = 3;
  for (let i = 0; i < count; i++) {
    const p = Math.round(max - ((max - min) * i / (count - 1)));
    points.push(p);
  }
  return points;
}

function loadUsedQuestions() {
  try {
    if (!fs.existsSync(USED_QUESTIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_QUESTIONS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveUsedQuestions(used, newOne) {
  const merged = [...used, newOne].slice(-USED_HISTORY_LIMIT);
  fs.writeFileSync(USED_QUESTIONS_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

const QUESTION_TEMPLATES = [
  // === BUDAYA & KESENIAN ===
  'Sebutkan {seni tari daerah/nama alat musik tradisional/budaya daerah} Indonesia',
  'Sebutkan {baju adat/pakaian tradisional/tarian khas} dari Indonesia',
  'Sebutkan {festival/adat istiadat/upacara} tradisional Indonesia',
  'Sebutkan {legenda/mitos/cerita rakyat} dari Indonesia',
  'Sebutkan {lagu daerah/tarian tradisional/alat musik} dari {Jawa/Bali/Sunda}',
  'Sebutkan {seni lukis/pahat/ukir} tradisional Indonesia',
  'Sebutkan {bentuk rumah adat/nama gamelan/keris} Indonesia',
  'Sebutkan {baju pengantin/pakaian adat/senior} dari berbagai daerah',

  // === IPA & SAINS ===
  'Sebutkan {planet/satelit/benda langit} di tata surya',
  'Sebutkan {jenis矿物质/tambang/logam} yang ditemukan di Indonesia',
  'Sebutkan {gaya/fenomena alam/hukum fisika} yang kamu ketahui',
  'Sebutkan {jenis cuaca/cuaca ekstrem/fenomena alam} yang terjadi di Indonesia',
  'Sebutkan {tumbuhan berbunga/jenis bunga/tanaman obat} tradisional Indonesia',
  'Sebutkan {hewan yang berkembang biak/hewan endemik/binatang langka} di Indonesia',
  'Sebutkan {jenis sel/organ/tulang} pada tubuh manusia',
  'Sebutkan {benda yang tenggelam/benda yang melayang/hukum Archimedes} yang kamu tahu',
  'Sebutkan {jenis gaya/gaya gravitasi/fenomena fisika} yang terjadi sehari-hari',
  'Sebutkan {jenis energi/sumber energi/bentuk energi} yang digunakan sehari-hari',
  'Sebutkan {lapisan atmosfer/lapisan bumi/jenis tanah} yang kamu ketahui',
  'Sebutkan {jenis ekosistem/habitat/bioma} yang ada di dunia',
  'Sebutkan {jenis virus/bakteri/mikroorganisme} yang merugikan manusia',
  'Sebutkan {partikel/atom/molekul/senyawa} yang menyusun benda',
  'Sebutkan {fenomena optik/cahaya/warna pelangi} yang kamu amati',
  'Sebutkan {jenis gelombang/gelombang bunyi/gelombang elektromagnetik} yang kamu ketahui',
  'Sebutkan {jenis mata pilah/bola mata/penyakit mata} yang umum terjadi',
  'Sebutkan {jenis gigi/golongan darah/sistem organ} pada tubuh manusia',

  // === GEOGRAFI & TEMPAT ===
  'Sebutkan {danau/gunung/sungai} terkenal di Indonesia',
  'Sebutkan {pulau/selat/teluk} yang ada di Indonesia',
  'Sebutkan {pegunungan/lembah/kawah} terkenal di dunia',
  'Sebutkan {ibukota negara/kota besar/metropolis} di dunia',
  'Sebutkan {danau terbesar/gunung tertinggi/sungai terpanjang} di dunia',
  'Sebutkan {tempat wisata/budaya unik/benda bersejarah} yang terkenal dari {Jawa/Bali/Sumatra}',
  'Sebutkan {lautan/benua/samudra} yang mengelilingi Indonesia',
  'Sebutkan {jenis iklim/musim/perubahan cuaca} di Indonesia',
  'Sebutkan {wilayah/zona/wilayah administratif} di Indonesia',

  // === TEKNOLOGI & MODERN ===
  'Sebutkan {media sosial/aplikasi/platform digital} yang populer',
  'Sebutkan {penemuan/invensi/teknologi} yang mengubah dunia',
  'Sebutkan {jenis perangkat elektronik/benda digital/gadget} yang digunakan sehari-hari',
  'Sebutkan {bahasa pemrograman/framework/tools} dalam dunia IT',
  'Sebutkan {jenis database/protokol/jaringan} komputer yang kamu ketahui',
  'Sebutkan {jenis malware/virus/bahaya} di dunia digital',
  'Sebutkan {website/google/service} yang kamu gunakan setiap hari',
  'Sebutkan {penemu/ilmuwan/Tokoh} penting dalam sejarah teknologi',

  // === KEHIDUPAN SEHARI-HARI ===
  'Sebutkan {hewan yang jinak/hewan peliharaan/hewan yang bermanfaat} bagi manusia',
  'Sebutkan {benda di tas/benda di rumah/benda di kamar} yang kamu gunakan setiap hari',
  'Sebutkan {makanan tradisional/snack/minuman} khas Indonesia',
  'Sebutkan {benda yang terbuat dari kaca/besi/kayu/plastik}',
  'Sebutkan {alat masak/perlengkapan makan/mesin} yang ada di dapur',
  'Sebutkan {benda yang bisa didaur ulang/benda ramah lingkungan/produk hijau}',
  'Sebutkan {pekerjaan/lulusan/jenis usaha} yang banyak dibutuhkan',
  'Sebutkan {benda antik/benda masa lalu/artefak} yang menarik untuk dikumpulkan',
  'Sebutkan {jenis olahraga/bentuk latihan/gerakan} untuk menjaga kesehatan',
  'Sebutkan {benda di sekolah/alat tulis/perlengkapan} yang kamu butuhkan saat belajar',
  'Sebutkan {makanan dari tepung/nasi/lauk pauk} yang umum dimakan orang Indonesia',
  'Sebutkan {jenis penyakit/gangguan kesehatan/macam-macam virus} yang umum',
  'Sebutkan {benda yang bisa terapung/benda yang bisa meledak/benda magnetis}',
  'Sebutkan {benda langit/meteor/komet/galaksi} yang kamu ketahui',
  'Sebutkan {bentuk geometri/jenis bangun datar/bangun ruang} dalam matematika',
  'Sebutkan {jenama/raksasa/bintang/matahari} di langit malam',
  'Sebutkan {simbol pada peta/gambar pada peta/tanda di jalan} yang kamu ketahui',
  'Sebutkan {jenis pekerjaan/profesi/lulusan} yang dibutuhkan di Indonesia',
  'Sebutkan {benda transparan/benda cair/benda gas} yang kamu ketahui',
  'Sebutkan {jenis sayuran/bumbu dapur/bahan masakan} di dapur',
  'Sebutkan {benda panjang/benda pendek/benda melengkung} yang ada di sekitarmu',
  'Sebutkan {jenama api/unSur/klasifikasi} dalam tabel periodik',
  'Sebutkan {kristal/mineral/batu permata} yang terkenal di dunia',
  'Sebutkan {benda yang berputar/benda yang jatuh/benda yang meluncur} dalam fisika',
];

function getRandomQuestionIdea() {
  const template = QUESTION_TEMPLATES[Math.floor(Math.random() * QUESTION_TEMPLATES.length)];
  return template.replace(/\{([^}]+)\}/g, (match, options) => {
    const choices = options.split('/');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

function buildPrompt(usedQuestions) {
  const idea = getRandomQuestionIdea();
  const excludeList = usedQuestions.length
    ? `\n\nJANGAN pakai pertanyaan atau tema ini (sudah pernah): ${usedQuestions.join(', ')}`
    : '';

  return `Buat 1 pertanyaan MUDAH ala game "Family 100" berbahasa Indonesia yang jawabannya berupa daftar hal-hal umum/pengetahuan umum (kategori), lalu berikan 15 jawaban yang benar dan masuk akal.

INSPIRASI TEMA (Gunakan ini atau buat variasi baru yang sejenis, tetap kategori pengetahuan umum yang mudah):
"${idea}"

SYARAT MUTLAK:
1. Pertanyaan HARUS berupa permintaan menyebutkan anggota suatu kategori yang jelas dan objektif (contoh: hewan, negara, warna, buah, profesi, benda di suatu tempat). JANGAN membuat pertanyaan opini/survei subjektif (seperti "menurutmu kenapa..." atau "apa yang akan kamu lakukan jika...").
2. Kategori harus benar-benar punya minimal 15 jawaban yang valid dan umum diketahui orang Indonesia.
3. Berikan TEPAT ${TOTAL_ANSWERS} jawaban, semuanya harus BENAR secara faktual (bukan karangan/opini).
4. Urutkan jawaban dari yang PALING UMUM/PALING MUDAH terpikirkan hingga yang PALING JARANG (tapi tetap benar).
5. Tiap jawaban HARUS SATU KATA SAJA (boleh kata majemuk dengan tanda hubung seperti "KUPU-KUPU" atau "ABU-ABU"), gunakan huruf kapital. JANGAN pakai jawaban 2 kata terpisah spasi.
6. Tidak boleh ada jawaban yang maknanya sama/duplikat dalam satu soal.
7. Pertanyaan dan jawaban harus gampang ditebak anak-anak maupun orang dewasa, cocok untuk permainan santai yang cepat.${excludeList}

Jawab HANYA dalam format JSON (tanpa teks lain, tanpa markdown backticks), contoh:
{"question": "Sebutkan hewan yang hidup di darat", "answers": ["SAPI", "KAMBING", "KUDA", "GAJAH", "JERAPAH", "SINGA", "HARIMAU", "KUCING", "ANJING", "KELINCI", "RUSA", "ZEBRA", "BADAK", "KERBAU", "MONYET"]}
`;
}

// Diekspor biar AI worker bisa pakai core logic-nya
async function callAIGenerator(usedQuestions = []) {
  const prompt = buildPrompt(usedQuestions);
  
  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal game Family 100 bahasa Indonesia bergaya MUDAH (kategori pengetahuan umum, bukan survei opini). Selalu jawab dalam format JSON object saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: prompt }
  ], { temperature: 0.85, max_tokens: 600, timeout: 20000 , difficulty: 'medium' });

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON valid: ${content.slice(0, 200)}`);
  }

  const question = String(parsed.question || '').trim();
  if (!question) throw new Error('AI tidak kasih pertanyaan yang valid');

  if (!Array.isArray(parsed.answers)) {
    throw new Error('AI tidak mengembalikan array answers');
  }

  const seen = new Set();
  const validAnswers = [];
  for (const raw of parsed.answers) {
    const answer = String(raw || '').trim().toUpperCase();
    if (!answer || answer.length > 20) continue;
    const normKey = answer.replace(/[^A-Z]/g, '');
    if (seen.has(normKey)) continue;
    seen.add(normKey);
    validAnswers.push(answer);
  }

  if (validAnswers.length < TOTAL_ANSWERS) {
    throw new Error(`Jawaban valid cuma ${validAnswers.length}, butuh ${TOTAL_ANSWERS}`);
  }

  return { question, answers: validAnswers.slice(0, TOTAL_ANSWERS) };
}

function buildQuestion(question, answers) {
  const points = generatePoints(answers.length);
  const answerList = answers.map((text, i) => ({
    id: i,
    text,
    points: points[i],
    found: false,
    foundBy: null
  }));

  const state = {
    question,
    answers: answerList,
    board: Array(BOARD_SLOTS).fill(null),
    boardSlots: BOARD_SLOTS
  };

  fs.writeFileSync(QUESTION_PATH, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

// ---------- Main entrypoint untuk Game ----------

async function generateNewRound(skipAI = false) {
  const usedQuestions = loadUsedQuestions();
  let lastError = null;

  if (!skipAI) {
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
      try {
        console.log(`🤖 [Family100 Game] Percobaan AI...`);
        const { question, answers } = await callAIGenerator(usedQuestions);
        
        saveUsedQuestions(usedQuestions, question);
        saveFallbackQuestion(question, answers); // otomatis nambah bank soal
        
        const state = buildQuestion(question, answers);
        console.log(`✓ [Family100 Game] Berhasil via AI: "${question}"`);
        return { success: true, state, source: 'ai' };
      } catch (err) {
        lastError = err.message;
        console.warn(`⚠️  [Family100 Game] AI error: ${lastError}`);
      }
    }
  }

  console.log(`🔄 [Family100 Game] ${skipAI ? 'Skip AI,' : 'AI gagal,'} pakai fallback...`);

  const fallback = pickFallbackQuestion(usedQuestions);
  if (!fallback) {
    return { success: false, error: `AI gagal dan fallback kosong. Error: ${lastError}` };
  }

  saveUsedQuestions(usedQuestions, fallback.question);
  const state = buildQuestion(fallback.question, fallback.answers);
  console.log(`✓ [Family100 Game] Pakai fallback: "${fallback.question}"`);
  return { success: true, state, source: `fallback:${fallback.question}` };
}

module.exports = { 
  generateNewRound, 
  callAIGenerator, 
  BOARD_SLOTS, 
  TOTAL_ANSWERS 
};
