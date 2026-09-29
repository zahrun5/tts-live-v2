/**
 * AI Team - TTS-Live V2
 *
 * Multi-agent pipeline untuk generate bank soal berkualitas tinggi.
 *
 * Agents:
 *  1. Librarian     - Baca & kategorisasi seluruh bank soal
 *  2. GapAnalyst    - Identifikasi kategori yang kurang
 *  3. QuestionWriter- Generate pertanyaan berdasarkan target kategori
 *  4. DedupScout   - Cek duplikat exact + fuzzy
 *  5. QualityGrader- Validasi kualitas pertanyaan
 *  6. CategorySuggester - Suggest kategori baru yang belum ada
 *  7. Orchestrator - Koordinasi & keputusan final
 */

const { callAI } = require('./ai-client');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
// Shared: load bank data
// ─────────────────────────────────────────────

// Bank soal V2 (sudah di-clean dari duplikat)
const BANK_DIRS = {
  family100: path.join(__dirname, 'games/family100/fallback'),
  tts: path.join(__dirname, 'games/tts/fallback'),
  'susun-kata-acak': path.join(__dirname, 'games/susun-kata-acak/fallback'),
  'cari-kata': path.join(__dirname, 'games/cari-kata/fallback'),
  'sambung-kata': path.join(__dirname, 'games/sambung-kata/fallback'),
  'susun-kalimat': path.join(__dirname, 'games/susun-kalimat/fallback'),
  trivia: path.join(__dirname, 'games/trivia/fallback'),
};

function loadBank(gameName) {
  const dir = BANK_DIRS[gameName];
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  let all = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (Array.isArray(data)) all = all.concat(data);
    } catch (e) {}
  }
  return all;
}

// ─────────────────────────────────────────────
// Agent Prompts
// ─────────────────────────────────────────────

const LIBRARIAN_PROMPT = (gameName, bank) => {
  const sample = bank.slice(0, 20).map((q, i) => {
    const text = q.question || q.sentence || q.category || JSON.stringify(q).slice(0, 80);
    return `  ${i + 1}. "${text}"`;
  }).join('\n');

  return `Kamu adalah Librarian Agent. Baca bank soal game "${gameName}" berikut dan kategorisasi.

BANK (${bank.length} soal, sample 20):
${sample}

TUGAS:
1. Baca SELURUH bank yang diberikan
2. Kelompokkan berdasarkan KATEGORI UTAMA (topik tema). Contoh kategori: "budaya", "cuaca", "negara", "dapur", "kamar mandi", "teknologi", "olahraga", "sains", dll.
3. Untuk setiap kategori, hitung BRAPA PERTANYAAN yang ada
4. Identifikasi KATA KUNCI yang sering muncul di awal pertanyaan (misal: "Sebutkan X", "Apa itu X", "Nama-nama X")

OUTPUT (JSON):
{
  "total": <jumlah total bank>,
  "categories": {
    "<nama kategori>": {
      "count": <jumlah pertanyaan>,
      "examples": ["<pertanyaan 1>", "<pertanyaan 2>"],
      "keywords": ["<kata kunci 1>", "<kata kunci 2>"]
    }
  },
  "keywordPatterns": ["<pattern 1>", "<pattern 2>", ...]
}

Berikan output JSON valid saja, tidak ada text lain.`;
};

const GAP_ANALYST_PROMPT = (gameName, librarianResult, bank) => {
  return `Kamu adalah Gap Analyst Agent. Dari hasil audit bank soal "${gameName}", tentukan prioritas generasi.

AUDIT BANK (dari Librarian):
${JSON.stringify(librarianResult, null, 2)}

TUGAS:
1. Analisa kategori yang SATURATED (>10 pertanyaan): ini sudah cukup
2. Analisa kategori yang UNDERREPRESENTED (1-5 pertanyaan): ini butuh lebih
3. Analisa kategori yang ABSEN (0 pertanyaan): ini PRIORITAS TERTINGGI
4. Ambil 5 sampel pertanyaan dari bank (acak, berbeda kategori) untuk jadi "gaya penulisan"

PEDOMAN KATEGORI TERATUR:
- "Sebutkan X" → kategori mengikuti kata setelah "Sebutkan"
- "Apa itu X" → kategori = "konsep/definsi"
- "Nama-nama X" → kategori = daftar/nama

OUTPUT (JSON):
{
  "saturated": ["<kategori>", ...],
  "underrepresented": [{"category": "<nama>", "count": <jumlah>, "priority": "medium"}],
  "absent": [{"category": "<nama>", "priority": "high|critical"}],
  "topPriorities": [{"category": "<nama>", "reason": "<kenapa ini prioritas>", "count": <jumlah saat ini>}, ...],
  "writingStyleSamples": ["<contoh gaya penulisan 1>", "<contoh 2>"]
}

Berikan output JSON valid saja.`;
};

