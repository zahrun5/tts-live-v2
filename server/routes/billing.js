// routes/billing.js
// Endpoint Midtrans: create Snap token + webhook notif.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { billingLimiter } = require('../middleware/rateLimit');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const midtrans = require('../services/midtrans');
const { getActiveSubscription } = require('../services/subscriptionHelper');
const { PLAN_PRICES, MIDTRANS_IS_PRODUCTION } = require('../config');
const email = require('../services/email');

const DAY_MS = 24 * 60 * 60 * 1000;

// Kembalikan client key + daftar plan (publik, ga perlu auth)
router.get('/plans', (req, res) => {
  res.json({
    plans: PLAN_PRICES,
    midtransClientKey: midtrans.getClientKey(),
    isProduction: MIDTRANS_IS_PRODUCTION
  });
});

// Bikin Snap transaction (perlu auth)
router.post('/create-snap', auth, billingLimiter, async (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!PLAN_PRICES[plan] || plan === 'free') {
      return res.status(400).json({ error: 'Plan tidak valid' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
    const tx = await midtrans.createTransaction({ username: user.username, plan, email: user.email });

    // PENTING: simpan order id supaya webhook bisa menemukan subscription ini.
    // Status 'pending' = belum dibayar; baru jadi 'active' saat webhook settlement.
    await Subscription.create({
      userId: user._id,
      plan,
      status: 'pending',
      midtransOrderId: tx.orderId,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + (PLAN_PRICES[plan].durationDays || 30) * DAY_MS),
      autoRenew: false
    });

    res.json({ token: tx.token, redirect_url: tx.redirect_url, orderId: tx.orderId });
  } catch (err) {
    console.error('[Billing] create-snap:', err.message);
    res.status(500).json({ error: 'Gagal membuat transaksi' });
  }
});

// Status subscription user saat ini (plan aktif tertinggi)
router.get('/status', auth, async (req, res) => {
  try {
    const sub = await getActiveSubscription(req.user.id);
    res.json({ subscription: sub });
  } catch (err) {
    res.status(500).json({ error: 'Gagal baca subscription' });
  }
});

// Webhook Midtrans. Tidak pakai auth (Midtrans yg manggil), tapi verify signature.
router.post('/webhook', async (req, res) => {
  try {
    const notif = req.body || {};
    if (!midtrans.verifySignature(notif)) {
      console.warn('[Billing] webhook signature INVALID', { order: notif.order_id });
      return res.status(403).json({ error: 'Invalid signature' });
    }
    const status = midtrans.classify(notif);
    const orderId = notif.order_id;
    const sub = await Subscription.findOne({ midtransOrderId: orderId });
    if (!sub) {
      console.warn('[Billing] webhook untuk order tak dikenal:', orderId);
      return res.status(404).json({ error: 'Subscription tidak ditemukan' });
    }

    // Defensive: nominal dari Midtrans harus sama dengan harga plan.
    const price = PLAN_PRICES[sub.plan];
    if (!price || Number(notif.gross_amount) !== price.price) {
      console.warn('[Billing] webhook nominal tidak cocok', { order: orderId, got: notif.gross_amount, want: price && price.price });
      return res.status(400).json({ error: 'Nominal tidak cocok' });
    }

    const user = await User.findById(sub.userId);
    const planDur = price.durationDays || 30;

    if (status === 'settlement') {
      // Idempotent: notifikasi yang sama dikirim ulang oleh Midtrans -> abaikan.
      if (sub.status === 'active' && sub.midtransTransactionId === (notif.transaction_id || sub.midtransTransactionId)) {
        return res.json({ ok: true, duplicate: true });
      }
      sub.status = 'active';
      sub.midtransTransactionId = notif.transaction_id || sub.midtransTransactionId;
      sub.startedAt = new Date();
      sub.expiresAt = new Date(Date.now() + planDur * DAY_MS);
      sub.autoRenew = (notif.payment_type === 'credit_card');
      await sub.save();
      if (user && user.email) email.paymentSuccess({ to: user.email, username: user.username, plan: sub.plan, expiresAt: sub.expiresAt.toISOString().slice(0, 10) });
      console.log('[Billing] settlement -> sub', sub._id, 'aktif sampai', sub.expiresAt);
    } else if (status === 'pending') {
      // Menunggu pembayaran: tidak ada perubahan.
    } else if (status === 'deny' || status === 'cancel' || status === 'expire') {
      // Midtrans bisa mengirim event tidak berurutan. Kalau order ini sudah
      // dibayar (active), event gagal yang datang terlambat harus diabaikan.
      if (sub.status === 'pending') {
        sub.status = status === 'expire' ? 'expired' : 'canceled';
        await sub.save();
        if (user && user.email) email.paymentFailed({ to: user.email, username: user.username, plan: sub.plan, reason: status });
      }
    } else if (status === 'refund' || status === 'partial_refund' || status === 'chargeback') {
      sub.status = 'canceled';
      sub.expiresAt = new Date();
      await sub.save();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Billing] webhook error:', err.message);
    res.status(500).json({ error: 'Webhook error' });
  }
});

module.exports = router;
