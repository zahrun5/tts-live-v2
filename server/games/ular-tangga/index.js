// Ular Tangga V2 — Dynamic Team System + Stamina Battle + Mystery Effects
//
// MAJOR CHANGES FROM V1:
//  1. DYNAMIC TEAMS: 1-6 solo, 7-12 = 3 teams, 13-24 = 4 teams, 25-36 = 5 teams, 37+ = 6 teams
//  2. STAMINA SYSTEM: TikTok LIKE tap → +1 stamina, battle commands cost stamina
//  3. MYSTERY TILE: 15 instant effects (buff/attack/debuff), no inventory
//  4. DADU 6 RULE: Roll 6 → lempar lagi (bonus turn)
//
// Alur satu ronde:
//  1. LOBI: penonton komen "join" buat ikut. Begitu ada LOBBY_MIN pemain, hitung
//     mundur LOBBY_MS mulai. Papan penuh (MAX_PLAYERS) = langsung mulai.
//  2. BALAPAN: server melempar dadu sendiri untuk TEAM (1 bidak per tim), tapi
//     yang lempar = individual rotation dalam roster tim. Jeda TURN_MS per giliran.
//  3. 3 tim tercepat di petak 100 jadi juara, SEMUA anggota dapat poin (100/60/30).
//     Ronde selesai kalau waktu habis atau tinggal 1 tim.

'use strict';

// ---------- konfigurasi ----------
const BOARD_SIZE = 100;
const TURN_MS = 3000;
const LOBBY_MIN_SOLO = 2;              // minimal untuk solo mode
const LOBBY_MIN_TEAM = 7;              // minimal untuk trigger team mode
const LOBBY_MS = 20000;
const LOBBY_IDLE_MS = 3 * 60 * 1000;
const MAX_PLAYERS = 36;                // naikkan dari 6 jadi 36
const ROUND_TIMEOUT_MS = 20 * 60 * 1000;
const PODIUM_MS = 8000;
const WINNER_POINTS = [100, 60, 30];
const WINNER_COUNT = WINNER_POINTS.length;
const PARTICIPATION_MAX = 20;
const BROADCAST_THROTTLE_MS = 150;
const MAX_COMMENT_LENGTH = 20;
const RECENT_ROLLS_IN_PAYLOAD = 5;

const SNAKE_COUNT = 8;
const LADDER_COUNT = 6;
const MIN_JUMP = 10;
const MAX_SNAKE_DROP = 60;
const MAX_LADDER_RISE = 25;
const BACK_STEPS = 3;
const FWD_STEPS = 5;
const SPECIAL_PLAN = [
  ['again', 2, 5, 95],
  ['mystery', 10, 6, 96]
];

// Stamina & Battle
const STAMINA_MAX = 100;
const STAMINA_PER_LIKE = 1;
const COST_SERANG = 20;
const COST_BEKU = 25;
const COST_ULAR = 30;
const ATTACK_BACK = 5;
const FREEZE_TURNS = 1;
const TRAP_DROP = 10;
const MAX_TRAPS = 12;

// Mystery Tile Effects (15 effects)
const MYSTERY_EFFECTS = [
  // BUFF (40%)
  ['perisai', 7], ['speed', 7], ['teleport', 7], ['double', 7], ['lucky', 6], ['stamina', 6],
  // ATTACK (30%)
  ['auto-serang', 6], ['freeze-bomb', 6], ['swap-curse', 6], ['snake-drop', 6], ['chaos-strike', 6],
  // DEBUFF (30%)
  ['trap', 8], ['dizzy', 7], ['reverse', 8], ['cursed', 7]
];
const MYSTERY_MOVE_MIN = 3;
const MYSTERY_MOVE_MAX = 6;

// Event Global
const EVENT_MIN_MS = 2 * 60 * 1000;
const EVENT_MAX_MS = 3 * 60 * 1000;
const EVENT_WARN_MS = 5000;
const EVENT_BANNER_MS = 3000;
const STORM_BACK = 3;
const WIND_FWD = 3;
const SHIELD_MS = 15000;
const GRAB_MS = 15000;
const GRAB_WINNERS = 5;
const GRAB_WORDS = ['gas', 'rebut', 'sikat', 'kocok', 'ambil', 'bagi', 'mantap', 'cepat'];
const EVENT_WEIGHTS = [['storm', 2], ['wind', 2], ['shield', 2], ['grab', 3]];

const FEED_KEEP = 8;
const TARGET_ROLLS_MIN = 45;
const TARGET_ROLLS_MAX = 65;
const SIM_RUNS = 300;
const BOARD_ATTEMPTS = 200;

// Team Colors
const TEAM_COLORS = ['Merah🔴', 'Biru🔵', 'Hijau🟢', 'Kuning🟡', 'Ungu🟣', 'Oren🟠'];
const TEAM_EMOJI = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];

