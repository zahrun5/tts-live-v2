// auth/google.js
// Google OAuth (authorization code flow) untuk TTS-Live V2.
//
// Modul ini mengekspor factory yang mengembalikan router Express; di-mount oleh
// routes/auth.js pada /api/auth/google.
//
//   GET  /api/auth/google           -> set cookie state, redirect ke consent screen Google
//   GET  /api/auth/google/callback  -> cek state (anti-CSRF), tukar code, cek email_verified,
//                                      upsert user, redirect ke /login?oauth=success&code=...
//   POST /api/auth/google/exchange  -> tukar code sekali-pakai (60 dtk) jadi { token, user }
//
// Kenapa pakai "code" dan bukan token di URL: token di query string tercatat di
// log reverse-proxy, history browser, dan header Referer. Code ini hanya bisa
// dipakai SEKALI dan kedaluwarsa dalam 60 detik.
//
// ENV: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, APP_BASE_URL
const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const config = require('../config');
const { authLimiter } = require('../middleware/rateLimit');

const STATE_COOKIE = 'oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;

// code sekali-pakai -> { result, expires }. In-memory cukup: TTL pendek, 1 proses PM2.
// (Kalau nanti pakai cluster/multi-instance, pindahkan ke Mongo/Redis.)
const pendingCodes = new Map();
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingCodes) if (v.expires < now) pendingCodes.delete(k);
}, 30 * 1000);
if (sweep.unref) sweep.unref();

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function buildRouter({ handleGoogleProfile }) {
  const router = express.Router();
  const appUrl = () => config.APP_BASE_URL || 'http://localhost:3050';
  const isHttps = () => appUrl().startsWith('https://');
  const fail = (res, reason) => res.redirect(`${appUrl()}/login?oauth=error&reason=${encodeURIComponent(reason)}`);

  const makeClient = () => new OAuth2Client(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI
  );

  // Step 1: redirect ke Google consent screen
  router.get('/', (req, res) => {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      return res.status(501).json({
        error: 'Google OAuth belum dikonfigurasi',
        hint: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL di .env'
      });
    }
    const state = crypto.randomBytes(24).toString('hex');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',      // tetap terkirim pada redirect balik dari Google
      secure: isHttps(),
      maxAge: STATE_TTL_MS,
      path: '/api/auth/google'
    });
    const url = makeClient().generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state
    });
    res.redirect(url);
  });

  // Step 2: callback dari Google
  router.get('/callback', async (req, res) => {
    try {
      if (!config.GOOGLE_CLIENT_ID) return fail(res, 'Google OAuth belum dikonfigurasi');
      if (req.query.error) return fail(res, 'Login Google dibatalkan');

      const { code, state } = req.query;
      const expected = readCookie(req, STATE_COOKIE);
      res.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
      if (typeof code !== 'string' || !code) return fail(res, 'Kode OAuth tidak ada');
      if (typeof state !== 'string' || !safeEqual(state, expected)) {
        return fail(res, 'Sesi login tidak valid, coba lagi');
      }

      const client = makeClient();
      const { tokens } = await client.getToken(code);
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();

      // Email wajib terverifikasi oleh Google; kalau tidak, jangan dipakai untuk akun.
      if (!payload.email || payload.email_verified !== true) {
        return fail(res, 'Email Google belum terverifikasi');
      }

      const result = await handleGoogleProfile({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture
      });

      const oneTime = crypto.randomBytes(32).toString('hex');
      pendingCodes.set(oneTime, { result, expires: Date.now() + CODE_TTL_MS });
      res.redirect(`${appUrl()}/login?oauth=success&code=${oneTime}`);
    } catch (err) {
      console.error('[Auth/google] callback error:', err.message);
      // Pesan generik ke browser; detail cukup di log server.
      const reason = err && err.code === 'EMAIL_USED_BY_PASSWORD_ACCOUNT'
        ? err.message
        : 'Login Google gagal, coba lagi';
      fail(res, reason);
    }
  });

  // Step 3: client menukar code sekali-pakai jadi token
  router.post('/exchange', authLimiter, (req, res) => {
    const code = req.body && req.body.code;
    if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
      return res.status(400).json({ error: 'Kode tidak valid' });
    }
    const entry = pendingCodes.get(code);
    pendingCodes.delete(code); // sekali pakai, terlepas berhasil atau tidak
    if (!entry || entry.expires < Date.now()) {
      return res.status(400).json({ error: 'Kode kedaluwarsa, silakan login ulang' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(entry.result);
  });

  return router;
}

module.exports = { buildRouter, _pendingCodes: pendingCodes }; // _pendingCodes: hanya untuk test
