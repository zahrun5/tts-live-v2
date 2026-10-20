// services/youtubeManager.js
// Satu koneksi YouTube Live per user (tanpa API key, pakai youtubeConnector).
// Jalurnya sama dengan TikTok: komentar -> room.handleChat. Super Chat diabaikan dulu.
// Catatan: TikTok dan YouTube dibuat eksklusif (menyambung salah satu otomatis
// memutus yang lain), supaya status live di room tidak saling tabrakan.
const roomManager = require('./roomManager');
const tiktokManager = require('./tiktokManager');
const { YouTubeConnector, parseTarget } = require('./youtubeConnector');
const { cleanPlayerName } = require('./sanitize');

const sessions = new Map(); // username -> { connector, target, intentional }
const CONNECT_TIMEOUT_MS = 25000;

// Emoji custom YouTube datang sebagai ":nama-emoji:". Buang supaya tidak
// mengganggu parsing jawaban (emoji unicode biasa dibiarkan).
function cleanComment(text) {
  return String(text || '')
    .replace(/:[A-Za-z0-9_-]{2,60}:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Nama tampilan YouTube berupa handle "@nama": buang "@" di depan.
function cleanName(name) {
  return cleanPlayerName(String(name || '').replace(/^@+/, ''), 'YouTubeUser');
}

// true kalau target valid (liveId, URL live, channelId, atau @handle)
exports.isValidTarget = (target) => {
  try { parseTarget(target); return true; } catch (e) { return false; }
};

function teardown(username) {
  const session = sessions.get(username);
  if (!session) return null;
  session.intentional = true;
  sessions.delete(username);
  try { session.connector.disconnect(); } catch (e) { /* abaikan */ }
  return session;
}

exports.startLive = async (username, target) => {
  const room = await roomManager.getRoom(username);
  if (!room) throw new Error('User tidak ditemukan');

  // Eksklusif dengan TikTok
  tiktokManager.stopLive(username);

  const old = teardown(username);
  if (old) room.setLiveStatus(false, 'YouTube');

  const connector = new YouTubeConnector(target); // lempar error kalau format target salah
  const session = { connector, target, intentional: false };
  sessions.set(username, session); // didaftarkan dulu supaya handler di bawah dianggap sesi aktif

  connector.on('comment', (c) => {
    if (sessions.get(username) !== session) return;
    const text = cleanComment(c.comment);
    if (!text) return;
    room.handleChat({ player: cleanName(c.nickname || c.username), profileUrl: c.profilePictureUrl, text })
      .catch((err) => console.error('[YouTube] handleChat error:', err.message));
  });

  connector.on('connected', ({ liveId }) => {
    if (sessions.get(username) !== session) return;
    room.setLiveStatus(true, 'YouTube');
    console.log(`[YouTube] ${username} terhubung ke live ${liveId}`);
  });

  connector.on('disconnected', ({ reason }) => {
    if (sessions.get(username) !== session || session.intentional) return;
    room.setLiveStatus(false, 'YouTube');
    console.log(`[YouTube] ${username} terputus (${reason}), konektor mencoba sambung lagi`);
  });

  connector.on('error', (err) => {
    console.error(`[YouTube] ${username} error:`, err && err.message);
  });

  // Tunggu sampai benar-benar terhubung (atau gagal) supaya dashboard dapat jawaban jelas.
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      connector.removeListener('connected', onOk);
      connector.removeListener('error', onFail);
      fn(val);
    };
    const onOk = () => finish(resolve);
    const onFail = (err) => finish(reject, err);
    const timer = setTimeout(() => finish(reject, new Error('Timeout')), CONNECT_TIMEOUT_MS);
    connector.once('connected', onOk);
    connector.once('error', onFail);
    connector.connect().catch(onFail);
  }).catch((err) => {
    session.intentional = true;
    if (sessions.get(username) === session) sessions.delete(username);
    try { connector.disconnect(); } catch (e) { /* abaikan */ }
    room.setLiveStatus(false, 'YouTube', err.message);
    throw new Error('Gagal tersambung ke live YouTube. Pastikan live sedang berjalan dan target benar.');
  });

  return true;
};

exports.stopLive = (username) => {
  const session = teardown(username);
  if (session) {
    const room = roomManager.peekRoom(username);
    if (room) room.setLiveStatus(false, 'YouTube');
  }
};

exports.getStatus = (username) => sessions.has(username) && !sessions.get(username).intentional;
