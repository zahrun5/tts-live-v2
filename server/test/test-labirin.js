// Test game Labirin. Jalankan: node --test server/test/test-labirin.js
// (Node 20+, tanpa dependensi. Timer & jam dipalsukan, jadi test cepat.)
'use strict';

const { test, mock, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../games/labirin');

const N = 1, E = 2, S = 4, W = 8;
const DELTA = { U: [0, -1, N], D: [0, 1, S], L: [-1, 0, W], R: [1, 0, E] };

// BFS dari payload.walls — dipakai bot buat nyari jalur ke pintu keluar.
function pathTo(payload, from, to) {
  const { cols, rows, walls } = payload;
  const prev = new Map();
  const key = (x, y) => y * cols + x;
  const q = [from];
  prev.set(key(from.x, from.y), null);
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c.x === to.x && c.y === to.y) break;
    for (const [m, [dx, dy, wall]] of Object.entries(DELTA)) {
      if (walls[key(c.x, c.y)] & wall) continue;
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), { c, m });
      q.push({ x: nx, y: ny });
    }
  }
  const moves = [];
  let cur = to;
  while (prev.get(key(cur.x, cur.y))) {
    const { c, m } = prev.get(key(cur.x, cur.y));
    moves.unshift(m);
    cur = c;
  }
  return moves;
}

// Jalan satu pemain ke finish: kirim komentar 3-langkah, majuin jam sesuai cooldown.
function runToFinish(name, moves) {
  let result = null;
  for (let i = 0; i < moves.length; i += 3) {
    const chunk = moves.slice(i, i + 3);
    mock.timers.tick(1000); // lewatin cooldown
    result = game.handleAnswer({ moves: chunk, answer: chunk.join(''), player: name });
  }
  return result;
}

