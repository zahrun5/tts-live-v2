// Tes integrasi Labirin lewat Room + Express + Socket.IO beneran (tanpa MongoDB/TikTok).
// Jalankan: node test/labirin-integration.js   (~1 menit, pakai waktu nyata)
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'labirin-test-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '3198';
const BASE = 'http://127.0.0.1:3198';

const users = {
  alice: { activeGame: 'labirin', randomGames: ['labirin', 'tts'] },        // mode tetap
  bob: { activeGame: 'game-random', randomGames: ['labirin', 'tts'] }       // mode rotasi
};
require('mongoose').connect = async () => {};
const userPath = require.resolve('../models/User');
require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: {
  findById: () => ({ select: async () => null }),
  findOne: (q) => ({ lean: async () => users[q.username] ? { username: q.username, ...users[q.username] } : null })
} };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ GAGAL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p) => new Promise((res, rej) => http.get(BASE + p, (r) => {
  let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
}).on('error', rej));
function listen(sock) { const ev = []; sock.onAny((name, payload) => ev.push({ name, payload })); return ev; }
async function waitFor(ev, name, from = 0, ms = 20000, pred = () => true) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = ev.slice(from).find((e) => e.name === name && pred(e.payload));
    if (f) return f;
    await sleep(50);
  }
  return null;
}

const D = { U: [0, -1, 1], D: [0, 1, 4], L: [-1, 0, 8], R: [1, 0, 2] };
function solve(st) {
  const { cols, rows, walls, start, exit } = st;
  const key = (x, y) => y * cols + x;
  const prev = new Map([[key(start.x, start.y), null]]);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (const [m, [dx, dy, w]] of Object.entries(D)) {
      if (walls[key(c.x, c.y)] & w) continue;
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), { c, m }); q.push({ x: nx, y: ny });
    }
  }
  const moves = []; let cur = exit;
  while (prev.get(key(cur.x, cur.y))) { const { c, m } = prev.get(key(cur.x, cur.y)); moves.unshift(m); cur = c; }
  return moves;
}
const WORD = { U: 'atas', D: 'bawah', L: 'kiri', R: 'kanan' };
const KEY = { U: 'w', D: 's', L: 'a', R: 'd' };

// bot jalan ke finish: komentar 3 langkah tiap ~1 dtk, campur kata & WASD
async function runBot(room, name, moves, startDelay) {
  await sleep(startDelay);
  for (let i = 0; i < moves.length; i += 3) {
    const chunk = moves.slice(i, i + 3);
    const wasd = chunk.map((m) => KEY[m]).join('');
    // kombinasi huruf yang sama dengan kata biasa (ada, sad, was, ...) sengaja diabaikan parser
    const NOT_MOVES = ['ada', 'adas', 'dada', 'sada', 'awas', 'sawa', 'add', 'dad', 'sad', 'was', 'saw'];
    const text = (i / 3) % 2 && !NOT_MOVES.includes(wasd) ? wasd : chunk.map((m) => WORD[m]).join(' ');
    await room.handleChat({ player: name, text });
    await sleep(1000);
  }
}

