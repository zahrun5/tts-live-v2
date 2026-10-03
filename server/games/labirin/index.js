// Labirin — balapan labirin lewat komentar arah.
//
// Semua penonton mulai dari pintu masuk yang sama. Komentar arah
// (atas/bawah/kiri/kanan, up/down/left/right, atau w/a/s/d) bikin pemain itu
// BERJALAN TERUS menyusuri lorong ke arah tersebut: belokan diikuti otomatis,
// dan baru berhenti kalau ketemu persimpangan (pertigaan/perempatan), jalan
// buntu, atau pintu keluar. Jadi penonton cuma perlu komentar tiap ada
// persimpangan, bukan tiap petak. 3 penonton tercepat yang sampai pintu keluar
// jadi pemenang (poin 100/60/30).
//
// Tanpa AI: parsing murni regex/kamus, sama kayak game lain yang udah pure regex.
//
// CATATAN KONTRAK:
//  - handleAnswer() sengaja return { ok:false } untuk gerakan biasa. Di room.js,
//    ok:true berarti "jawaban benar" -> nambah skor + emit update/leaderboard/
//    answer:correct. Kalau tiap gerakan ok:true, 100+ penonton bakal banjirin
//    socket. Gerakan biasa disiarkan lewat broadcaster (di-throttle), dan ok:true
//    cuma buat penonton yang finish di 3 besar.
//  - Ronde bisa selesai sendiri lewat timer (timeout 4 menit / jeda podium). Buat
//    itu game butuh cara bilang "ronde selesai" ke room: argumen ke-2
//    setBroadcaster(fn, requestCompletion). Kalau room.js belum di-patch (argumen
//    ke-2 nggak ada), game fallback bikin labirin baru sendiri di game yang sama.

'use strict';

// ---------- konfigurasi ----------
const COLS = 11;                       // lebar labirin (jumlah sel)
const ROWS = 17;                       // tinggi labirin (portrait, muat di layar HP)
const MIN_SHORTEST_PATH = 40;          // jalur terpendek minimal (langkah) biar nggak kecepetan
const MAX_COMMANDS_PER_COMMENT = 3;    // maksimal arah per komentar (tiap arah = 1 lari sampai persimpangan)
const RUN_COOLDOWN_BASE_MS = 500;      // kunci minimal tiap komentar yang bikin pemain jalan
const RUN_COOLDOWN_PER_CELL_MS = 40;   // tambahan kunci per petak yang dilewati (lari panjang = tunggu lebih lama)
const RUN_COOLDOWN_MAX_MS = 2500;      // batas atas kunci
const ROUND_TIMEOUT_MS = 4 * 60 * 1000;
const PODIUM_MS = 8000;                // lama papan juara tampil sebelum ronde baru
const WINNER_POINTS = [100, 60, 30];   // poin juara 1/2/3
const WINNER_COUNT = WINNER_POINTS.length;
const BROADCAST_THROTTLE_MS = 150;     // gabung banyak langkah jadi 1 emit
const MAX_PLAYERS_IN_PAYLOAD = 80;
const MAX_TRACKED_PLAYERS = 1000;
const MAX_COMMENT_LENGTH = 60;

// dinding per sel (bitmask)
const N = 1, E = 2, S = 4, W = 8;
const DIRS = {
  U: { dx: 0, dy: -1, wall: N, opp: S },
  D: { dx: 0, dy: 1, wall: S, opp: N },
  L: { dx: -1, dy: 0, wall: W, opp: E },
  R: { dx: 1, dy: 0, wall: E, opp: W }
};

// ---------- parser komentar ----------
const WORDS = {
  atas: 'U', naik: 'U', up: 'U',
  bawah: 'D', turun: 'D', down: 'D',
  kiri: 'L', left: 'L',
  kanan: 'R', right: 'R'
};
const ARROWS = { '⬆': 'U', '↑': 'U', '⬇': 'D', '↓': 'D', '⬅': 'L', '←': 'L', '➡': 'R', '→': 'R' };
const WASD = { w: 'U', a: 'L', s: 'D', d: 'R' };
// kata biasa yang kebetulan cuma terdiri dari huruf w/a/s/d
const NOT_MOVES = new Set(['ada', 'adas', 'dada', 'sada', 'awas', 'sawa', 'add', 'dad', 'sad', 'was', 'saw']);

// Return array arah (['U','R',...], maks MAX_COMMANDS_PER_COMMENT) atau null kalau
// komentar bukan perintah gerak. Semua token harus berupa arah; satu kata
// non-arah ("kiri dong") bikin seluruh komentar diabaikan.
function parseMoves(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim().toLowerCase();
  if (!s || s.length > MAX_COMMENT_LENGTH) return null;

  s = s.replace(/\uFE0F/g, '');
  s = s.replace(/[⬆↑⬇↓⬅←➡→]/g, (ch) => ` @${ARROWS[ch]} `);

  const tokens = s.split(/[\s,.;:!?\-_/|+*]+/).filter(Boolean);
  if (!tokens.length) return null;

  const moves = [];
  for (const tok of tokens) {
    if (/^@[UDLR]$/.test(tok)) {
      moves.push(tok[1]);
    } else if (WORDS[tok]) {
      moves.push(WORDS[tok]);
    } else if (/^[wasd]{1,6}$/.test(tok) && !NOT_MOVES.has(tok)) {
      for (const ch of tok) moves.push(WASD[ch]);
    } else {
      return null;
    }
  }
  return moves.length ? moves.slice(0, MAX_COMMANDS_PER_COMMENT) : null;
}