// ---------- acak ----------
let rng = Math.random;
function randInt(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
function rowOf(cell) { return Math.floor((cell - 1) / 10); }

// ---------- parser komentar ----------
const JOIN_WORDS = new Set(['join', 'main', 'gabung']);

function isJoinComment(text) {
  if (typeof text !== 'string') return false;
  let s = text.trim().toLowerCase();
  if (!s || s.length > MAX_COMMENT_LENGTH) return false;
  s = s.replace(/[\s!.?,]+$/g, '');
  return JOIN_WORDS.has(s);
}

// Parse battle commands: serang [tim], beku [tim], ular
function parseBattleCommand(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim().toLowerCase();
  if (!s || s.length > MAX_COMMENT_LENGTH) return null;
  s = s.replace(/[\s!.?,]+$/g, '');
  
  // serang [target]
  if (s === 'serang' || s === 'hajar') return { kind: 'serang', target: null };
  const serangMatch = /^(serang|hajar)\s+(merah|biru|hijau|kuning|ungu|oren)$/.exec(s);
  if (serangMatch) return { kind: 'serang', target: serangMatch[2] };
  
  // beku [target]
  if (s === 'beku' || s === 'bekukan') return { kind: 'beku', target: null };
  const bekuMatch = /^(beku|bekukan)\s+(merah|biru|hijau|kuning|ungu|oren)$/.exec(s);
  if (bekuMatch) return { kind: 'beku', target: bekuMatch[2] };
  
  // ular (pasang trap)
  if (s === 'ular') return { kind: 'ular', target: null };
  
  return null;
}

// ---------- papan ----------
function buildEffects(snakes, ladders, specials) {
  const effects = new Map();
  for (const [from, to] of snakes) effects.set(from, { type: 'snake', to });
  for (const [from, to] of ladders) effects.set(from, { type: 'ladder', to });
  for (const s of specials) effects.set(s.c, { type: s.t, to: s.to });
  return effects;
}

function applyRoll(effects, pos, d) {
  let m = pos + d;
  if (m > BOARD_SIZE) m = BOARD_SIZE - (m - BOARD_SIZE);
  const eff = effects.get(m);
  if (!eff) return { m, t: m, v: null };
  if (eff.type === 'again' || eff.type === 'mystery') return { m, t: m, v: eff.type };
  return { m, t: eff.to, v: eff.type };
}

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

function tryGenerateBoard() {
  const used = new Set([1, BOARD_SIZE]);
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
          : type === 'fwd' ? Math.min(BOARD_SIZE, c + FWD_STEPS) : c;
        if (type !== 'again' && used.has(to)) continue;
        used.add(c);
        if (type !== 'again') used.add(to);
        specials.push({ c, t: type, to });
        placed = true;
      }
      if (!placed) return null;
    }
  }
  return { snakes, ladders, specials };
}

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
let rollSeq = 0;
let arriveSeq = 0;
let broadcast = null;
let requestCompletion = null;
let awardPoints = null;
let evSeq = 0;
let roundTimer = null;
let podiumTimer = null;
let broadcastTimer = null;
let eventTimer = null;
let turnTimer = null;
let lobbyTimer = null;
let lobbyIdleTimer = null;
let EVENTS_ENABLED = true;
let TURNS_PAUSED = false;

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

// ---------- team logic ----------
function getTeamCount(playerCount) {
  if (playerCount <= 6) return 0;  // solo mode
  if (playerCount <= 12) return 3;
  if (playerCount <= 24) return 4;
  if (playerCount <= 36) return 5;
  return 6;
}

function isSoloMode(state) {
  return !state.teams || state.teams.length === 0;
}

function assignToTeam(name, state) {
  if (isSoloMode(state)) {
    // Solo mode - no teams
    return null;
  }
  
  // Find team with fewest members
  let minTeam = 0;
  let minCount = state.teamRosters[0].length;
  for (let i = 1; i < state.teams.length; i++) {
    if (state.teamRosters[i].length < minCount) {
      minCount = state.teamRosters[i].length;
      minTeam = i;
    }
  }
  
  state.teamRosters[minTeam].push(name);
  return minTeam;
}

function getPlayerTeam(name, state) {
  if (isSoloMode(state)) return null;
  for (let i = 0; i < state.teamRosters.length; i++) {
    if (state.teamRosters[i].includes(name)) return i;
  }
  return null;
}

// ---------- ronde baru ----------
function newRound() {
  clearTimers();
  round += 1;
  const board = generateBoard();
  state = {
    phase: 'lobby',
    round,
    board,
    players: new Map(),       // name -> player object
    order: [],                // join order (for turn rotation)
    teams: [],                // team indices [0, 1, 2, ...] (empty for solo)
    teamRosters: [],          // array of arrays: [[player1, player2], [player3], ...]
    teamPositions: [],        // [pos0, pos1, ...] team piece positions
    teamSkip: [],             // [skip0, skip1, ...] frozen turns
    teamRank: [],             // [rank0, rank1, ...] finish rank (0 = not finished)
    teamFinishMs: [],         // [ms0, ms1, ...]
    teamRolls: [],            // [rolls0, rolls1, ...]
    teamTurnIndex: [],        // [idx0, idx1, ...] current roster index per team
    turn: null,               // current player name (not team)
    currentTeam: null,        // current team index (null for solo)
    turnAt: 0,
    finishers: [],
    nextColor: 0,
    awarded: false,
    traps: new Map(),         // petak -> { owner, teamIdx }
    ulars: new Map(),         // player -> petak (ular trap owned)
    feed: [],
    event: null,
    shieldUntil: 0,
    recent: [],
    endReason: null,
    lobbyEndsAt: 0,
    startedAt: 0,
    endsAt: 0
  };
  lobbyIdleTimer = unref(setTimeout(lobbyIdleExpired, LOBBY_IDLE_MS));
  scheduleBroadcast();
}

function lobbyIdleExpired() {
  lobbyIdleTimer = null;
  if (!state || state.phase !== 'lobby' || lobbyTimer) return;
  clearTimers();
  state.phase = 'done';
  if (typeof requestCompletion === 'function') requestCompletion();
  else newRound();
}