// Mock timer diaktifin sekali buat satu file (enable/reset berulang per test bikin
// timer test sebelumnya bocor). init() selalu bersihin timer game dari test lain.
before(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
after(() => mock.timers.reset());
beforeEach(() => {
  game.setBroadcaster(() => {}, null);
  game.init();
});

test('parser: perintah arah yang valid', () => {
  const p = game._parseMoves;
  assert.deepEqual(p('atas'), ['U']);
  assert.deepEqual(p('KANAN'), ['R']);
  assert.deepEqual(p('w'), ['U']);
  assert.deepEqual(p('wasd'), ['U', 'L', 'D']);          // dipotong 3 langkah
  assert.deepEqual(p('atas atas kanan kanan'), ['U', 'U', 'R']);
  assert.deepEqual(p('kiri, bawah'), ['L', 'D']);
  assert.deepEqual(p('up down left right'), ['U', 'D', 'L']);
  assert.deepEqual(p('⬆️➡️'), ['U', 'R']);
  assert.deepEqual(p('↓ ← →'), ['D', 'L', 'R']);
});

test('parser: komentar biasa diabaikan', () => {
  const p = game._parseMoves;
  for (const t of ['halo kak', 'kiri dong', 'ada', 'SKIP', 'GANTI', 'sad', '', '   ', 'x'.repeat(100), null, 42]) {
    assert.equal(p(t), null, `harusnya null: ${JSON.stringify(t)}`);
  }
  assert.deepEqual(game.parseComment('kanan'), { moves: ['R'], answer: 'R' });
  assert.equal(game.parseComment('halo'), null);
});

test('labirin selalu bisa diselesaikan dan jalurnya cukup panjang', () => {
  const lengths = [];
  for (let i = 0; i < 100; i++) {
    game.init();
    const st = game.buildStatePayload();
    assert.equal(st.start.y, 0);
    assert.equal(st.exit.y, st.rows - 1);
    const path = pathTo(st, st.start, st.exit);
    assert.ok(path.length > 0, 'harus ada jalur');
    assert.equal(path.length, st.shortest);
    lengths.push(path.length);
  }
  const min = Math.min(...lengths);
  assert.ok(min >= 40, `jalur terpendek terlalu pendek: ${min}`);
});

test('tabrak tembok: berhenti di tempat, posisi tidak tembus', () => {
  const st = game.buildStatePayload();
  // dari baris paling atas, "atas" selalu nabrak tembok luar
  const r = game.handleAnswer({ moves: ['U'], answer: 'U', player: 'budi' });
  assert.equal(r.ok, false);
  const p = game.buildStatePayload().players.find((x) => x.n === 'budi');
  assert.deepEqual([p.x, p.y], [st.start.x, st.start.y]);
});

test('batas 3 langkah per komentar + cooldown per pemain', () => {
  const st = game.buildStatePayload();
  const path = pathTo(st, st.start, st.exit);
  const first = path.slice(0, 5);
  mock.timers.tick(1000);
  game.handleAnswer({ moves: first, answer: first.join(''), player: 'ani' });   // 5 langkah dikirim
  let p = game.buildStatePayload().players.find((x) => x.n === 'ani');
  assert.equal(Math.abs(p.x - st.start.x) + p.y, 3, 'cuma 3 langkah yang jalan');

  // langsung komentar lagi (dalam cooldown) -> ditolak
  const r = game.handleAnswer({ moves: [path[3]], answer: path[3], player: 'ani' });
  assert.equal(r.ok, false);
  assert.equal(r.msg, 'Terlalu cepat');

  mock.timers.tick(1000);
  game.handleAnswer({ moves: [path[3]], answer: path[3], player: 'ani' });
  p = game.buildStatePayload().players.find((x) => x.n === 'ani');
  assert.ok(Math.abs(p.x - st.start.x) + p.y >= 4);
});

test('3 tercepat finish: poin 100/60/30, lalu papan juara, lalu minta ronde baru', () => {
  let completions = 0;
  game.setBroadcaster(() => {}, () => { completions++; return true; });

  const st = game.buildStatePayload();
  const path = pathTo(st, st.start, st.exit);

  const results = ['juara1', 'juara2', 'juara3'].map((n) => runToFinish(n, path));
  assert.deepEqual(results.map((r) => r.points), [100, 60, 30]);
  assert.deepEqual(results.map((r) => r.meta.rank), [1, 2, 3]);
  assert.ok(results.every((r) => r.ok));

  let after = game.buildStatePayload();
  assert.equal(after.phase, 'podium');
  assert.deepEqual(after.finishers.map((f) => f.player), ['juara1', 'juara2', 'juara3']);
  assert.equal(game.isComplete(), false, 'belum complete selama papan juara tampil');

  // pemain ke-4 ditolak (ronde udah selesai)
  assert.equal(game.handleAnswer({ moves: ['D'], answer: 'D', player: 'telat' }).ok, false);

  mock.timers.tick(8000);
  assert.equal(game.isComplete(), true);
  assert.equal(completions, 1, 'room diminta nyelesaiin ronde tepat sekali');
});

test('yang udah finish nggak dapat poin dua kali', () => {
  const st = game.buildStatePayload();
  const path = pathTo(st, st.start, st.exit);
  assert.equal(runToFinish('sama', path).ok, true);
  mock.timers.tick(1000);
  assert.equal(game.handleAnswer({ moves: ['U'], answer: 'U', player: 'sama' }).ok, false);
  assert.equal(game.buildStatePayload().finishers.length, 1);
});

test('timeout 4 menit: ronde selesai tanpa pemenang, tampil yang terdekat', () => {
  let completions = 0;
  game.setBroadcaster(() => {}, () => { completions++; return true; });
  const st = game.buildStatePayload();
  const path = pathTo(st, st.start, st.exit);

  mock.timers.tick(1000);
  game.handleAnswer({ moves: path.slice(0, 3), answer: '', player: 'jauh' });
  mock.timers.tick(1000);
  game.handleAnswer({ moves: path.slice(0, 1), answer: '', player: 'dekat0' });

  mock.timers.tick(4 * 60 * 1000);
  const after = game.buildStatePayload();
  assert.equal(after.phase, 'podium');
  assert.equal(after.endReason, 'timeout');
  assert.equal(after.finishers.length, 0);
  assert.equal(after.closest[0], 'jauh', 'terdekat = yang paling jauh jalannya');

  mock.timers.tick(8000);
  assert.equal(completions, 1);
});

test('tanpa hook room (room.js belum di-patch): bikin labirin baru sendiri', () => {
  game.setBroadcaster(() => {}, null);
  const before = game.buildStatePayload();
  mock.timers.tick(4 * 60 * 1000);   // timeout -> papan juara
  mock.timers.tick(8000);            // papan juara selesai -> labirin baru (fallback)
  const after = game.buildStatePayload();
  assert.equal(after.phase, 'racing');
  assert.equal(after.round, before.round + 1);
  assert.equal(after.players.length, 0);
});

test('onComplete() = ronde baru (dipakai skip vote & rotasi)', async () => {
  const r0 = game.buildStatePayload().round;
  const res = await game.onComplete();
  assert.equal(res.success, true);
  const st = game.buildStatePayload();
  assert.equal(st.round, r0 + 1);
  assert.equal(st.phase, 'racing');
});

test('broadcast di-throttle: 200 langkah = 1 emit', () => {
  let emits = 0;
  game.setBroadcaster(() => { emits++; }, null);
  const st = game.buildStatePayload();
  const first = pathTo(st, st.start, st.exit)[0];
  for (let i = 0; i < 200; i++) {
    game.handleAnswer({ moves: [first], answer: first, player: `p${i}` });
  }
  mock.timers.tick(500);
  assert.equal(emits, 1);
});

test('payload aman di-emit: bisa di-JSON, tetap kecil dengan 500 pemain', () => {
  const st = game.buildStatePayload();
  const first = pathTo(st, st.start, st.exit)[0];
  for (let i = 0; i < 500; i++) game.handleAnswer({ moves: [first], answer: first, player: `penonton-${i}` });
  const payload = game.buildStatePayload();
  const json = JSON.stringify(payload);
  assert.equal(payload.totalPlayers, 500);
  assert.equal(payload.players.length, 80);
  assert.ok(json.length < 12_000, `payload kegedean: ${json.length} byte`);
});

test('admin answers & clue list tidak error', () => {
  assert.ok(game.getAdminAnswers().items.length >= 2);
  assert.match(game.buildClueList(), /Labirin/);
});
