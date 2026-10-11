// services/roomManager.js
// Nyimpen satu Room per user. Room dibuat malas (lazy) saat pertama dibutuhkan
// (overlay dibuka, dashboard dibuka, atau connect ke TikTok).
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
