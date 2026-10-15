// services/tiktokManager.js
// Satu koneksi TikTok Live per user. Semua urusan game diserahkan ke Room.
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');
const roomManager = require('./roomManager');
const User = require('../models/User');
const giftTrigger = require('./giftTrigger');
const { cleanPlayerName, cleanProfileUrl } = require('./sanitize');

const sessions = new Map(); // username -> { conn, tiktokUsername, intentional, retries, timer }
const MAX_RETRIES = 10; // reconnect saat koneksi putus di tengah live (delay naik sampai maks 60 dtk)
const restoring = new Map(); // username -> token (cegah dua loop restore jalan bareng)

function extractPlayerInfo(data) {
  const name = (data.user && (data.user.nickname || data.user.uniqueId))
    || data.uniqueId || data.nickname || 'TikTokUser';
  let profileUrl = '';
  if (data.user) {
    profileUrl = data.user.profilePictureUrl || (data.user.avatarThumb && data.user.avatarThumb.urlList && data.user.avatarThumb.urlList[0]) || (data.user.avatarLarge && data.user.avatarLarge.urlList && data.user.avatarLarge.urlList[0]);
  }
  if (!profileUrl && data.profilePictureUrl) profileUrl = data.profilePictureUrl;
  if (!profileUrl && data.avatarThumb && data.avatarThumb.urlList) profileUrl = data.avatarThumb.urlList[0];
  if (!profileUrl && data.userDetails && data.userDetails.profilePictureUrls) profileUrl = data.userDetails.profilePictureUrls[0] || data.userDetails.profilePictureUrls;
  if (!profileUrl && data.user && data.user.userDetails && data.user.userDetails.profilePictureUrls) profileUrl = data.user.userDetails.profilePictureUrls[0] || data.user.userDetails.profilePictureUrls;
  return { name: cleanPlayerName(name, 'TikTokUser'), profileUrl: cleanProfileUrl(profileUrl) };
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
    const info = extractPlayerInfo(data);
    room.handleChat({ player: info.name, profileUrl: info.profileUrl, text });
  });

  conn.on(WebcastEvent.LIKE, (data) => {
    const info = extractPlayerInfo(data);
    const likeCount = data.likeCount || 1;
    room.handleLike({ player: info.name, profileUrl: info.profileUrl, count: likeCount });
  });

  // Gift event: lookup mapping default + user, lalu delegasi ke giftTrigger.
  // Library tiktok-live-connector mengirim event 'gift' (1 detail per gift individual
  // atau 'giftEvent' (kumulatif per streak)). Kita tangani dua-duanya.
  const seenGifts = session.seenGifts || (session.seenGifts = new Map()); // msgId -> waktu
  const onGift = async (data) => {
    try {
      // Gift streak (giftType 1): TikTok mengirim 1 event per kali tap selama streak.
      // Proses SEKALI saat streak selesai (repeatEnd), kalau tidak satu streak 10x
      // akan memicu skip/next 10x.
      if (Number(data.giftType) === 1 && !data.repeatEnd) return;
      // Dedupe event yang terkirim ganda (reconnect/replay).
      const msgId = data.msgId != null ? String(data.msgId) : '';
      if (msgId) {
        if (seenGifts.has(msgId)) return;
        seenGifts.set(msgId, Date.now());
        if (seenGifts.size > 500) seenGifts.delete(seenGifts.keys().next().value);
      }
      const giftName = (data.giftName || data.name || 'unknown').toString().slice(0, 60);
      // diamondCount / coins: library pakai diamondCount di v2. Streak = harga x jumlah ulang.
      const unit = Number(data.diamondCount || data.coins || data.giftCoins || 0);
      const repeat = Number(data.giftType) === 1 ? Math.max(1, Number(data.repeatCount) || 1) : 1;
      const coins = unit * repeat;
      const sender = cleanPlayerName((data.user && (data.user.nickname || data.user.uniqueId)) || data.uniqueId, 'anonymous');
      const user = await User.findOne({ username }).select('_id').lean();
      if (!user) return;
      const result = await giftTrigger.handleGiftEvent({
        room, userId: user._id, giftName, giftCoins: coins, sender
      });
      if (result.handled) {
        console.log(`[TikTok:Gift] ${sender} -> ${giftName} (${coins} coin) => ${result.action} ${result.value || ''}`);
      }
    } catch (err) {
      console.error('[TikTok] gift handler error:', err.message);
    }
  };
  if (WebcastEvent.GIFT) conn.on(WebcastEvent.GIFT, onGift);

  const onDown = (reason) => {
    if (sessions.get(username) !== session) return; // sesi lama, abaikan
    room.setLiveStatus(false, session.tiktokUsername);
    if (session.intentional) return;
    if (reason === 'stream_end') { sessions.delete(username); room.setLiveTarget(null); return; }
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

// Bongkar sesi tanpa menyentuh liveTarget (dipakai startLive & stopLive).
function teardown(username) {
  const session = sessions.get(username);
  if (!session) return null;
  session.intentional = true;
  if (session.timer) clearTimeout(session.timer);
  try { session.conn.disconnect(); } catch (e) {}
  sessions.delete(username);
  return session;
}

exports.startLive = async (username, tiktokUsername) => {
  const room = await roomManager.getRoom(username);
  if (!room) throw new Error('User tidak ditemukan');
  restoring.delete(username); // koneksi manual membatalkan loop restore yang sedang jalan
  const old = teardown(username);
  if (old) room.setLiveStatus(false, old.tiktokUsername);

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
  room.setLiveTarget(tiktokUsername); // simpan ke disk: server restart pun akan sambung lagi
  room.setLiveStatus(true, tiktokUsername);
  console.log(`[TikTok] ${username} terhubung ke live @${tiktokUsername}`);
  return true;
};

// Dipanggil Room saat start (setelah server restart). Mencoba menyambung ulang ke
// target yang tersimpan, dengan retry sabar: 5s, 10s, 20s, 30s, lalu tiap 30s
// sampai ~15 menit. Berhenti kalau user menyambung manual / menekan Putuskan.
const RESTORE_DELAYS = [5000, 10000, 20000, 30000];
const RESTORE_MAX_MS = 15 * 60 * 1000;

exports.restoreLive = async (username, tiktokUsername) => {
  if (sessions.has(username) || restoring.has(username)) return false;
  const room = roomManager.peekRoom(username) || await roomManager.getRoom(username);
  if (!room) return false;
  const token = {};
  restoring.set(username, token);
  const startedAt = Date.now();
  let attempt = 0;

  const stillWanted = () =>
    restoring.get(username) === token && room.liveTarget === tiktokUsername && !sessions.has(username);

  while (stillWanted() && Date.now() - startedAt < RESTORE_MAX_MS) {
    try {
      await exports.startLive(username, tiktokUsername);
      console.log(`[TikTok] ${username} auto-reconnect sukses ke @${tiktokUsername} (percobaan ${attempt + 1})`);
      return true;
    } catch (err) {
      console.log(`[TikTok] ${username} auto-reconnect #${attempt + 1} gagal: ${String(err.message).slice(0, 100)}`);
    }
    // startLive() menghapus token restore -> pasang lagi supaya loop tetap sah
    if (!sessions.has(username) && room.liveTarget === tiktokUsername) restoring.set(username, token);
    else break;
    const delay = RESTORE_DELAYS[Math.min(attempt, RESTORE_DELAYS.length - 1)];
    attempt += 1;
    await new Promise(r => setTimeout(r, delay));
  }
  if (restoring.get(username) === token) restoring.delete(username);
  if (!sessions.has(username) && room.liveTarget === tiktokUsername) {
    console.log(`[TikTok] ${username} menyerah auto-reconnect ke @${tiktokUsername}. Sambungkan manual dari dashboard.`);
  }
  return false;
};

// Dipanggil dari dashboard (tombol Putuskan): ini pilihan sengaja user,
// jadi target dihapus dan server tidak akan menyambung ulang sendiri.
exports.stopLive = (username) => {
  restoring.delete(username);
  const session = teardown(username);
  const room = roomManager.peekRoom(username);
  if (room) {
    room.setLiveTarget(null);
    if (session) room.setLiveStatus(false, session.tiktokUsername);
  }
};

exports.getStatus = (username) => sessions.has(username) && !sessions.get(username).intentional;
