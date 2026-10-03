// Test game Ular Tangga (giliran otomatis + lobi). Jalankan:
//   node --test server/test/test-ular-tangga.js
// (Node 20+, tanpa dependensi. Timer & jam dipalsukan, jadi test cepat.)
'use strict';

const { test, mock, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../games/ular-tangga');

const CFG = game._config;
const TURN = CFG.TURN_MS;

let awarded;       // [[nama, poin]] dari awardFn
let completions;   // berapa kali game minta room bikin ronde baru

// Mock timer diaktifin sekali buat satu file (enable/reset berulang per test bikin
// timer test sebelumnya bocor). init() selalu bersihin timer game dari test lain.
before(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
after(() => mock.timers.reset());
beforeEach(() => {
  game._setRng();                       // acak asli buat generator papan
  awarded = [];
  completions = 0;
  game.setBroadcaster(() => {}, () => { completions += 1; }, (n, p) => awarded.push([n, p]));
  game._setEvents(false);               // event acak dimatikan; tes event memanggil _startEvent
  game.init();
  game._pauseTurns(false);
  plan = {};
});

// ---------- helper ----------
let plan = {};
// Atur dadu per pemain. Nilai = angka dadu, atau fungsi (petakSekarang) => dadu.
// Dibaca dari pemain yang sedang giliran, jadi nggak peduli urutan lempar.
function planRng() {
  const s = game.buildStatePayload();
  const who = s.turn;
  if (!who || plan[who] === undefined) return 0.5;
  const pos = s.players.find((x) => x.n === who).p;
  const want = typeof plan[who] === 'function' ? plan[who](pos) : plan[who];
  return (want - 1) / 6 + 0.01;
}
function dice(map) { plan = { ...plan, ...map }; game._setRng(planRng); }
// Sampai petak 100 secepat mungkin dengan langkah maksimal `max` (pas di akhir).
const sprint = (max) => (pos) => Math.min(max, 100 - pos);

const join = (name, word = 'join') => game.handleAnswer({ answer: word, player: name });
const use = (name, cmd) => game.handleAnswer({ answer: cmd, player: name });
const snap = () => game.buildStatePayload();
const P = (name) => snap().players.find((x) => x.n === name);
const posOf = (name) => { const p = P(name); return p ? p.p : 0; };
const turns = (n) => { for (let i = 0; i < n; i++) mock.timers.tick(TURN); };
const warm = () => mock.timers.tick(CFG.EVENT_WARN_MS + 10);
function emptyBoard() { game._setBoard([], [], []); }

// Gabung semua `names`, pasang papan, lewati hitung mundur lobi -> balapan jalan.
function startRace(names, board = emptyBoard) {
  names.forEach((n) => join(n));
  board();
  mock.timers.tick(CFG.LOBBY_MS);
  assert.equal(snap().phase, 'racing');
}

// ---------- parser ----------
test('parser: join / main / gabung dikenali', () => {
  const p = game._isJoinComment;
  for (const t of ['join', 'JOIN', '  Main ', 'gabung', 'join!', 'main!!!', 'gabung.']) {
    assert.equal(p(t), true, `harusnya valid: ${JSON.stringify(t)}`);
  }
  assert.deepEqual(game.parseComment('join'), { answer: 'join' });
  assert.deepEqual(game.parseComment('Gabung!'), { answer: 'join' });
});

test('parser: obrolan biasa dan "lempar" lama diabaikan', () => {
  const p = game._isJoinComment;
  for (const t of ['halo kak', 'mau join dong', 'main apa ini', 'bergabung', 'join join', 'skip', '', '   ', 'x'.repeat(100), null, 42]) {
    assert.equal(p(t), false, `harusnya diabaikan: ${JSON.stringify(t)}`);
  }
  assert.equal(game.parseComment('halo'), null);
  assert.equal(game.parseComment('lempar'), null);      // dadu sekarang otomatis
  assert.equal(game.parseComment('dadu'), null);
});

// ---------- generator papan ----------
test('generator papan valid di 100 papan acak + rata-rata lemparan masuk target', () => {
  for (let i = 0; i < 100; i++) {
    const b = game._generateBoard();
    assert.equal(b.snakes.length, CFG.SNAKE_COUNT);
    assert.equal(b.ladders.length, CFG.LADDER_COUNT);
    assert.equal(b.specials.length, 7);

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
      if (s.t !== 'again' && s.t !== 'mystery') assert.ok(!cells.includes(s.to), 'tujuan loncat nggak boleh di petak berefek');
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
  assert.equal(b.specials.length, 7);
  const cells = [];
  b.snakes.forEach(([h, t]) => { assert.ok(h > t && h - t >= CFG.MIN_JUMP && h - t <= CFG.MAX_SNAKE_DROP); cells.push(h, t); });
  b.ladders.forEach(([bt, tp]) => { assert.ok(tp > bt && tp - bt >= CFG.MIN_JUMP && tp - bt <= CFG.MAX_LADDER_RISE && tp <= 99); cells.push(bt, tp); });
  b.specials.forEach((s) => cells.push(s.c));
  assert.equal(new Set(cells).size, cells.length);
  assert.ok(!cells.includes(1) && !cells.includes(100));
  b.specials.filter((s) => s.t !== 'again' && s.t !== 'mystery').forEach((s) => assert.ok(!cells.includes(s.to)));
  game.reset();                                    // ronde tetap bisa mulai
  assert.equal(game.buildStatePayload().snakes.length, CFG.SNAKE_COUNT);
});

test('simulasi: rata-rata lemparan papan hasil generator mendekati hasil simulasi ulang', () => {
  const b = game._generateBoard();
  const again = game._simulate(b.effects, 2000);
  assert.ok(Math.abs(again - b.avgRolls) < b.avgRolls * 0.2, `${again} vs ${b.avgRolls}`);   // varians ikut membesar di papan yang panjang
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

// ---------- lobi ----------
test('lobi: ronde baru mulai dari lobi tanpa pemain', () => {
  const s = snap();
  assert.equal(s.phase, 'lobby');
  assert.equal(s.totalPlayers, 0);
  assert.equal(s.turn, '');
  assert.equal(s.lobby.endsAt, 0);
  assert.equal(s.lobby.min, CFG.LOBBY_MIN);
  assert.equal(s.lobby.max, CFG.MAX_PLAYERS);
});

test('lobi: join / main / gabung, nama yang sama nggak dihitung dobel', () => {
  assert.equal(join('A', 'join').msg, 'Gabung');
  assert.equal(join('B', 'main').msg, 'Gabung');
  assert.equal(join('C', 'gabung').msg, 'Gabung');
  assert.equal(join('A').msg, 'Sudah ikut');
  assert.equal(snap().totalPlayers, 3);
  assert.deepEqual(snap().queue, ['A', 'B', 'C']);
  assert.ok(snap().feed.some((e) => e.k === 'join' && e.a === 'A'));
});

test('lobi: 1 pemain saja belum memulai hitung mundur', () => {
  join('A');
  assert.equal(snap().lobby.endsAt, 0);
  mock.timers.tick(CFG.LOBBY_MS * 2);
  assert.equal(snap().phase, 'lobby');
});

test('lobi: pemain ke-2 memulai hitung mundur, lalu balapan jalan urut join', () => {
  join('A'); join('B');
  assert.equal(snap().lobby.endsAt, Date.now() + CFG.LOBBY_MS);
  mock.timers.tick(CFG.LOBBY_MS - 1);
  assert.equal(snap().phase, 'lobby');
  mock.timers.tick(1);
  const s = snap();
  assert.equal(s.phase, 'racing');
  assert.equal(s.turn, 'A');
  assert.ok(s.endsAt > Date.now());
  assert.equal(s.lobby.endsAt, 0);
});

test('lobi: yang join selama hitung mundur ikut main', () => {
  join('A'); join('B');
  mock.timers.tick(CFG.LOBBY_MS - 500);
  assert.equal(join('C').msg, 'Gabung');
  mock.timers.tick(500);
  assert.equal(snap().phase, 'racing');
  assert.deepEqual(snap().queue, ['A', 'B', 'C']);
});

test('lobi: papan penuh langsung mulai tanpa nunggu hitung mundur', () => {
  for (let i = 0; i < CFG.MAX_PLAYERS; i++) join('P' + i);
  assert.equal(snap().phase, 'racing');
  assert.equal(join('Telat').msg, 'Papan penuh');
});

test('lobi sepi: ronde dilewati, room diminta ganti (rotasi Game Acak)', () => {
  join('A');
  mock.timers.tick(CFG.LOBBY_IDLE_MS + 10);
  assert.equal(completions, 1);
});

test('lobi sepi: tanpa hook room, bikin lobi baru sendiri', () => {
  game.setBroadcaster(() => {}, null);
  game.init();
  const r = snap().round;
  mock.timers.tick(CFG.LOBBY_IDLE_MS + 10);
  assert.equal(snap().round, r + 1);
  assert.equal(snap().phase, 'lobby');
});

test('lobi yang sudah ramai nggak dilewati walau lewat batas sepi', () => {
  join('A'); join('B');
  mock.timers.tick(CFG.LOBBY_MS);
  game._pauseTurns(true);
  mock.timers.tick(CFG.LOBBY_IDLE_MS);
  assert.equal(completions, 0);
});

// ---------- giliran otomatis ----------
test('giliran otomatis: dadu dilempar sendiri tiap TURN_MS, bergantian urut join', () => {
  startRace(['A', 'B', 'C']);
  dice({ A: 1, B: 2, C: 3 });
  mock.timers.tick(TURN - 1);
  assert.equal(posOf('A'), 0);                    // belum waktunya
  mock.timers.tick(1);
  assert.equal(posOf('A'), 1); assert.equal(snap().turn, 'B');
  turns(1);
  assert.equal(posOf('B'), 2); assert.equal(snap().turn, 'C');
  turns(1);
  assert.equal(posOf('C'), 3); assert.equal(snap().turn, 'A');
  turns(1);
  assert.equal(posOf('A'), 2);
  assert.equal(snap().recentRolls.length, 4);
  assert.deepEqual(P('A'), { ...P('A'), q: P('A').q, d: 1, f: 1, m: 2, v: null });   // data lemparan buat animasi
});

test('komentar "lempar" manual nggak ngaruh lagi', () => {
  startRace(['A', 'B']);
  dice({ A: 2, B: 2 });
  assert.equal(use('A', 'lempar').ok, false);
  assert.equal(posOf('A'), 0);
});

test('join di tengah balapan: ikut urutan join, mulai dari petak 0', () => {
  startRace(['A', 'B', 'C']);
  dice({ A: 3, B: 3, C: 3, D: 3 });
  turns(2);                                       // A dan B sudah lempar, sekarang giliran C
  assert.equal(snap().turn, 'C');
  assert.equal(join('D').msg, 'Gabung');
  assert.equal(posOf('D'), 0);
  assert.deepEqual(snap().queue, ['C', 'D', 'A', 'B']);
  turns(1);                                       // C
  assert.equal(snap().turn, 'D');
  turns(1);                                       // D
  assert.equal(posOf('D'), 3);
  assert.equal(snap().turn, 'A');
});

test('petak "lempar lagi": pemain yang sama dapat giliran berikutnya', () => {
  startRace(['A', 'B'], () => game._setBoard([], [], [{ c: 3, t: 'again', to: 3 }]));
  dice({ A: 3, B: 1 });
  turns(1);
  assert.equal(P('A').v, 'again');
  assert.equal(snap().turn, 'A');
  turns(1);
  assert.equal(posOf('A'), 6);
  assert.equal(snap().turn, 'B');
});

test('ular menurunkan, tangga menaikkan', () => {
  startRace(['A', 'B'], () => game._setBoard([[7, 2]], [[4, 20]], []));
  dice({ A: 4, B: (pos) => (pos === 0 ? 1 : 6) });
  turns(2);
  assert.equal(posOf('A'), 20); assert.equal(P('A').v, 'ladder');
  turns(2);                                       // B: 1 lalu 1+6=7 = kepala ular
  assert.equal(posOf('B'), 2); assert.equal(P('B').v, 'snake');
});

test('harus pas di 100: kelebihan memantul balik, lalu pas = finish', () => {
  startRace(['A', 'B']);
  dice({ A: sprint(6), B: 1 });
  for (let i = 0; i < 40 && posOf('A') < 96; i++) turns(2);
  assert.equal(posOf('A'), 96);
  dice({ A: 6 });
  turns(2);
  assert.equal(posOf('A'), 98);                   // 96+6=102 -> 100-2
  dice({ A: sprint(6) });
  turns(2);
  assert.equal(snap().phase, 'podium');
  assert.equal(snap().finishers[0].player, 'A');
});

// ---------- finish, poin, ronde ----------
function runUntilPodium(max = 600) {
  for (let i = 0; i < max && snap().phase === 'racing'; i++) turns(1);
  return snap();
}

test('2 pemain: yang finish duluan dapat 100, ronde langsung selesai', () => {
  startRace(['A', 'B']);
  dice({ A: sprint(6), B: 1 });
  const s = runUntilPodium();
  assert.equal(s.phase, 'podium');
  assert.equal(s.endReason, 'finished');
  assert.deepEqual(s.finishers.map((f) => [f.player, f.rank, f.points]), [['A', 1, 100]]);
  const aw = Object.fromEntries(awarded);
  assert.equal(aw.A, 100);
  assert.ok(aw.B >= 1);                           // poin ikut serta buat B
  assert.equal(awarded.length, 2);
  assert.equal(completions, 0);                   // podium dulu
  mock.timers.tick(CFG.PODIUM_MS + 10);
  assert.equal(completions, 1);                   // lalu room diminta ronde baru
  assert.equal(awarded.length, 2);                // poin nggak dobel
});

test('3 pemain: tinggal 1 yang belum finish = ronde selesai', () => {
  startRace(['A', 'B', 'C']);
  dice({ A: sprint(6), B: sprint(5), C: 1 });
  const s = runUntilPodium();
  assert.deepEqual(s.finishers.map((f) => [f.player, f.points]), [['A', 100], ['B', 60]]);
  assert.deepEqual(s.closest, ['C']);
  assert.ok(Object.fromEntries(awarded).C >= 1);
});

test('4 pemain: 3 juara terisi (100/60/30), sisanya dapat poin ikut serta', () => {
  startRace(['A', 'B', 'C', 'D']);
  dice({ A: sprint(6), B: sprint(5), C: sprint(4), D: 1 });
  const s = runUntilPodium();
  assert.deepEqual(s.finishers.map((f) => [f.player, f.points]), [['A', 100], ['B', 60], ['C', 30]]);
  const aw = Object.fromEntries(awarded);
  assert.equal(aw.A, 100); assert.equal(aw.B, 60); assert.equal(aw.C, 30);
  assert.ok(aw.D >= 1);
});

test('yang sudah finish dilewati di giliran berikutnya', () => {
  startRace(['A', 'B', 'C', 'D']);
  dice({ A: sprint(6), B: 1, C: 1, D: 1 });
  for (let i = 0; i < 200 && snap().finishers.length < 1; i++) turns(1);
  assert.equal(snap().finishers[0].player, 'A');
  assert.equal(snap().phase, 'racing');
  assert.ok(!snap().queue.includes('A'));
  const q = snap().queue.length;
  assert.equal(q, 3);
});

test('timeout: ronde selesai, yang terdekat tampil, poin ikut serta sekali', () => {
  startRace(['A', 'B']);
  dice({ A: 6, B: 3 });
  turns(4);                                       // A=12, B=6
  game._pauseTurns(true);
  mock.timers.tick(CFG.ROUND_TIMEOUT_MS + 100);
  const s = snap();
  assert.equal(s.phase, 'podium');
  assert.equal(s.endReason, 'timeout');
  assert.deepEqual(s.closest, ['A', 'B']);
  assert.deepEqual([...awarded].sort(), [['A', 2], ['B', 1]]);
  mock.timers.tick(CFG.PODIUM_MS + 100);
  assert.equal(awarded.length, 2);
  assert.equal(completions, 1);
});

test('tanpa hook room (room.js belum di-patch): bikin lobi baru sendiri', () => {
  game.setBroadcaster(() => {}, null);
  game.init();
  startRace(['A', 'B']);
  dice({ A: sprint(6), B: 1 });
  runUntilPodium();
  const r = snap().round;
  plan = {};
  game._setRng();
  mock.timers.tick(CFG.PODIUM_MS + 10);
  assert.equal(snap().round, r + 1);
  assert.equal(snap().phase, 'lobby');
  assert.equal(snap().totalPlayers, 0);
});

test('onComplete() = ronde baru (lobi kosong) dengan papan baru', async () => {
  join('A');
  const r1 = snap().round;
  const res = await game.onComplete();
  assert.equal(res.success, true);
  assert.equal(snap().round, r1 + 1);
  assert.equal(snap().phase, 'lobby');
  assert.equal(snap().totalPlayers, 0);
  assert.equal(game.isComplete(), false);
});

test('reset() mulai dari ronde 1 dengan lobi kosong', () => {
  startRace(['A', 'B']);
  game.reset();
  assert.equal(snap().round, 1);
  assert.equal(snap().phase, 'lobby');
  assert.equal(snap().totalPlayers, 0);
});

test('broadcast di-throttle: banyak join bersamaan = 1 emit', () => {
  let emits = 0;
  game.setBroadcaster(() => { emits += 1; }, null);
  game.init();
  mock.timers.tick(CFG.BROADCAST_THROTTLE_MS + 10);
  emits = 0;
  for (let i = 0; i < 5; i++) join('P' + i);
  mock.timers.tick(CFG.BROADCAST_THROTTLE_MS + 10);
  assert.equal(emits, 1);
});

test('payload: lobi dan balapan membawa info giliran', () => {
  join('A'); join('B');
  let s = snap();
  assert.equal(s.phase, 'lobby');
  assert.equal(s.turn, '');
  assert.deepEqual(s.queue, ['A', 'B']);
  assert.ok(s.lobby.endsAt > Date.now());
  mock.timers.tick(CFG.LOBBY_MS);
  s = snap();
  assert.equal(s.turn, 'A');
  assert.equal(s.turnMs, TURN);
  assert.ok(s.turnAt > Date.now());
  assert.equal(typeof P('A').c, 'number');        // warna bidak
  assert.equal(s.cooldownMs, undefined);          // cooldown lempar sudah nggak ada
});

test('getAdminAnswers & buildClueList memenuhi kontrak', () => {
  join('A');
  const a = game.getAdminAnswers();
  assert.ok(a.title.includes('Ular Tangga'));
  assert.ok(a.items.some((i) => i.label === 'Pemain di papan' && i.answer === '1'));
  assert.ok(a.items.some((i) => i.label === 'Fase' && i.answer === 'lobby'));
  assert.ok(String(game.buildClueList()).includes('Ular Tangga'));
});

// ---------- item & pertarungan ----------
test('parseComment: perintah item dikenali, obrolan biasa tidak', () => {
  assert.deepEqual(game.parseComment('Serang 2!'), { answer: 'serang 2' });
  assert.deepEqual(game.parseComment('tangkis'), { answer: 'tangkis' });
  assert.equal(game.parseComment('serang dong'), null);
  assert.equal(game.parseComment('tangkis 3'), null);
});

test('item: cuma buat pemain yang sudah join, dan cuma saat balapan jalan', () => {
  join('A');
  assert.equal(use('A', 'serang').msg, 'Ronde belum jalan');        // masih lobi
  startRace(['A', 'B']);
  game._pauseTurns(true);
  assert.equal(use('Z', 'serang').msg, 'Belum bisa pakai item');    // penonton biasa
});

test('serang: kena pemain terdekat di depan, korban kebal sesudahnya', () => {
  startRace(['A', 'B', 'C']);
  dice({ A: 1, B: 4, C: 6 });
  turns(3);
  game._pauseTurns(true);
  game._giveItem('A', 'serang'); game._giveItem('A', 'serang');
  assert.equal(use('A', 'serang').ok, false);
  assert.equal(posOf('B'), 1);                    // 4 - 5, minimal petak 1
  use('A', 'serang');                             // B kebal -> kena C
  assert.equal(posOf('C'), 1);
  assert.deepEqual(P('A').i, []);
  assert.equal(use('A', 'serang').msg, 'Item tidak ada');
});

test('tangkis menahan serangan dan gigitan ular', () => {
  startRace(['A', 'B'], () => game._setBoard([[8, 2]], [], []));
  dice({ A: 1, B: 3 });
  turns(2);
  game._pauseTurns(true);
  game._giveItem('B', 'tangkis'); game._giveItem('A', 'serang');
  use('B', 'tangkis');
  assert.equal(P('B').g, 'tangkis');
  use('A', 'serang');
  assert.equal(posOf('B'), 3);
  assert.equal(P('B').g, 0);
  game._giveItem('B', 'tangkis'); use('B', 'tangkis');
  dice({ B: 5 });
  game._pauseTurns(false);
  turns(2);                                       // A lempar, lalu B: 3 + 5 = 8 = kepala ular
  assert.equal(posOf('B'), 8);
  assert.equal(P('B').v, 'shielded');
});

test('pantul: serangan balik ke penyerang', () => {
  startRace(['A', 'B']);
  dice({ A: 2, B: 3 });
  turns(2);
  game._pauseTurns(true);
  game._giveItem('B', 'pantul'); game._giveItem('A', 'serang');
  use('B', 'pantul'); use('A', 'serang');
  assert.equal(posOf('A'), 1);                    // 2 - 5, minimal 1
  assert.equal(posOf('B'), 3);
});

test('beku: giliran lempar korban berikutnya dilewati satu kali', () => {
  startRace(['A', 'B']);
  dice({ A: 1, B: 4 });
  turns(2);                                       // A=1, B=4, sekarang giliran A
  game._giveItem('A', 'beku');
  use('A', 'beku');
  assert.equal(P('B').sk, CFG.FREEZE_TURNS);
  turns(1);                                       // A lempar (=2)
  assert.equal(snap().turn, 'B');
  turns(1);                                       // giliran B dilewati
  assert.equal(posOf('B'), 4);
  assert.equal(P('B').sk, 0);
  assert.equal(snap().turn, 'A');
  assert.ok(snap().feed.some((e) => e.k === 'skip' && e.a === 'B'));
  turns(2);                                       // A lempar, B lempar lagi seperti biasa
  assert.equal(posOf('B'), 8);
});

test('tukar: dua pemain bertukar petak', () => {
  startRace(['A', 'B']);
  dice({ A: 2, B: 6 });
  turns(2);
  game._pauseTurns(true);
  game._giveItem('A', 'tukar'); use('A', 'tukar');
  assert.equal(posOf('A'), 6);
  assert.equal(posOf('B'), 2);
});

test('jebakan: korban turun TRAP_DROP petak, pemasang aman', () => {
  startRace(['A', 'B']);
  dice({ A: 6, B: 2 });
  turns(2);                                       // A=6, B=2
  game._pauseTurns(true);
  game._giveItem('A', 'jebakan'); use('A', 'jebakan');
  assert.deepEqual(snap().traps.map((t) => t[0]), [6]);
  dice({ B: 4 });
  game._pauseTurns(false);
  turns(2);                                       // A lempar (lewat jebakannya sendiri), B: 2 + 4 = 6
  assert.equal(posOf('B'), 1);                    // 6 - 8, minimal 1
  assert.equal(P('B').v, 'trap');
  assert.equal(snap().traps.length, 0);
});

test('petak misteri: item masuk tas, tas penuh', () => {
  startRace(['A', 'B'], () => game._setBoard([], [], [{ c: 2, t: 'mystery', to: 2 }, { c: 3, t: 'mystery', to: 3 }, { c: 4, t: 'mystery', to: 4 }]));
  dice({ A: 2, B: 1 });
  turns(1);                                       // A: 2
  assert.deepEqual(P('A').i, ['serang']);
  assert.equal(P('A').v, 'item');
  dice({ A: 1 });
  turns(2);                                       // B, lalu A: 3
  assert.equal(P('A').i.length, CFG.MAX_ITEMS);
  turns(2);                                       // B, lalu A: 4 (tas sudah penuh)
  assert.equal(P('A').v, 'full');
  assert.equal(P('A').i.length, CFG.MAX_ITEMS);
});

test('petak misteri: kadang maju 3-6 petak', () => {
  startRace(['A', 'B'], () => game._setBoard([], [], [{ c: 4, t: 'mystery', to: 4 }]));
  game._setRng(() => 0.6);                        // dadu 4 -> petak misteri, lalu maju 5
  turns(1);
  assert.equal(posOf('A'), 9);
  assert.equal(P('A').v, 'fwd');
});

// ---------- event global ----------
test('badai: semua pemain mundur, banner tampil lalu hilang', () => {
  startRace(['A', 'B']);
  dice({ A: 6, B: 2 });
  turns(2);                                       // A=6, B=2
  game._pauseTurns(true);
  game._startEvent('storm');
  assert.equal(snap().event.ph, 'warn');
  warm();
  assert.equal(posOf('A'), 6 - CFG.STORM_BACK);
  assert.equal(posOf('B'), 1);                    // minimal petak 1
  assert.equal(snap().event.t, 'storm');
  mock.timers.tick(CFG.EVENT_BANNER_MS + 10);
  assert.equal(snap().event, null);
});

test('angin segar: semua maju', () => {
  startRace(['A', 'B']);
  dice({ A: 6, B: 2 });
  turns(2);
  game._pauseTurns(true);
  game._startEvent('wind'); warm();
  assert.equal(posOf('A'), 6 + CFG.WIND_FWD);
  assert.equal(posOf('B'), 2 + CFG.WIND_FWD);
});

test('perisai massal: ular tidak menggigit selama SHIELD_MS', () => {
  startRace(['A', 'B'], () => game._setBoard([[8, 2]], [], []));
  dice({ A: 3, B: 3 });
  turns(2);                                       // A=3, B=3
  game._pauseTurns(true);
  game._startEvent('shield'); warm();
  dice({ A: 5 });
  game._pauseTurns(false);
  turns(1);                                       // A: 3 + 5 = 8, kepala ular
  assert.equal(posOf('A'), 8);
  game._pauseTurns(true);
  mock.timers.tick(CFG.SHIELD_MS);
  dice({ B: 5 });
  game._pauseTurns(false);
  turns(1);                                       // B: 3 + 5 = 8
  assert.equal(posOf('B'), 2);                    // perisai sudah habis
});

test('Perang Besar: serang bebas tanpa item, ada jeda antar serangan', () => {
  startRace(['A', 'B', 'C']);
  dice({ A: 1, B: 4, C: 6 });
  turns(3);
  game._pauseTurns(true);
  assert.equal(use('A', 'serang').msg, 'Item tidak ada');
  game._startEvent('war'); warm();
  use('A', 'serang');                             // gratis, kena B
  assert.equal(posOf('B'), 1);
  assert.equal(use('A', 'serang').msg, 'Terlalu cepat');
  mock.timers.tick(CFG.WAR_ATTACK_GAP_MS + 10);
  use('A', 'serang');                             // B masih kebal -> kena C
  assert.equal(posOf('C'), 1);
  mock.timers.tick(CFG.WAR_MS);
  assert.equal(use('A', 'serang').msg, 'Item tidak ada');
});

test('Rebutan Item: 5 tercepat dapat item, event selesai lebih awal, penonton non-pemain nggak bisa', () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  names.forEach((n) => join(n));                  // 6 = penuh, balapan langsung jalan
  game._pauseTurns(true);
  game._startEvent('grab');
  assert.equal(snap().event.w, '');               // kata belum dibuka saat peringatan
  warm();
  const w = snap().event.w;
  assert.ok(w);
  assert.equal(game.handleAnswer({ answer: w, player: 'Z' }).msg, 'Belum ikut main');
  assert.equal(P('Z'), undefined);                // nggak otomatis jadi pemain
  names.forEach((n) => game.handleAnswer({ answer: w, player: n }));
  const have = names.filter((n) => P(n).i.length === 1);
  assert.equal(have.length, CFG.GRAB_WINNERS);
  assert.equal(snap().event, null);
  assert.equal(game.parseComment(w), null);       // kata biasa lagi
});
