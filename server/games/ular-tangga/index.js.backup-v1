// Ular Tangga — balapan ke petak 100, dadu dilempar OTOMATIS BERGILIRAN.
//
// Alur satu ronde:
//  1. LOBI: penonton komen "join" (alias: main, gabung) buat ikut. Begitu ada
//     LOBBY_MIN pemain, hitung mundur LOBBY_MS mulai; yang join selama hitung
//     mundur ikut main. Papan penuh (MAX_PLAYERS) = langsung mulai.
//  2. BALAPAN: server melempar dadu sendiri, satu pemain per giliran, urut
//     sesuai urutan join (jeda TURN_MS per giliran). Penonton nggak perlu
//     ngetik "lempar", cukup fokus ke battle (item + event). Yang telat join
//     tetap bisa ikut kapan saja: masuk antrean paling belakang, mulai dari
//     petak 0.
//  3. 3 pemain tercepat di petak 100 jadi juara (poin 100/60/30). Ronde juga
//     selesai kalau tinggal 1 pemain yang belum finish (nggak ada lawan lagi)
//     atau waktu habis. Lalu podium + konfeti, lalu balik ke lobi.
//
// Aturan papan (100 petak, diacak tiap ronde):
//  - ular: turun, tangga: naik, petak spesial: "lempar lagi" (pemain yang sama
//    lempar lagi di giliran berikutnya) dan petak misteri (item atau maju/mundur).
//  - harus pas di petak 100: kalau lemparan melebihi 100, bidak memantul balik.
//  - satu efek per lemparan (tidak ada rantai efek).
//  - beku = giliran lempar korban berikutnya dilewati (bukan lagi hitungan detik).
//
// CATATAN KONTRAK:
//  - Lemparan terjadi dari timer di dalam game, bukan dari komentar, jadi
//    handleAnswer() selalu return { ok:false } (join, item, rebutan item).
//    Poin juara dikirim lewat awardFn (argumen ke-3 setBroadcaster), sama
//    seperti poin ikut serta. Tanpa awardFn game tetap jalan, cuma tanpa poin.
//  - Ronde selesai sendiri lewat timer (timeout / jeda podium / lobi sepi).
//    Game bilang "ronde selesai" ke room lewat argumen ke-2 setBroadcaster
//    (requestCompletion). Kalau argumen itu nggak ada, game bikin ronde baru
//    sendiri.

'use strict';

// ---------- konfigurasi ----------
const BOARD_SIZE = 100;
const TURN_MS = 3000;                  // jeda sebelum dadu otomatis dilempar tiap giliran
const LOBBY_MIN = 2;                   // pemain minimal buat memulai hitung mundur
const LOBBY_MS = 20000;                // lama hitung mundur lobi (setelah LOBBY_MIN terpenuhi)
const LOBBY_IDLE_MS = 3 * 60 * 1000;   // lobi sepi segini lama (pemain < LOBBY_MIN) = ronde dilewati
const MAX_PLAYERS = 6;                 // pemain maksimal per ronde (lobi penuh = langsung mulai)
const ROUND_TIMEOUT_MS = 20 * 60 * 1000;   // dihitung sejak balapan mulai, bukan sejak lobi
const PODIUM_MS = 8000;                // lama papan juara tampil sebelum ronde baru
const WINNER_POINTS = [100, 60, 30];   // poin juara 1/2/3
const WINNER_COUNT = WINNER_POINTS.length;
const PARTICIPATION_MAX = 20;          // poin maks buat yang belum finish (sebanding petak saat ronde berakhir)
const BROADCAST_THROTTLE_MS = 150;     // gabung banyak perubahan jadi 1 emit
const MAX_COMMENT_LENGTH = 20;
const RECENT_ROLLS_IN_PAYLOAD = 5;

const SNAKE_COUNT = 8;
const LADDER_COUNT = 6;
const MIN_JUMP = 10;                   // selisih minimal naik/turun (petak)
const MAX_SNAKE_DROP = 60;             // turun terjauh lewat ular (petak)
const MAX_LADDER_RISE = 25;            // naik terjauh lewat tangga (biar papan tetap kebaca)
const BACK_STEPS = 3;
const FWD_STEPS = 5;
// jenis petak spesial: [tipe, jumlah, petak terkecil, petak terbesar]
const SPECIAL_PLAN = [
  ['again', 2, 5, 95],
  ['mystery', 5, 6, 96]       // petak misteri: item acak atau maju/mundur 3-6
];