const QUESTION_WRITER_PROMPT = (gameName, gapResult, writingSamples) => {
  const targets = gapResult.topPriorities.slice(0, 3).map(p =>
    `- ${p.category} (alasan: ${p.reason}, saat ini ada ${p.count})`
  ).join('\n');

  const styles = writingSamples.map(s => `- "${s}"`).join('\n');

  return `Kamu adalah Question Writer Agent. Generate pertanyaan Family100 berkualitas tinggi.

KONTEKS:
- Target kategori yang perlu dibuat:
${targets}

- Contoh gaya penulisan yang sudah terbukti bagus di bank:
${styles}

ATURAN MUTLAK:
1. Pertanyaan HARUS dalam format "Sebutkan ..." (Family100 style)
2. Harus 15 jawaban yang benar dan masuk akal (umum/pengetahuan dasar)
3. Jawaban harus BERAGAM — tidak boleh 2 jawaban yang mirip jenisnya
4. Semua jawaban harus OBJEKTIF (bukan opini), jelas benar/salahnya
5. Kategori harus SPESIFIK — bukan umum (misal: "hewan laut" bukan "hewan", "ibu kota" bukan "negara")
6. Jawaban harus RENTANG BERAGAM — dari yang paling populer ke kurang populer (15-30 poin turun bertahap)

OUTPUT (JSON), buat 1 pertanyaan saja:
{
  "question": "<pertanyaan dalam bahasa Indonesia yang jelas>",
  "category": "<kategori utama pertanyaan>",
  "answers": [
    {"text": "<jawaban 1>", "points": 30},
    {"text": "<jawaban 2>", "points": 28},
    ... (total 15, points turun dari 30 ke minimal 5)
  ],
  "notes": "<catatan singkat: kenapa kategori ini dipilih>"
}

Berikan output JSON valid saja, tidak ada text lain.`;
};

const DEDUP_SCOUT_PROMPT = (gameName, newQuestion, bank) => {
  const samples = bank.slice(0, 50).map((q, i) => {
    const text = q.question || q.sentence || q.category || JSON.stringify(q).slice(0, 100);
    return `${i + 1}. "${text}"`;
  }).join('\n');

  return `Kamu adalah Deduplication Scout. Cek apakah pertanyaan baru DUPLIKAT atau MIRIP dengan bank yang sudah ada.

PERTANYAAN BARU:
"${newQuestion.question}"

BANK EXISTING (sample 50 dari ${bank.length}):
${samples}

TUGAS:
1. CEK EXACT MATCH: apakah pertanyaan baru PERSIS SAMA dengan yang ada di bank?
2. CEK NEAR-DUPLICATE: apakah pertanyaan baru MIRIP (similar topic, similar format) dengan yang ada?
3. CEK FUZZY: meskipun berbeda kata, apakah INTENSI-nya sama?

Dua pertanyaan MIRIP jika:
- Membahas topik yang sama (misal: "buaya" vs "reptil" = sama)
- Format yang sama + kategori yang sama (misal: "Sebutkan X di Y" vs "Sebutkan X di Z" = mungkin mirip jika Z=Y)

OUTPUT (JSON):
{
  "isExactMatch": true|false,
  "exactMatchWith": "<pertanyaan yang persis sama>" | null,
  "nearDuplicates": [
    {"text": "<pertanyaan mirip>", "similarity": "<high|medium>", "reason": "<kenapa mirip>"}
  ],
  "verdict": "ACCEPT|REJECT",
  "reason": "<penjelasan keputusan>"
}

Berikan output JSON valid saja.`;
};

