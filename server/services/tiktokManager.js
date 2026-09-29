// services/tiktokManager.js
// Satu koneksi TikTok Live per user. Semua urusan game diserahkan ke Room.
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');
const roomManager = require('./roomManager');

const sessions = new Map(); // username -> { conn, tiktokUsername, intentional, retries, timer }
const MAX_RETRIES = 5;

function extractPlayer(data) {
  return (data.user && (data.user.nickname || data.user.uniqueId))
    || data.uniqueId || data.nickname || 'TikTokUser';
}

function buildConnection(tiktokUsername) {
  const opts = {};
  if (process.env.EULER_API_KEY) opts.signApiKey = process.env.EULER_API_KEY;
  return new TikTokLiveConnection(tiktokUsername.replace(/^@/, ''), opts);
}

function attachHandlers(username, room, session) {
  const conn = session.conn;

  conn.on(ControlEvent.ERROR, (err) => {
    console.error(`[TikTok] ${username} error:`, err && (err.message || err.info || err));
  });

  conn.on(WebcastEvent.CHAT, (data) => {
    const text = data.comment || data.content;
    if (!text) return;
    room.handleChat({ player: extractPlayer(data), text });
  });

  const onDown = (reason) => {
    if (sessions.get(username) !== session) return; // sesi lama, abaikan
    room.setLiveStatus(false, session.tiktokUsername);
    if (session.intentional) return;
    if (reason === 'stream_end') { sessions.delete(username); return; }
    scheduleReconnect(username, room, session);
  };
  conn.on(ControlEvent.DISCONNECTED, () => onDown('disconnected'));
  conn.on(WebcastEvent.STREAM_END, () => onDown('stream_end'));
}

function scheduleReconnect(username, room, session) {
  if (session.retries >= MAX_RETRIES) {
    console.log(`[TikTok] ${username} menyerah reconnect setelah ${MAX_RETRIES}x`);
    sessions.delete(username);
    return;
  }
  const delay = Math.min(5000 * 2 ** session.retries, 60000);
  session.retries += 1;
  console.log(`[TikTok] ${username} reconnect #${session.retries} dalam ${delay / 1000}s`);
  session.timer = setTimeout(async () => {
    if (sessions.get(username) !== session || session.intentional) return;
    try {
      try { session.conn.disconnect(); } catch (e) {}
      session.conn = buildConnection(session.tiktokUsername);
      attachHandlers(username, room, session);
      await session.conn.connect();
      session.retries = 0;
      room.setLiveStatus(true, session.tiktokUsername);
      console.log(`[TikTok] ${username} tersambung lagi ke @${session.tiktokUsername}`);
    } catch (err) {
      console.log(`[TikTok] ${username} reconnect gagal: ${String(err.message).slice(0, 100)}`);
      if (sessions.get(username) === session && !session.intentional) scheduleReconnect(username, room, session);
    }
  }, delay);
  if (session.timer.unref) session.timer.unref();
}

exports.startLive = async (username, tiktokUsername) => {
  const room = await roomManager.getRoom(username);
  if (!room) throw new Error('User tidak ditemukan');
  exports.stopLive(username);

  const session = { conn: buildConnection(tiktokUsername), tiktokUsername, intentional: false, retries: 0, timer: null };
  attachHandlers(username, room, session);

  try {
    await session.conn.connect();
  } catch (err) {
    console.log(`[TikTok] ${username} connect ke @${tiktokUsername} gagal: ${String(err.message).slice(0, 100)}`);
    room.setLiveStatus(false, tiktokUsername, err.message);
    if (err.message && err.message.includes('processInitialData')) {
      throw new Error('Gagal melacak Live. Pastikan username benar dan sedang LIVE.');
    }
    throw new Error(err.message || 'Username tidak sedang live atau tidak ditemukan');
  }

  sessions.set(username, session);
  room.setLiveStatus(true, tiktokUsername);
  console.log(`[TikTok] ${username} terhubung ke live @${tiktokUsername}`);
  return true;
};

exports.stopLive = (username) => {
  const session = sessions.get(username);
  if (!session) return;
  session.intentional = true;
  if (session.timer) clearTimeout(session.timer);
  try { session.conn.disconnect(); } catch (e) {}
  sessions.delete(username);
  const room = roomManager.peekRoom(username);
  if (room) room.setLiveStatus(false, session.tiktokUsername);
};

exports.getStatus = (username) => sessions.has(username) && !sessions.get(username).intentional;
