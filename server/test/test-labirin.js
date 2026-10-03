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

// Posisi pemain dari payload (belum muncul = masih di pintu masuk).
function posOf(name) {
  const st = game.buildStatePayload();
  const p = st.players.find((x) => x.n === name);
  return p ? { x: p.x, y: p.y } : { x: st.start.x, y: st.start.y };
}

// Satu komentar: arah pertama jalur terpendek dari posisi pemain sekarang. Majuin
// jam sampai cooldown lewat, jadi tes nggak bergantung pada angka cooldown.
function sendNextMove(name) {
  const st = game.buildStatePayload();
  const dir = pathTo(st, posOf(name), st.exit)[0];
  let r;
  do {
    mock.timers.tick(100);
    r = game.handleAnswer({ moves: [dir], answer: dir, player: name });
  } while (r.msg === 'Terlalu cepat');
  return r;
}

// Jalan satu pemain ke finish: tiap komentar = 1 arah (lari sampai persimpangan).
function runToFinish(name) {
  let result = null;
  let commands = 0;
  for (let i = 0; i < 200; i++) {
    result = sendNextMove(name);
    commands++;
    if (result.ok) break;
  }
  return { result, commands };
}

// Labirin buatan tangan buat ngetes runSegment (ukuran sama dengan game: 11x17).
const COLS = 11, ROWS = 17;
const LINK = { U: [0, -1, N, S], D: [0, 1, S, N], L: [-1, 0, W, E], R: [1, 0, E, W] };
const blankWalls = () => new Array(COLS * ROWS).fill(N | E | S | W);
function carve(walls, x, y, keys) {
  for (const k of keys) {
    const [dx, dy, wall, opp] = LINK[k];
    walls[y * COLS + x] &= ~wall;
    walls[(y + dy) * COLS + (x + dx)] &= ~opp;
    x += dx; y += dy;
  }
  return { x, y };
}
const openSides = (walls, x, y) => [N, E, S, W].filter((b) => !(walls[y * COLS + x] & b)).length;

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

test('runSegment: ikut belokan, berhenti di pertigaan', () => {
  const walls = blankWalls();
  carve(walls, 0, 0, ['R', 'R', 'D', 'D']);   // (0,0)->(2,0) belok ke bawah ->(2,2)
  carve(walls, 2, 2, ['L']);                   // cabang kiri di (2,2)
  carve(walls, 2, 2, ['R', 'R', 'R', 'R']);    // cabang kanan buntu di (6,2)
  const exit = { x: 10, y: 16 };
  const r = game._runSegment(walls, exit, 0, 0, 'R');
  assert.deepEqual([r.x, r.y, r.cells, r.finished], [2, 2, 4, false]);   // bukan cuma 1 langkah
});

test('runSegment: berhenti di jalan buntu', () => {
  const walls = blankWalls();
  carve(walls, 2, 2, ['L']);
  carve(walls, 2, 2, ['R', 'R', 'R', 'R']);
  const r = game._runSegment(walls, { x: 10, y: 16 }, 2, 2, 'R');
  assert.deepEqual([r.x, r.y, r.cells], [6, 2, 4]);
});

test('runSegment: balik arah juga lari sampai ujung lorong (ikut belokan)', () => {
  const walls = blankWalls();
  carve(walls, 0, 0, ['R', 'R', 'D', 'D']);
  carve(walls, 2, 2, ['L']);
  const r = game._runSegment(walls, { x: 10, y: 16 }, 2, 2, 'U');   // (2,2)->(2,0)->belok kiri->(0,0) buntu
  assert.deepEqual([r.x, r.y, r.cells], [0, 0, 4]);
});

test('runSegment: berhenti di perempatan, sisi asal tidak dihitung sebagai pilihan', () => {
  const walls = blankWalls();
  carve(walls, 6, 4, ['D', 'D']);              // lorong (6,4)->(6,6)
  carve(walls, 6, 6, ['U']);                   // (sudah terhubung, aman diulang)
  carve(walls, 6, 6, ['D']);
  carve(walls, 6, 6, ['L']);
  carve(walls, 6, 6, ['R']);
  const r = game._runSegment(walls, { x: 10, y: 16 }, 6, 4, 'D');
  assert.deepEqual([r.x, r.y, r.cells], [6, 6, 2]);
  assert.equal(openSides(walls, 6, 6), 4);
});

