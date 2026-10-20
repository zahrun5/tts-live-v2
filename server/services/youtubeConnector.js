// services/youtubeConnector.js
// Konektor YouTube Live untuk TTS Live (tanpa API key) memakai library "youtube-chat".
//
// Instal:   npm install youtube-chat
// Tes cepat: node services/youtubeConnector.js <liveId | URL live | UC...channelId | @handle>
//
// Event yang dipancarkan (EventEmitter):
//   'connected'     { liveId }
//   'disconnected'  { reason }
//   'comment'       { platform, userId, username, nickname, comment, profilePictureUrl, isOwner, isModerator, isMember }
//   'gift'          { platform, userId, username, nickname, giftName, amount, amountText, profilePictureUrl }
//   'error'         Error
//
// Catatan: field comment/gift sengaja dibuat mirip event TikTok connector.
// Kalau nama field di TikTok connector kamu beda, ubah di fungsi
// buildComment() dan buildGift() di bawah.

const { EventEmitter } = require('events');
const { LiveChat } = require('youtube-chat');

const RECONNECT_DELAY_MS = 10000;
const MAX_RECONNECT_DELAY_MS = 60000;

// Ubah input apa pun (URL / liveId / channelId / @handle) jadi opsi LiveChat
function parseTarget(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('Target YouTube kosong (isi liveId, URL, channelId, atau @handle)');

  if (s.startsWith('@')) return { handle: s };

  if (/^UC[\w-]{22}$/.test(s)) return { channelId: s };

  if (/^[\w-]{11}$/.test(s)) return { liveId: s };

  try {
    const u = new URL(s);
    const v = u.searchParams.get('v');
    if (v) return { liveId: v };

    // https://www.youtube.com/live/<id>  atau  https://youtu.be/<id>
    const m = u.pathname.match(/\/(?:live|embed)\/([\w-]{11})/) || (u.hostname === 'youtu.be' && u.pathname.match(/^\/([\w-]{11})/));
    if (m) return { liveId: m[1] };

    // https://www.youtube.com/channel/UC...
    const c = u.pathname.match(/\/channel\/(UC[\w-]{22})/);
    if (c) return { channelId: c[1] };

    // https://www.youtube.com/@handle
    const h = u.pathname.match(/\/(@[\w.-]+)/);
    if (h) return { handle: h[1] };
  } catch (e) {
    // bukan URL, lanjut ke error di bawah
  }

  throw new Error('Format target YouTube tidak dikenali: ' + s);
}

// Gabungkan potongan pesan (teks + emoji) jadi satu string
function messageToText(items) {
  if (!Array.isArray(items)) return '';
  return items
    .map((it) => {
      if (it && typeof it.text === 'string') return it.text;
      if (it && (it.emojiText || it.alt)) return it.emojiText || it.alt;
      return '';
    })
    .join('')
    .trim();
}

// Ambil angka dari teks nominal Super Chat, misal "Rp50.000", "$5.00", "IDR 10,000"
function parseAmount(text) {
  const raw = String(text || '').replace(/[^\d.,]/g, '');
  if (!raw) return 0;

  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);

  // Pemisah terakhir dengan 1-2 digit di belakangnya dianggap desimal
  if (lastSep !== -1 && raw.length - lastSep - 1 <= 2) {
    const intPart = raw.slice(0, lastSep).replace(/[.,]/g, '');
    const decPart = raw.slice(lastSep + 1);
    return parseFloat(intPart + '.' + decPart) || 0;
  }
  return parseFloat(raw.replace(/[.,]/g, '')) || 0;
}

function buildComment(item) {
  const author = item.author || {};
  return {
    platform: 'youtube',
    userId: author.channelId || '',
    username: author.name || '',
    nickname: author.name || '',
    comment: messageToText(item.message),
    profilePictureUrl: (author.thumbnail && author.thumbnail.url) || '',
    isOwner: !!item.isOwner,
    isModerator: !!item.isModerator,
    isMember: !!item.isMembership,
  };
}

function buildGift(item) {
  const author = item.author || {};
  const sc = item.superchat || {};
  const amountText = sc.amount || '';
  return {
    platform: 'youtube',
    userId: author.channelId || '',
    username: author.name || '',
    nickname: author.name || '',
    giftName: sc.sticker ? 'Super Sticker' : 'Super Chat',
    amount: parseAmount(amountText),
    amountText,
    profilePictureUrl: (author.thumbnail && author.thumbnail.url) || '',
  };
}

class YouTubeConnector extends EventEmitter {
  constructor(target) {
    super();
    this.options = parseTarget(target);
    this.chat = null;
    this.stopped = true;
    this.retryTimer = null;
    this.retryDelay = RECONNECT_DELAY_MS;
    this.seenIds = new Set();
  }

  async connect() {
    this.stopped = false;
    await this._startChat();
  }

  disconnect() {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.chat) {
      try { this.chat.stop(); } catch (e) { /* abaikan */ }
      this.chat.removeAllListeners();
      this.chat = null;
    }
    this.emit('disconnected', { reason: 'manual' });
  }

  async _startChat() {
    if (this.stopped) return;

    // Bersihkan instance lama kalau ada
    if (this.chat) {
      try { this.chat.stop(); } catch (e) { /* abaikan */ }
      this.chat.removeAllListeners();
    }

    const chat = new LiveChat(this.options);
    this.chat = chat;

    chat.on('start', (liveId) => {
      this.retryDelay = RECONNECT_DELAY_MS; // reset backoff
      this.emit('connected', { liveId });
    });

    chat.on('end', (reason) => {
      this.emit('disconnected', { reason: reason || 'end' });
      this._scheduleReconnect();
    });

    chat.on('error', (err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      // Library kadang tidak memanggil 'end' setelah error, jadi jadwalkan sendiri
      this._scheduleReconnect();
    });

    chat.on('chat', (item) => {
      // Cegah duplikat pesan (bisa terjadi saat reconnect)
      if (item.id) {
        if (this.seenIds.has(item.id)) return;
        this.seenIds.add(item.id);
        if (this.seenIds.size > 2000) {
          // buang entri paling lama biar memori tidak membengkak
          const first = this.seenIds.values().next().value;
          this.seenIds.delete(first);
        }
      }

      if (item.superchat) {
        this.emit('gift', buildGift(item));
      }

      const comment = buildComment(item);
      if (comment.comment) this.emit('comment', comment);
    });

    try {
      const ok = await chat.start();
      if (!ok) {
        this.emit('error', new Error('Live YouTube tidak ditemukan / belum mulai. Akan dicoba lagi.'));
        this._scheduleReconnect();
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.stopped || this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RECONNECT_DELAY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._startChat();
    }, delay);
  }
}

module.exports = { YouTubeConnector, parseTarget, parseAmount };

// ---- Mode tes: node services/youtubeConnector.js <target> ----
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.log('Pakai: node services/youtubeConnector.js <liveId | URL live | UC...channelId | @handle>');
    process.exit(1);
  }

  const yt = new YouTubeConnector(target);
  yt.on('connected', ({ liveId }) => console.log('[YT] Terhubung, liveId =', liveId));
  yt.on('disconnected', ({ reason }) => console.log('[YT] Terputus:', reason));
  yt.on('error', (e) => console.error('[YT] Error:', e.message));
  yt.on('comment', (c) => console.log(`[YT] ${c.nickname}: ${c.comment}`));
  yt.on('gift', (g) => console.log(`[YT] SUPERCHAT ${g.nickname}: ${g.amountText} (=${g.amount})`));

  yt.connect();

  process.on('SIGINT', () => {
    yt.disconnect();
    process.exit(0);
  });
}
