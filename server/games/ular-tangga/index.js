// Ular Tangga — balapan ke petak 100 lewat komentar "lempar".
//
// Semua penonton main BERSAMAAN (bukan bergiliran): tiap penonton punya bidak
// sendiri dan melempar dadu dengan mengetik "lempar" (alias: dadu, roll, 🎲).
// Dadu 1-6 diundi di server. Ada cooldown per penonton biar spam komentar nggak
// mempercepat lemparan. 3 penonton tercepat yang sampai petak 100 jadi pemenang
// (poin 100/60/30), lalu podium + konfeti, lalu ronde baru.
//
// Aturan papan (100 petak, diacak tiap ronde):
//  - ular: turun, tangga: naik, petak spesial: "lempar lagi" (tanpa cooldown),
//    "mundur 3", "maju 5".
//  - harus pas di petak 100: kalau lemparan melebihi 100, bidak memantul balik.
//  - satu efek per lemparan (tidak ada rantai efek), kecuali "lempar lagi" yang
//    memberi satu lemparan bonus tanpa cooldown.
//  - ronde yang habis waktu TIDAK membagi poin (poin cuma lewat ok:true di
//    handleAnswer, dan itu cuma buat finisher). Papan juara menampilkan siapa
//    yang paling dekat ke petak 100.
//
// CATATAN KONTRAK (sama seperti Labirin):
//  - handleAnswer() return { ok:false } untuk lemparan biasa. Di room.js ok:true
//    berarti "jawaban benar" -> nambah skor + emit update/leaderboard/answer:correct.
//    Kalau tiap lemparan ok:true, ratusan penonton bakal banjirin socket.
//    Lemparan biasa disiarkan lewat broadcaster (di-throttle); ok:true cuma buat
//    penonton yang finish di 3 besar.
//  - Ronde bisa selesai sendiri lewat timer (timeout / jeda podium). Buat itu game
//    butuh cara bilang "ronde selesai" ke room: argumen ke-2
//    setBroadcaster(fn, requestCompletion). Kalau argumen itu nggak ada, game
//    bikin ronde baru sendiri.

'use strict';

// ---------- konfigurasi ----------
const BOARD_SIZE = 100;
const ROLL_COOLDOWN_MS = 3000;         // jeda minimal antar lemparan per penonton
const ROUND_TIMEOUT_MS = 5 * 60 * 1000;
const PODIUM_MS = 8000;                // lama papan juara tampil sebelum ronde baru
const WINNER_POINTS = [100, 60, 30];   // poin juara 1/2/3
const WINNER_COUNT = WINNER_POINTS.length;
const BROADCAST_THROTTLE_MS = 150;     // gabung banyak lemparan jadi 1 emit
const MAX_PLAYERS_IN_PAYLOAD = 80;
const MAX_TRACKED_PLAYERS = 1000;
const MAX_COMMENT_LENGTH = 20;
const RECENT_ROLLS_IN_PAYLOAD = 5;

const SNAKE_COUNT = 8;
const LADDER_COUNT = 6;
const MIN_JUMP = 10;                   // selisih minimal naik/turun (petak)
const MAX_SNAKE_DROP = 50;             // turun terjauh lewat ular (petak)
const MAX_LADDER_RISE = 38;            // naik terjauh lewat tangga (biar papan tetap kebaca)
const BACK_STEPS = 3;
const FWD_STEPS = 5;
// jenis petak spesial: [tipe, jumlah, petak terkecil, petak terbesar]
const SPECIAL_PLAN = [
  ['again', 2, 5, 95],
  ['back', 2, 12, 96],
  ['fwd', 1, 5, 88]
];

// target rata-rata jumlah lemparan sampai finish (diukur lewat simulasi)
const TARGET_ROLLS_MIN = 32;
const TARGET_ROLLS_MAX = 48;
const SIM_RUNS = 300;
const BOARD_ATTEMPTS = 200;

