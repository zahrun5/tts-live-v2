const gameProxy = require('./gameProxy');

const activeGames = new Map();
const ALL_GAMES = ['tts', 'susun-kata-acak', 'family100', 'trivia', 'cari-kata', 'sambung-kata', 'susun-kalimat'];

function pickRandom(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

function emitUpdate(io, username, state) {
  const room = io.to(`room_${username}`);
  const a = state.actualGame;
  console.log(`[Game] emit update to room_${username} for ${a}`);
  if (a === 'tts') {
    room.emit('update', { type: 'tts', rows: state.rows, cols: state.cols, words: state.words });
  } else if (a === 'susun-kata-acak') {
    room.emit('update', { type: 'susun-kata-acak', slots: state.slots });
  } else if (a === 'family100') {
    room.emit('update', { type: 'family100', question: state.question, answers: state.answers });
  } else if (a === 'cari-kata') {
    room.emit('update', { type: 'cari-kata', theme: state.theme, words: state.words });
  } else if (a === 'sambung-kata') {
    room.emit('update', { type: 'sambung-kata', rows: state.rows, cols: state.cols, words: state.words });
  } else if (a === 'susun-kalimat') {
    room.emit('update', { type: 'susun-kalimat', items: state.items, totalSoal: state.totalSoal, solvedSoal: state.solvedSoal });
  } else if (a === 'trivia') {
    room.emit('update', { type: 'trivia', category: state.category, question: state.question, options: state.options, correctLetter: state.correctLetter });
  }
}

exports.initGame = (username, gameType, io, gamePool) => {
  console.log(`[Game] initGame user=${username} gameType=${gameType} pool=${JSON.stringify(gamePool)}`);
  let state = activeGames.get(username) || { leaderboard: [], solvedUsers: new Set() };
  state.leaderboard = state.leaderboard || [];
  state.solvedUsers = new Set();
  state.round = (state.round || 0) + 1;

  let actualGame;
  if (gameType === 'game-random') {
    const pool = (gamePool && gamePool.length > 0) ? gamePool : ALL_GAMES;
    actualGame = pickRandom(pool);
    state.type = 'game-random';
    state.pool = pool;
  } else {
    actualGame = gameType;
    state.type = gameType;
  }
  state.actualGame = actualGame;

  const result = gameProxy.getPuzzle(actualGame);
  if (!result) {
    console.log(`[Game] ❌ getPuzzle returned null for ${actualGame}`);
    io.to(`room_${username}`).emit('update', { type: 'error', message: `Soal ${actualGame} belum tersedia` });
    return;
  }

  const d = result.data;
  if (actualGame === 'tts') {
    Object.assign(state, { rows: d.rows, cols: d.cols, words: d.words.map(w => ({ ...w })) });
  } else if (actualGame === 'susun-kata-acak') {
    Object.assign(state, { answer: d.word, slots: d.slots });
  } else if (actualGame === 'family100') {
    Object.assign(state, { question: d.question, answers: d.answers });
  } else if (actualGame === 'cari-kata') {
    Object.assign(state, { theme: d.theme, words: d.words.map(w => ({ ...w })) });
  } else if (actualGame === 'sambung-kata') {
    Object.assign(state, { rows: d.rows, cols: d.cols, words: d.words.map(w => ({ ...w })) });
  } else if (actualGame === 'susun-kalimat') {
    Object.assign(state, { items: d.items, totalSoal: d.totalSoal, solvedSoal: 0 });
  } else if (actualGame === 'trivia') {
    Object.assign(state, { category: d.category, question: d.question, options: d.options, correctLetter: d.correctLetter });
  }

  activeGames.set(username, state);
  console.log(`[Game] ✅ Loaded ${actualGame} for ${username}, emitting update`);
  emitUpdate(io, username, state);
  io.to(`room_${username}`).emit('leaderboard:update', state.leaderboard);
};

exports.skipRound = (username, io) => {
  const state = activeGames.get(username);
  if (!state) {
    console.log(`[Game] skipRound: no state for ${username}`);
    return;
  }
  const nextType = state.type === 'game-random' ? 'game-random' : state.type;
  const nextPool = state.type === 'game-random' ? state.pool : null;
  exports.initGame(username, nextType, io, nextPool);
};

exports.checkAnswer = (username, chatData, io) => {
  const state = activeGames.get(username);
  if (!state) return;
  const text = (chatData.comment || '').toUpperCase().trim();
  const user = chatData.uniqueId || 'Anonim';

  if (state.actualGame === 'susun-kata-acak') {
    if (text === state.answer && !state.solvedUsers.has(user)) {
      state.solvedUsers.add(user);
      addScore(state, user, 10);
      state.slots[0].status = 'solved';
      state.slots[0].solvedBy = user;
      activeGames.set(username, state);
      io.to(`room_${username}`).emit('update', { type: 'susun-kata-acak', slots: state.slots });
      io.to(`room_${username}`).emit('leaderboard:update', state.leaderboard);
      const nextPool = state.type === 'game-random' ? state.pool : null;
      setTimeout(() => exports.initGame(username, state.type, io, nextPool), 4000);
    }
    return;
  }

  if (state.actualGame === 'cari-kata') {
    const found = state.words.find(w => !w.found && w.word.toUpperCase() === text);
    if (found && !state.solvedUsers.has(user + '-' + text)) {
      state.solvedUsers.add(user + '-' + text);
      found.found = true;
      addScore(state, user, 10);
      activeGames.set(username, state);
      io.to(`room_${username}`).emit('update', { type: 'cari-kata', theme: state.theme, words: state.words });
      io.to(`room_${username}`).emit('leaderboard:update', state.leaderboard);
    }
    return;
  }
};

function addScore(state, player, points) {
  const entry = state.leaderboard.find(r => r.player === player);
  if (entry) entry.score += points;
  else state.leaderboard.push({ player, score: points });
  state.leaderboard.sort((a, b) => b.score - a.score);
}

exports.getGameState = (username) => activeGames.get(username);
