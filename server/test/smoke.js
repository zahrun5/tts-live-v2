// Smoke test tanpa MongoDB/TikTok: `npm test` di folder server.
// Model User & mongoose.connect di-stub; sisanya jalan beneran
// (Express, Socket.IO, Room, modul game V1).
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ttslive-test-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '3199';
const BASE = 'http://127.0.0.1:3199';
const ALL = ['tts', 'family100', 'susun-kata-acak', 'cari-kata', 'sambung-kata', 'susun-kalimat', 'trivia'];

const users = {
  alice: { activeGame: 'trivia', randomGames: ALL },
  bob: { activeGame: 'game-random', randomGames: ['tts', 'family100'] }
};
require('mongoose').connect = async () => {};
const userPath = require.resolve('../models/User');
require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: {
  findById: () => ({ select: async () => null }),
  findOne: (q) => ({ lean: async () => users[q.username] ? { username: q.username, ...users[q.username] } : null })
} };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ GAGAL:', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const get = (p) => new Promise((res, rej) => http.get(BASE + p, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, type: r.headers['content-type'] || '', body: d }));
}).on('error', rej));

function listen(sock) {
  const ev = [];
  sock.onAny((name, payload) => ev.push({ name, payload, t: Date.now() }));
  return ev;
}
const waitFor = async (ev, name, from = 0, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = ev.slice(from).find(e => e.name === name);
    if (f) return f;
    await sleep(40);
  }
  return null;
};

function answersFor(game, roomDir) {
  const g = path.join(roomDir, 'games', game);
  const rj = (f) => JSON.parse(fs.readFileSync(path.join(g, f), 'utf8'));
  if (game === 'tts' || game === 'sambung-kata') return rj('puzzle.json').words.map(w => w.answer);
  if (game === 'family100') return rj('question.json').answers.map(a => a.text);
  if (game === 'cari-kata') return rj('puzzle.json').words.map(w => (typeof w === 'string' ? w : w.word || w.answer));
  if (game === 'trivia') return [rj('puzzle.json').correctLetter];
  if (game === 'susun-kalimat') return rj('state.json').items.map(i => i.sentence);
  return null;
}