const QUALITY_GRADER_PROMPT = (gameName, draftQuestion) => {
  return `Kamu adalah Quality Grader. Beri score dan feedback untuk pertanyaan Family100 ini.

PERTANYAAN:
"${draftQuestion.question}"

JAWABAN (15):
${draftQuestion.answers.map((a, i) => `${i + 1}. [${a.points}pt] ${a.text}`).join('\n')}

KRITERIA GRADING:
1. FORMAT - Apakah pertanyaan jelas dan dalam format "Sebutkan..."?
2. OBJEKTIVITAS - Apakah semua 15 jawaban OBJEKTIF, tidak ada opini?
3. VARIASI - Apakah 15 jawaban BERAGAM jenisnya, bukan 10 hal yang sama?
4. RANGE POIN - Apakah poin turun bertahap dari populer ke jarang (30→5)?
5. SPESIFISITAS - Apakah kategori pertanyaan SPESIFIK, tidak terlalu umum?

OUTPUT (JSON):
{
  "scores": {
    "format": <0-10>,
    "objectivity": <0-10>,
    "variety": <0-10>,
    "pointRange": <0-10>,
    "specificity": <0-10>
  },
  "overall": <0-100>,
  "verdict": "ACCEPT|REVISE|REJECT",
  "issues": ["<masalah 1>", "<masalah 2>", ...],
  "suggestions": ["<saran perbaikan 1>", ...]
}

Berikan output JSON valid saja.`;
};

const CATEGORY_SUGGESTER_PROMPT = (gameName, bank, gapResult) => {
  const samples = bank.slice(0, 30).map((q, i) => {
    const text = q.question || q.sentence || JSON.stringify(q).slice(0, 80);
    return `${i + 1}. "${text}"`;
  }).join('\n');

  return `Kamu adalah Category Suggester. Suggest kategori BARU yang belum ada di bank ini tapi SEHARUSNYA ADA.

GAME: "${gameName}"

BANK EXISTING (30 samples):
${samples}

KATEGORI YANG SUDAH ADA:
${JSON.stringify(Object.keys(gapResult.categories || {}), null, 2)}

KATEGORI YANG ABSEN (priority tinggi):
${(gapResult.absent || []).map(c => `- ${c.category}`).join('\n')}

TUGAS:
1. Suggest 5 kategori BARU yang belum ada di bank tapi cocok untuk game Family100
2. Setiap kategori harus: SPECIFIC, OBJEKTIF, POPULER DI INDONESIA, dan ada 10+ kemungkinan jawaban berbeda
3. Beri 3 contoh pertanyaan potensial untuk setiap kategori

OUTPUT (JSON):
{
  "suggestions": [
    {
      "category": "<nama kategori baru>",
      "why": "<kenapa kategori ini penting untuk bank ini>",
      "examples": [
        "<contoh pertanyaan 1>",
        "<contoh pertanyaan 2>",
        "<contoh pertanyaan 3>"
      ],
      "answerPotential": "<10/15/20+ jawaban yang mungkin>"
    }
  ]
}

Berikan output JSON valid saja.`;
};

// ─────────────────────────────────────────────
// Orchestrator: jalankan pipeline
// ─────────────────────────────────────────────

async function parseJSONResponse(text) {
  try {
    // Extract JSON from markdown if present
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1].trim());
    return JSON.parse(text.trim());
  } catch (e) {
    console.log('[AI-Team] JSON parse failed, trying extract:', e.message);
    // Try to find first { and last }
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1) {
      try { return JSON.parse(text.slice(first, last + 1)); } catch (e2) {}
    }
    return null;
  }
}

async function runAgent(name, prompt, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await callAI(prompt);
      const result = await parseJSONResponse(response);
      if (result) return result;
      console.log(`[AI-Team][${name}] Retry ${i + 1}: invalid JSON`);
    } catch (e) {
      console.log(`[AI-Team][${name}] Error: ${e.message}`);
    }
  }
  return null;
}

