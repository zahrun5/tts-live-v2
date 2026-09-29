const { TikTokLiveConnection } = require('tiktok-live-connector');
const gameService = require('./gameService');
const connections = new Map();

exports.startLive = async (username, tiktokUsername, io) => {
  if (connections.has(username)) {
    try { connections.get(username).disconnect(); } catch (e) {}
    connections.delete(username);
    if (global.ioInstance) global.ioInstance.to(`room_${username}`).emit('status', { connected: false });
  }

  const userModel = require('../models/User');

  // Jaga-jaga: kalau ternyata belum ada ronde aktif sama sekali
  // (misal server baru restart dan belum ada yang klik Simpan), generate sekali
  // biar overlay gak kosong.
  if (!gameService.getGameState(username)) {
    try {
      const user = await userModel.findOne({ username });
      const activeGame = (user.activeGame === 'game-random' && user.randomGames && user.randomGames.length > 0)
        ? { type: 'game-random', pool: user.randomGames }
        : user.activeGame;
      const resolvedGameType = typeof activeGame === 'object' ? activeGame.type : activeGame;
      const gamePool = typeof activeGame === 'object' ? activeGame.pool : null;
      gameService.initGame(username, resolvedGameType, io, gamePool);
    } catch (e) {
      console.error(`[TikTok] Fallback game init failed for ${username}:`, e.message);
    }
  }

  const connection = new TikTokLiveConnection(tiktokUsername, {});

  try {
    await connection.connect();
    connections.set(username, connection);
    console.log(`[TikTok] ${username} terhubung ke live @${tiktokUsername}`);
    io.to(`room_${username}`).emit('status', { connected: true });

    connection.on('chat', data => {
      io.to(`room_${username}`).emit('chat:comment', { player: data.uniqueId, text: data.comment, avatar: data.profilePictureUrl });
      gameService.checkAnswer(username, data, io);
    });

    connection.on('disconnected', () => {
      console.log(`[TikTok] ${username} terputus dari @${tiktokUsername}`);
      connections.delete(username);
      io.to(`room_${username}`).emit('status', { connected: false });
    });

    return true;
  } catch (err) {
    console.log(`[TikTok] ${username} connect ke @${tiktokUsername} gagal: ${err.message?.slice(0, 100)}`);
    if (err.message && err.message.includes('processInitialData')) {
      throw new Error('Gagal melacak Live. Pastikan username benar dan sedang LIVE.');
    }
    throw new Error(err.message || 'Username tidak sedang live atau tidak ditemukan');
  }
};

exports.stopLive = (username) => {
  if (connections.has(username)) {
    try { connections.get(username).disconnect(); } catch (e) {}
    connections.delete(username);
  }
  if (global.ioInstance) {
    global.ioInstance.to(`room_${username}`).emit('status', { connected: false });
  }
};

exports.getStatus = (username) => connections.has(username);