// item & pertarungan
const MAX_ITEMS = 2;                   // tas item per penonton
const ATTACK_BACK = 5;                 // serang: target mundur segini petak
const FREEZE_TURNS = 1;                // beku: target kehilangan segini giliran lempar
const IMMUNE_MS = 10000;               // kebal setelah kena serang/beku/tukar
const TRAP_DROP = 8;                   // jebakan: korban turun segini petak
const MAX_TRAPS = 12;
const MYSTERY_MOVE_MIN = 3;
const MYSTERY_MOVE_MAX = 6;
const FEED_KEEP = 6;
const ITEM_WEIGHTS = [['serang', 3], ['beku', 2], ['tangkis', 2], ['pantul', 1], ['tukar', 1], ['jebakan', 2]];
const ITEM_ALIASES = { serang: 'serang', hajar: 'serang', beku: 'beku', bekukan: 'beku', tangkis: 'tangkis', perisai: 'tangkis', pantul: 'pantul', tukar: 'tukar', jebakan: 'jebakan' };
const TARGETED = new Set(['serang', 'beku', 'tukar']);

// event global (tiap EVENT_MIN_MS..EVENT_MAX_MS, didahului peringatan)
const EVENT_MIN_MS = 2 * 60 * 1000;
const EVENT_MAX_MS = 3 * 60 * 1000;
const EVENT_WARN_MS = 5000;            // peringatan di layar sebelum event jalan
const EVENT_BANNER_MS = 3000;          // lama banner badai / angin
const STORM_BACK = 3;                  // badai: semua mundur
const WIND_FWD = 3;                    // angin segar: semua maju
const SHIELD_MS = 15000;               // perisai massal: ular nggak menggigit
const WAR_MS = 20000;                  // Perang Besar: serang/beku/tukar gratis
const WAR_ATTACK_GAP_MS = 2000;        // jeda antar serangan gratis per penonton
const GRAB_MS = 15000;                 // Rebutan Item: lama kata dibuka
const GRAB_WINNERS = 5;
const GRAB_WORDS = ['gas', 'rebut', 'sikat', 'kocok', 'ambil', 'bagi', 'mantap', 'cepat'];
const EVENT_WEIGHTS = [['storm', 2], ['wind', 2], ['shield', 2], ['war', 2], ['grab', 3]];

// target rata-rata jumlah lemparan sampai finish (diukur lewat simulasi).
// Dengan giliran bergantian, durasi ronde ~ lemparan x jumlah pemain x TURN_MS,
// jadi targetnya jauh lebih kecil daripada versi paralel.
const TARGET_ROLLS_MIN = 45;
const TARGET_ROLLS_MAX = 65;
const SIM_RUNS = 300;
const BOARD_ATTEMPTS = 200;

