// auth/google.js
// Pintu masuk Google OAuth untuk TTS-Live V2 (modul util).
//
// Modul ini BUKAN router — dia mengekspor factory yang mengembalikan router
// Express, supaya routes/auth.js bisa me-mount semua endpoint auth di satu tempat
// (menghindari double-mount kalau folder ini juga di-mount langsung).
//
// Alur OAuth authorization code (pakai google-auth-library, TIDAK pakai passport):
//   GET  /api/auth/google          -> redirect ke consent screen Google
//   GET  /api/auth/google/callback -> tukar 'code' jadi token, dapat profil,
//                                    upsert user, redirect balik ke /login
//                                    dengan ?oauth=success&token=...
//
// ENV yang dibutuhkan (kalau tidak di-set, /google balikin 501):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_CALLBACK_URL (default: http://localhost:3050/api/auth/google/callback)
//   APP_BASE_URL (untuk URL redirect setelah login)
//
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const config = require('../config');

function buildRouter({ handleGoogleProfile }) {
  const router = express.Router();

  function makeClient() {
    return new OAuth2Client(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI
    );
  }

  // Step 1: redirect ke Google consent screen
  router.get('/', (req, res) => {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      return res.status(501).json({
        error: 'Google OAuth belum dikonfigurasi',
        hint: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL di .env'
      });
    }
    const client = makeClient();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['openid', 'email', 'profile']
    });
    res.redirect(url);
  });

  // Step 2: callback. Tukar 'code' -> token -> profile -> upsert user.
  router.get('/callback', async (req, res) => {
    try {
      if (!config.GOOGLE_CLIENT_ID) {
        return res.status(501).json({ error: 'Google OAuth belum dikonfigurasi' });
      }
      const { code } = req.query;
      if (!code) return res.status(400).json({ error: 'Kode OAuth tidak ada' });

      const client = makeClient();
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();
      // Map Google OIDC payload (sub/email/name/picture) -> shape yg handleGoogleProfile expect
      const result = await handleGoogleProfile({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture
      });

      const appUrl = config.APP_BASE_URL || 'http://localhost:3050';
      const redirect = `${appUrl}/login?oauth=success&token=${encodeURIComponent(result.token)}&user=${encodeURIComponent(JSON.stringify(result.user))}`;
      res.redirect(redirect);
    } catch (err) {
      console.error('[Auth/google] callback error:', err.message);
      const appUrl = config.APP_BASE_URL || 'http://localhost:3050';
      res.redirect(`${appUrl}/login?oauth=error&reason=${encodeURIComponent(err.message || 'unknown')}`);
    }
  });

  return router;
}

module.exports = { buildRouter };
