/**
 * Background AI Worker - Sinonim Kata
 *
 * Jalan terus di background (di-manage PM2). Pastikan bank soal cukup besar
 * (target 400 soal). Tiap siklus: generate -> verifikasi -> simpan sebagai
 * SATU file batch baru (fallback/batch-<timestamp>.json, nggak pernah diedit
 * lagi). Kena rate limit / timeout: pause 5 menit.
 *
 * Jalankan dari folder server/ (ai-client.js baca .env dari cwd):
 *   pm2 start games/sinonim-kata/ai-worker.js --name sinonim-kata-worker
 *   pm2 save
 */

const { callAIGenerator } = require('./ai-synonym-generator');
const { saveBatch, getTotalCount } = require('./fallback-manager');

const TARGET_BANK_SIZE = 400;
const SUCCESS_DELAY_MS = 2000;
const RETRY_DELAY_MS = 10000;
const RATE_LIMIT_DELAY_MS = 300000;
const FULL_BANK_DELAY_MS = 60 * 60 * 1000;
const EMPTY_STREAK_LIMIT = 5;          // berturut-turut 0 soal tersimpan
const EMPTY_STREAK_DELAY_MS = 600000;  // lalu istirahat 10 menit

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWorker() {
  console.log('👷 [AI Worker] Memulai Sinonim Kata background worker...');
  let emptyStreak = 0;

  while (true) {
    const currentCount = getTotalCount();

    if (currentCount >= TARGET_BANK_SIZE) {
      console.log(`👷 [AI Worker] Bank soal penuh (${currentCount}/${TARGET_BANK_SIZE}). Tidur 1 jam...`);
      await sleep(FULL_BANK_DELAY_MS);
      continue;
    }

    console.log(`👷 [AI Worker] Bank soal kurang (${currentCount}/${TARGET_BANK_SIZE}). Memanggil AI...`);

    try {
      const entries = await callAIGenerator();
      const saved = saveBatch(entries);
      console.log(`✅ [AI Worker] ${saved}/${entries.length} soal lolos & disimpan. Bank sekarang: ${getTotalCount()}`);

      if (saved === 0) {
        emptyStreak++;
        if (emptyStreak >= EMPTY_STREAK_LIMIT) {
          console.log(`⏳ [AI Worker] ${emptyStreak}x berturut-turut tidak ada soal baru. Istirahat 10 menit...`);
          emptyStreak = 0;
          await sleep(EMPTY_STREAK_DELAY_MS);
          continue;
        }
      } else {
        emptyStreak = 0;
      }

      await sleep(SUCCESS_DELAY_MS);

    } catch (err) {
      const errMsg = err.message || '';
      console.error(`❌ [AI Worker] Gagal: ${errMsg}`);

      if (errMsg.includes('429') || errMsg.includes('Rate limit') || errMsg.includes('timeout')) {
        console.log('⏳ [AI Worker] Terdeteksi rate limit / timeout. Istirahat 5 menit...');
        await sleep(RATE_LIMIT_DELAY_MS);
      } else {
        console.log('⏳ [AI Worker] Error lain. Coba lagi dalam 10 detik...');
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
}

runWorker().catch(e => console.error('Worker crash:', e));