// ---------- generator labirin ----------
function idx(x, y) { return y * COLS + x; }

// Recursive backtracker (iteratif): labirin "sempurna", dijamin selalu ada tepat
// satu jalur antar dua sel manapun.
function carveMaze() {
  const walls = new Array(COLS * ROWS).fill(N | E | S | W);
  const visited = new Array(COLS * ROWS).fill(false);
  const stack = [{ x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }];
  visited[idx(stack[0].x, stack[0].y)] = true;

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = [];
    for (const key of Object.keys(DIRS)) {
      const d = DIRS[key];
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (visited[idx(nx, ny)]) continue;
      options.push({ d, nx, ny });
    }
    if (!options.length) { stack.pop(); continue; }
    const pick = options[Math.floor(Math.random() * options.length)];
    walls[idx(cur.x, cur.y)] &= ~pick.d.wall;
    walls[idx(pick.nx, pick.ny)] &= ~pick.d.opp;
    visited[idx(pick.nx, pick.ny)] = true;
    stack.push({ x: pick.nx, y: pick.ny });
  }
  return walls;
}

// Jarak (langkah) dari sel asal ke semua sel.
function bfs(walls, from) {
  const dist = new Array(COLS * ROWS).fill(-1);
  dist[idx(from.x, from.y)] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const base = dist[idx(cur.x, cur.y)];
    for (const key of Object.keys(DIRS)) {
      const d = DIRS[key];
      if (walls[idx(cur.x, cur.y)] & d.wall) continue;
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (dist[idx(nx, ny)] !== -1) continue;
      dist[idx(nx, ny)] = base + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

// Satu "lari": langkah pertama sesuai arah komentar, lalu terus menyusuri lorong
// (belokan diikuti otomatis) sampai:
//   - pintu keluar              -> finished = true
//   - persimpangan (pertigaan/perempatan: >= 2 jalan lanjut selain sisi asal)
//   - jalan buntu (0 jalan lanjut)
// Kalau langkah pertama sudah nabrak tembok, cells = 0 dan posisi nggak berubah.
// Fungsi murni (nggak nyentuh state) biar gampang dites.
function runSegment(walls, exit, x, y, firstKey) {
  const first = DIRS[firstKey];
  if (!first || (walls[idx(x, y)] & first.wall)) return { x, y, cells: 0, finished: false };

  let dir = first;
  let cells = 0;
  for (let guard = 0; guard < COLS * ROWS; guard++) {
    x += dir.dx;
    y += dir.dy;
    cells += 1;
    if (x === exit.x && y === exit.y) return { x, y, cells, finished: true };

    // jalan lanjut = sisi terbuka selain sisi tempat kita datang (dir.opp)
    const w = walls[idx(x, y)];
    const forward = [];
    for (const key of Object.keys(DIRS)) {
      const d = DIRS[key];
      if (d.wall === dir.opp) continue;
      if (w & d.wall) continue;
      forward.push(d);
    }
    if (forward.length !== 1) break;   // 0 = buntu, >= 2 = persimpangan
    dir = forward[0];                  // lorong lurus/belok: lanjut
  }
  return { x, y, cells, finished: false };
}

// Pintu masuk di baris atas (kolom acak), pintu keluar di baris bawah yang
// paling jauh dari pintu masuk. Coba beberapa kali sampai jalurnya cukup panjang.
function generateMaze() {
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const walls = carveMaze();
    const start = { x: Math.floor(Math.random() * COLS), y: 0 };
    const fromStart = bfs(walls, start);
    let exit = { x: 0, y: ROWS - 1 };
    for (let x = 0; x < COLS; x++) {
      if (fromStart[idx(x, ROWS - 1)] > fromStart[idx(exit.x, exit.y)]) exit = { x, y: ROWS - 1 };
    }
    const shortest = fromStart[idx(exit.x, exit.y)];
    if (!best || shortest > best.shortest) best = { walls, start, exit, shortest };
    if (shortest >= MIN_SHORTEST_PATH) break;
  }
  best.distToExit = bfs(best.walls, best.exit);
  return best;
}

// ---------- state ----------
let state = null;
let round = 0;
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
  const maze = generateMaze();
  const now = Date.now();
  state = {
    phase: 'racing',            // racing -> podium -> done
    round,
    walls: maze.walls,
    start: maze.start,
    exit: maze.exit,
    shortest: maze.shortest,
    distToExit: maze.distToExit,
    players: new Map(),
    finishers: [],
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
    // return false = game ini udah nggak aktif, biarin aja.
    requestCompletion();
  } else {
    newRound();
  }
}