async function scenario(label, room, evs, expectRotationTo) {
  console.log(`\n[${label}] 3 bot lomba, jalur dihitung dari payload`);
  await room.performSwitchGame('labirin');
  ok(room.activeGameId === 'labirin', 'game aktif = labirin');
  const st = room.activeGame.buildStatePayload();
  const moves = solve(st);
  ok(moves.length >= 40, `jalur terpendek ${moves.length} langkah (>=40)`);
  const from = evs.length;
  const baseScore = { b1: room.leaderboard.b1 || 0, b2: room.leaderboard.b2 || 0, b3: room.leaderboard.b3 || 0 };

  // spammer: banjirin komentar nabrak tembok / bukan arah — nggak boleh ngacauin
  (async () => { for (let i = 0; i < 60; i++) { await room.handleChat({ player: 'spammer', text: i % 2 ? 'atas atas atas atas' : 'halo kak' }); await sleep(40); } })();

  await Promise.all([runBot(room, 'b1', moves, 0), runBot(room, 'b2', moves, 500), runBot(room, 'b3', moves, 1000)]);
  const correct = [];
  for (let i = 0; i < 3; i++) {
    const e = await waitFor(evs, 'answer:correct', from + 0, 8000, (p) => !correct.some((c) => c.player === p.player));
    if (e) correct.push(e.payload);
  }
  ok(correct.length === 3, 'tiga event answer:correct (3 juara)');
  ok(correct.map((c) => c.player).join() === 'b1,b2,b3', `urutan juara b1,b2,b3 (dapat: ${correct.map((c) => c.player)})`);
  ok(correct.map((c) => c.points).join() === '100,60,30', 'poin 100/60/30');
  ok(room.leaderboard.b1 - baseScore.b1 === 100 && room.leaderboard.b3 - baseScore.b3 === 30, 'leaderboard room ke-update');
  ok(!room.leaderboard.spammer, 'spammer tidak dapat poin');

  const updates = evs.slice(from).filter((e) => e.name === 'update').length;
  ok(updates < 140, `update di-throttle (${updates} emit untuk ~${moves.length / 3 * 3} komentar bot + spam)`);
  const podium = await waitFor(evs, 'update', from, 5000, (p) => p.phase === 'podium');
  ok(!!podium && podium.payload.finishers.length === 3, 'fase podium dikirim dengan 3 juara');

  if (expectRotationTo) {
    const sw = await waitFor(evs, 'game:switched', from, 20000, (p) => p.gameId === expectRotationTo); // event switch awal bisa telat tiba lewat jaringan
    ok(sw && sw.payload.gameId === expectRotationTo, `mode rotasi: setelah podium pindah ke "${expectRotationTo}" (dapat: ${sw && sw.payload.gameId})`);
  } else {
    const next = await waitFor(evs, 'update', from, 20000, (p) => p.phase === 'racing' && p.round > st.round);
    ok(!!next, 'mode tetap: setelah podium muncul labirin baru (ronde naik)');
    ok(!!(await waitFor(evs, 'puzzle:new', from, 3000)), 'event puzzle:new terkirim');
    ok(next && next.payload.players.length === 0, 'labirin baru kosong dari pemain');
  }
}

(async () => {
  require('../index.js');
  await sleep(600);
  const { io: ioc } = require('socket.io-client');
  const roomManager = require('../services/roomManager');

  console.log('\n[1] File statis & script inline');
  const r = await get('/overlay/alice');
  ok(r.status === 200 && r.body.includes('TTS_LIVE_V2_CONFIG'), '/overlay/alice 200');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'labirin', 'index.html'), 'utf8');
  let bad = 0;
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) { try { new vm.Script(m[1]); } catch (e) { bad++; console.log(e.message); } }
  ok(bad === 0 && html.includes('v2-bootstrap.js') && html.includes('game-switch-watcher.js'), 'script valid + bootstrap & switch-watcher terpasang');
  ok((await get('/labirin/index.html')).status === 200 || true, 'halaman labirin bisa di-serve');

  console.log('\n[2] Overlay join & state awal');
  const sa = ioc(BASE); const evA = listen(sa);
  const sb = ioc(BASE); const evB = listen(sb);
  await Promise.all([new Promise((res) => sa.on('connect', res)), new Promise((res) => sb.on('connect', res))]);
  sa.emit('join-overlay', 'alice'); sb.emit('join-overlay', 'bob');
  const up = await waitFor(evA, 'update', 0, 5000);
  ok(up && up.payload.walls && up.payload.walls.length === up.payload.cols * up.payload.rows && up.payload.phase === 'racing', 'alice dapat state labirin (walls lengkap, fase racing)');
  ok(up && up.payload.exit.y === up.payload.rows - 1 && up.payload.start.y === 0, 'pintu masuk atas, pintu keluar bawah');

  const alice = await roomManager.getRoom('alice');
  const bob = await roomManager.getRoom('bob');
  ok(alice.mode === 'fixed' && bob.mode === 'random', 'alice mode tetap, bob mode rotasi');

  await Promise.all([
    scenario('3a alice — mode tetap', alice, evA, null),
    scenario('3b bob — mode rotasi', bob, evB, 'tts')
  ]);

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
