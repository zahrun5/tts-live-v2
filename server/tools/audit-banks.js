#!/usr/bin/env node
/**
 * audit-banks.js — audit & bersihkan bank soal semua game.
 *
 * Latar belakang: bank soal dibuat massal oleh Gemini tanpa pengecekan, jadi banyak
 * soal janggal ("Alat tulis yang melahirkan"), jawaban sampah ("HELIKOPTER" untuk
 * transportasi air), kalimat tak bermakna, atau jawaban yang berputar.
 *
 * Dua tahap:
 *   1. ATURAN PASTI (selalu jalan, tanpa AI): perbaiki / buang yang jelas rusak.
 *   2. JURI AI (opsional, --ai): Gemini menilai makna. Perlu gateway AI yang
 *      hanya terjangkau dari STB (lihat ai-client.js).
 *
 * AMAN: default-nya DRY-RUN (tidak mengubah file). Yang dibuang tidak dihapus
 * permanen, tapi dipindah ke games/<game>/quarantine/ lengkap dengan alasannya.
 *
 * Pemakaian (dari folder server/):
 *   node tools/audit-banks.js                       # dry-run semua game, aturan pasti
 *   node tools/audit-banks.js --game=family100      # satu/beberapa game (pisah koma)
 *   node tools/audit-banks.js --apply               # tulis hasil aturan pasti
 *   node tools/audit-banks.js --ai                  # dry-run + juri AI
 *   node tools/audit-banks.js --ai --apply          # terapkan aturan pasti + juri AI
 *   opsi lain: --batch=20 (item per panggilan AI), --root=<folder games> (untuk uji)
 *
 * Verdict AI di-cache di tools/out/ai-cache.json, jadi kalau terputus tinggal jalankan
 * ulang perintah yang sama: yang sudah dinilai tidak dipanggil lagi.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ───────────────────────── argumen ─────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ROOT = path.resolve(args.root || path.join(__dirname, '../games'));
const OUT_DIR = path.join(__dirname, 'out');
const APPLY = !!args.apply;
const USE_AI = !!args.ai;
const BATCH = Math.max(5, parseInt(args.batch, 10) || 20);
const TODAY = new Date().toISOString().slice(0, 10);

// ───────────────────────── util ─────────────────────────
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const letters = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z]/g, '');
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (hay, needle) => new RegExp('(^|[^a-z0-9])' + escRe(needle) + '([^a-z0-9]|$)', 'i').test(hay);

// ───────────────────────── aturan pasti (modul bersama) ─────────────────────────
const rules = require('./bank-rules');
const { NON_LATIN_RE } = rules;

// ───────────────────────── adapter per game ─────────────────────────
// glob      : file bank (relatif ke games/<game>/), pola sederhana "dir/*.json" atau nama file
// list      : nama field array yang bisa "diperbaiki" (buang elemen buruk), null = hanya terima/tolak
// minList   : minimal isi `list` setelah diperbaiki, kurang dari itu -> item dibuang
// key       : teks pembeda item (dedupe & tampilan)
// render    : bagaimana item ditampilkan ke juri AI
// det       : aturan pasti -> null | {drop: alasan} | {edit: itemBaru, why}
// rubric    : instruksi juri AI
const ADAPTERS = {
  family100: {
    glob: 'fallback/bank-*.json', list: 'answers', minList: 4,
    key: it => norm(it.question),
    render: it => `Pertanyaan: ${it.question} | Jawaban: ${it.answers.join(', ')}`,
    det: rules.det['family100'],
    rubric: 'Game Family 100 untuk penonton TikTok Indonesia. Pertanyaan harus jelas dan cukup spesifik supaya orang bisa menebak jawaban umum (mis. "Sebutkan hewan berkaki empat"). ' +
      'TOLAK ("reject") jika pertanyaannya terlalu umum/kabur (hampir semua kata bisa jadi jawaban) atau tidak masuk akal. ' +
      'Jika pertanyaan bagus tapi ada jawaban yang SALAH KATEGORI, sampah, bukan kata nyata, bernilai kategori itu sendiri (mis. "BURUNG" untuk "jenis burung"), atau kata yang digabung salah (mis. "PERAHUBESI"), ' +
      'kembalikan "fix" dengan daftar jawaban buruk di "bad" (tulis persis seperti di data).'
  },

  'lengkapi-kalimat': {
    glob: 'fallback/*.json', list: 'answers', minList: 1,
    key: it => norm(it.sentence),
    render: it => `Kalimat: ${it.sentence} | Jawaban benar: ${it.answers.join(' / ')}`,
    det: rules.det['lengkapi-kalimat'],
    rubric: 'Soal isian kosong bahasa Indonesia. Kalimat harus bermakna, faktual, dan hanya punya jawaban yang jelas untuk bagian kosong. ' +
      'TOLAK jika kalimat tidak bermakna, jawabannya salah/tidak pasti, berputar (menjelaskan kata dengan kata yang sama), atau terlalu banyak jawaban yang masuk akal. ' +
      'Jika hanya sebagian jawaban alternatif yang salah, "fix" dengan daftar "bad".'
  },

  'sinonim-dan-bahasa-daerah': {
    glob: 'fallback/*.json', list: 'answers', minList: 1,
    key: it => norm(it.word),
    render: it => `Kata: ${it.word} | Jawaban (sinonim/bahasa daerah): ${it.answers.join(', ')}`,
    det: rules.det['sinonim-dan-bahasa-daerah'],
    rubric: 'Soal "sebutkan sinonim / padanan bahasa daerah" untuk penonton umum Indonesia. Kata soal harus dikenal orang kebanyakan. ' +
      'TOLAK jika kata soalnya langka/arkais sehingga hampir tak ada yang tahu, atau semua jawaban salah. ' +
      'Jika sebagian jawaban SALAH (bukan sinonim/padanan sebenarnya), "fix" dengan "bad".'
  },

  'tts-tema': {
    glob: 'fallback-themes.json', list: 'words', minList: 4,
    key: it => norm(it.theme),
    render: it => `Tema: ${it.theme} | Kata: ${it.words.join(', ')}`,
    det: rules.det['tts-tema'],
    rubric: 'Tema untuk teka-teki silang (TTS) bahasa Indonesia: tema harus kategori yang bermakna dan semua kata anggota kategori itu. ' +
      'TOLAK jika temanya bukan kategori nyata (mis. hanya satu kata biasa) atau sebagian besar kata tidak cocok. ' +
      '"fix" dengan "bad" untuk kata yang bukan anggota tema atau bukan kata Indonesia yang nyata.'
  },

  'susun-kalimat': {
    glob: 'fallback/bank-*.json', list: null, minList: 0,
    key: it => norm(it.sentence),
    render: it => `Kalimat: ${it.sentence}`,
    det: rules.det['susun-kalimat'],
    rubric: 'Game "susun kalimat acak": kata-kata kalimat diacak dan penonton menyusunnya. Kalimat harus alami, bermakna, logis, dan gramatikal dalam bahasa Indonesia, ' +
      'dengan satu susunan yang jelas. TOLAK jika kalimat tak bermakna atau janggal secara logika (mis. "Siswa menusuk apotek di bukit", "Adikku mencampur di kertas"), ' +
      'tidak lengkap, atau gramatikanya rusak. Terima kalimat sederhana yang wajar.'
  },

  'cari-kata': {
    glob: 'fallback/bank-*.json', list: 'words', minList: 8,
    key: it => norm(it.theme),
    render: it => `Tema: ${it.theme} | Kata: ${it.words.join(', ')}`,
    det: rules.det['cari-kata'],
    rubric: 'Game "cari kata" (word search). Tema harus kategori nyata dan masuk akal ("Hewan yang hidup di air"). ' +
      'TOLAK jika tema absurd/bertentangan (mis. "Alat tulis yang melahirkan", "Kendaraan berat yang rasanya pedas"). ' +
      '"fix" dengan "bad" untuk kata yang bukan anggota tema.'
  }
};

// ───────────────────────── pemuatan file ─────────────────────────
function listFiles(game, pattern) {
  const dir = path.join(ROOT, game);
  if (!pattern.includes('*')) { const f = path.join(dir, pattern); return fs.existsSync(f) ? [f] : []; }
  const sub = path.dirname(pattern);
  const re = new RegExp('^' + path.basename(pattern).split('*').map(escRe).join('.*') + '$');
  const full = path.join(dir, sub);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter(f => re.test(f)).sort().map(f => path.join(full, f));
}

// ───────────────────────── juri AI ─────────────────────────
const CACHE_FILE = path.join(OUT_DIR, 'ai-cache.json');
const loadCache = () => { try { return readJson(CACHE_FILE); } catch (e) { return {}; } };
let callAI = null;

function parseFlags(content) {
  const a = content.indexOf('{'), b = content.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('bukan JSON: ' + content.slice(0, 120));
  const obj = JSON.parse(content.slice(a, b + 1));
  if (!Array.isArray(obj.flag)) throw new Error('field "flag" tidak ada');
  return obj.flag;
}

async function judgeBatch(ad, items) {
  const lines = items.map((it, i) => `${i}. ${ad.render(it)}`).join('\n');
  const prompt = `${ad.rubric}\n\nNilai SETIAP item bernomor di bawah. Hanya laporkan item yang bermasalah; item yang bagus JANGAN ditulis.\n` +
    `Jawab HANYA JSON tanpa teks lain: {"flag":[{"i":<nomor>,"v":"reject"|"fix","bad":["..."],"why":"alasan singkat"}]}\n` +
    `Kalau semua bagus: {"flag":[]}\n\nItem:\n${lines}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { content } = await callAI([
        { role: 'system', content: 'Kamu editor soal game kuis bahasa Indonesia yang teliti dan kritis. Jawab hanya JSON.' },
        { role: 'user', content: prompt }
      ], { temperature: 0.1, max_tokens: 2500, timeout: 90000, difficulty: 'easy' });
      return parseFlags(content);
    } catch (e) {
      // Kunci salah/tidak terbaca: percuma diulang, hentikan dengan pesan yang jelas.
      if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.{0,12}(api.?key|token)|authenticat/i.test(e.message)) {
        throw new Error('Gateway AI menolak permintaan (kunci tidak sah): kunci API tidak terbaca atau salah. ' +
          'Pastikan server/.env berisi OPENAI_API_KEY yang benar.');
      }
      const limited = /429|rate/i.test(e.message);
      console.warn(`   ⚠️  percobaan ${attempt}/3 gagal: ${e.message.slice(0, 140)}${limited ? ' (rate limit, tunggu 60 dtk)' : ''}`);
      await sleep(limited ? 60000 : 3000 * attempt);
    }
  }
  return null; // tidak ternilai
}

// ───────────────────────── proses satu game ─────────────────────────
async function auditGame(game) {
  const ad = ADAPTERS[game];
  const files = listFiles(game, ad.glob);
  if (!files.length) return { game, skipped: 'file bank tidak ditemukan' };

  const state = files.map(f => ({ file: f, items: readJson(f), out: [] }));
  const removed = []; // {reason, stage, source, item}
  const stats = { total: 0, edited: 0, dropped: 0, aiRejected: 0, aiFixed: 0, unjudged: 0 };
  // Tahap 1: aturan pasti + dedupe (yang dipertahankan = item dengan isi terlengkap)
  const cands = []; // {st, item, k, edited}
  for (const st of state) {
    for (const item of st.items) {
      stats.total++;
      let cur = item, edited = false;
      const r = NON_LATIN_RE.test(JSON.stringify(item)) ? { drop: 'mengandung aksara non-Latin (kemungkinan teks rusak)' } : ad.det(cur);
      if (r && r.drop) { removed.push({ reason: r.drop, stage: 'aturan', source: path.relative(ROOT, st.file), item }); stats.dropped++; continue; }
      if (r && r.edit) { cur = r.edit; edited = true; }
      if (ad.list && (cur[ad.list] || []).length < ad.minList) {
        removed.push({ reason: `isi ${ad.list} kurang dari ${ad.minList}`, stage: 'aturan', source: path.relative(ROOT, st.file), item }); stats.dropped++; continue;
      }
      cands.push({ st, item: cur, orig: item, k: ad.key(cur), edited });
    }
  }
  const richness = c => (ad.list ? (c.item[ad.list] || []).length : 0);
  const best = new Map();
  for (const c of cands) { const b = best.get(c.k); if (!b || richness(c) > richness(b)) best.set(c.k, c); }
  const survivors = []; // {st, item}
  for (const c of cands) {
    if (best.get(c.k) !== c) {
      removed.push({ reason: 'duplikat (ada versi yang lebih lengkap)', stage: 'aturan', source: path.relative(ROOT, c.st.file), item: c.orig }); stats.dropped++; continue;
    }
    if (c.edited) stats.edited++;
    survivors.push({ st: c.st, item: c.item });
  }

  // Tahap 2: juri AI
  if (USE_AI) {
    const cache = loadCache();
    const pending = [];
    for (const s of survivors) {
      const id = hash(game + '|' + JSON.stringify(s.item));
      s.id = id;
      if (!cache[id]) pending.push(s);
    }
    console.log(`   🤖 ${game}: ${survivors.length - pending.length} sudah di-cache, ${pending.length} perlu dinilai (${Math.ceil(pending.length / BATCH)} panggilan)`);
    let failStreak = 0;
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      const flags = await judgeBatch(ad, chunk.map(c => c.item));
      if (flags === null) {
        stats.unjudged += chunk.length;
        if (++failStreak >= 3) throw new Error('3 batch berturut-turut gagal total, dihentikan. Periksa gateway AI / kunci API. Yang sudah dinilai tetap tersimpan di cache, jalankan ulang untuk melanjutkan.');
        continue;
      }
      failStreak = 0;
      const byIdx = new Map(flags.filter(f => Number.isInteger(f.i) && f.i >= 0 && f.i < chunk.length).map(f => [f.i, f]));
      chunk.forEach((c, idx) => {
        const f = byIdx.get(idx);
        cache[c.id] = f ? { v: f.v === 'fix' && ad.list ? 'fix' : 'reject', bad: Array.isArray(f.bad) ? f.bad.map(String) : [], why: String(f.why || '') } : { v: 'ok' };
      });
      writeJson(CACHE_FILE, cache);
      const rate = Math.round(100 * flags.length / chunk.length);
      process.stdout.write(`\r   🤖 ${game}: ${Math.min(i + BATCH, pending.length)}/${pending.length} dinilai (batch terakhir ditandai ${rate}%)   `);
    }
    if (pending.length) process.stdout.write('\n');

    for (const s of survivors) {
      const v = cache[s.id];
      if (!v || v.v === 'ok') continue;
      if (v.v === 'fix') {
        const bad = new Set(v.bad.map(norm));
        const kept = (s.item[ad.list] || []).filter(a => !bad.has(norm(a)));
        if (kept.length >= ad.minList && kept.length < s.item[ad.list].length) {
          s.item = { ...s.item, [ad.list]: kept }; stats.aiFixed++; continue;
        }
      }
      s.dead = true; stats.aiRejected++;
      removed.push({ reason: 'juri AI: ' + (v.why || (v.v === 'fix' ? 'sisa isi terlalu sedikit' : 'ditolak')), stage: 'ai', source: path.relative(ROOT, s.st.file), item: s.item });
    }
  }

  for (const s of survivors) if (!s.dead) s.st.out.push(s.item);
  const kept = state.reduce((n, st) => n + st.out.length, 0);
  return { game, stats, kept, removed, state, ad };
}

// ───────────────────────── main ─────────────────────────
(async () => {
  const wanted = args.game ? String(args.game).split(',') : Object.keys(ADAPTERS);
  for (const g of wanted) if (!ADAPTERS[g]) { console.error(`Game tidak dikenal: ${g}. Pilihan: ${Object.keys(ADAPTERS).join(', ')}`); process.exit(1); }
  if (USE_AI) callAI = require('../ai-client').callAI;

  console.log(`\n🔎 Audit bank soal — ${APPLY ? 'MODE TERAPKAN (file akan diubah)' : 'DRY-RUN (tidak ada file yang diubah)'}${USE_AI ? ' + juri AI' : ''}\n   folder: ${ROOT}\n`);
  const results = [];
  for (const g of wanted) {
    const r = await auditGame(g);
    results.push(r);
    if (r.skipped) { console.log(`• ${g}: dilewati (${r.skipped})`); continue; }
    const s = r.stats;
    console.log(`• ${g}: ${s.total} soal → ${r.kept} tersisa | dirapikan ${s.edited} | dibuang aturan ${s.dropped}` +
      (USE_AI ? ` | AI tolak ${s.aiRejected}, AI perbaiki ${s.aiFixed}${s.unjudged ? `, belum ternilai ${s.unjudged}` : ''}` : ''));
    const byReason = {};
    r.removed.forEach(x => { const k = x.reason.replace(/".*?"/g, '"…"'); (byReason[k] = byReason[k] || []).push(x); });
    Object.entries(byReason).sort((a, b) => b[1].length - a[1].length).slice(0, 4).forEach(([k, list]) => {
      const ex = list[0].item; const sample = ex.question || ex.sentence || ex.theme || ex.word || '';
      console.log(`     - ${list.length}× ${k}   contoh: ${String(sample).slice(0, 70)}`);
    });
  }

  if (!APPLY) {
    writeJson(path.join(OUT_DIR, 'audit-report.json'), results.filter(r => !r.skipped).map(r => ({ game: r.game, stats: r.stats, kept: r.kept, removed: r.removed })));
    console.log(`\nℹ️  Dry-run selesai. Laporan lengkap: tools/out/audit-report.json\n   Tambahkan --apply untuk menulis perubahan.\n`);
    return;
  }

  for (const r of results.filter(x => !x.skipped)) {
    for (const st of r.state) writeJson(st.file, st.out);
    if (r.removed.length) {
      const qf = path.join(ROOT, r.game, 'quarantine', `${TODAY}${USE_AI ? '-ai' : ''}.json`);
      let prev = []; try { prev = readJson(qf); } catch (e) { /* baru */ }
      writeJson(qf, prev.concat(r.removed));
    }
  }
  console.log('\n✅ Selesai ditulis. Soal yang dibuang ada di games/<game>/quarantine/ (bisa dipulihkan).\n');
})().catch(e => { console.error('❌', e); process.exit(1); });
