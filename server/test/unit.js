// Unit/integration test tanpa MongoDB, TikTok, atau Google: `node test/unit.js`
// Mencakup perbaikan keamanan: sanitasi, vote per-pemain, gift matching, webhook Midtrans, OAuth state.
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ttslive-unit-'));
process.env.DATA_DIR = TMP;
process.env.NODE_ENV = 'test';
process.env.MIDTRANS_SERVER_KEY = 'SB-Mid-server-TEST';
process.env.MIDTRANS_CLIENT_KEY = 'SB-Mid-client-TEST';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-test';
process.env.APP_BASE_URL = 'http://localhost:3050';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ GAGAL:', m); } };
const stub = (rel, exports) => {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

function request(server, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: urlPath,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, json: j, text: d }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const listen = (app) => new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });

(async () => {
  // ───────────────────────── sanitize ─────────────────────────
  console.log('\n[sanitize]');
  const { cleanPlayerName, cleanProfileUrl } = require('../services/sanitize');
  ok(cleanPlayerName('  Budi‮  \n Santoso ') === 'Budi Santoso', 'nama: buang karakter bidi/kontrol, rapikan spasi');
  ok(cleanPlayerName('x'.repeat(200)).length === 40, 'nama: dibatasi 40 karakter');
  ok(cleanPlayerName('') === 'Anonim' && cleanPlayerName(null, 'TikTokUser') === 'TikTokUser', 'nama kosong -> fallback');
  ok(cleanProfileUrl('https://p16.tiktokcdn.com/a.jpg') !== '', 'URL https valid lolos');
  ok(cleanProfileUrl('javascript:alert(1)') === '', 'URL javascript: ditolak');
  ok(cleanProfileUrl('https://x.com/a" onerror="alert(1)') === '', 'URL dengan kutip (breakout atribut) ditolak');
  ok(cleanProfileUrl('https://x.com/<script>') === '', 'URL dengan < ditolak');

  // ───────────────────── safe.js (browser helper) ─────────────────────
  console.log('\n[public/shared/safe.js]');
  const vm = require('vm');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/shared/safe.js'), 'utf8'), sandbox);
  const { escapeHtml, safeUrl } = sandbox.window;
  ok(escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'escapeHtml: tag dinetralkan');
  ok(escapeHtml(`"'&`) === '&quot;&#39;&amp;', 'escapeHtml: kutip & ampersand');
  ok(escapeHtml(null) === '' && escapeHtml(0) === '0', 'escapeHtml: null/0');
  ok(safeUrl('https://a.com/x.png') === 'https://a.com/x.png', 'safeUrl: https lolos');
  ok(safeUrl('javascript:alert(1)') === '' && safeUrl('https://a.com/"x') === '', 'safeUrl: javascript: & kutip ditolak');

  // ───────────────────── semua game memakai helper ─────────────────────
  console.log('\n[overlay game: tidak ada sink mentah]');
  const pub = path.join(__dirname, '../public');
  const games = fs.readdirSync(pub).filter(d => fs.existsSync(path.join(pub, d, 'index.html')) && !['legal', 'assets', 'shared'].includes(d));
  let rawSinks = [], missing = [];
  for (const g of games) {
    const html = fs.readFileSync(path.join(pub, g, 'index.html'), 'utf8');
    if (!html.includes('/shared/safe.js')) missing.push(g);
    html.split('\n').forEach((ln, i) => {
      if (/\$\{(player|row\.player|p\.player|data\.player|profileUrl)\}/.test(ln) && !/textContent/.test(ln)) rawSinks.push(`${g}:${i + 1}`);
    });
  }
  ok(games.length === 12, `12 game ditemukan (ada ${games.length})`);
  ok(missing.length === 0, 'semua game memuat /shared/safe.js' + (missing.length ? ' — kurang: ' + missing : ''));
  ok(rawSinks.length === 0, 'tidak ada ${player}/${profileUrl} mentah di innerHTML' + (rawSinks.length ? ' — ' + rawSinks.join(', ') : ''));

  // ───────────────────────── vote controller ─────────────────────────
  console.log('\n[vote-controller: 1 pemain = 1 suara]');
  const createVote = require('../vote-controller');
  const mkVote = () => {
    const calls = { skip: 0, reveal: 0, sw: [] };
    const vc = createVote({
      safeEmit: () => {}, performForceNext: async () => { calls.skip++; }, performReveal: async () => { calls.reveal++; },
      performSwitchGame: async (id) => { calls.sw.push(id); },
      votableGames: [{ num: 1, id: 'family100', label: 'F' }, { num: 2, id: 'tts', label: 'T' }]
    });
    return { vc, calls };
  };
  let { vc, calls } = mkVote();
  for (let i = 0; i < 25; i++) await vc.handleVoteComment('skip', 'spammer');
  ok(calls.skip === 0 && vc.getStatus().skip.count === 1, 'satu akun spam "skip" 25x -> hanya dihitung 1');
  for (let i = 0; i < 9; i++) await vc.handleVoteComment('skip', 'viewer' + i);
  ok(calls.skip === 1, '10 pemain berbeda -> skip jalan tepat 1x');
  ({ vc, calls } = mkVote());
  for (let i = 0; i < 10; i++) await vc.handleVoteComment('nyerah', 'p' + i);
  ok(calls.reveal === 1, '10 pemain unik "nyerah" -> reveal 1x');
  ({ vc, calls } = mkVote());
  for (let i = 0; i < 10; i++) await vc.handleVoteComment('ganti', 'g' + i);
  for (let i = 0; i < 30; i++) await vc.handleVoteComment('1', 'curang');
  ok(calls.sw.length === 0 && vc.getStatus().gameSelect.votes[1] === 1, 'satu akun vote "1" 30x -> hanya 1 suara');
  for (let i = 0; i < 9; i++) await vc.handleVoteComment('2', 'v' + i);
  await vc.handleVoteComment('2', 'v9');
  ok(calls.sw.length === 1 && calls.sw[0] === 'tts', '10 pemain unik vote "2" -> ganti ke game 2');
  ({ vc, calls } = mkVote());
  for (let i = 0; i < 10; i++) await vc.handleVoteComment('ganti', 'h' + i);
  await vc.handleVoteComment('1', 'plin-plan'); await vc.handleVoteComment('2', 'plin-plan');
  const gv = vc.getStatus().gameSelect.votes;
  ok(gv[1] === 0 && gv[2] === 1, 'pemain pindah pilihan -> suara dipindah, bukan ditambah');

  // ───────────────────────── gift trigger ─────────────────────────
  console.log('\n[giftTrigger: matching & cooldown]');
  const mappings = [
    { giftName: 'Rose', action: 'skip_round', enabled: true },
    { giftName: 'Rose Bouquet', action: 'reveal_answer', enabled: true },
    { giftName: 'a', action: 'skip_round', enabled: true },
    { giftName: 'Lion', action: 'next_question', enabled: true }
  ];
  stub('../models/GiftMapping', { find: () => ({ lean: async () => mappings }) });
  stub('../gifts/defaults', { COIN_NEXT_QUESTION_THRESHOLD: 5000, ensureDefaults: async () => {} });
  delete require.cache[require.resolve('../services/giftTrigger')];
  const gt = require('../services/giftTrigger');
  ok((await gt.findMapping('u', 'Rose')).action === 'skip_round', 'exact match "Rose"');
  ok((await gt.findMapping('u', 'Rose Bouquet')).action === 'reveal_answer', 'exact match "Rose Bouquet" menang atas "Rose"');
  ok((await gt.findMapping('u', 'Big Lion King')).giftName === 'Lion', 'kata utuh "Lion" cocok di dalam nama gift');
  ok(await gt.findMapping('u', 'Galaxy') === null, 'mapping 1 huruf ("a") tidak cocok ke "Galaxy"');
  ok(await gt.findMapping('u', 'Lionel') === null, '"Lion" tidak cocok ke "Lionel" (bukan kata utuh)');
  let nexts = 0;
  const room = { performForceNext: async () => { nexts++; return { ok: true }; }, performReveal: async () => ({ ok: true }), emit() {} };
  await gt.applyMapping(room, { action: 'next_question' });
  const second = await gt.applyMapping(room, { action: 'next_question' });
  ok(nexts === 1 && second.handled === false, 'dua gift berdekatan -> soal hanya loncat 1x (cooldown)');

  // ───────────────────────── midtrans signature ─────────────────────────
  console.log('\n[midtrans]');
  const mt = require('../services/midtrans');
  const sig = (o, s, a) => crypto.createHash('sha512').update(`${o}${s}${a}SB-Mid-server-TEST`).digest('hex');
  ok(mt.verifySignature({ order_id: 'o1', status_code: '200', gross_amount: '25000.00', signature_key: sig('o1', '200', '25000.00') }), 'signature benar diterima');
  ok(!mt.verifySignature({ order_id: 'o1', status_code: '200', gross_amount: '25000.00', signature_key: 'abc' }), 'signature beda panjang ditolak (tanpa crash)');
  ok(!mt.verifySignature({ order_id: 'o1', status_code: '200', gross_amount: '1.00', signature_key: sig('o1', '200', '25000.00') }), 'nominal diubah -> signature tidak cocok');

  // ───────────────────────── webhook Midtrans ─────────────────────────
  console.log('\n[webhook Midtrans: alur uang]');
  const sub = { plan: 'basic', status: 'pending', midtransOrderId: 'order-1', userId: 'u1', midtransTransactionId: '', saves: 0, async save() { this.saves++; } };
  stub('../models/Subscription', { findOne: async (q) => (q.midtransOrderId === 'order-1' ? sub : null), create: async (d) => d });
  stub('../models/User', { findById: async () => ({ username: 'harin', email: '' }) });
  delete require.cache[require.resolve('../routes/billing')];
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/billing', require('../routes/billing'));
  const srv = await listen(app);
  const { PLAN_PRICES } = require('../config');
  const price = PLAN_PRICES.basic.price;
  const notif = (over = {}) => {
    const n = { order_id: 'order-1', status_code: '200', gross_amount: price + '.00', transaction_status: 'settlement', transaction_id: 'tx-1', payment_type: 'gopay', ...over };
    n.signature_key = sig(n.order_id, n.status_code, n.gross_amount);
    return n;
  };
  let r = await request(srv, 'POST', '/api/billing/webhook', { ...notif(), signature_key: 'palsu' });
  ok(r.status === 403 && sub.status === 'pending', 'signature palsu -> 403, langganan tetap pending');
  r = await request(srv, 'POST', '/api/billing/webhook', notif({ gross_amount: '1.00' }));
  ok(r.status === 400 && sub.status === 'pending', 'nominal tidak sesuai harga paket -> 400, tidak aktif');
  r = await request(srv, 'POST', '/api/billing/webhook', notif({ order_id: 'order-asing' }));
  ok(r.status === 404, 'order tak dikenal -> 404');
  r = await request(srv, 'POST', '/api/billing/webhook', notif());
  ok(r.status === 200 && sub.status === 'active' && sub.expiresAt > new Date(), 'settlement valid -> langganan AKTIF');
  const savesAfter = sub.saves;
  r = await request(srv, 'POST', '/api/billing/webhook', notif());
  ok(r.status === 200 && r.json.duplicate === true && sub.saves === savesAfter, 'notifikasi ganda (retry Midtrans) -> idempoten, tidak diproses ulang');
  r = await request(srv, 'POST', '/api/billing/webhook', notif({ transaction_status: 'expire' }));
  ok(sub.status === 'active', 'event "expire" terlambat setelah bayar -> TIDAK menurunkan langganan aktif');
  r = await request(srv, 'POST', '/api/billing/webhook', notif({ transaction_status: 'refund' }));
  ok(sub.status === 'canceled', 'refund -> langganan dibatalkan');
  srv.close();

  // ───────────────────────── Google OAuth ─────────────────────────
  console.log('\n[Google OAuth: state & kode sekali-pakai]');
  const googleMod = require('../auth/google');
  const gapp = express(); gapp.use(express.json());
  gapp.use('/api/auth/google', googleMod.buildRouter({ handleGoogleProfile: async () => ({ token: 't', user: {} }) }));
  const gsrv = await listen(gapp);
  r = await request(gsrv, 'GET', '/api/auth/google');
  const setCookie = (r.headers['set-cookie'] || [])[0] || '';
  const loc = r.headers.location || '';
  const stateParam = new URL(loc).searchParams.get('state');
  ok(r.status === 302 && /accounts\.google\.com/.test(loc), 'start -> redirect ke Google');
  ok(!!stateParam && setCookie.includes('oauth_state=' + stateParam) && /HttpOnly/i.test(setCookie), 'state acak dikirim + cookie HttpOnly berisi state yang sama');
  r = await request(gsrv, 'GET', '/api/auth/google/callback?code=abc&state=dipalsukan', null, { Cookie: 'oauth_state=' + stateParam });
  ok(r.status === 302 && /oauth=error/.test(r.headers.location) && /tidak%20valid/i.test(r.headers.location), 'callback dengan state salah (CSRF) -> ditolak');
  r = await request(gsrv, 'GET', '/api/auth/google/callback?code=abc&state=' + stateParam);
  ok(r.status === 302 && /oauth=error/.test(r.headers.location), 'callback tanpa cookie state -> ditolak');
  const code = crypto.randomBytes(32).toString('hex');
  googleMod._pendingCodes.set(code, { result: { token: 'JWT', user: { username: 'u' } }, expires: Date.now() + 60000 });
  r = await request(gsrv, 'POST', '/api/auth/google/exchange', { code });
  ok(r.status === 200 && r.json.token === 'JWT', 'exchange kode valid -> dapat token');
  r = await request(gsrv, 'POST', '/api/auth/google/exchange', { code });
  ok(r.status === 400, 'kode yang sama dipakai lagi -> ditolak (sekali pakai)');
  const old = crypto.randomBytes(32).toString('hex');
  googleMod._pendingCodes.set(old, { result: { token: 'X' }, expires: Date.now() - 1 });
  r = await request(gsrv, 'POST', '/api/auth/google/exchange', { code: old });
  ok(r.status === 400, 'kode kedaluwarsa -> ditolak');
  r = await request(gsrv, 'POST', '/api/auth/google/exchange', { code: '../../etc' });
  ok(r.status === 400, 'kode berformat aneh -> ditolak');
  gsrv.close();

  // ───────────────────────── penautan akun Google ─────────────────────────
  console.log('\n[handleGoogleProfile: anti pengambilalihan akun]');
  const users = [{ _id: 'pw1', username: 'korban', email: 'korban@gmail.com', password: 'HASH', googleId: '' }];
  stub('../models/User', function User(d) { Object.assign(this, d, { _id: 'new' + users.length }); this.save = async () => { users.push(this); }; });
  const U = require('../models/User');
  U.findOne = async (q) => users.find(u => Object.entries(q).every(([k, v]) => u[k] === v)) || null;
  stub('../services/subscriptionHelper', { ensureFreeSubscription: async () => {} });
  stub('../services/email', { welcome: () => {} });
  delete require.cache[require.resolve('../controllers/authController')];
  const ac = require('../controllers/authController');
  let err = null;
  try { await ac.handleGoogleProfile({ googleId: 'g-attacker', email: 'Korban@Gmail.com', name: 'x' }); } catch (e) { err = e; }
  ok(err && err.code === 'EMAIL_USED_BY_PASSWORD_ACCOUNT', 'email milik akun berpassword TIDAK otomatis ditautkan ke Google');
  ok(users[0].googleId === '', 'akun berpassword tidak berubah');
  const res2 = await ac.handleGoogleProfile({ googleId: 'g-baru', email: 'ab@x.com', name: 'x' });
  ok(res2.user.username.length >= 3, 'username dari email pendek tetap >= 3 karakter (' + res2.user.username + ')');

  console.log(`\n${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
