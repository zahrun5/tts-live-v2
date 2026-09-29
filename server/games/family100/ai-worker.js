/**
 * Background AI Worker - Family 100
 *
 * Worker ini jalan terus di background (di-manage PM2).
 * Pakai AI Team pipeline untuk generate bank soal berkualitas tinggi:
 *   Librarian → Gap Analyst → Question Writer → Dedup Scout → Quality Grader
 *
 * AI Team memutuskan apa yang perlu dibuat, bukan asal generate random.
 * Target: 1000+ pertanyaan Family100 yang bervariasi dan tidak duplikat.
 */

const { generateWithTeam, loadBank } = require('../../ai-team');
const { saveFallbackQuestion, getTotalCount, clearCache } = require('./fallback-manager');

const TARGET_BANK_SIZE = 1000;
const BATCH_SIZE = 3;           // Generate 3 pertanyaan per pipeline run
const PIPELINE_DELAY_MS = 5000;  // Jeda antar pipeline run
const RATE_LIMIT_DELAY_MS = 300000; // 5 menit kalau rate limit
const ERROR_DELAY_MS = 15000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWorker() {
  console.log('👷 [AI Worker] Memulai Family 100 AI Team worker...');
  console.log('👷 Target: ' + TARGET_BANK_SIZE + ' pertanyaan berkualitas di bank');

  while (true) {
    const currentCount = getTotalCount();

    if (currentCount >= TARGET_BANK_SIZE) {
      console.log(`👷 [AI Worker] ✅ Bank soal sudah cukup (${currentCount}/${TARGET_BANK_SIZE}). Tidur 1 jam...`);
      await sleep(60 * 60 * 1000);
      continue;
    }

    console.log(`👷 [AI Worker] Bank kurang (${currentCount}/${TARGET_BANK_SIZE}). Jalankan AI Team pipeline...`);

    try {
      // Jalankan AI Team pipeline
      // generateWithTeam akan:
      // 1. Librarian: audit bank → kategori apa saja yang ada
      // 2. Gap Analyst: analisis gaps → kategori apa yang kurang
      // 3. Question Writer: generate 3 pertanyaan untuk kategori prioritas
      // 4. Dedup Scout: cek duplikat sebelum save
      // 5. Quality Grader: validasi kualitas sebelum save
      // 6. Category Suggester: suggest kategori baru
      const results = await generateWithTeam('family100', BATCH_SIZE);

      let saved = 0;
      for (const result of results) {
        if (!result.draft || !result.draft.question) continue;

        // Quality filter: minimal 60/100 untuk disimpan
        if (result.quality && result.quality.overall < 60) {
          console.log(`👷 [AI Worker] ⏭ Skip (quality ${result.quality.overall}/100 < 60): "${result.draft.question.slice(0, 50)}"`);
          continue;
        }

        const { question, answers } = result.draft;

        // Normalize answers format for fallback-manager
        const normalizedAnswers = answers.map((a, i) =>
          typeof a === 'string' ? a : a.text
        );

        const didSave = saveFallbackQuestion(question, normalizedAnswers);
        if (didSave) {
          saved++;
          clearCache(); // invalidate gameProxy cache
        }
      }

      const newCount = getTotalCount();
      console.log(`👷 [AI Worker] Pipeline selesai: ${saved}/${results.length} disimpan. Bank: ${currentCount} → ${newCount}`);

      // Kalau 0 berhasil disimpan (mungkin semua dupes/quality rendah), tunggu lebih lama
      if (saved === 0) {
        console.log(`👷 [AI Worker] ⚠️ Tidak ada yang berhasil. Tunggu 30 detik...`);
        await sleep(30000);
      } else {
        await sleep(PIPELINE_DELAY_MS);
      }

    } catch (err) {
      const errMsg = err.message || '';
      console.error(`❌ [AI Worker] Pipeline error: ${errMsg}`);

      if (errMsg.includes('429') || errMsg.includes('Rate limit')) {
        console.log(`⏳ [AI Worker] Rate limit terdeteksi. Istirahat 5 menit...`);
        await sleep(RATE_LIMIT_DELAY_MS);
      } else {
        await sleep(ERROR_DELAY_MS);
      }
    }
  }
}

runWorker().catch(e => console.error('❌ [AI Worker] Crash:', e.message));