test('runSegment: berhenti di pintu keluar walau ada cabang, dan ditandai finished', () => {
  const walls = blankWalls();
  carve(walls, 9, 14, ['D', 'D']);             // ... (9,14)->(9,16)
  carve(walls, 9, 16, ['L']);                  // cabang di pintu keluar
  const r = game._runSegment(walls, { x: 9, y: 16 }, 9, 14, 'D');
  assert.deepEqual([r.x, r.y, r.cells, r.finished], [9, 16, 2, true]);
});

test('runSegment: langkah pertama nabrak tembok = diam di tempat', () => {
  const walls = blankWalls();
  carve(walls, 0, 0, ['R']);
  for (const k of ['U', 'D', 'L']) {
    const r = game._runSegment(walls, { x: 10, y: 16 }, 0, 0, k);
    assert.deepEqual([r.x, r.y, r.cells, r.finished], [0, 0, 0, false], k);
  }
});

test('satu komentar = lari sampai persimpangan/buntu/finish (40 labirin acak)', () => {
  for (let i = 0; i < 40; i++) {
    game.init();
    const st = game.buildStatePayload();
    const first = pathTo(st, st.start, st.exit)[0];
    mock.timers.tick(1000);
    game.handleAnswer({ moves: [first], answer: first, player: 'lari' });
    const p = posOf('lari');
    assert.notDeepEqual(p, { x: st.start.x, y: st.start.y }, 'harus bergerak');
    const atExit = p.x === st.exit.x && p.y === st.exit.y;
    // sel lorong biasa (lurus/belok) punya tepat 2 sisi terbuka; pemain nggak boleh berhenti di situ
    assert.ok(atExit || openSides(st.walls, p.x, p.y) !== 2, `berhenti di tengah lorong (${p.x},${p.y})`);
  }
});

test('cooldown per komentar: komentar langsung berikutnya ditolak, lalu boleh lagi', () => {
  const st = game.buildStatePayload();
  const dir1 = pathTo(st, st.start, st.exit)[0];
  mock.timers.tick(1000);
  assert.equal(game.handleAnswer({ moves: [dir1], answer: dir1, player: 'ani' }).msg, 'Bergerak');

  const dir2 = pathTo(st, posOf('ani'), st.exit)[0];
  const r = game.handleAnswer({ moves: [dir2], answer: dir2, player: 'ani' });   // langsung lagi
  assert.equal(r.ok, false);
  assert.equal(r.msg, 'Terlalu cepat');

  mock.timers.tick(3000);
  assert.notEqual(game.handleAnswer({ moves: [dir2], answer: dir2, player: 'ani' }).msg, 'Terlalu cepat');
});

test('beberapa arah dalam satu komentar dijalankan berurutan, maksimal 3 lari', () => {
  // cari labirin yang butuh >= 4 keputusan (hampir semua)
  let cmds, ends;
  for (let attempt = 0; attempt < 50; attempt++) {
    game.init();
    const st = game.buildStatePayload();
    let pos = { x: st.start.x, y: st.start.y };
    cmds = []; ends = [];
    for (let i = 0; i < 4; i++) {
      const c = pathTo(st, pos, st.exit)[0];
      const r = game._runSegment(st.walls, st.exit, pos.x, pos.y, c);
      cmds.push(c); ends.push({ x: r.x, y: r.y });
      pos = { x: r.x, y: r.y };
      if (r.finished) break;
    }
    if (cmds.length === 4 && !(ends[3].x === st.exit.x && ends[3].y === st.exit.y)) break;
  }
  assert.equal(cmds.length, 4, 'butuh labirin dengan >= 4 keputusan');
  mock.timers.tick(1000);
  game.handleAnswer({ moves: cmds, answer: cmds.join(''), player: 'multi' });   // 4 arah dikirim
  assert.deepEqual(posOf('multi'), ends[2], 'cuma 3 lari pertama yang jalan');
});

test('3 tercepat finish: poin 100/60/30, lalu papan juara, lalu minta ronde baru', () => {
  let completions = 0;
  game.setBroadcaster(() => {}, () => { completions++; return true; });

  const results = ['juara1', 'juara2', 'juara3'].map((n) => runToFinish(n).result);
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
  assert.equal(runToFinish('sama').result.ok, true);
  mock.timers.tick(1000);
  assert.equal(game.handleAnswer({ moves: ['U'], answer: 'U', player: 'sama' }).ok, false);
  assert.equal(game.buildStatePayload().finishers.length, 1);
});

test('timeout 4 menit: ronde selesai tanpa pemenang, tampil yang terdekat', () => {
  let completions = 0;
  game.setBroadcaster(() => {}, () => { completions++; return true; });

  sendNextMove('jauh');     // dua kali lari
  sendNextMove('jauh');
  sendNextMove('dekat0');   // sekali lari

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