// ---------- acak (bisa diganti buat tes) ----------
let rng = Math.random;
function randInt(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
function rowOf(cell) { return Math.floor((cell - 1) / 10); }

// ---------- parser komentar ----------
const ROLL_WORDS = new Set(['lempar', 'dadu', 'roll', '🎲']);

// true kalau komentar PERSIS satu kata perintah lempar (boleh diakhiri tanda
// baca). Obrolan biasa ("lempar dong", "dadunya mana") diabaikan.
function isRollComment(text) {
  if (typeof text !== 'string') return false;
  let s = text.trim().toLowerCase();
  if (!s || s.length > MAX_COMMENT_LENGTH) return false;
  s = s.replace(/\uFE0F/g, '').replace(/[\s!.?,]+$/g, '');
  return ROLL_WORDS.has(s);
}

// ---------- papan ----------
// effects: Map petak -> { type, to }. Tipe: snake | ladder | again | back | fwd.
function buildEffects(snakes, ladders, specials) {
  const effects = new Map();
  for (const [from, to] of snakes) effects.set(from, { type: 'snake', to });
  for (const [from, to] of ladders) effects.set(from, { type: 'ladder', to });
  for (const s of specials) effects.set(s.c, { type: s.t, to: s.to });
  return effects;
}

// Hitung hasil satu lemparan dari posisi `pos` dengan dadu `d`.
// Fungsi murni (nggak nyentuh state) biar gampang dites.
// Return { m, t, v }: m = petak mendarat (setelah pantulan), t = petak akhir
// (setelah efek), v = jenis efek atau null.
function applyRoll(effects, pos, d) {
  let m = pos + d;
  if (m > BOARD_SIZE) m = BOARD_SIZE - (m - BOARD_SIZE);   // pantul dari 100
  const eff = effects.get(m);
  if (!eff) return { m, t: m, v: null };
  if (eff.type === 'again') return { m, t: m, v: 'again' };
  return { m, t: eff.to, v: eff.type };
}

// Simulasi Monte Carlo: rata-rata jumlah lemparan (yang kena cooldown) sampai
// finish untuk satu pemain.
function simulate(effects, runs) {
  let total = 0;
  for (let i = 0; i < runs; i++) {
    let pos = 0, turns = 0, free = false;
    for (let guard = 0; guard < 5000 && pos !== BOARD_SIZE; guard++) {
      const r = applyRoll(effects, pos, randInt(1, 6));
      pos = r.t;
      if (free) free = false; else turns += 1;
      if (r.v === 'again') free = true;
    }
    total += turns;
  }
  return total / runs;
}

// Satu percobaan menyusun papan. Return null kalau gagal menaruh semuanya.
function tryGenerateBoard() {
  const used = new Set([1, BOARD_SIZE]);   // petak 1 dan 100 bebas efek
  const snakes = [], ladders = [], specials = [];

  for (let i = 0; i < SNAKE_COUNT; i++) {
    let placed = false;
    for (let t = 0; t < 60 && !placed; t++) {
      const head = randInt(12, 99);
      const tail = randInt(Math.max(2, head - MAX_SNAKE_DROP), head - MIN_JUMP);
      if (tail < 2 || used.has(head) || used.has(tail) || rowOf(head) === rowOf(tail)) continue;
      used.add(head); used.add(tail);
      snakes.push([head, tail]);
      placed = true;
    }
    if (!placed) return null;
  }
  for (let i = 0; i < LADDER_COUNT; i++) {
    let placed = false;
    for (let t = 0; t < 60 && !placed; t++) {
      const bottom = randInt(2, 88);
      const top = randInt(bottom + MIN_JUMP, Math.min(99, bottom + MAX_LADDER_RISE));
      if (used.has(bottom) || used.has(top) || rowOf(bottom) === rowOf(top)) continue;
      used.add(bottom); used.add(top);
      ladders.push([bottom, top]);
      placed = true;
    }
    if (!placed) return null;
  }
  for (const [type, count, lo, hi] of SPECIAL_PLAN) {
    for (let i = 0; i < count; i++) {
      let placed = false;
      for (let t = 0; t < 60 && !placed; t++) {
        const c = randInt(lo, hi);
        if (used.has(c)) continue;
        const to = type === 'back' ? Math.max(1, c - BACK_STEPS)
          : type === 'fwd' ? Math.min(BOARD_SIZE, c + FWD_STEPS)
          : c;
        // tujuan loncat nggak boleh jatuh di petak berefek (biar nggak kelihatan rantai)
        if (type !== 'again' && used.has(to)) continue;
        used.add(c);
        if (type !== 'again') used.add(to);   // cadangkan tujuan, jangan sampai ketimpa spesial lain
        specials.push({ c, t: type, to });
        placed = true;
      }
      if (!placed) return null;
    }
  }
  return { snakes, ladders, specials };
}

// Papan tetap, dipakai kalau generator acak gagal total (nggak boleh sampai ronde
// tanpa papan). Memenuhi aturan yang sama dengan papan acak.
const FALLBACK_BOARD = {
  snakes: [[97, 61], [88, 52], [76, 41], [69, 33], [62, 27], [54, 19], [47, 15], [35, 14]],
  ladders: [[4, 26], [9, 31], [21, 42], [28, 57], [36, 64], [51, 72]],
  specials: [
    { c: 8, t: 'again', to: 8 }, { c: 45, t: 'again', to: 45 },
    { c: 58, t: 'back', to: 55 }, { c: 83, t: 'back', to: 80 },
    { c: 12, t: 'fwd', to: 17 }
  ]
};

function fallbackBoard() {
  const b = JSON.parse(JSON.stringify(FALLBACK_BOARD));
  const effects = buildEffects(b.snakes, b.ladders, b.specials);
  return { ...b, effects, avgRolls: Math.round(simulate(effects, SIM_RUNS) * 10) / 10 };
}

// Buat papan acak yang rata-rata lemparannya masuk target. Kalau sampai
// BOARD_ATTEMPTS belum ketemu, pakai papan yang paling dekat ke target.
function generateBoard() {
  const mid = (TARGET_ROLLS_MIN + TARGET_ROLLS_MAX) / 2;
  let best = null;
  for (let attempt = 0; attempt < BOARD_ATTEMPTS; attempt++) {
    const b = tryGenerateBoard();
    if (!b) continue;
    const effects = buildEffects(b.snakes, b.ladders, b.specials);
    const avg = simulate(effects, SIM_RUNS);
    const board = { ...b, effects, avgRolls: Math.round(avg * 10) / 10 };
    if (avg >= TARGET_ROLLS_MIN && avg <= TARGET_ROLLS_MAX) return board;
    if (!best || Math.abs(avg - mid) < Math.abs(best.avgRolls - mid)) best = board;
  }
  return best || fallbackBoard();
}

// ---------- state ----------
let state = null;
let round = 0;
let rollSeq = 0;          // nomor lemparan, naik terus lintas ronde
let arriveSeq = 0;        // urutan tiba di petak (buat tie-break)
let broadcast = null;
let requestCompletion = null;
let roundTimer = null;
let podiumTimer = null;
let broadcastTimer = null;

function clearTimers() {
  clearTimeout(roundTimer);
  clearTimeout(podiumTimer);
  clearTimeout(broadcastTimer);
  roundTimer = podiumTimer = broadcastTimer = null;
}

function unref(t) { if (t && t.unref) t.unref(); return t; }

function scheduleBroadcast() {
  if (!broadcast || broadcastTimer) return;
  broadcastTimer = unref(setTimeout(() => {
    broadcastTimer = null;
    if (broadcast) broadcast();
  }, BROADCAST_THROTTLE_MS));
}

function newRound() {
  clearTimers();
  round += 1;
  const board = generateBoard();
  const now = Date.now();
  state = {
    phase: 'racing',            // racing -> podium -> done
    round,
    board,
    players: new Map(),
    finishers: [],
    recent: [],
    endReason: null,
    startedAt: now,
    endsAt: now + ROUND_TIMEOUT_MS
  };
  roundTimer = unref(setTimeout(() => endRound('timeout'), ROUND_TIMEOUT_MS));
  scheduleBroadcast();
}

// Ronde berakhir (3 juara terisi atau waktu habis): tampilkan papan juara dulu,
// baru minta room bikin ronde berikutnya.
function endRound(reason) {
  if (!state || state.phase !== 'racing') return;
  clearTimeout(roundTimer);
  roundTimer = null;
  state.phase = 'podium';
  state.endReason = reason;
  state.podiumEndsAt = Date.now() + PODIUM_MS;
  scheduleBroadcast();
  podiumTimer = unref(setTimeout(finishPodium, PODIUM_MS));
}

function finishPodium() {
  podiumTimer = null;
  if (!state) return;
  state.phase = 'done';
  if (typeof requestCompletion === 'function') {
    // room yang nentuin: ronde baru di game ini, atau rotasi ke game lain.
    requestCompletion();
  } else {
    newRound();
  }
}

function shortName(name) {
  return String(name).slice(0, 24);
}

// Urutan "terdepan": yang sudah finish (urut juara), lalu petak paling tinggi;
// kalau sama petaknya, yang tiba duluan menang.
function compareProgress(a, b) {
  if (a.rank && b.rank) return a.rank - b.rank;
  if (a.rank) return -1;
  if (b.rank) return 1;
  return b.pos - a.pos || a.arrive - b.arrive;
}

// Penuh? buang pemain tak selesai yang paling lama diam.
function evictIdlePlayer() {
  let victim = null, victimName = null;
  for (const [name, p] of state.players) {
    if (p.rank) continue;
    if (!victim || p.lastActive < victim.lastActive) { victim = p; victimName = name; }
  }
  if (victimName === null) return false;
  state.players.delete(victimName);
  return true;
}

// ---------- kontrak game ----------
module.exports = {
  id: 'ular-tangga',

  // Argumen ke-2 opsional (lihat patch room.js).
  setBroadcaster(fn, completeFn) {
    broadcast = fn;
    requestCompletion = typeof completeFn === 'function' ? completeFn : null;
  },

  init() {
    round = 0;
    newRound();
  },

  parseComment(text) {
    if (!isRollComment(text)) return null;
    return { answer: 'lempar' };
  },

  handleAnswer({ answer, player }) {
    if (!state || state.phase !== 'racing') return { ok: false, msg: 'Ronde belum jalan' };
    const name = player ? String(player) : '';
    if (!name) return { ok: false, msg: 'Pemain tidak valid' };
    if (!isRollComment(String(answer || ''))) return { ok: false, msg: 'Bukan perintah lempar' };

    const now = Date.now();
    let p = state.players.get(name);
    if (!p) {
      if (state.players.size >= MAX_TRACKED_PLAYERS && !evictIdlePlayer()) return { ok: false, msg: 'Papan penuh' };
      p = { pos: 0, lockedUntil: 0, rank: 0, rolls: 0, joinedAt: now, lastActive: now, arrive: 0, finishMs: 0, q: 0, d: 0, f: 0, m: 0, v: null };
      state.players.set(name, p);
    }
    if (p.rank) return { ok: false, msg: 'Sudah finish' };
    if (now < p.lockedUntil) return { ok: false, msg: 'Terlalu cepat' };

    const d = randInt(1, 6);
    const from = p.pos;
    const r = applyRoll(state.board.effects, from, d);
    rollSeq += 1;
    p.pos = r.t;
    p.rolls += 1;
    p.lastActive = now;
    p.arrive = ++arriveSeq;
    p.q = rollSeq; p.d = d; p.f = from; p.m = r.m; p.v = r.v;
    // "lempar lagi" = lemparan berikutnya tanpa cooldown
    p.lockedUntil = r.v === 'again' ? now : now + ROLL_COOLDOWN_MS;

    state.recent.push({ s: rollSeq, n: shortName(name), d, f: from, t: r.t, v: r.v });
    if (state.recent.length > RECENT_ROLLS_IN_PAYLOAD) state.recent.shift();

    if (r.t !== BOARD_SIZE) {
      scheduleBroadcast();
      return { ok: false, msg: 'Dilempar' };
    }

    p.rank = state.finishers.length + 1;
    p.finishMs = now - state.startedAt;
    const points = WINNER_POINTS[p.rank - 1] || 0;
    state.finishers.push({ player: shortName(name), rank: p.rank, points, ms: p.finishMs, rolls: p.rolls });
    if (state.finishers.length >= WINNER_COUNT) endRound('finished');
    else scheduleBroadcast();

    return {
      ok: true,
      points,
      msg: `Juara ${p.rank}!`,
      meta: { rank: p.rank, ms: p.finishMs }
    };
  },

  isComplete() {
    return !!state && state.phase === 'done';
  },

  // Dipanggil room buat ronde baru (ronde selesai, skip vote, ronde pertama).
  async onComplete() {
    newRound();
    return { success: true, source: 'ular-tangga-generated' };
  },

  reset() {
    round = 0;
    newRound();
  },

  buildClueList() {
    return `Ular Tangga - Ronde ${state ? state.round : 1}`;
  },

  buildStatePayload() {
    if (!state) {
      return {
        phase: 'racing', round: 1, size: BOARD_SIZE, snakes: [], ladders: [], specials: [],
        endsAt: 0, serverTime: Date.now(), cooldownMs: ROLL_COOLDOWN_MS,
        winnersNeeded: WINNER_COUNT, totalPlayers: 0, players: [], finishers: [],
        closest: [], recentRolls: []
      };
    }

    const ranked = [...state.players.entries()].sort(([, a], [, b]) => compareProgress(a, b));

    const players = ranked.slice(0, MAX_PLAYERS_IN_PAYLOAD).map(([name, p]) => ({
      n: shortName(name), p: p.pos, r: p.rank,
      q: p.q, d: p.d, f: p.f, m: p.m, v: p.v     // lemparan terakhir, buat animasi lompat
    }));

    const closest = state.phase !== 'racing' && state.finishers.length < WINNER_COUNT
      ? ranked.filter(([, p]) => !p.rank).slice(0, WINNER_COUNT - state.finishers.length)
          .map(([name]) => shortName(name))
      : [];

    return {
      phase: state.phase,
      round: state.round,
      size: BOARD_SIZE,
      snakes: state.board.snakes,
      ladders: state.board.ladders,
      specials: state.board.specials,
      endsAt: state.endsAt,
      serverTime: Date.now(),
      endReason: state.endReason,
      cooldownMs: ROLL_COOLDOWN_MS,
      winnersNeeded: WINNER_COUNT,
      totalPlayers: state.players.size,
      players,
      finishers: state.finishers,
      closest,
      recentRolls: state.recent
    };
  },

  getAdminAnswers() {
    if (!state) return { title: 'Ular Tangga', items: [] };
    const items = [
      { label: 'Rata-rata lemparan (simulasi)', answer: String(state.board.avgRolls), solved: false },
      { label: 'Ular / Tangga / Spesial', answer: `${state.board.snakes.length} / ${state.board.ladders.length} / ${state.board.specials.length}`, solved: false },
      { label: 'Pemain di papan', answer: String(state.players.size), solved: false },
      ...state.finishers.map((f) => ({ label: `Juara ${f.rank}`, answer: f.player, solved: true }))
    ];
    return { title: `Ular Tangga - Ronde ${state.round}`, items };
  },

  // ---------- dipakai test-ular-tangga.js ----------
  _isRollComment: isRollComment,
  _applyRoll: applyRoll,
  _generateBoard: generateBoard,
  _tryGenerateBoard: tryGenerateBoard,
  _fallbackBoard: fallbackBoard,
  _buildEffects: buildEffects,
  _simulate: simulate,
  _setRng(fn) { rng = typeof fn === 'function' ? fn : Math.random; },
  // Pasang papan buatan tangan ke ronde yang sedang jalan.
  _setBoard(snakes, ladders, specials) {
    state.board = {
      snakes, ladders, specials,
      effects: buildEffects(snakes, ladders, specials),
      avgRolls: 0
    };
  },
  _config: {
    BOARD_SIZE, ROLL_COOLDOWN_MS, ROUND_TIMEOUT_MS, PODIUM_MS, WINNER_POINTS,
    MAX_PLAYERS_IN_PAYLOAD, MAX_TRACKED_PLAYERS, BROADCAST_THROTTLE_MS,
    SNAKE_COUNT, LADDER_COUNT, MIN_JUMP, MAX_SNAKE_DROP, MAX_LADDER_RISE, BACK_STEPS, FWD_STEPS,
    TARGET_ROLLS_MIN, TARGET_ROLLS_MAX
  }
};