function newPlayer(now, teamIdx) {
  return {
    pos: 0,
    skip: 0,
    rank: 0,
    rolls: 0,
    joinedAt: now,
    lastActive: now,
    ci: state.nextColor++,
    bonus: 0,
    stamina: 0,              // NEW: stamina (0-100)
    teamIdx: teamIdx,        // NEW: team index (null for solo)
    
    // Buffs
    shieldUntil: 0,          // perisai: immune until timestamp
    speedLeft: 0,            // speed: turns left with 2 dice
    luckyNext: false,        // lucky: next roll 5-6
    cursedNext: false,       // cursed: next roll 1-2
    
    arrive: 0,
    finishMs: 0,
    q: 0,
    d: 0,
    f: 0,
    m: 0,
    v: null
  };
}

function joinPlayer(name, now) {
  if (!state || (state.phase !== 'lobby' && state.phase !== 'racing')) {
    return { ok: false, msg: 'Ronde sudah selesai' };
  }
  if (state.players.has(name)) {
    return { ok: false, msg: 'Sudah ikut' };
  }
  if (state.players.size >= MAX_PLAYERS) {
    return { ok: false, msg: 'Papan penuh' };
  }
  
  // Determine if we need to switch to team mode
  const newCount = state.players.size + 1;
  const needTeams = getTeamCount(newCount);
  
  if (state.phase === 'lobby' && needTeams > 0 && state.teams.length === 0) {
    // Initialize teams
    state.teams = Array.from({ length: needTeams }, (_, i) => i);
    state.teamRosters = Array.from({ length: needTeams }, () => []);
    state.teamPositions = Array(needTeams).fill(0);
    state.teamSkip = Array(needTeams).fill(0);
    state.teamRank = Array(needTeams).fill(0);
    state.teamFinishMs = Array(needTeams).fill(0);
    state.teamRolls = Array(needTeams).fill(0);
    state.teamTurnIndex = Array(needTeams).fill(0);
    
    // Reassign existing players to teams
    for (const existingName of state.order) {
      const teamIdx = assignToTeam(existingName, state);
      state.players.get(existingName).teamIdx = teamIdx;
    }
  }
  
  const teamIdx = assignToTeam(name, state);
  state.players.set(name, newPlayer(now, teamIdx));
  state.order.push(name);
  pushFeed('join', name, '', teamIdx !== null ? TEAM_EMOJI[teamIdx] : '');
  
  if (state.phase === 'lobby') {
    const minPlayers = needTeams > 0 ? LOBBY_MIN_TEAM : LOBBY_MIN_SOLO;
    if (state.players.size >= MAX_PLAYERS) {
      clearTimeout(lobbyTimer);
      startRace();
    } else if (state.players.size >= minPlayers && !lobbyTimer) {
      state.lobbyEndsAt = now + LOBBY_MS;
      lobbyTimer = unref(setTimeout(startRace, LOBBY_MS));
    }
  }
  
  scheduleBroadcast();
  return { ok: false, msg: 'Gabung' };
}

function startRace() {
  lobbyTimer = null;
  const minPlayers = state.teams.length > 0 ? LOBBY_MIN_TEAM : LOBBY_MIN_SOLO;
  if (!state || state.phase !== 'lobby' || state.players.size < minPlayers) return;
  clearTimeout(lobbyIdleTimer);
  lobbyIdleTimer = null;
  const now = Date.now();
  state.phase = 'racing';
  state.lobbyEndsAt = 0;
  state.startedAt = now;
  state.endsAt = now + ROUND_TIMEOUT_MS;
  roundTimer = unref(setTimeout(() => endRound('timeout'), ROUND_TIMEOUT_MS));
  
  if (isSoloMode(state)) {
    state.turn = state.order[0];
    state.currentTeam = null;
  } else {
    // Team mode: start with team 0, first roster member
    state.currentTeam = 0;
    state.turn = state.teamRosters[0][0];
  }
  
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

function advanceTurn() {
  if (!state || state.phase !== 'racing') return;
  
  if (isSoloMode(state)) {
    // Solo mode: next player in order who hasn't finished
    const n = state.order.length;
    const idx = state.order.indexOf(state.turn);
    for (let i = 1; i <= n; i++) {
      const nm = state.order[(((idx + i) % n) + n) % n];
      const q = state.players.get(nm);
      if (q && !q.rank) {
        state.turn = nm;
        state.currentTeam = null;
        scheduleTurn();
        scheduleBroadcast();
        return;
      }
    }
  } else {
    // Team mode: next team, then rotate roster within team
    const teamCount = state.teams.length;
    for (let i = 1; i <= teamCount; i++) {
      const teamIdx = (state.currentTeam + i) % teamCount;
      if (state.teamRank[teamIdx] > 0) continue; // team finished
      
      const roster = state.teamRosters[teamIdx];
      if (roster.length === 0) continue;
      
      // Next member in this team's roster
      state.teamTurnIndex[teamIdx] = (state.teamTurnIndex[teamIdx] + 1) % roster.length;
      const nextPlayer = roster[state.teamTurnIndex[teamIdx]];
      
      state.currentTeam = teamIdx;
      state.turn = nextPlayer;
      scheduleTurn();
      scheduleBroadcast();
      return;
    }
  }
  
  endRound('finished');
}

function checkRoundEnd() {
  if (isSoloMode(state)) {
    let unfinished = 0;
    for (const q of state.players.values()) if (!q.rank) unfinished += 1;
    if (state.finishers.length >= WINNER_COUNT || unfinished < 2) {
      endRound('finished');
      return true;
    }
  } else {
    let unfinished = 0;
    for (const rank of state.teamRank) if (rank === 0) unfinished += 1;
    if (state.finishers.length >= WINNER_COUNT || unfinished < 2) {
      endRound('finished');
      return true;
    }
  }
  return false;
}

// Pick mystery effect dengan weight
function pickMysteryEffect() {
  const total = MYSTERY_EFFECTS.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [id, w] of MYSTERY_EFFECTS) { r -= w; if (r < 0) return id; }
  return MYSTERY_EFFECTS[0][0];
}