(async () => {
  require('../index.js');
  await sleep(500);
  const { io: ioc } = require('socket.io-client');
  const roomManager = require('../services/roomManager');

  console.log('\n[1] Route & file statis');
  let r = await get('/overlay/alice');
  ok(r.status === 200 && r.body.includes('TTS_LIVE_V2_CONFIG') && r.body.includes('"alice"'), '/overlay/alice ke-inject config');
  ok(r.body.includes('/shared/v2-bootstrap.js'), 'overlay memuat v2-bootstrap.js');
  ok((await get('/overlay/nobody')).status === 404, 'user tidak ada -> 404');
  ok((await get('/overlay/x%22%3C%2Fscript%3E')).status === 404, 'username jahat (XSS) ditolak');
  r = await get('/shared/v2-bootstrap.js');
  ok(r.status === 200 && r.type.includes('javascript') && r.body.includes('join-overlay'), '/shared/v2-bootstrap.js bukan HTML SPA');
  r = await get('/shared/vote-overlay.js');
  ok(r.status === 200 && r.type.includes('javascript'), '/shared/vote-overlay.js ke-serve');
  r = await get('/api/grid');
  ok(r.status === 200 && r.body.trim().startsWith('{'), '/api/grid balas JSON (bukan HTML)');

  console.log('\n[2] Syntax script inline di 7 HTML game');
  for (const g of ALL) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', g, 'index.html'), 'utf8');
    let bad = 0;
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      try { new vm.Script(m[1]); } catch (e) { bad++; }
    }
    ok(bad === 0 && html.includes('v2-bootstrap.js'), `${g}: script valid + bootstrap terpasang`);
  }

  console.log('\n[3] Socket: join, state, reconnect, isolasi room');
  const sa = ioc(BASE); const evA = listen(sa);
  const sb = ioc(BASE); const evB = listen(sb);
  await Promise.all([new Promise(res => sa.on('connect', res)), new Promise(res => sb.on('connect', res))]);
  sa.emit('join-overlay', 'alice'); sb.emit('join-overlay', 'bob');
  const upA = await waitFor(evA, 'update');
  ok(upA && upA.payload && upA.payload.options && upA.payload.question, 'alice dapat state trivia lewat join-overlay');
  ok(upA && upA.payload.correctLetter == null, 'jawaban trivia TIDAK bocor di payload');
  ok(!!(await waitFor(evA, 'leaderboard:update')), 'alice dapat leaderboard:update');
  ok(!!(await waitFor(evB, 'update')), 'bob dapat state (game random)');
  const mark = evA.length;
  sa.disconnect(); sa.connect();
  await new Promise(res => sa.once('connect', res));
  sa.emit('join-overlay', 'alice'); // persis yang dilakukan v2-bootstrap saat reconnect
  ok(!!(await waitFor(evA, 'update', mark)), 'setelah reconnect + join ulang, state datang lagi');

  console.log('\n[4] Semua game: state aman, jawaban benar diberi skor, ronde lanjut');
  const alice = await roomManager.getRoom('alice');
  await alice.applySettings({ activeGame: 'tts', randomGames: ALL }); // mode fixed
  for (const g of ALL) {
    await alice.performSwitchGame(g);
    ok(alice.activeGameId === g, `${g}: aktif`);
    const state = alice.activeGame.buildStatePayload();
    if (g === 'tts') ok(state.words.every(w => w.answer === null), 'tts: jawaban belum bocor');
    const answers = answersFor(g, alice.roomDir);
    if (!answers) { console.log('  - (susun-kata-acak: jawaban di memori, dites lewat modul di bawah)'); continue; }
    const from = evA.length;
    const before = alice.leaderboard['budi'] || 0;
    for (const a of answers) await alice.handleChat({ player: 'budi', text: a });
    ok((alice.leaderboard['budi'] || 0) > before, `${g}: skor bertambah (${before} -> ${alice.leaderboard['budi']})`);
    ok(!!(await waitFor(evA, 'answer:correct', from)), `${g}: event answer:correct terkirim`);
    ok(!!(await waitFor(evA, 'puzzle:new', from, 6000)), `${g}: ronde selesai -> soal baru (mode tetap)`);
  }

  console.log('\n[5] Susun Kata Acak (6 slot; jawaban dicari dari bank kata)');
  await alice.performSwitchGame('susun-kata-acak');
  const skaDir = path.join(alice.roomDir, 'games', 'susun-kata-acak');
  const pool = [];
  for (const f of fs.readdirSync(path.join(skaDir, 'fallback')).filter(f => f.endsWith('.json'))) {
    try { pool.push(...JSON.parse(fs.readFileSync(path.join(skaDir, 'fallback', f), 'utf8'))); } catch (e) {}
  }
  try { pool.push(...JSON.parse(fs.readFileSync(path.join(skaDir, 'fallback-wordbank.json'), 'utf8'))); } catch (e) {}
  const words = pool.map(w => (typeof w === 'string' ? w : w.word)).filter(Boolean);
  const sorted = (w) => w.toUpperCase().replace(/[^A-Z]/g, '').split('').sort().join('');
  const slots0 = alice.activeGame.buildStatePayload().slots;
  ok(slots0.length > 0 && slots0.every(sl => sl.answer === null), `susun-kata-acak: ${slots0.length} slot, jawaban belum bocor`);
  const b4 = alice.leaderboard['sari'] || 0;
  let solved = 0;
  for (const sl of slots0) {
    const hit = words.find(w => sorted(w) === sorted(sl.scrambled));
    if (hit) { await alice.handleChat({ player: 'sari', text: hit }); solved++; }
  }
  ok(solved > 0 && (alice.leaderboard['sari'] || 0) > b4, `susun-kata-acak: ${solved} slot dijawab benar, skor bertambah`);

  console.log('\n[6] Mode acak (bob): selesai ronde -> game lain, terisolasi dari alice');
  const bob = await roomManager.getRoom('bob');
  const bobStart = bob.activeGameId;
  const fromB = evB.length, fromA = evA.length;
  for (const a of answersFor(bobStart, bob.roomDir) || []) await bob.handleChat({ player: 'joko', text: a });
  const sw = await waitFor(evB, 'game:switched', fromB, 8000);
  ok(sw && sw.payload.gameId !== bobStart && ['tts', 'family100'].includes(sw.payload.gameId), `bob pindah ${bobStart} -> ${sw && sw.payload.gameId} (sesuai pool)`);
  ok(!evA.slice(fromA).some(e => e.name === 'game:switched' && e.payload.gameId === (sw && sw.payload.gameId) && false) && !evA.slice(fromA).some(e => e.name === 'answer:correct' && e.payload.player === 'joko'), 'event bob tidak nyasar ke alice');
  ok(!alice.leaderboard['joko'] && bob.leaderboard['joko'] > 0, 'leaderboard per-user terpisah');
  ok(bob.roomDir !== alice.roomDir && fs.existsSync(path.join(bob.roomDir, 'games', 'tts', 'puzzle.json')), 'tiap user punya folder game sendiri');

  console.log('\n[7] Vote "ganti" x10 memunculkan overlay pilihan game');
  const fromV = evA.length;
  for (let i = 0; i < 10; i++) await alice.handleChat({ player: 'v' + i, text: 'ganti' });
  ok(!!(await waitFor(evA, 'gameselect:start', fromV)), 'gameselect:start terkirim');

  console.log('\n[8] Persistensi');
  const saved = JSON.parse(fs.readFileSync(alice.stateFile, 'utf8'));
  ok(saved.leaderboard.budi > 0 && saved.gameId, 'room-state.json menyimpan leaderboard & game aktif');

  console.log('\n[9] Jawaban untuk admin (dashboard)');
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: 'x', username: 'alice' }, require('../config').JWT_SECRET);
  const getAuth = (p, t) => new Promise((res, rej) => http.get(BASE + p, { headers: t ? { Authorization: 'Bearer ' + t } : {} }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
  }).on('error', rej));
  ok((await getAuth('/api/sys/game/answers')).status === 401, 'tanpa token -> 401 (jawaban tidak publik)');
  for (const g of ALL) {
    await alice.performSwitchGame(g);
    const r = await getAuth('/api/sys/game/answers', token);
    const j = JSON.parse(r.body);
    ok(r.status === 200 && j.ok && j.gameId === g && j.items.length > 0 && j.items.every(i => typeof i.answer === 'string' && i.answer.length > 0), `${g}: ${j.items ? j.items.length : 0} jawaban terbaca (${j.items && j.items[0] ? j.items[0].answer : '-'})`);
    // overlay TIDAK boleh menerima jawaban yang belum terjawab
    const st = JSON.stringify(alice.activeGame.buildStatePayload());
    const unsolved = j.items.filter(i => !i.solved).map(i => i.answer);
    const leaked = g === 'trivia' ? [] : unsolved.filter(a => st.includes('"' + a + '"'));
    ok(leaked.length === 0, `${g}: payload overlay tidak memuat jawaban yang belum terjawab`);
  }
  await alice.performSwitchGame('family100');
  const a0 = alice.getAdminAnswers();
  const firstUnsolved = a0.items.find(i => !i.solved);
  await alice.handleChat({ player: 'tes', text: firstUnsolved.answer });
  const a1 = alice.getAdminAnswers();
  ok(a1.items.filter(i => i.solved).length === a0.items.filter(i => i.solved).length + 1, 'family100: status "sudah" ikut berubah setelah terjawab');

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
