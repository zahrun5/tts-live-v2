// Test game Ular Tangga. Jalankan: node --test server/test/test-ular-tangga.js
// (Node 20+, tanpa dependensi. Timer & jam dipalsukan, jadi test cepat.)
'use strict';

const { test, mock, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../games/ular-tangga');

const CFG = game._config;
const COOLDOWN = CFG.ROLL_COOLDOWN_MS;

// Mock timer diaktifin sekali buat satu file (enable/reset berulang per test bikin
// timer test sebelumnya bocor). init() selalu bersihin timer game dari test lain.
before(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
after(() => mock.timers.reset());
beforeEach(() => {
  game._setRng();                       // acak asli buat generator papan
  game.setBroadcaster(() => {}, null);
  game.init();
});

// Paksa hasil dadu = d (rng: 1 + floor(r * 6) == d).
function forceDie(d) { game._setRng(() => (d - 1) / 6 + 0.01); }

// Papan kosong (tanpa efek) / papan buatan tangan.
function emptyBoard() { game._setBoard([], [], []); }

// Satu lemparan dengan dadu d. Majuin jam melewati cooldown dulu.
function roll(name, d) {
  mock.timers.tick(COOLDOWN + 100);
  return rollNow(name, d);
}
// Lemparan tanpa nunggu cooldown (buat tes cooldown & "lempar lagi").
function rollNow(name, d) {
  forceDie(d);
  return game.handleAnswer({ answer: 'lempar', player: name });
}

function posOf(name) {
  const p = game.buildStatePayload().players.find((x) => x.n === name);
  return p ? p.p : 0;
}

// Bawa satu pemain ke petak 100 di papan kosong: 16 x dadu 6 (= 96), lalu dadu 4.
function runToFinish(name) {
  let r;
  for (let i = 0; i < 16; i++) r = roll(name, 6);
  assert.equal(posOf(name), 96);
  r = roll(name, 4);
  return r;
}

// ---------- parser ----------
test('parser: perintah lempar yang valid', () => {
  const p = game._isRollComment;
  for (const t of ['lempar', 'LEMPAR', '  Dadu ', 'roll', '🎲', '🎲️', 'lempar!', 'roll!!!', 'dadu.']) {
    assert.equal(p(t), true, `harusnya valid: ${JSON.stringify(t)}`);
  }
  assert.deepEqual(game.parseComment('lempar'), { answer: 'lempar' });
});

test('parser: obrolan biasa diabaikan', () => {
  const p = game._isRollComment;
  for (const t of ['halo kak', 'lempar dong', 'dadunya mana', 'lemparan', 'roll roll', 'skip', '', '   ', 'x'.repeat(100), null, 42]) {
    assert.equal(p(t), false, `harusnya diabaikan: ${JSON.stringify(t)}`);
  }
  assert.equal(game.parseComment('halo'), null);
});

// ---------- generator papan ----------
test('generator papan valid di 100 papan acak + rata-rata lemparan masuk target', () => {
  for (let i = 0; i < 100; i++) {
    const b = game._generateBoard();
    assert.equal(b.snakes.length, CFG.SNAKE_COUNT);
    assert.equal(b.ladders.length, CFG.LADDER_COUNT);
    assert.equal(b.specials.length, 5);

    const cells = [];
    for (const [head, tail] of b.snakes) {
      assert.ok(head > tail, 'ular harus turun');
      assert.ok(head - tail >= CFG.MIN_JUMP && head - tail <= CFG.MAX_SNAKE_DROP, `turun ${head - tail}`);
      assert.notEqual(Math.floor((head - 1) / 10), Math.floor((tail - 1) / 10), 'ular harus pindah baris');
      cells.push(head, tail);
    }
    for (const [bottom, top] of b.ladders) {
      assert.ok(top > bottom, 'tangga harus naik');
      assert.ok(top - bottom >= CFG.MIN_JUMP && top - bottom <= CFG.MAX_LADDER_RISE, `naik ${top - bottom}`);
      assert.ok(top <= 99, 'tangga nggak boleh langsung finish');
      assert.notEqual(Math.floor((bottom - 1) / 10), Math.floor((top - 1) / 10), 'tangga harus pindah baris');
      cells.push(bottom, top);
    }
    for (const s of b.specials) cells.push(s.c);

    assert.ok(!cells.includes(1) && !cells.includes(100), 'petak 1 dan 100 harus bebas efek');
    assert.equal(new Set(cells).size, cells.length, 'satu efek per petak, ujung nggak saling tabrakan');
    for (const s of b.specials) {
      if (s.t === 'back') assert.equal(s.to, Math.max(1, s.c - CFG.BACK_STEPS));
      if (s.t === 'fwd') assert.equal(s.to, Math.min(100, s.c + CFG.FWD_STEPS));
      if (s.t !== 'again') assert.ok(!cells.includes(s.to), 'tujuan loncat nggak boleh di petak berefek');
    }
    assert.ok(b.avgRolls >= CFG.TARGET_ROLLS_MIN && b.avgRolls <= CFG.TARGET_ROLLS_MAX, `rata-rata ${b.avgRolls} di luar target`);
  }
});

test('papan cadangan: generator gagal total tetap menghasilkan papan valid', () => {
  game._setRng(() => 0.5);                         // acak "macet": generator nggak bisa menaruh apa pun
  assert.equal(game._tryGenerateBoard(), null);
  const b = game._generateBoard();
  assert.equal(b.snakes.length, CFG.SNAKE_COUNT);
  assert.equal(b.ladders.length, CFG.LADDER_COUNT);
  assert.equal(b.specials.length, 5);
  const cells = [];
  b.snakes.forEach(([h, t]) => { assert.ok(h > t && h - t >= CFG.MIN_JUMP && h - t <= CFG.MAX_SNAKE_DROP); cells.push(h, t); });
  b.ladders.forEach(([bt, tp]) => { assert.ok(tp > bt && tp - bt >= CFG.MIN_JUMP && tp - bt <= CFG.MAX_LADDER_RISE && tp <= 99); cells.push(bt, tp); });
  b.specials.forEach((s) => cells.push(s.c));
  assert.equal(new Set(cells).size, cells.length);
  assert.ok(!cells.includes(1) && !cells.includes(100));
  b.specials.filter((s) => s.t !== 'again').forEach((s) => assert.ok(!cells.includes(s.to)));
  game.reset();                                    // ronde tetap bisa mulai
  assert.equal(game.buildStatePayload().snakes.length, CFG.SNAKE_COUNT);
});

test('simulasi: rata-rata lemparan papan hasil generator mendekati hasil simulasi ulang', () => {
  const b = game._generateBoard();
  const again = game._simulate(b.effects, 2000);
  assert.ok(Math.abs(again - b.avgRolls) < 8, `${again} vs ${b.avgRolls}`);
});

// ---------- aturan lemparan (fungsi murni) ----------
test('applyRoll: biasa, pas di 100, dan pantul kalau lebih', () => {
  const fx = game._buildEffects([], [], []);
  assert.deepEqual(game._applyRoll(fx, 10, 4), { m: 14, t: 14, v: null });
  assert.deepEqual(game._applyRoll(fx, 96, 4), { m: 100, t: 100, v: null });
  assert.deepEqual(game._applyRoll(fx, 98, 5), { m: 97, t: 97, v: null });   // 98+5=103 -> 100-3
  assert.deepEqual(game._applyRoll(fx, 99, 6), { m: 95, t: 95, v: null });
  assert.deepEqual(game._applyRoll(fx, 0, 6), { m: 6, t: 6, v: null });
});

test('applyRoll: ular, tangga, dan petak spesial', () => {
  const fx = game._buildEffects(
    [[30, 8]],
    [[12, 40]],
    [{ c: 50, t: 'again', to: 50 }, { c: 60, t: 'back', to: 57 }, { c: 70, t: 'fwd', to: 75 }]
  );
  assert.deepEqual(game._applyRoll(fx, 27, 3), { m: 30, t: 8, v: 'snake' });
  assert.deepEqual(game._applyRoll(fx, 9, 3), { m: 12, t: 40, v: 'ladder' });
  assert.deepEqual(game._applyRoll(fx, 47, 3), { m: 50, t: 50, v: 'again' });
  assert.deepEqual(game._applyRoll(fx, 55, 5), { m: 60, t: 57, v: 'back' });
  assert.deepEqual(game._applyRoll(fx, 66, 4), { m: 70, t: 75, v: 'fwd' });
});

test('applyRoll: satu efek per lemparan (nggak ada rantai)', () => {
  // puncak tangga (20) kebetulan kepala ular: tetap berhenti di 20
  const fx = game._buildEffects([[20, 5]], [[10, 20]], []);
  assert.deepEqual(game._applyRoll(fx, 7, 3), { m: 10, t: 20, v: 'ladder' });
});

// ---------- handleAnswer ----------
test('lemparan pertama: pemain muncul di papan dengan data lemparan', () => {
  emptyBoard();
  const r = roll('budi', 4);
  assert.equal(r.ok, false, 'lemparan biasa nggak boleh ok:true');
  const p = game.buildStatePayload().players.find((x) => x.n === 'budi');
  assert.equal(p.p, 4);
  assert.deepEqual([p.d, p.f, p.m, p.v], [4, 0, 4, null]);
  assert.ok(p.q > 0);
  const rr = game.buildStatePayload().recentRolls;
  assert.deepEqual(rr[rr.length - 1], { s: p.q, n: 'budi', d: 4, f: 0, t: 4, v: null });
});

test('komentar bukan lempar: ditolak dan pemain nggak dibuat', () => {
  const r = game.handleAnswer({ answer: 'halo', player: 'iseng' });
  assert.equal(r.ok, false);
  assert.equal(game.buildStatePayload().totalPlayers, 0);
  assert.equal(game.handleAnswer({ answer: 'lempar', player: '' }).ok, false);
});

test('ular menurunkan, tangga menaikkan', () => {
  game._setBoard([[10, 3]], [[14, 30]], []);
  roll('ular', 6);
  assert.equal(roll('ular', 4).ok, false);
  assert.equal(posOf('ular'), 3, 'kena ular di 10 -> 3');
  const rr = game.buildStatePayload().recentRolls;
  assert.equal(rr[rr.length - 1].v, 'snake');

  roll('tangga', 6); roll('tangga', 6); roll('tangga', 2);
  assert.equal(posOf('tangga'), 30, 'naik tangga di 14 -> 30');
});

test('petak spesial: mundur 3 dan maju 5', () => {
  game._setBoard([], [], [{ c: 8, t: 'back', to: 5 }, { c: 20, t: 'fwd', to: 25 }]);
  roll('mundur', 6); roll('mundur', 2);
  assert.equal(posOf('mundur'), 5);
  roll('maju', 6); roll('maju', 6); roll('maju', 6); roll('maju', 2);
  assert.equal(posOf('maju'), 25);
});

test('"lempar lagi": lemparan berikutnya tanpa cooldown', () => {
  game._setBoard([], [], [{ c: 6, t: 'again', to: 6 }]);
  roll('lagi', 6);                                   // mendarat di 6 = lempar lagi
  assert.equal(posOf('lagi'), 6);
  const bonus = rollNow('lagi', 3);                  // langsung, tanpa nunggu
  assert.notEqual(bonus.msg, 'Terlalu cepat');
  assert.equal(posOf('lagi'), 9);
  assert.equal(rollNow('lagi', 3).msg, 'Terlalu cepat', 'setelah bonus, cooldown biasa');
});

test('cooldown per penonton: lemparan langsung berikutnya ditolak, lalu boleh lagi', () => {
  emptyBoard();
  roll('ani', 2);
  const r = rollNow('ani', 3);
  assert.equal(r.ok, false);
  assert.equal(r.msg, 'Terlalu cepat');
  assert.equal(posOf('ani'), 2, 'posisi nggak berubah');
  mock.timers.tick(COOLDOWN);
  assert.notEqual(rollNow('ani', 3).msg, 'Terlalu cepat');
  assert.equal(posOf('ani'), 5);
  // penonton lain nggak ikut kena cooldown
  assert.notEqual(rollNow('bima', 1).msg, 'Terlalu cepat');
});

test('harus pas di 100: kelebihan memantul balik', () => {
  emptyBoard();
  for (let i = 0; i < 16; i++) roll('pantul', 6);
  assert.equal(posOf('pantul'), 96);
  roll('pantul', 6);                                 // 96+6=102 -> memantul ke 98
  assert.equal(posOf('pantul'), 98);
  assert.equal(game.buildStatePayload().finishers.length, 0);
  const r = roll('pantul', 2);                       // 98+2 = 100 pas
  assert.equal(r.ok, true);
  assert.equal(posOf('pantul'), 100);
});

// ---------- juara, podium, timeout ----------
test('3 tercepat finish: poin 100/60/30, lalu papan juara, lalu minta ronde baru', () => {
  let completions = 0;
  game.setBroadcaster(() => {}, () => { completions++; return true; });
  emptyBoard();

  const results = ['juara1', 'juara2', 'juara3'].map((n) => runToFinish(n));
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual(results.map((r) => r.points), [100, 60, 30]);
  assert.deepEqual(results.map((r) => r.meta.rank), [1, 2, 3]);

  const after = game.buildStatePayload();
  assert.equal(after.phase, 'podium');
  assert.equal(after.endReason, 'finished');
  assert.deepEqual(after.finishers.map((f) => f.player), ['juara1', 'juara2', 'juara3']);
  assert.equal(after.finishers[0].rolls, 17);
  assert.equal(game.isComplete(), false, 'belum complete selama papan juara tampil');

  assert.equal(rollNow('telat', 3).ok, false, 'setelah ronde selesai nggak ada lemparan lagi');

  mock.timers.tick(CFG.PODIUM_MS);
  assert.equal(game.isComplete(), true);
  assert.equal(completions, 1, 'room diminta nyelesaiin ronde tepat sekali');
});

test('yang udah finish nggak bisa melempar lagi dan nggak dapat poin dua kali', () => {
  emptyBoard();
  assert.equal(runToFinish('sama').ok, true);
  mock.timers.tick(COOLDOWN + 100);
  const r = rollNow('sama', 3);
  assert.equal(r.ok, false);
  assert.equal(r.msg, 'Sudah finish');
  assert.equal(game.buildStatePayload().finishers.length, 1);
});

test('timeout: ronde selesai tanpa poin, tampil yang terdekat (imbang = tiba duluan)', () => {
  let completions = 0;
  game.setBroadcaster(() => {}, () => { completions++; return true; });
  emptyBoard();

  roll('jauh', 6); roll('jauh', 6);                  // petak 12
  roll('kembar1', 6); roll('kembar1', 4);            // petak 10 (tiba duluan)
  roll('kembar2', 5); roll('kembar2', 5);            // petak 10 (tiba belakangan)
  roll('dekat', 3);

  mock.timers.tick(CFG.ROUND_TIMEOUT_MS);
  const after = game.buildStatePayload();
  assert.equal(after.phase, 'podium');
  assert.equal(after.endReason, 'timeout');
  assert.equal(after.finishers.length, 0);
  assert.deepEqual(after.closest, ['jauh', 'kembar1', 'kembar2']);
  assert.deepEqual(after.players.map((p) => p.n).slice(0, 3), ['jauh', 'kembar1', 'kembar2']);

  mock.timers.tick(CFG.PODIUM_MS);
  assert.equal(completions, 1);
});

test('timeout sebagian: yang sudah finish tetap dapat poin, sisanya cuma "terdekat"', () => {
  emptyBoard();
  assert.equal(runToFinish('satu').points, 100);
  roll('hampir', 6); roll('hampir', 6);
  mock.timers.tick(CFG.ROUND_TIMEOUT_MS);
  const after = game.buildStatePayload();
  assert.equal(after.endReason, 'timeout');
  assert.equal(after.finishers.length, 1);
  assert.deepEqual(after.closest, ['hampir']);
});

test('tanpa hook room (room.js belum di-patch): bikin ronde baru sendiri', () => {
  game.setBroadcaster(() => {}, null);
  const before = game.buildStatePayload();
  mock.timers.tick(CFG.ROUND_TIMEOUT_MS);   // timeout -> papan juara
  mock.timers.tick(CFG.PODIUM_MS);          // papan juara selesai -> ronde baru (fallback)
  const after = game.buildStatePayload();
  assert.equal(after.phase, 'racing');
  assert.equal(after.round, before.round + 1);
  assert.equal(after.players.length, 0);
});

test('onComplete() = ronde baru dengan papan baru (dipakai skip vote & rotasi)', async () => {
  const r0 = game.buildStatePayload().round;
  const res = await game.onComplete();
  assert.equal(res.success, true);
  const st = game.buildStatePayload();
  assert.equal(st.round, r0 + 1);
  assert.equal(st.phase, 'racing');
  assert.equal(st.snakes.length, CFG.SNAKE_COUNT);
});

test('reset() mulai dari ronde 1 dengan papan kosong pemain', () => {
  roll('x', 3);
  game._setRng();
  game.reset();
  const st = game.buildStatePayload();
  assert.equal(st.round, 1);
  assert.equal(st.totalPlayers, 0);
});

// ---------- beban ----------
test('broadcast di-throttle: 200 lemparan dari 200 penonton = 1 emit', () => {
  let emits = 0;
  game.setBroadcaster(() => { emits++; }, null);
  emits = 0;
  emptyBoard();
  for (let i = 0; i < 200; i++) rollNow('p' + i, 3);
  assert.equal(emits, 0, 'belum ada emit sebelum jeda throttle lewat');
  mock.timers.tick(CFG.BROADCAST_THROTTLE_MS);
  assert.equal(emits, 1);
});

test('payload tetap kecil dengan 500 pemain', () => {
  emptyBoard();
  for (let i = 0; i < 500; i++) rollNow('penonton-' + i, 1 + (i % 6));
  const st = game.buildStatePayload();
  assert.equal(st.totalPlayers, 500);
  assert.equal(st.players.length, CFG.MAX_PLAYERS_IN_PAYLOAD);
  assert.ok(st.recentRolls.length <= 5);
  const bytes = JSON.stringify(st).length;
  assert.ok(bytes < 15000, `payload ${bytes} byte kebesaran`);
  // urut terdepan dulu
  for (let i = 1; i < st.players.length; i++) assert.ok(st.players[i - 1].p >= st.players[i].p);
});

test('papan penuh: pemain paling lama diam dibuang, pemain baru tetap bisa main', () => {
  emptyBoard();
  for (let i = 0; i < CFG.MAX_TRACKED_PLAYERS; i++) {
    rollNow('pemain-' + i, 1);
    if (i % 100 === 99) mock.timers.tick(10);   // beda waktu aktif antar kelompok
  }
  assert.equal(game.buildStatePayload().totalPlayers, CFG.MAX_TRACKED_PLAYERS);
  const r = rollNow('pemain-baru', 2);
  assert.notEqual(r.msg, 'Papan penuh');
  const st = game.buildStatePayload();
  assert.equal(st.totalPlayers, CFG.MAX_TRACKED_PLAYERS, 'jumlah tetap di batas');
  assert.equal(posOf('pemain-baru'), 2);
  assert.equal(posOf('pemain-0'), 0, 'pemain paling lama diam yang dibuang');
});

test('getAdminAnswers & buildClueList memenuhi kontrak', () => {
  roll('adm', 3);
  const a = game.getAdminAnswers();
  assert.ok(a.title.includes('Ular Tangga'));
  assert.ok(Array.isArray(a.items) && a.items.length >= 3);
  assert.ok(game.buildClueList().includes('Ular Tangga'));
  assert.equal(game.id, 'ular-tangga');
});