// ---------- acak (bisa diganti buat tes) ----------
let rng = Math.random;
function randInt(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
function rowOf(cell) { return Math.floor((cell - 1) / 10); }

// ---------- parser komentar ----------
const JOIN_WORDS = new Set(['join', 'main', 'gabung']);

// true kalau komentar PERSIS satu kata perintah join (boleh diakhiri tanda
// baca). Obrolan biasa ("mau join dong", "main apa ini") diabaikan.
function isJoinComment(text) {
  if (typeof text !== 'string') return false;
  let s = text.trim().toLowerCase();
  if (!s || s.length > MAX_COMMENT_LENGTH) return false;
  s = s.replace(/[\s!.?,]+$/g, '');
  return JOIN_WORDS.has(s);
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
  if (eff.type === 'again' || eff.type === 'mystery') return { m, t: m, v: eff.type };
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
  snakes: [[96, 78], [89, 70], [83, 64], [72, 55], [61, 42], [52, 35], [44, 26], [27, 7]],
  ladders: [[3, 24], [22, 43], [34, 57], [59, 81], [9, 30], [41, 62]],
  specials: [
    { c: 8, t: 'again', to: 8 }, { c: 45, t: 'again', to: 45 },
    { c: 12, t: 'mystery', to: 12 }, { c: 16, t: 'mystery', to: 16 }, { c: 58, t: 'mystery', to: 58 },
    { c: 69, t: 'mystery', to: 69 }, { c: 85, t: 'mystery', to: 85 }
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
let awardPoints = null;
let evSeq = 0;           // nomor kejadian pertarungan (feed), naik terus lintas ronde
let roundTimer = null;
let podiumTimer = null;
let broadcastTimer = null;
let eventTimer = null;
let turnTimer = null;
let lobbyTimer = null;
let lobbyIdleTimer = null;
let EVENTS_ENABLED = true;
let TURNS_PAUSED = false;   // cuma dipakai tes

function clearTimers() {
  clearTimeout(roundTimer);
  clearTimeout(podiumTimer);
  clearTimeout(broadcastTimer);
  clearTimeout(eventTimer);
  clearTimeout(turnTimer);
  clearTimeout(lobbyTimer);
  clearTimeout(lobbyIdleTimer);
  roundTimer = podiumTimer = broadcastTimer = eventTimer = turnTimer = lobbyTimer = lobbyIdleTimer = null;
}

function unref(t) { if (t && t.unref) t.unref(); return t; }

function scheduleBroadcast() {
  if (!broadcast || broadcastTimer) return;
  broadcastTimer = unref(setTimeout(() => {
    broadcastTimer = null;
    if (broadcast) broadcast();
  }, BROADCAST_THROTTLE_MS));
}

// Ronde baru selalu mulai dari LOBI: papan sudah jadi, nunggu pemain join.
function newRound() {
  clearTimers();
  round += 1;
  const board = generateBoard();
  state = {
    phase: 'lobby',             // lobby -> racing -> podium -> done
    round,
    board,
    players: new Map(),
    order: [],                  // urutan giliran = urutan join
    turn: null,                 // nama pemain yang gilirannya sedang menunggu
    turnAt: 0,                  // kapan dadunya otomatis dilempar
    finishers: [],
    nextColor: 0,
    awarded: false,
    traps: new Map(),          // petak -> { owner, c }
    feed: [],
    event: null,               // { t, ph: 'warn'|'active', at, end, w, got }
    shieldUntil: 0,
    warUntil: 0,
    recent: [],
    endReason: null,
    lobbyEndsAt: 0,
    startedAt: 0,
    endsAt: 0
  };
  lobbyIdleTimer = unref(setTimeout(lobbyIdleExpired, LOBBY_IDLE_MS));
  scheduleBroadcast();
}

// Lobi sepi terlalu lama: lewati ronde ini (penting buat rotasi Game Acak,
// biar nggak nyangkut di game yang nggak ada pemainnya).
function lobbyIdleExpired() {
  lobbyIdleTimer = null;
  if (!state || state.phase !== 'lobby' || lobbyTimer) return;
  clearTimers();
  state.phase = 'done';
  if (typeof requestCompletion === 'function') requestCompletion();
  else newRound();
}

// Pemain ke-LOBBY_MIN gabung -> hitung mundur mulai. Penuh -> langsung mulai.
function joinPlayer(name, now) {
  if (!state || (state.phase !== 'lobby' && state.phase !== 'racing')) return { ok: false, msg: 'Ronde sudah selesai' };
  if (state.players.has(name)) return { ok: false, msg: 'Sudah ikut' };
  if (state.players.size >= MAX_PLAYERS) return { ok: false, msg: 'Papan penuh' };
  state.players.set(name, newPlayer(now));
  state.order.push(name);              // telat join = antre paling belakang
  pushFeed('join', name, '', '');
  if (state.phase === 'lobby') {
    if (state.players.size >= MAX_PLAYERS) {
      clearTimeout(lobbyTimer);
      startRace();
    } else if (state.players.size >= LOBBY_MIN && !lobbyTimer) {
      state.lobbyEndsAt = now + LOBBY_MS;
      lobbyTimer = unref(setTimeout(startRace, LOBBY_MS));
    }
  }
  scheduleBroadcast();
  return { ok: false, msg: 'Gabung' };
}

function startRace() {
  lobbyTimer = null;
  if (!state || state.phase !== 'lobby' || state.players.size < LOBBY_MIN) return;
  clearTimeout(lobbyIdleTimer);
  lobbyIdleTimer = null;
  const now = Date.now();
  state.phase = 'racing';
  state.lobbyEndsAt = 0;
  state.startedAt = now;
  state.endsAt = now + ROUND_TIMEOUT_MS;
  roundTimer = unref(setTimeout(() => endRound('timeout'), ROUND_TIMEOUT_MS));
  state.turn = state.order[0];
  scheduleEvent();
  scheduleTurn();
  scheduleBroadcast();
}

// ---------- giliran otomatis ----------
function scheduleTurn() {
  clearTimeout(turnTimer);
  if (TURNS_PAUSED) { turnTimer = null; return; }
  state.turnAt = Date.now() + TURN_MS;
  turnTimer = unref(setTimeout(takeTurn, TURN_MS));
}

// Pindah ke pemain berikutnya (yang belum finish) menurut urutan join.
function advanceTurn() {
  if (!state || state.phase !== 'racing') return;
  const n = state.order.length;
  const idx = state.order.indexOf(state.turn);
  for (let i = 1; i <= n; i++) {
    const nm = state.order[(((idx + i) % n) + n) % n];
    const q = state.players.get(nm);
    if (q && !q.rank) {
      state.turn = nm;
      scheduleTurn();
      scheduleBroadcast();
      return;
    }
  }
  endRound('finished');
}

// Ronde selesai kalau 3 juara terisi, atau sisa pemain yang belum finish < 2.
function checkRoundEnd() {
  let unfinished = 0;
  for (const q of state.players.values()) if (!q.rank) unfinished += 1;
  if (state.finishers.length >= WINNER_COUNT || unfinished < 2) {
    endRound('finished');
    return true;
  }
  return false;
}

// Satu lemparan buat `name`. Return hasil applyRoll (r.t = petak akhir, r.v = efek).
function doRoll(name, p, now) {
  const d = randInt(1, 6);
  const from = p.pos;
  const r = applyRoll(state.board.effects, from, d);
  resolveEffects(r, p, name);
  rollSeq += 1;
  p.pos = r.t;
  p.rolls += 1;
  p.lastActive = now;
  p.arrive = ++arriveSeq;
  p.q = rollSeq; p.d = d; p.f = from; p.m = r.m; p.v = r.v;
  state.recent.push({ s: rollSeq, n: shortName(name), d, f: from, t: r.t, v: r.v, it: r.it || '' });
  if (state.recent.length > RECENT_ROLLS_IN_PAYLOAD) state.recent.shift();
  return r;
}

function takeTurn() {
  turnTimer = null;
  if (!state || state.phase !== 'racing') return;
  const now = Date.now();
  const name = state.turn;
  const p = name == null ? null : state.players.get(name);
  if (!p || p.rank) { advanceTurn(); return; }

  if (p.skip > 0) {                     // kena beku: giliran dilewati
    p.skip -= 1;
    pushFeed('skip', name, '', 'beku');
    scheduleBroadcast();
    advanceTurn();
    return;
  }

  const r = doRoll(name, p, now);

  if (r.t === BOARD_SIZE) {
    p.rank = state.finishers.length + 1;
    p.finishMs = now - state.startedAt;
    const points = WINNER_POINTS[p.rank - 1] || 0;
    state.finishers.push({ player: shortName(name), rank: p.rank, points, ms: p.finishMs, rolls: p.rolls });
    if (points && awardPoints) awardPoints(name, points);
    if (checkRoundEnd()) return;
    scheduleBroadcast();
    advanceTurn();
    return;
  }

  scheduleBroadcast();
  if (r.v === 'again') scheduleTurn();  // pemain yang sama lempar lagi
  else advanceTurn();
}

// Ronde berakhir (juara terisi, tinggal 1 pemain, atau waktu habis): tampilkan
// papan juara dulu, baru minta room bikin ronde berikutnya.
function endRound(reason) {
  if (!state || state.phase !== 'racing') return;
  clearTimeout(roundTimer);
  roundTimer = null;
  clearTimeout(turnTimer);
  turnTimer = null;
  state.turn = null;
  state.phase = 'podium';
  state.endReason = reason;
  clearTimeout(eventTimer);
  eventTimer = null;
  state.event = null;
  awardParticipation();
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

// Poin hiburan buat yang belum finish: sebanding petak saat ronde berakhir.
// Cuma sekali per ronde, dan cuma kalau room menyediakan awardFn.
function awardParticipation() {
  if (!state || state.awarded) return;
  state.awarded = true;
  if (!awardPoints) return;
  for (const [name, p] of state.players) {
    if (p.rank || p.pos <= 0) continue;
    const pts = Math.max(1, Math.round((p.pos / BOARD_SIZE) * PARTICIPATION_MAX));
    p.bonus = pts;
    awardPoints(name, pts);
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

// Antrean giliran: mulai dari yang sedang menunggu (balapan) / urutan join (lobi).
function turnQueue() {
  if (!state) return [];
  if (state.phase === 'lobby') return state.order.map(shortName);
  if (state.turn == null) return [];
  const n = state.order.length;
  const idx = state.order.indexOf(state.turn);
  const out = [];
  for (let i = 0; i < n; i++) {
    const nm = state.order[(idx + i) % n];
    const q = state.players.get(nm);
    if (q && !q.rank) out.push(shortName(nm));
  }
  return out;
}

// ---------- item & pertarungan ----------
function parseItemCommand(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim().toLowerCase();
  if (!s || s.length > MAX_COMMENT_LENGTH) return null;
  s = s.replace(/[\s!.?,]+$/g, '');
  const m = /^([a-z]+)(?: (\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const kind = ITEM_ALIASES[m[1]];
  if (!kind || (m[2] && !TARGETED.has(kind))) return null;
  return { kind, arg: m[2] ? Number(m[2]) : 0 };
}

function pickItem() {
  const total = ITEM_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [id, w] of ITEM_WEIGHTS) { r -= w; if (r < 0) return id; }
  return ITEM_WEIGHTS[0][0];
}

function pushFeed(k, a, b, it) {
  state.feed.push({ s: ++evSeq, k, a: shortName(a), b: b ? shortName(b) : '', it });
  if (state.feed.length > FEED_KEEP) state.feed.shift();
}

// Efek petak/jebakan/tangkis untuk satu lemparan. Mengubah r (r.t, r.v, r.it).
function resolveEffects(r, p, name) {
  if (r.v === 'mystery') {
    const x = rng();
    if (x < 0.5) {
      const it = pickItem();
      if (p.items.length < MAX_ITEMS) { p.items.push(it); r.v = 'item'; r.it = it; pushFeed('item', name, '', it); }
      else r.v = 'full';
    } else {
      const n = randInt(MYSTERY_MOVE_MIN, MYSTERY_MOVE_MAX);
      if (x < 0.75) { r.t = Math.min(BOARD_SIZE - 1, r.m + n); r.v = 'fwd'; }
      else { r.t = Math.max(1, r.m - n); r.v = 'back'; }
    }
  } else if (r.v === 'snake' && state.shieldUntil > Date.now()) {
    r.t = r.m; r.v = 'shielded';                  // perisai massal
  } else if (r.v === 'snake' && p.guard === 'tangkis') {
    p.guard = null; r.t = r.m; r.v = 'shielded';
    pushFeed('block', name, '', 'tangkis');
  } else if (r.v === null) {
    const trap = state.traps.get(r.t);
    if (trap && trap.owner !== name) {
      state.traps.delete(r.t);
      if (p.guard === 'tangkis') { p.guard = null; pushFeed('block', name, '', 'tangkis'); }
      else { r.t = Math.max(1, r.t - TRAP_DROP); r.v = 'trap'; pushFeed('trap', trap.owner, name, 'jebakan'); }
    }
  }
}

// Target: "serang" = pemain terdekat di depan (yang nggak kebal); "serang N" = peringkat N.
function findTarget(name, me, arg, now) {
  const ranked = [...state.players.entries()].sort(([, a], [, b]) => compareProgress(a, b));
  let cand = null;
  if (arg) {
    cand = ranked[arg - 1];
    if (!cand) return { err: 'Peringkat tidak ada' };
  } else {
    for (const e of ranked) {
      const [n, q] = e;
      if (n === name || q.rank || q.pos <= me.pos || now < q.immuneUntil) continue;
      if (!cand || q.pos < cand[1].pos) cand = e;
    }
    if (!cand) return { err: 'Tidak ada target' };
  }
  const [tn, tp] = cand;
  if (tn === name) return { err: 'Tidak bisa target diri sendiri' };
  if (tp.rank) return { err: 'Sudah finish' };
  if (now < tp.immuneUntil) return { err: 'Target sedang kebal' };
  return { name: tn, p: tp };
}

function applyHit(kind, victim, attacker, now) {
  if (kind === 'serang') {
    victim.pos = Math.max(1, victim.pos - ATTACK_BACK);
    victim.arrive = ++arriveSeq;
  } else if (kind === 'beku') {
    victim.skip += FREEZE_TURNS;              // giliran lempar berikutnya dilewati
  } else if (kind === 'tukar') {
    const t = attacker.pos; attacker.pos = victim.pos; victim.pos = t;
    attacker.arrive = ++arriveSeq; victim.arrive = ++arriveSeq;
  }
}

function useItem(name, p, kind, arg, now) {
  const idx = p.items.indexOf(kind);
  const free = state.warUntil > now && TARGETED.has(kind);   // Perang Besar: serang bebas tanpa item
  if (idx < 0 && !free) return { ok: false, msg: 'Item tidak ada' };
  if (free && now < p.warLock) return { ok: false, msg: 'Terlalu cepat' };
  if (kind === 'tangkis' || kind === 'pantul') {
    if (p.guard) return { ok: false, msg: 'Sudah berlindung' };
    p.items.splice(idx, 1);
    p.guard = kind;
    pushFeed('guard', name, '', kind);
  } else if (kind === 'jebakan') {
    if (p.pos <= 0 || p.pos >= BOARD_SIZE) return { ok: false, msg: 'Tidak bisa pasang di sini' };
    if (state.traps.has(p.pos)) return { ok: false, msg: 'Sudah ada jebakan' };
    for (const [c, t] of state.traps) if (t.owner === name) state.traps.delete(c);   // satu jebakan per pemasang
    if (state.traps.size >= MAX_TRAPS) state.traps.delete(state.traps.keys().next().value);
    p.items.splice(idx, 1);
    state.traps.set(p.pos, { owner: name, c: p.ci });
    pushFeed('set', name, '', kind);
  } else {
    const t = findTarget(name, p, arg, now);
    if (t.err) return { ok: false, msg: t.err };
    if (free) p.warLock = now + WAR_ATTACK_GAP_MS; else p.items.splice(idx, 1);
    const tp = t.p;
    if (tp.guard === 'pantul' && kind !== 'tukar') {
      tp.guard = null;
      applyHit(kind, p, p, now);                 // balik ke penyerang
      pushFeed('reflect', t.name, name, kind);
    } else if (tp.guard) {
      tp.guard = null;                            // tangkis (atau pantul lawan tukar) menahan
      pushFeed('block', name, t.name, kind);
    } else {
      applyHit(kind, tp, p, now);
      tp.immuneUntil = now + IMMUNE_MS;
      pushFeed('hit', name, t.name, kind);
    }
  }
  p.lastActive = now;
  scheduleBroadcast();
  return { ok: false, msg: 'Item dipakai' };
}

// ---------- event global ----------
function newPlayer(now) {
  return { pos: 0, skip: 0, rank: 0, rolls: 0, joinedAt: now, lastActive: now, ci: state.nextColor++, bonus: 0, warLock: 0, items: [], guard: null, immuneUntil: 0, arrive: 0, finishMs: 0, q: 0, d: 0, f: 0, m: 0, v: null };
}

function pickEvent() {
  const total = EVENT_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [id, w] of EVENT_WEIGHTS) { r -= w; if (r < 0) return id; }
  return EVENT_WEIGHTS[0][0];
}

function scheduleEvent() {
  clearTimeout(eventTimer);
  eventTimer = null;
  if (!EVENTS_ENABLED) return;
  eventTimer = unref(setTimeout(() => startEvent(), randInt(EVENT_MIN_MS, EVENT_MAX_MS)));
}

// Peringatan dulu (EVENT_WARN_MS), baru event jalan. `forced` = tipe tertentu (buat tes).
function startEvent(forced) {
  eventTimer = null;
  if (!state || state.phase !== 'racing') return;
  if (!forced && state.players.size < 2) { scheduleEvent(); return; }   // sepi: nggak ada yang kena
  const now = Date.now();
  state.event = { t: forced || pickEvent(), ph: 'warn', at: now + EVENT_WARN_MS, end: now + EVENT_WARN_MS, w: '', got: [] };
  scheduleBroadcast();
  eventTimer = unref(setTimeout(fireEvent, EVENT_WARN_MS));
}

function fireEvent() {
  eventTimer = null;
  const ev = state && state.event;
  if (!ev || state.phase !== 'racing') return;
  const now = Date.now();
  let dur = EVENT_BANNER_MS;
  if (ev.t === 'storm' || ev.t === 'wind') {
    const d = ev.t === 'storm' ? -STORM_BACK : WIND_FWD;
    for (const q of state.players.values()) {
      if (q.rank || q.pos <= 0) continue;
      q.pos = Math.max(1, Math.min(BOARD_SIZE - 1, q.pos + d));
      q.arrive = ++arriveSeq;
    }
  } else if (ev.t === 'shield') { state.shieldUntil = now + SHIELD_MS; dur = SHIELD_MS; }
  else if (ev.t === 'war') { state.warUntil = now + WAR_MS; dur = WAR_MS; }
  else if (ev.t === 'grab') { ev.w = GRAB_WORDS[randInt(0, GRAB_WORDS.length - 1)]; dur = GRAB_MS; }
  ev.ph = 'active';
  ev.end = now + dur;
  scheduleBroadcast();
  eventTimer = unref(setTimeout(endEvent, dur));
}

function endEvent() {
  clearTimeout(eventTimer);
  eventTimer = null;
  if (!state) return;
  state.event = null;
  scheduleEvent();
  scheduleBroadcast();
}

// Rebutan Item: komentar persis kata yang tampil di layar.
function isGrabComment(text) {
  const ev = state && state.event;
  if (!ev || ev.t !== 'grab' || ev.ph !== 'active' || typeof text !== 'string') return false;
  return text.trim().toLowerCase().replace(/[\s!.?,]+$/g, '') === ev.w;
}

function joinGrab(name, now) {
  const ev = state.event;
  if (ev.got.includes(name)) return { ok: false, msg: 'Sudah dapat' };
  const p = state.players.get(name);
  if (!p) return { ok: false, msg: 'Belum ikut main' };   // rebutan item cuma buat yang sudah join
  if (p.rank || p.items.length >= MAX_ITEMS) return { ok: false, msg: 'Tas penuh' };
  const it = pickItem();
  p.items.push(it);
  ev.got.push(name);
  pushFeed('item', name, '', it);
  if (ev.got.length >= GRAB_WINNERS) endEvent();
  scheduleBroadcast();
  return { ok: false, msg: 'Dapat item' };
}

// ---------- kontrak game ----------
module.exports = {
  id: 'ular-tangga',

  // Argumen ke-2 & ke-3 opsional (lihat patch room.js).
  setBroadcaster(fn, completeFn, awardFn) {
    broadcast = fn;
    awardPoints = typeof awardFn === 'function' ? awardFn : null;
    requestCompletion = typeof completeFn === 'function' ? completeFn : null;
  },

  init() {
    round = 0;
    newRound();
  },

  parseComment(text) {
    if (isJoinComment(text)) return { answer: 'join' };
    if (isGrabComment(text)) return { answer: state.event.w };
    const c = parseItemCommand(text);
    return c ? { answer: c.kind + (c.arg ? ' ' + c.arg : '') } : null;
  },

  // Selalu { ok:false }: join/item nggak memberi poin langsung. Poin juara
  // dikirim lewat awardFn dari timer giliran (lihat takeTurn).
  handleAnswer({ answer, player }) {
    if (!state) return { ok: false, msg: 'Ronde belum siap' };
    const name = player ? String(player) : '';
    if (!name) return { ok: false, msg: 'Pemain tidak valid' };
    const text = String(answer || '');
    const now = Date.now();

    if (isJoinComment(text)) return joinPlayer(name, now);
    if (state.phase !== 'racing') return { ok: false, msg: 'Ronde belum jalan' };
    if (isGrabComment(text)) return joinGrab(name, now);
    const cmd = parseItemCommand(text);
    if (cmd) {
      const p0 = state.players.get(name);
      if (!p0 || p0.rank) return { ok: false, msg: 'Belum bisa pakai item' };
      return useItem(name, p0, cmd.kind, cmd.arg, now);
    }
    return { ok: false, msg: 'Perintah tidak dikenal' };
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
        phase: 'lobby', round: 1, size: BOARD_SIZE, snakes: [], ladders: [], specials: [],
        endsAt: 0, serverTime: Date.now(), turn: '', turnAt: 0, turnMs: TURN_MS, queue: [],
        lobby: { endsAt: 0, min: LOBBY_MIN, max: MAX_PLAYERS },
        winnersNeeded: WINNER_COUNT, totalPlayers: 0, players: [], finishers: [],
        closest: [], recentRolls: []
      };
    }

    const ranked = [...state.players.entries()].sort(([, a], [, b]) => compareProgress(a, b));
    const now = Date.now();

    const players = ranked.map(([name, p]) => ({
      n: shortName(name), p: p.pos, r: p.rank, c: p.ci,
      i: p.items.slice(), g: p.guard || 0, sk: p.skip,
      q: p.q, d: p.d, f: p.f, m: p.m, v: p.v     // lemparan terakhir, buat animasi lompat
    }));

    const closest = state.phase !== 'racing' && state.phase !== 'lobby' && state.finishers.length < WINNER_COUNT
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
      serverTime: now,
      endReason: state.endReason,
      turn: state.phase === 'racing' && state.turn != null ? shortName(state.turn) : '',
      turnAt: state.phase === 'racing' ? state.turnAt : 0,
      turnMs: TURN_MS,
      queue: turnQueue(),
      lobby: { endsAt: state.lobbyEndsAt, min: LOBBY_MIN, max: MAX_PLAYERS },
      participationMax: PARTICIPATION_MAX,
      winnersNeeded: WINNER_COUNT,
      totalPlayers: state.players.size,
      players,
      finishers: state.finishers,
      closest,
      recentRolls: state.recent,
      traps: [...state.traps].map(([c, t]) => [c, t.c]),
      feed: state.feed,
      maxItems: MAX_ITEMS,
      event: state.event
        ? { t: state.event.t, ph: state.event.ph, at: state.event.at, end: state.event.end, w: state.event.ph === 'active' ? state.event.w : '', n: state.event.got.length, m: GRAB_WINNERS }
        : null
    };
  },

  getAdminAnswers() {
    if (!state) return { title: 'Ular Tangga', items: [] };
    const items = [
      { label: 'Fase', answer: state.phase, solved: false },
      { label: 'Rata-rata lemparan (simulasi)', answer: String(state.board.avgRolls), solved: false },
      { label: 'Ular / Tangga / Spesial', answer: `${state.board.snakes.length} / ${state.board.ladders.length} / ${state.board.specials.length}`, solved: false },
      { label: 'Pemain di papan', answer: String(state.players.size), solved: false },
      ...state.finishers.map((f) => ({ label: `Juara ${f.rank}`, answer: f.player, solved: true }))
    ];
    return { title: `Ular Tangga - Ronde ${state.round}`, items };
  },

  // ---------- dipakai test-ular-tangga.js ----------
  _isJoinComment: isJoinComment,
  _applyRoll: applyRoll,
  _generateBoard: generateBoard,
  _tryGenerateBoard: tryGenerateBoard,
  _fallbackBoard: fallbackBoard,
  _buildEffects: buildEffects,
  _simulate: simulate,
  _setRng(fn) { rng = typeof fn === 'function' ? fn : Math.random; },
  _setEvents(on) { EVENTS_ENABLED = !!on; },
  // Hentikan / lanjutkan dadu otomatis (biar tes item & event bisa atur posisi pasti).
  _pauseTurns(on) {
    TURNS_PAUSED = !!on;
    if (on) { clearTimeout(turnTimer); turnTimer = null; }
    else if (state && state.phase === 'racing') scheduleTurn();
  },
  _startEvent(type) { clearTimeout(eventTimer); startEvent(type); },
  _giveItem(name, item) { state.players.get(name).items.push(item); },
  // Pasang papan buatan tangan ke ronde yang sedang jalan.
  _setBoard(snakes, ladders, specials) {
    state.board = {
      snakes, ladders, specials,
      effects: buildEffects(snakes, ladders, specials),
      avgRolls: 0
    };
  },
  _config: {
    EVENT_WARN_MS, EVENT_BANNER_MS, STORM_BACK, WIND_FWD, SHIELD_MS, WAR_MS, WAR_ATTACK_GAP_MS, GRAB_WINNERS,
    PARTICIPATION_MAX, MAX_ITEMS, ATTACK_BACK, FREEZE_TURNS, IMMUNE_MS, TRAP_DROP, BOARD_SIZE, ROUND_TIMEOUT_MS, PODIUM_MS, WINNER_POINTS,
    TURN_MS, LOBBY_MIN, LOBBY_MS, LOBBY_IDLE_MS, MAX_PLAYERS, BROADCAST_THROTTLE_MS,
    SNAKE_COUNT, LADDER_COUNT, MIN_JUMP, MAX_SNAKE_DROP, MAX_LADDER_RISE, BACK_STEPS, FWD_STEPS,
    TARGET_ROLLS_MIN, TARGET_ROLLS_MAX
  }
};
