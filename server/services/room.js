// services/room.js
//
// Satu Room = satu user (streamer). Ini port dari server.js V1, tapi state-nya
// per-instance (bukan variabel global), dan emit-nya cuma ke room Socket.IO
// milik user itu (`room_<username>`).
//
// Logika game (validasi jawaban, skor, grid, bank soal) TIDAK ditulis ulang:
// dipakai apa adanya dari modul V1 (games/*/index.js). Tiap user dapat SALINAN
// folder games sendiri di DATA_DIR/rooms/<username>/, jadi file state di disk
// (puzzle.json, used-*.json, state.json, fallback/) nggak bentrok antar user,
// dan tiap user otomatis punya instance modul sendiri.

const fs = require('fs');
const path = require('path');
const createVoteController = require('../vote-controller');

const MODE_RANDOM = 'random';
const MODE_FIXED = 'fixed';

const AVATAR_POOL = [
  '🐱','🐶','🐰','🦊','🐻','🐼','🐨','🐯','🐸','🐵','🦁','🐷','🐹','🐮',
  '🐔','🐧','🐦','🦉','🐺','🐗','🐴','🦄','🐝','🐛','🐢','🐍','🦎','🐙',
  '🐳','🐬','🦈','🐊','🦒','🐘','🦏','🦛','🦘','🦥','🦦','🦡','🦨','🐿️',
  '🦔','🐐','🐑','🦙','🐫','🦌','🐇','🦫'
];
const MAX_AVATARS = 20;
const AVATAR_TIMEOUT = 120000; // 2 menit

const VOTABLE_GAMES = [
  { num: 1, id: 'family100', label: 'Family 100' },
  { num: 2, id: 'sambung-kata', label: 'Sambung Kata' },
  { num: 3, id: 'susun-kata-acak', label: 'Susun Kata Acak' }
];