function progressOf(p) {
  return state.distToExit[idx(p.x, p.y)];
}

function shortName(name) {
  return String(name).slice(0, 24);
}

// ---------- kontrak game ----------
module.exports = {
  id: 'labirin',

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
    const moves = parseMoves(text);
    if (!moves) return null;
    return { moves, answer: moves.join('') };
  },

  handleAnswer({ moves, answer, player }) {
    if (!state || state.phase !== 'racing') return { ok: false, msg: 'Ronde belum jalan' };
    const name = player ? String(player) : '';
    if (!name) return { ok: false, msg: 'Pemain tidak valid' };

    const list = Array.isArray(moves) ? moves : parseMoves(String(answer || ''));
    if (!list || !list.length) return { ok: false, msg: 'Bukan arah' };

    const now = Date.now();
    let p = state.players.get(name);
    if (!p) {
      if (state.players.size >= MAX_TRACKED_PLAYERS) return { ok: false, msg: 'Labirin penuh' };
      p = { x: state.start.x, y: state.start.y, lockedUntil: 0, rank: 0, steps: 0, joinedAt: now, finishMs: 0 };
      state.players.set(name, p);
    }
    if (p.rank) return { ok: false, msg: 'Sudah finish' };
    if (now < p.lockedUntil) return { ok: false, msg: 'Terlalu cepat' };

    // Tiap arah = satu lari sampai persimpangan/buntu/finish. Beberapa arah dalam
    // satu komentar dijalankan berurutan; berhenti kalau nabrak tembok.
    let moved = 0;
    let finished = false;
    for (const m of list.slice(0, MAX_COMMANDS_PER_COMMENT)) {
      const r = runSegment(state.walls, state.exit, p.x, p.y, m);
      if (!r.cells) break;             // nabrak tembok: berhenti
      p.x = r.x;
      p.y = r.y;
      moved += r.cells;
      if (r.finished) { finished = true; break; }
    }
    p.steps += moved;
    p.lockedUntil = now + Math.min(RUN_COOLDOWN_MAX_MS, RUN_COOLDOWN_BASE_MS + moved * RUN_COOLDOWN_PER_CELL_MS);

    if (!finished) {
      scheduleBroadcast(); // posisi baru (atau pemain baru muncul di pintu masuk)
      return { ok: false, msg: moved ? 'Bergerak' : 'Tabrak tembok' };
    }

    p.rank = state.finishers.length + 1;
    p.finishMs = now - state.startedAt;
    const points = WINNER_POINTS[p.rank - 1] || 0;
    state.finishers.push({ player: shortName(name), rank: p.rank, points, ms: p.finishMs });
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
    return { success: true, source: 'labirin-generated' };
  },

  reset() {
    round = 0;
    newRound();
  },

  buildClueList() {
    return `Labirin - Ronde ${state ? state.round : 1}`;
  },

  buildStatePayload() {
    if (!state) {
      return {
        phase: 'racing', round: 1, cols: COLS, rows: ROWS, walls: [], start: { x: 0, y: 0 },
        exit: { x: 0, y: 0 }, shortest: 0, endsAt: 0, serverTime: Date.now(),
        winnersNeeded: WINNER_COUNT, totalPlayers: 0, players: [], finishers: [], closest: []
      };
    }

    // pemain terdepan dulu: yang udah finish (urut juara), lalu paling dekat pintu keluar
    const ranked = [...state.players.entries()].sort(([, a], [, b]) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return progressOf(a) - progressOf(b) || a.joinedAt - b.joinedAt;
    });

    const players = ranked.slice(0, MAX_PLAYERS_IN_PAYLOAD).map(([name, p]) => ({
      n: shortName(name), x: p.x, y: p.y, r: p.rank
    }));

    const closest = state.phase !== 'racing' && state.finishers.length < WINNER_COUNT
      ? ranked.filter(([, p]) => !p.rank).slice(0, WINNER_COUNT - state.finishers.length)
          .map(([name]) => shortName(name))
      : [];

    return {
      phase: state.phase,
      round: state.round,
      cols: COLS,
      rows: ROWS,
      walls: state.walls,
      start: state.start,
      exit: state.exit,
      shortest: state.shortest,
      endsAt: state.endsAt,
      serverTime: Date.now(),
      endReason: state.endReason,
      winnersNeeded: WINNER_COUNT,
      totalPlayers: state.players.size,
      players,
      finishers: state.finishers,
      closest
    };
  },

  getAdminAnswers() {
    if (!state) return { title: 'Labirin', items: [] };
    const items = [
      { label: 'Jalur terpendek', answer: `${state.shortest} langkah`, solved: false },
      { label: 'Pemain di labirin', answer: String(state.players.size), solved: false },
      ...state.finishers.map((f) => ({ label: `Juara ${f.rank}`, answer: f.player, solved: true }))
    ];
    return { title: `Labirin - Ronde ${state.round}`, items };
  },

  // dipakai test-labirin.js
  _parseMoves: parseMoves,
  _runSegment: runSegment
};
