// billing/midtrans.js
// Adapter / skeleton untuk Midtrans di TTS-Live V2 (sandbox by default).
//
// Layer ini TIPIS — logic sebenarnya ada di services/midtrans.js (wrapper midtrans-client).
// Tujuannya:
//   1. Jadi titik masuk yang mudah di-audit (cuma lihat folder `billing/`).
//   2. Re-export fungsi yang dipakai routes/billing.js.
//   3. Beri label "phase 1 skeleton" + ENV yang dibutuhkan.
//
// ENV yang dibutuhkan (lihat .env.example):
//   MIDTRANS_SERVER_KEY   (SB-Mid-server-xxx untuk sandbox)
//   MIDTRANS_CLIENT_KEY   (SB-Mid-client-xxx untuk sandbox)
//   MIDTRANS_IS_PRODUCTION (default false)
//
const { PLAN_PRICES } = require('../config');
const midtrans = require('../services/midtrans');

/** Status cepat: apakah Midtrans siap dipakai? */
function status() {
  return {
    serverKeySet: Boolean(process.env.MIDTRANS_SERVER_KEY),
    clientKeySet: Boolean(process.env.MIDTRANS_CLIENT_KEY),
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    ready: Boolean(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_CLIENT_KEY)
  };
}

module.exports = {
  // Re-export service
  createTransaction: midtrans.createTransaction,
  verifySignature: midtrans.verifySignature,
  classify: midtrans.classify,
  getClientKey: midtrans.getClientKey,
  getClients: midtrans.getClients,
  // Lokal
  status,
  PLAN_PRICES
};