function findCircularPath(obj) {
  const seen = new WeakSet();
  function walk(val, p) {
    if (val && typeof val === 'object') {
      if (seen.has(val)) return p;
      seen.add(val);
      for (const key of Object.keys(val)) {
        const found = walk(val[key], `${p}.${key}`);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(obj, 'payload');
}

// Salin folder template games/ ke folder milik user.
// - file .js SELALU ditimpa (biar update kode ikut ke semua user)
// - file lain (puzzle.json, used-*.json, bank soal, dst) cuma disalin kalau
//   belum ada, supaya progres/riwayat soal user nggak ketimpa.
function syncTemplate(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      syncTemplate(src, dest);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.md') || !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}

class Room {
  constructor({ username, io, dataDir, templateDir, aiClientPath, publicDir, settings }) {
    this.username = username;
    this.io = io;
    this.roomName = `room_${username}`;
    this.roomDir = path.join(dataDir, 'rooms', username);
    this.templateDir = templateDir;
    this.aiClientPath = aiClientPath;
    this.publicDir = publicDir;
    this.stateFile = path.join(this.roomDir, 'room-state.json');

    this.games = null;
    this.activeGame = null;
    this.activeGameId = null;
    this.mode = MODE_RANDOM;
    this.pool = null;
    this.leaderboard = {};
    this.unlockedLevels = { 2: false, 3: false };
    this.sessionAvatars = {};
    this.liveStatus = { active: false, username: null, error: null, updatedAt: null };
    this.isGeneratingNext = false;
    this.initialized = new Set(); // game yang sudah pernah dikasih ronde SEGAR di room ini
    this.voteController = null;
    this.initialSettings = settings || {};
  }

  // ---------- lifecycle ----------

  async start() {
    fs.mkdirSync(this.roomDir, { recursive: true });
    syncTemplate(this.templateDir, path.join(this.roomDir, 'games'));
    fs.copyFileSync(this.aiClientPath, path.join(this.roomDir, 'ai-client.js'));

    this.games = require(path.join(this.roomDir, 'games', 'game-registry'));
    const allIds = Object.keys(this.games);

    const saved = this.loadSaved();
    this.leaderboard = saved.leaderboard || {};
    this.initialized = new Set(saved.initialized || []);

    const s = this.initialSettings;
    this.pool = this.cleanPool(s.randomGames) || saved.pool || allIds;

    if (s.activeGame && s.activeGame !== 'game-random' && this.games[s.activeGame]) {
      this.mode = MODE_FIXED;
      this.activeGameId = s.activeGame;
    } else if (s.activeGame === 'game-random') {
      this.mode = MODE_RANDOM;
      this.activeGameId = this.games[saved.gameId] && this.pool.includes(saved.gameId)
        ? saved.gameId
        : this.pickRandomGameId(null);
    } else {
      this.mode = saved.mode === MODE_FIXED ? MODE_FIXED : MODE_RANDOM;
      this.activeGameId = this.games[saved.gameId] ? saved.gameId : (this.pool[0] || 'tts');
    }

    this.activeGame = this.games[this.activeGameId];
    await this.activeGame.init();
    this.bindBroadcaster();
    await this.ensureRoundReady();

    this.voteController = createVoteController({
      safeEmit: (event, payload) => this.emit(event, payload),
      performSwitchGame: (id) => this.performSwitchGame(id),
      performForceNext: (src) => this.performForceNext(src),
      performReveal: () => this.performReveal(),
      votableGames: VOTABLE_GAMES.filter(g => this.games[g.id])
    });
    this.saveState();
  }

  dispose() {
    for (const p of Object.keys(this.sessionAvatars)) {
      clearTimeout(this.sessionAvatars[p].timer);
    }
    this.sessionAvatars = {};
  }

  // Template games/ bawa sisa state dari V1 (puzzle setengah terjawab dst).
  // Jadi PERTAMA KALI sebuah game dipakai di room ini, kita paksa ambil ronde
  // segar dari bank. Setelahnya cuma diganti kalau ronde tersimpan sudah selesai.
  async ensureRoundReady() {
    try {
      const g = this.activeGame;
      const needsFresh = !this.initialized.has(this.activeGameId) || (g.isComplete && g.isComplete());
      if (needsFresh && g.onComplete) await g.onComplete(this.getRandomLevel());
      this.initialized.add(this.activeGameId);
    } catch (err) {
      console.error(`[Room ${this.username}] ensureRoundReady gagal:`, err.message);
    }
  }

  bindBroadcaster() {
    if (this.activeGame.setBroadcaster) {
      this.activeGame.setBroadcaster(() => this.emit('update', this.activeGame.buildStatePayload()));
    }
  }

  // ---------- persistence ----------

  loadSaved() {
    try {
      if (fs.existsSync(this.stateFile)) return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch (e) {
      console.error(`[Room ${this.username}] gagal baca room-state.json:`, e.message);
    }
    return {};
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify({
        gameId: this.activeGameId,
        mode: this.mode,
        pool: this.pool,
        leaderboard: this.leaderboard,
        initialized: [...this.initialized]
      }, null, 2), 'utf8');
    } catch (e) {
      console.error(`[Room ${this.username}] gagal simpan room-state.json:`, e.message);
    }
  }

  // ---------- emit (aman dari circular reference) ----------

  emit(event, payload) {
    try {
      JSON.stringify(payload);
      this.io.to(this.roomName).emit(event, payload);
    } catch (err) {
      console.error(`❌ [Room ${this.username}] emit('${event}') dibatalkan, payload bermasalah (${findCircularPath(payload) || 'cek manual'}): ${err.message}`);
    }
  }

  emitTo(socket, event, payload) {
    try {
      JSON.stringify(payload);
      socket.emit(event, payload);
    } catch (err) {
      console.error(`❌ [Room ${this.username}] emitTo('${event}') dibatalkan: ${err.message}`);
    }
  }

  // Dikirim ke satu overlay yang baru join (atau join ulang setelah reconnect).
  sendFullState(socket) {
    try {
      this.emitTo(socket, 'update', this.activeGame.buildStatePayload());
    } catch (err) {
      console.error(`[Room ${this.username}] buildStatePayload gagal:`, err.message);
    }
    this.emitTo(socket, 'leaderboard:update', this.buildLeaderboardPayload());
    this.emitTo(socket, 'live:status', this.liveStatus);
    this.emitTo(socket, 'status', { connected: this.liveStatus.active });
    this.emitTo(socket, 'avatar:sync', Object.entries(this.sessionAvatars).map(([player, d]) => ({ player, emoji: d.emoji })));
  }

  // ---------- leaderboard & level ----------

  addScore(player, points) {
    const name = player || 'Anonim';
    this.leaderboard[name] = (this.leaderboard[name] || 0) + points;
    this.saveState();
  }

  buildLeaderboardPayload() {
    return Object.entries(this.leaderboard)
      .map(([player, score]) => ({ player, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  getHighestScore() {
    return Math.max(0, ...Object.values(this.leaderboard));
  }

  checkLevelUnlock() {
    const high = this.getHighestScore();
    const unlocked = [];
    if (high >= 300 && !this.unlockedLevels[2]) { this.unlockedLevels[2] = true; unlocked.push(2); }
    if (high >= 500 && !this.unlockedLevels[3]) { this.unlockedLevels[3] = true; unlocked.push(3); }
    return unlocked;
  }

  getRandomLevel() {
    const available = [1];
    if (this.unlockedLevels[2]) available.push(2);
    if (this.unlockedLevels[3]) available.push(3);
    return available[Math.floor(Math.random() * available.length)];
  }

  resetLeaderboard() {
    this.leaderboard = {};
    this.unlockedLevels = { 2: false, 3: false };
    this.saveState();
    this.emit('leaderboard:update', this.buildLeaderboardPayload());
  }

  // ---------- avatar ----------

  removeAvatar(player) {
    if (!this.sessionAvatars[player]) return;
    clearTimeout(this.sessionAvatars[player].timer);
    delete this.sessionAvatars[player];
    this.emit('avatar:remove', { player });
  }

  assignAvatarIfNeeded(player) {
    const name = player || 'Anonim';
    const existing = this.sessionAvatars[name];
    if (existing) {
      clearTimeout(existing.timer);
      existing.lastActive = Date.now();
      existing.timer = setTimeout(() => this.removeAvatar(name), AVATAR_TIMEOUT);
      return null;
    }
    if (Object.keys(this.sessionAvatars).length >= MAX_AVATARS) {
      const oldest = Object.entries(this.sessionAvatars).sort((a, b) => a[1].lastActive - b[1].lastActive)[0];
      this.removeAvatar(oldest[0]);
    }
    const used = new Set(Object.values(this.sessionAvatars).map(a => a.emoji));
    const available = AVATAR_POOL.filter(e => !used.has(e));
    const pool = available.length > 0 ? available : AVATAR_POOL;
    const emoji = pool[Math.floor(Math.random() * pool.length)];
    const timer = setTimeout(() => this.removeAvatar(name), AVATAR_TIMEOUT);
    if (timer.unref) timer.unref();
    this.sessionAvatars[name] = { emoji, lastActive: Date.now(), timer };
    return emoji;
  }

  resetSessionAvatars() {
    for (const p of Object.keys(this.sessionAvatars)) clearTimeout(this.sessionAvatars[p].timer);
    this.sessionAvatars = {};
    this.emit('avatar:reset');
  }

  // ---------- status live TikTok ----------

  setLiveStatus(active, tiktokUsername, error) {
    const isNewSession = !!active && !this.liveStatus.active;
    this.liveStatus = { active: !!active, username: tiktokUsername || null, error: error || null, updatedAt: Date.now() };
    this.emit('live:status', this.liveStatus);
    this.emit('status', { connected: !!active });
    if (isNewSession) this.resetSessionAvatars();
  }

  // ---------- pengaturan dari dashboard ----------

  cleanPool(list) {
    if (!Array.isArray(list)) return null;
    const ids = list.filter(id => this.games ? this.games[id] : true);
    return ids.length > 0 ? ids : null;
  }

  pickRandomGameId(excludeId) {
    const pool = (this.pool && this.pool.length > 0) ? this.pool : Object.keys(this.games);
    const candidates = pool.filter(id => id !== excludeId && this.games[id]);
    const list = candidates.length > 0 ? candidates : pool;
    return list[Math.floor(Math.random() * list.length)];
  }

  hasReadyFrontend(gameId) {
    return fs.existsSync(path.join(this.publicDir, gameId, 'index.html'));
  }

  // Dipanggil dari POST /settings. Return { switched, mode, gameId }.
  async applySettings({ activeGame, randomGames }) {
    const pool = this.cleanPool(randomGames);
    if (pool) this.pool = pool;

    let switched = false;
    if (activeGame === 'game-random') {
      this.mode = MODE_RANDOM;
      if (!this.pool.includes(this.activeGameId)) {
        const r = await this.performSwitchGame(this.pickRandomGameId(this.activeGameId));
        switched = !!(r.ok && !r.unchanged);
      }
    } else if (activeGame && this.games[activeGame]) {
      this.mode = MODE_FIXED;
      const r = await this.performSwitchGame(activeGame);
      switched = !!(r.ok && !r.unchanged);
    }
    this.saveState();
    this.emit('mode:changed', { mode: this.mode, gameId: this.activeGameId });
    return { switched, mode: this.mode, gameId: this.activeGameId };
  }

  // ---------- ganti game / ronde ----------

  async performSwitchGame(gameId) {
    const nextGame = this.games[gameId];
    if (!nextGame) return { ok: false, error: `Game "${gameId}" tidak ada` };
    if (!this.hasReadyFrontend(gameId)) {
      return { ok: false, error: `public/${gameId}/index.html belum ada` };
    }
    if (gameId === this.activeGameId) return { ok: true, id: gameId, unchanged: true };

    try {
      await nextGame.init();
    } catch (err) {
      console.error(`❌ [Room ${this.username}] gagal init "${gameId}":`, err.message);
      return { ok: false, error: `Gagal menyiapkan game "${gameId}"` };
    }

    this.activeGame = nextGame;
    this.activeGameId = gameId;
    this.bindBroadcaster();
    await this.ensureRoundReady();
    this.saveState();

    this.emit('game:switched', { gameId, state: this.activeGame.buildStatePayload(), mode: this.mode });
    this.emit('leaderboard:update', this.buildLeaderboardPayload());
    return { ok: true, id: gameId };
  }

  async switchGameAndGenerateRound(nextId) {
    const nextGame = this.games[nextId];
    try {
      await nextGame.init();
    } catch (err) {
      console.error(`❌ [Room ${this.username}] gagal init "${nextId}" (rotasi):`, err.message);
      this.emit('puzzle:error', { message: `Gagal menyiapkan game "${nextId}"` });
      return;
    }

    this.activeGame = nextGame;
    this.activeGameId = nextId;
    this.bindBroadcaster();
    this.saveState();

    this.isGeneratingNext = true;
    this.emit('puzzle:completed', { message: `Ronde selesai! Ganti ke game "${nextId}"...` });
    try {
      const result = await this.activeGame.onComplete(this.getRandomLevel());
      if (!result || result.success === false) {
        this.emit('puzzle:error', { message: `Gagal membuat soal buat game "${nextId}"` });
        return;
      }
      this.initialized.add(nextId);
      this.saveState();
      const statePayload = this.activeGame.buildStatePayload();
      this.emit('game:switched', { gameId: nextId, state: statePayload, mode: this.mode });
      this.emit('leaderboard:update', this.buildLeaderboardPayload());
      this.emit('update', statePayload);
      this.emit('puzzle:new', {
        clues: this.activeGame.buildClueList ? this.activeGame.buildClueList() : null,
        source: result.source || 'random-rotation',
        level: result.level
      });
      setTimeout(() => this.emit('update', this.activeGame.buildStatePayload()), 500);
    } catch (err) {
      console.error(`❌ [Room ${this.username}] error generate ronde "${nextId}":`, err.stack || err.message);
      this.emit('puzzle:error', { message: 'Error internal saat ganti game' });
    } finally {
      this.isGeneratingNext = false;
    }
  }

  async startNextRoundInSameGame() {
    this.isGeneratingNext = true;
    this.emit('puzzle:completed', { message: 'Ronde selesai! Menyiapkan soal berikutnya...' });
    try {
      const result = await this.performForceNext('next-round');
      if (!result.ok) this.emit('puzzle:error', { message: 'Gagal membuat soal baru' });
    } finally {
      this.isGeneratingNext = false;
    }
  }

  async handleRoundCompleted() {
    if (this.mode === MODE_FIXED) return this.startNextRoundInSameGame();

    const previousId = this.activeGameId;
    let nextId = this.pickRandomGameId(previousId);
    if (!this.hasReadyFrontend(nextId)) {
      nextId = (this.pool || Object.keys(this.games)).find(id => id !== previousId && this.hasReadyFrontend(id)) || previousId;
    }
    if (nextId === previousId) return this.startNextRoundInSameGame();
    await this.switchGameAndGenerateRound(nextId);
  }

  async performForceNext(fallbackSource = 'skip') {
    if (!this.activeGame || !this.activeGame.onComplete) {
      return { ok: false, error: 'Game aktif tidak mendukung skip' };
    }
    try {
      const result = await this.activeGame.onComplete(this.getRandomLevel());
      if (!result || result.success === false) {
        return { ok: false, error: result ? result.error : 'Gagal skip soal' };
      }
      this.emit('update', this.activeGame.buildStatePayload());
      this.emit('puzzle:new', {
        clues: this.activeGame.buildClueList ? this.activeGame.buildClueList() : null,
        source: result.source || fallbackSource,
        level: result.level
      });
      setTimeout(() => this.emit('update', this.activeGame.buildStatePayload()), 500);
      return { ok: true, source: result.source };
    } catch (err) {
      console.error(`[Room ${this.username}] force next error:`, err);
      return { ok: false, error: 'Internal error saat skip' };
    }
  }

  async performReveal() {
    if (!this.activeGame || !this.activeGame.revealRandomAnswer) {
      return { ok: false, error: 'Game aktif tidak mendukung nyerah' };
    }
    const result = this.activeGame.revealRandomAnswer();
    if (!result.ok) return { ok: false, error: result.msg || 'Gagal membuka jawaban' };

    this.emit('update', this.activeGame.buildStatePayload());
    this.emit('answer:revealed', result.meta || {});
    if (this.activeGame.isComplete()) await this.handleRoundCompleted();
    return { ok: true, meta: result.meta };
  }

  // ---------- jawaban untuk admin (dashboard) ----------

  // Semua jawaban soal aktif, termasuk yang belum terjawab. HANYA lewat
  // endpoint ber-auth; jangan pernah di-emit ke socket overlay.
  getAdminAnswers() {
    const g = this.activeGame;
    if (!g || !g.getAdminAnswers) return { ok: false, error: 'Game aktif belum mendukung tampilan jawaban' };
    try {
      return { ok: true, gameId: this.activeGameId, ...g.getAdminAnswers() };
    } catch (err) {
      console.error(`[Room ${this.username}] getAdminAnswers gagal:`, err.message);
      return { ok: false, error: 'Gagal membaca jawaban' };
    }
  }

  // ---------- komentar & jawaban ----------

  // Setara alur CHAT di tiktok-connector.js V1: bubble komentar -> vote ->
  // parse -> validasi jawaban. Dipakai TikTok asli maupun tombol test dashboard.
  async handleChat({ player, text }) {
    const name = player || 'Anonim';
    const msg = (text || '').toString().slice(0, 120);
    if (!msg) return;

    const emoji = this.assignAvatarIfNeeded(name);
    if (emoji) this.emit('avatar:spawn', { player: name, emoji });
    this.emit('chat:comment', { player: name, text: msg });

    try {
      await this.voteController.handleVoteComment(msg, name);
    } catch (err) {
      console.error(`[Room ${this.username}] vote error:`, err.message);
    }

    if (this.isGeneratingNext) return;
    try {
      const parsed = await this.activeGame.parseComment(msg);
      if (parsed) await this.handleAnswer({ ...parsed, player: name });
    } catch (err) {
      console.error(`[Room ${this.username}] parse/answer error:`, err.message);
    }
  }

  // Setara POST /api/answer di server.js V1.
  async handleAnswer(payload) {
    const game = this.activeGame;
    const result = game.handleAnswer(payload);
    if (!result.ok) return result;

    const player = payload.player || 'Anonim';
    this.addScore(player, result.points || 0);

    for (const level of this.checkLevelUnlock()) {
      this.emit('level:unlock', {
        level,
        message: level === 2
          ? '🎉 Level 2 terbuka! Grid 10x10 + diagonal unlocked (high score ≥300)'
          : '🔥 Level 3 terbuka! Grid 12x12 unlocked (high score ≥500)'
      });
    }

    const emoji = this.assignAvatarIfNeeded(player);
    if (emoji) this.emit('avatar:spawn', { player, emoji });

    this.emit('update', game.buildStatePayload());
    this.emit('leaderboard:update', this.buildLeaderboardPayload());
    this.emit('answer:correct', { player, points: result.points || 0, ...(result.meta || {}) });

    if (game.isComplete()) this.handleRoundCompleted();
    return result;
  }
}

module.exports = { Room, MODE_RANDOM, MODE_FIXED };