async function generateWithTeam(gameName, targetCount = 3) {
  const gameLabel = { family100: 'Family100', tts: 'TTS', trivia: 'Trivia' }[gameName] || gameName;
  console.log(`\n[AI-Team] 🚀 Starting pipeline for ${gameLabel}...`);

  // Step 1: Librarian - audit bank
  console.log(`[AI-Team] 📚 Librarian: auditing ${gameName} bank...`);
  const bank = loadBank(gameName);
  if (bank.length === 0) {
    console.log(`[AI-Team] ⚠️ Bank empty, skipping.`);
    return [];
  }
  const librarianResult = await runAgent('Librarian', LIBRARIAN_PROMPT(gameName, bank));
  if (!librarianResult) {
    console.log(`[AI-Team] ❌ Librarian failed`);
    return [];
  }
  console.log(`[AI-Team] 📚 Librarian: ${Object.keys(librarianResult.categories || {}).length} categories found`);

  // Step 2: Gap Analyst
  console.log(`[AI-Team] 🎯 Gap Analyst: analyzing gaps...`);
  const gapResult = await runAgent('GapAnalyst', GAP_ANALYST_PROMPT(gameName, librarianResult, bank));
  if (!gapResult) {
    console.log(`[AI-Team] ❌ Gap Analyst failed`);
    return [];
  }
  const priorities = (gapResult.topPriorities || []).slice(0, 3);
  console.log(`[AI-Team] 🎯 Top priorities: ${priorities.map(p => p.category).join(', ')}`);

  // Step 3: Question Writer - generate per priority
  console.log(`[AI-Team] ✍️ Question Writer: generating ${targetCount} questions...`);
  const generated = [];
  const writingSamples = (gapResult.writingStyleSamples || bank.slice(0, 3).map(q => q.question || '')).slice(0, 5);

  for (let i = 0; i < targetCount; i++) {
    const prompt = QUESTION_WRITER_PROMPT(gameName, { topPriorities: priorities }, writingSamples);
    const draft = await runAgent(`Writer-${i + 1}`, prompt);
    if (!draft || !draft.question) {
      console.log(`[AI-Team] ⚠️ Writer-${i + 1} failed, skipping`);
      continue;
    }

    // Step 4: Dedup Scout
    const dedup = await runAgent(`DedupScout-${i + 1}`, DEDUP_SCOUT_PROMPT(gameName, draft, bank));
    if (dedup && dedup.verdict === 'REJECT') {
      console.log(`[AI-Team] 🔍 DedupScout REJECTED: ${dedup.reason}`);
      continue;
    }

    // Step 5: Quality Grader
    const quality = await runAgent(`Grader-${i + 1}`, QUALITY_GRADER_PROMPT(gameName, draft));
    if (!quality || !quality.verdict) {
      console.log(`[AI-Team] ⚠️ Grader-${i + 1} failed`);
      generated.push({ draft, quality: null });
      continue;
    }

    console.log(`[AI-Team] ⭐ Quality score: ${quality.overall}/100 (${quality.verdict})`);

    if (quality.verdict === 'REJECT') {
      console.log(`[AI-Team] ❌ Quality REJECTED: ${(quality.issues || []).join(', ')}`);
      continue;
    }

    generated.push({ draft, quality });
  }

  // Step 6: Category Suggester (bonus, bisa dipakai untuk planning berikutnya)
  console.log(`[AI-Team] 💡 Category Suggester: looking for new categories...`);
  const categorySuggestions = await runAgent('CategorySuggester', CATEGORY_SUGGESTER_PROMPT(gameName, bank, gapResult));
  if (categorySuggestions && categorySuggestions.suggestions) {
    console.log(`[AI-Team] 💡 ${categorySuggestions.suggestions.length} new categories suggested`);
  }

  console.log(`[AI-Team] ✅ Pipeline complete: ${generated.length}/${targetCount} questions accepted`);
  return generated;
}

module.exports = {
  generateWithTeam,
  loadBank,
  // Expose agents for standalone use if needed
  agents: {
    LIBRARIAN_PROMPT,
    GAP_ANALYST_PROMPT,
    QUESTION_WRITER_PROMPT,
    DEDUP_SCOUT_PROMPT,
    QUALITY_GRADER_PROMPT,
    CATEGORY_SUGGESTER_PROMPT,
  }
};