// Respawn mystery tile with new random effect
function respawnMysteryTile(pos) {
  const idx = state.board.specials.findIndex(s => s.c === pos && s.t === 'mystery');
  if (idx >= 0) {
    const newEffect = pickMysteryEffect();
    state.board.specials[idx] = { c: pos, t: 'mystery', to: pos, effectId: newEffect };
    state.board.effects.set(pos, { type: 'mystery', to: pos, effectId: newEffect });
  }
}

// Resolve mystery tile effects (instant apply)
function resolveMysteryEffect(p, name, pos, now) {
  const effect = pickMysteryEffect();
  
  // BUFF effects
  if (effect === 'perisai') {
    p.shieldUntil = now + 10000;
    pushFeed('mystery', name, '', '🛡️ Perisai 10s');
    return { pos, effect: 'perisai' };
  }
  if (effect === 'speed') {
    p.speedLeft = 2;
    pushFeed('mystery', name, '', '⚡ Speed 2 giliran');
    return { pos, effect: 'speed' };
  }
  if (effect === 'teleport') {
    const newPos = Math.min(BOARD_SIZE - 1, pos + 10);
    pushFeed('mystery', name, '', '🌀 Teleport +10');
    return { pos: newPos, effect: 'teleport' };
  }
  if (effect === 'double') {
    // Immediate extra roll - handled in takeTurn
    pushFeed('mystery', name, '', '🎲 Double lempar!');
    return { pos, effect: 'double' };
  }
  if (effect === 'lucky') {
    p.luckyNext = true;
    pushFeed('mystery', name, '', '⭐ Lucky next roll');
    return { pos, effect: 'lucky' };
  }
  if (effect === 'stamina') {
    p.stamina = Math.min(STAMINA_MAX, p.stamina + 50);
    pushFeed('mystery', name, '', '💪 +50 Stamina');
    return { pos, effect: 'stamina' };
  }
  
  // ATTACK effects
  if (effect === 'auto-serang') {
    const target = findClosestTargetAhead(name, p, now);
    if (target) {
      applySerang(target.name, target.p, name, now);
      pushFeed('mystery', name, target.name, '💥 Auto-serang');
    }
    return { pos, effect: 'auto-serang' };
  }
  if (effect === 'freeze-bomb') {
    const target = findClosestTargetAhead(name, p, now);
    if (target) {
      applyBeku(target.name, target.p, name, now);
      pushFeed('mystery', name, target.name, '🧊 Freeze-bomb');
    }
    return { pos, effect: 'freeze-bomb' };
  }
  if (effect === 'swap-curse') {
    const target = findFarthestBehind(name, p);
    if (target) {
      const tempPos = p.pos;
      p.pos = target.p.pos;
      target.p.pos = tempPos;
      p.arrive = ++arriveSeq;
      target.p.arrive = ++arriveSeq;
      pushFeed('mystery', name, target.name, '🔀 Swap curse');
      return { pos: p.pos, effect: 'swap-curse' };
    }
    return { pos, effect: 'swap-curse' };
  }
  if (effect === 'snake-drop') {
    if (pos > 0 && pos < BOARD_SIZE && !state.traps.has(pos)) {
      const teamIdx = p.teamIdx;
      state.traps.set(pos, { owner: name, teamIdx });
      if (state.ulars.has(name)) {
        const oldPos = state.ulars.get(name);
        state.traps.delete(oldPos);
      }
      state.ulars.set(name, pos);
      pushFeed('mystery', name, '', '🐍 Snake drop');
    }
    return { pos, effect: 'snake-drop' };
  }
  if (effect === 'chaos-strike') {
    const allTargets = getAllOtherTargets(name, p);
    if (allTargets.length > 0) {
      const victim = allTargets[randInt(0, allTargets.length - 1)];
      victim.p.pos = Math.max(1, victim.p.pos - 8);
      victim.p.arrive = ++arriveSeq;
      pushFeed('mystery', name, victim.name, '💀 Chaos strike -8');
    }
    return { pos, effect: 'chaos-strike' };
  }
  
  // DEBUFF effects
  if (effect === 'trap') {
    const newPos = Math.max(1, pos - 5);
    pushFeed('mystery', name, '', '🪤 Trap -5');
    return { pos: newPos, effect: 'trap' };
  }
  if (effect === 'dizzy') {
    p.skip += 1;
    pushFeed('mystery', name, '', '😵 Dizzy skip');
    return { pos, effect: 'dizzy' };
  }
  if (effect === 'reverse') {
    const back = randInt(3, 6);
    const newPos = Math.max(1, pos - back);
    pushFeed('mystery', name, '', `⏪ Reverse -${back}`);
    return { pos: newPos, effect: 'reverse' };
  }
  if (effect === 'cursed') {
    p.cursedNext = true;
    pushFeed('mystery', name, '', '💀 Cursed next roll');
    return { pos, effect: 'cursed' };
  }
  
  // Respawn mystery tile with new effect after applying current effect
  respawnMysteryTile(pos);
  
  return { pos, effect: 'unknown' };
}

