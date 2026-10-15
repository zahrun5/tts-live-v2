// services/roomManager.js
// Nyimpen satu Room per user. Room dibuat malas (lazy) saat pertama dibutuhkan
// (overlay dibuka, dashboard dibuka, atau connect ke TikTok).
const fs = require('fs');
const path = require('path');
const { Room } = require('./room');
const { DATA_DIR, USERNAME_RE } = require('../config');

const rooms = new Map();     // username -> Room
const creating = new Map();  // username -> Promise<Room|null> (cegah dobel-bikin)
let ctx = null;

exports.init = ({ io, settingsLoader, publicDir, dataDir }) => {
  ctx = {
    io,
    settingsLoader,
    publicDir: publicDir || path.join(__dirname, '..', 'public'),
    dataDir: dataDir || DATA_DIR
  };
};

// Return Room, atau null kalau user nggak ada / username nggak valid.
exports.getRoom = async (username) => {
  if (!ctx) throw new Error('roomManager belum di-init');
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return null;
  if (rooms.has(username)) return rooms.get(username);
  if (creating.has(username)) return creating.get(username);

  const p = (async () => {
    const settings = await ctx.settingsLoader(username);
    if (!settings) return null; // user nggak terdaftar
    const room = new Room({
      username,
      io: ctx.io,
      dataDir: ctx.dataDir,
      templateDir: path.join(__dirname, '..', 'games'),
      aiClientPath: path.join(__dirname, '..', 'ai-client.js'),
      publicDir: ctx.publicDir,
      settings
    });
    await room.start();
    rooms.set(username, room);
    console.log(`[Room] ${username} siap (game: ${room.activeGameId}, mode: ${room.mode})`);
    return room;
  })().finally(() => creating.delete(username));

  creating.set(username, p);
  return p;
};

exports.peekRoom = (username) => rooms.get(username) || null;

// Dipanggil sekali saat server naik. Room dibuat malas (lazy), jadi setelah restart
// nggak ada Room sampai overlay/dashboard dibuka. Di sini kita cari room yang
// terakhir punya target live (room-state.json -> liveTarget) dan bangunkan sekarang;
// Room.start() sendiri yang memicu auto-reconnect TikTok.
exports.restoreLiveRooms = async () => {
  if (!ctx) return;
  const roomsDir = path.join(ctx.dataDir, 'rooms');
  let names = [];
  try { names = fs.readdirSync(roomsDir); } catch (e) { return; }
  let found = 0;
  for (const name of names) {
    if (!USERNAME_RE.test(name)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(roomsDir, name, 'room-state.json'), 'utf8'));
      if (!state.liveTarget) continue;
      found++;
      console.log(`[Room] ${name} punya target live @${state.liveTarget}, bangunkan room untuk auto-reconnect`);
      await exports.getRoom(name);
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`[Room] restoreLiveRooms ${name} gagal:`, e.message);
    }
  }
  if (!found) console.log(`[Room] restoreLiveRooms: ${names.length} room diperiksa, tidak ada yang punya target live (belum pernah Sambungkan sejak update?)`);
};