function doRoll(name, p, now) {
  let d = randInt(1, 6);
  
  // Apply lucky/cursed buffs
  if (p.luckyNext) {
    d = randInt(5, 6);
    p.luckyNext = false;
  } else if (p.cursedNext) {
    d = randInt(1, 2);
    p.cursedNext = false;
  }
  
  // Speed buff: roll 2 dice, take best
  if (p.speedLeft > 0) {
    const d2 = randInt(1, 6);
    d = Math.max(d, d2);
    p.speedLeft -= 1;
  }
  
  const from = p.pos;
  const r = applyRoll(state.board.effects, from, d);
  
  // Resolve effects
  let finalPos = r.t;
  let finalEffect = r.v;
  
  if (r.v === 'mystery') {
    const mysteryResult = resolveMysteryEffect(p, name, r.m, now);
    finalPos = mysteryResult.pos;
    finalEffect = mysteryResult.effect;
  } else if (r.v === 'snake' && p.shieldUntil > now) {
    finalPos = r.m;
    finalEffect = 'shielded';
  } else if (r.v === 'snake' && state.shieldUntil > now) {
    finalPos = r.m;
    finalEffect = 'shielded';
  } else if (r.v === null) {
    // Check traps
    const trap = state.traps.get(r.t);
    if (trap && trap.owner !== name) {
      state.traps.delete(r.t);
      finalPos = Math.max(1, r.t - TRAP_DROP);
      finalEffect = 'trap';
      pushFeed('trap', trap.owner, name, '🐍 Ular trap -10');
    }
  }
  
  rollSeq += 1;
  p.pos = finalPos;
  p.rolls += 1;
  p.lastActive = now;
  p.arrive = ++arriveSeq;
  p.q = rollSeq;
  p.d = d;
  p.f = from;
  p.m = r.m;
  p.v = finalEffect;
  
  state.recent.push({
    s: rollSeq,
    n: shortName(name),
    d,
    f: from,
    t: finalPos,
    v: finalEffect,
    it: ''
  });
  if (state.recent.length > RECENT_ROLLS_IN_PAYLOAD) state.recent.shift();
  
  return { ...r, t: finalPos, v: finalEffect, d };
}

function takeTurn() {
  turnTimer = null;
  if (!state || state.phase !== 'racing') return;
  const now = Date.now();
  const name = state.turn;
  const p = name == null ? null : state.players.get(name);
  if (!p || p.rank) { advanceTurn(); return; }
  
  if (p.skip > 0) {
    p.skip -= 1;
    pushFeed('skip', name, '', 'beku');
    scheduleBroadcast();
    advanceTurn();
    return;
  }
  
  const r = doRoll(name, p, now);
  
  // Update team position if in team mode
  if (!isSoloMode(state) && p.teamIdx !== null) {
    state.teamPositions[p.teamIdx] = p.pos;
    state.teamRolls[p.teamIdx] += 1;
  }
  
  // Check finish
  if (p.pos === BOARD_SIZE) {
    if (isSoloMode(state)) {
      // Solo mode finish
      p.rank = state.finishers.length + 1;
      p.finishMs = now - state.startedAt;
      const points = WINNER_POINTS[p.rank - 1] || 0;
      state.finishers.push({
        player: shortName(name),
        rank: p.rank,
        points,
        ms: p.finishMs,
        rolls: p.rolls
      });
      if (points && awardPoints) awardPoints(name, points);
    } else {
      // Team mode finish - all team members get points
      const teamIdx = p.teamIdx;
      if (state.teamRank[teamIdx] === 0) {
        const teamRank = state.finishers.length + 1;
        state.teamRank[teamIdx] = teamRank;
        state.teamFinishMs[teamIdx] = now - state.startedAt;
        const points = WINNER_POINTS[teamRank - 1] || 0;
        
        // Award all team members
        for (const memberName of state.teamRosters[teamIdx]) {
          const member = state.players.get(memberName);
          if (member) {
            member.rank = teamRank;
            member.finishMs = state.teamFinishMs[teamIdx];
            if (points && awardPoints) awardPoints(memberName, points);
          }
        }
        
        state.finishers.push({
          team: TEAM_COLORS[teamIdx],
          rank: teamRank,
          points,
          ms: state.teamFinishMs[teamIdx],
          rolls: state.teamRolls[teamIdx],
          members: state.teamRosters[teamIdx].map(n => shortName(n))
        });
      }
    }
    
    if (checkRoundEnd()) return;
    scheduleBroadcast();
    advanceTurn();
    return;
  }
  
  scheduleBroadcast();
  
  // Dadu 6 rule OR again tile OR double mystery effect
  if (r.d === 6 || r.v === 'again' || r.v === 'double') {
    scheduleTurn(); // same player lempar lagi
  } else {
    advanceTurn();
  }
}

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
    requestCompletion();
  } else {
    newRound();
  }
}

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
  if (typeof name !== 'string') return '';
  return name.length > 12 ? name.slice(0, 11) + '…' : name;
}

function compareProgress(a, b) {
  if (a.rank && b.rank) return a.rank - b.rank;
  if (a.rank) return -1;
  if (b.rank) return 1;
  return b.pos - a.pos || a.arrive - b.arrive;
}

function turnQueue() {
  if (!state) return [];
  if (state.phase === 'lobby') return state.order.map(shortName);
  if (state.turn == null) return [];
  
  if (isSoloMode(state)) {
    const n = state.order.length;
    const idx = state.order.indexOf(state.turn);
    const out = [];
    for (let i = 0; i < n; i++) {
      const nm = state.order[(idx + i) % n];
      const q = state.players.get(nm);
      if (q && !q.rank) out.push(shortName(nm));
    }
    return out;
  } else {
    // Team mode: show current roller
    return [shortName(state.turn)];
  }
}

// ---------- battle system ----------
function pushFeed(k, a, b, it) {
  state.feed.push({ s: ++evSeq, k, a: shortName(a), b: b ? shortName(b) : '', it });
  if (state.feed.length > FEED_KEEP) state.feed.shift();
}

function findClosestTargetAhead(name, me, now) {
  const myPos = isSoloMode(state) ? me.pos : state.teamPositions[me.teamIdx];
  const ranked = [...state.players.entries()].sort(([, a], [, b]) => compareProgress(a, b));
  
  for (const [n, q] of ranked) {
    if (n === name) continue;
    if (q.rank) continue;
    
    const targetPos = isSoloMode(state) ? q.pos : state.teamPositions[q.teamIdx];
    if (targetPos <= myPos) continue;
    if (q.shieldUntil > now) continue;
    
    return { name: n, p: q };
  }
  return null;
}

function findFarthestBehind(name, me) {
  const myPos = isSoloMode(state) ? me.pos : state.teamPositions[me.teamIdx];
  const ranked = [...state.players.entries()].sort(([, a], [, b]) => compareProgress(b, a));
  
  for (const [n, q] of ranked) {
    if (n === name) continue;
    if (q.rank) continue;
    
    const targetPos = isSoloMode(state) ? q.pos : state.teamPositions[q.teamIdx];
    if (targetPos >= myPos) continue;
    
    return { name: n, p: q };
  }
  return null;
}

function getAllOtherTargets(name, me) {
  const targets = [];
  for (const [n, q] of state.players.entries()) {
    if (n === name || q.rank) continue;
    targets.push({ name: n, p: q });
  }
  return targets;
}

function applySerang(victimName, victim, attackerName, now) {
  if (isSoloMode(state)) {
    victim.pos = Math.max(1, victim.pos - ATTACK_BACK);
    victim.arrive = ++arriveSeq;
  } else {
    const teamIdx = victim.teamIdx;
    state.teamPositions[teamIdx] = Math.max(1, state.teamPositions[teamIdx] - ATTACK_BACK);
    victim.arrive = ++arriveSeq;
  }
  pushFeed('hit', attackerName, victimName, '💥 Serang -5');
}

function applyBeku(victimName, victim, attackerName, now) {
  victim.skip += FREEZE_TURNS;
  pushFeed('hit', attackerName, victimName, '🧊 Beku skip');
}

function useBattleCommand(name, p, cmd, now) {
  if (!state || state.phase !== 'racing') {
    return { ok: false, msg: 'Ronde belum jalan' };
  }
  
  const kind = cmd.kind;
  
  // Check stamina cost
  let cost = 0;
  if (kind === 'serang') cost = COST_SERANG;
  else if (kind === 'beku') cost = COST_BEKU;
  else if (kind === 'ular') cost = COST_ULAR;
  
  if (p.stamina < cost) {
    return { ok: false, msg: `Stamina kurang (butuh ${cost})` };
  }
  
  // Deduct stamina
  p.stamina -= cost;
  
  if (kind === 'serang') {
    let target = null;
    if (cmd.target) {
      // Target specific team
      const teamIdx = TEAM_COLORS.findIndex(c => c.toLowerCase().includes(cmd.target));
      if (teamIdx >= 0 && teamIdx < state.teams.length) {
        const targetRoster = state.teamRosters[teamIdx];
        if (targetRoster.length > 0) {
          const targetName = targetRoster[0];
          target = { name: targetName, p: state.players.get(targetName) };
        }
      }
    } else {
      target = findClosestTargetAhead(name, p, now);
    }
    
    if (target) {
      applySerang(target.name, target.p, name, now);
    } else {
      p.stamina += cost; // refund
      return { ok: false, msg: 'Tidak ada target' };
    }
  } else if (kind === 'beku') {
    let target = null;
    if (cmd.target) {
      const teamIdx = TEAM_COLORS.findIndex(c => c.toLowerCase().includes(cmd.target));
      if (teamIdx >= 0 && teamIdx < state.teams.length) {
        const targetRoster = state.teamRosters[teamIdx];
        if (targetRoster.length > 0) {
          const targetName = targetRoster[0];
          target = { name: targetName, p: state.players.get(targetName) };
        }
      }
    } else {
      target = findClosestTargetAhead(name, p, now);
    }
    
    if (target) {
      applyBeku(target.name, target.p, name, now);
    } else {
      p.stamina += cost;
      return { ok: false, msg: 'Tidak ada target' };
    }
  } else if (kind === 'ular') {
    const pos = isSoloMode(state) ? p.pos : state.teamPositions[p.teamIdx];
    if (pos <= 0 || pos >= BOARD_SIZE) {
      p.stamina += cost;
      return { ok: false, msg: 'Tidak bisa pasang di sini' };
    }
    if (state.traps.has(pos)) {
      p.stamina += cost;
      return { ok: false, msg: 'Sudah ada ular' };
    }
    
    // Remove old ular
    if (state.ulars.has(name)) {
      const oldPos = state.ulars.get(name);
      state.traps.delete(oldPos);
    }
    
    state.traps.set(pos, { owner: name, teamIdx: p.teamIdx });
    state.ulars.set(name, pos);
    pushFeed('set', name, '', '🐍 Pasang ular');
  }
  
  p.lastActive = now;
  scheduleBroadcast();
  return { ok: false, msg: 'Perintah dijalankan' };
}

// Handle TikTok LIKE event
function handleLike(name, now) {
  if (!state || state.phase !== 'racing') return;
  const p = state.players.get(name);
  if (!p) return;
  
  p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_PER_LIKE);
  p.lastActive = now;
  scheduleBroadcast();
}

// ---------- event global ----------
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

function startEvent(forced) {
  eventTimer = null;
  if (!state || state.phase !== 'racing') return;
  if (!forced && state.players.size < 2) { scheduleEvent(); return; }
  const now = Date.now();
  state.event = {
    t: forced || pickEvent(),
    ph: 'warn',
    at: now + EVENT_WARN_MS,
    end: now + EVENT_WARN_MS,
    w: '',
    got: []
  };
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
    if (isSoloMode(state)) {
      for (const q of state.players.values()) {
        if (q.rank || q.pos <= 0) continue;
        q.pos = Math.max(1, Math.min(BOARD_SIZE - 1, q.pos + d));
        q.arrive = ++arriveSeq;
      }
    } else {
      for (let i = 0; i < state.teams.length; i++) {
        if (state.teamRank[i] > 0) continue;
        state.teamPositions[i] = Math.max(1, Math.min(BOARD_SIZE - 1, state.teamPositions[i] + d));
      }
    }
  } else if (ev.t === 'shield') {
    state.shieldUntil = now + SHIELD_MS;
    dur = SHIELD_MS;
  } else if (ev.t === 'grab') {
    ev.w = GRAB_WORDS[randInt(0, GRAB_WORDS.length - 1)];
    dur = GRAB_MS;
  }
  
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

function isGrabComment(text) {
  const ev = state && state.event;
  if (!ev || ev.t !== 'grab' || ev.ph !== 'active' || typeof text !== 'string') return false;
  return text.trim().toLowerCase().replace(/[\s!.?,]+$/g, '') === ev.w;
}

function joinGrab(name, now) {
  const ev = state.event;
  if (ev.got.includes(name)) return { ok: false, msg: 'Sudah dapat' };
  const p = state.players.get(name);
  if (!p) return { ok: false, msg: 'Belum ikut main' };
  if (p.rank) return { ok: false, msg: 'Sudah finish' };
  
  // Give stamina as reward
  p.stamina = Math.min(STAMINA_MAX, p.stamina + 20);
  ev.got.push(name);
  pushFeed('item', name, '', '⚡ +20 Stamina');
  
  if (ev.got.length >= GRAB_WINNERS) endEvent();
  scheduleBroadcast();
  return { ok: false, msg: 'Dapat stamina' };
}

// ---------- kontrak game ----------
module.exports = {
  id: 'ular-tangga',

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
    const cmd = parseBattleCommand(text);
    return cmd ? { answer: cmd.kind + (cmd.target ? ' ' + cmd.target : '') } : null;
  },

  handleAnswer({ answer, player }) {
    if (!state) return { ok: false, msg: 'Ronde belum siap' };
    const name = player ? String(player) : '';
    if (!name) return { ok: false, msg: 'Pemain tidak valid' };
    const text = String(answer || '');
    const now = Date.now();

    if (isJoinComment(text)) return joinPlayer(name, now);
    if (state.phase !== 'racing') return { ok: false, msg: 'Ronde belum jalan' };
    if (isGrabComment(text)) return joinGrab(name, now);
    
    const cmd = parseBattleCommand(text);
    if (cmd) {
      const p0 = state.players.get(name);
      if (!p0 || p0.rank) return { ok: false, msg: 'Belum bisa pakai perintah' };
      return useBattleCommand(name, p0, cmd, now);
    }
    
    return { ok: false, msg: 'Perintah tidak dikenal' };
  },
  
  // NEW: Handle TikTok LIKE events
  handleLike({ player }) {
    if (!state) return;
    const name = player ? String(player) : '';
    if (!name) return;
    const now = Date.now();
    
    // Auto-join if not joined yet (during racing)
    if (state.phase === 'racing' && !state.players.has(name)) {
      if (state.players.size < MAX_PLAYERS) {
        joinPlayer(name, now);
      }
    }
    
    handleLike(name, now);
  },

  isComplete() {
    return !!state && state.phase === 'done';
  },

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
        phase: 'lobby',
        round: 1,
        mode: 'solo',
        size: BOARD_SIZE,
        snakes: [],
        ladders: [],
        specials: [],
        board: null,
        endsAt: 0,
        serverTime: Date.now(),
        turn: '',
        turnAt: 0,
        turnMs: TURN_MS,
        queue: [],
        lobby: { endsAt: 0, min: LOBBY_MIN_SOLO, max: MAX_PLAYERS },
        winnersNeeded: WINNER_COUNT,
        totalPlayers: 0,
        players: [],
        teams: [],
        finishers: [],
        closest: [],
        recentRolls: []
      };
    }

    const mode = isSoloMode(state) ? 'solo' : 'team';
    const ranked = [...state.players.entries()].sort(([, a], [, b]) => compareProgress(a, b));
    const now = Date.now();

    const players = ranked.map(([name, p]) => ({
      n: shortName(name),
      p: isSoloMode(state) ? p.pos : state.teamPositions[p.teamIdx],
      r: p.rank,
      c: p.ci,
      st: p.stamina,
      team: p.teamIdx,
      sk: p.skip,
      shield: p.shieldUntil > now,
      speed: p.speedLeft,
      lucky: p.luckyNext,
      cursed: p.cursedNext,
      q: p.q,
      d: p.d,
      f: p.f,
      m: p.m,
      v: p.v
    }));

    const teams = state.teams.map((idx) => ({
      idx,
      name: TEAM_COLORS[idx],
      emoji: TEAM_EMOJI[idx],
      pos: state.teamPositions[idx],
      rank: state.teamRank[idx],
      members: state.teamRosters[idx].map(n => shortName(n)),
      currentRoller: state.currentTeam === idx ? shortName(state.turn) : ''
    }));

    const closest = state.phase !== 'racing' && state.phase !== 'lobby' && state.finishers.length < WINNER_COUNT
      ? ranked.filter(([, p]) => !p.rank).slice(0, WINNER_COUNT - state.finishers.length)
          .map(([name]) => shortName(name))
      : [];

    const minPlayers = mode === 'team' ? LOBBY_MIN_TEAM : LOBBY_MIN_SOLO;

    return {
      phase: state.phase,
      round: state.round,
      mode,
      size: BOARD_SIZE,
      snakes: state.board.snakes,
      ladders: state.board.ladders,
      specials: state.board.specials,
      board: state.board,
      endsAt: state.endsAt,
      serverTime: now,
      endReason: state.endReason,
      turn: state.turn != null ? shortName(state.turn) : '',
      currentTeam: state.currentTeam,
      turnAt: state.phase === 'racing' ? state.turnAt : 0,
      turnMs: TURN_MS,
      queue: turnQueue(),
      lobby: { endsAt: state.lobbyEndsAt, min: minPlayers, max: MAX_PLAYERS },
      participationMax: PARTICIPATION_MAX,
      winnersNeeded: WINNER_COUNT,
      totalPlayers: state.players.size,
      players,
      teams,
      finishers: state.finishers,
      closest,
      recentRolls: state.recent,
      traps: [...state.traps].map(([c, t]) => [c, t.teamIdx]),
      feed: state.feed,
      event: state.event
        ? {
            t: state.event.t,
            ph: state.event.ph,
            at: state.event.at,
            end: state.event.end,
            w: state.event.ph === 'active' ? state.event.w : '',
            n: state.event.got.length,
            m: GRAB_WINNERS
          }
        : null
    };
  },

  getAdminAnswers() {
    if (!state) return { title: 'Ular Tangga V2', items: [] };
    const mode = isSoloMode(state) ? 'Solo' : `Team (${state.teams.length} tim)`;
    const items = [
      { label: 'Mode', answer: mode, solved: false },
      { label: 'Fase', answer: state.phase, solved: false },
      { label: 'Rata-rata lemparan (simulasi)', answer: String(state.board.avgRolls), solved: false },
      { label: 'Ular / Tangga / Spesial', answer: `${state.board.snakes.length} / ${state.board.ladders.length} / ${state.board.specials.length}`, solved: false },
      { label: 'Pemain', answer: String(state.players.size), solved: false },
      ...state.finishers.map((f) => ({
        label: `Juara ${f.rank}`,
        answer: f.team || f.player,
        solved: true
      }))
    ];
    return { title: `Ular Tangga V2 - Ronde ${state.round}`, items };
  },

  // ---------- test helpers ----------
  _isJoinComment: isJoinComment,
  _parseBattleCommand: parseBattleCommand,
  _applyRoll: applyRoll,
  _generateBoard: generateBoard,
  _tryGenerateBoard: tryGenerateBoard,
  _fallbackBoard: fallbackBoard,
  _buildEffects: buildEffects,
  _simulate: simulate,
  _setRng(fn) { rng = typeof fn === 'function' ? fn : Math.random; },
  _setEvents(on) { EVENTS_ENABLED = !!on; },
  _pauseTurns(on) {
    TURNS_PAUSED = !!on;
    if (on) { clearTimeout(turnTimer); turnTimer = null; }
    else if (state && state.phase === 'racing') scheduleTurn();
  },
  _startEvent(type) { clearTimeout(eventTimer); startEvent(type); },
  _giveStamina(name, amount) {
    const p = state.players.get(name);
    if (p) p.stamina = Math.min(STAMINA_MAX, p.stamina + amount);
  },
  _setBoard(snakes, ladders, specials) {
    state.board = {
      snakes, ladders, specials,
      effects: buildEffects(snakes, ladders, specials),
      avgRolls: 0
    };
  },
  _config: {
    EVENT_WARN_MS, EVENT_BANNER_MS, STORM_BACK, WIND_FWD, SHIELD_MS, GRAB_WINNERS,
    PARTICIPATION_MAX, BOARD_SIZE, ROUND_TIMEOUT_MS, PODIUM_MS, WINNER_POINTS,
    TURN_MS, LOBBY_MIN_SOLO, LOBBY_MIN_TEAM, LOBBY_MS, LOBBY_IDLE_MS, MAX_PLAYERS,
    BROADCAST_THROTTLE_MS, SNAKE_COUNT, LADDER_COUNT, MIN_JUMP, MAX_SNAKE_DROP,
    MAX_LADDER_RISE, BACK_STEPS, FWD_STEPS, TARGET_ROLLS_MIN, TARGET_ROLLS_MAX,
    STAMINA_MAX, STAMINA_PER_LIKE, COST_SERANG, COST_BEKU, COST_ULAR,
    ATTACK_BACK, FREEZE_TURNS, TRAP_DROP
  }
};
