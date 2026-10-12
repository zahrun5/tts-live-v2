// routes/billing.js
// Endpoint Midtrans: create Snap token + webhook notif.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { billingLimiter } = require('../middleware/rateLimit');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const midtrans = require('../services/midtrans');
const { PLAN_PRICES, MIDTRANS_IS_PRODUCTION } = require('../config');
const email = require('../services/email');

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
    res.json({ token: tx.token, redirect_url: tx.redirect_url, orderId: tx.orderId });
  } catch (err) {
    console.error('[Billing] create-snap:', err.message);
    res.status(500).json({ error: 'Gagal membuat transaksi: ' + err.message });
  }
});

// Status subscription user saat ini
router.get('/status', auth, async (req, res) => {
  try {
    const sub = await Subscription.findOne({ userId: req.user.id }).sort({ createdAt: -1 });
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
    const user = await User.findById(sub.userId);
    const planDur = PLAN_PRICES[sub.plan]?.durationDays || 30;

    if (status === 'settlement' || status === 'capture') {
      sub.status = 'active';
      sub.midtransTransactionId = notif.transaction_id || sub.midtransTransactionId;
      sub.startedAt = new Date();
      sub.expiresAt = new Date(Date.now() + planDur * 24 * 60 * 60 * 1000);
      sub.autoRenew = (notif.payment_type === 'credit_card');
      await sub.save();
      if (user) email.paymentSuccess({ to: user.email, username: user.username, plan: sub.plan, expiresAt: sub.expiresAt.toISOString().slice(0, 10) });
      console.log('[Billing] settlement -> sub', sub._id, 'aktif sampai', sub.expiresAt);
    } else if (status === 'pending') {
      // Biarkan status active existing (kalau ada) atau tetap 'active' untuk free; jangan downgrade.
    } else if (status === 'deny' || status === 'cancel' || status === 'expire') {
      sub.status = 'past_due';
      await sub.save();
      if (user) email.paymentFailed({ to: user.email, username: user.username, plan: sub.plan, reason: status });
    } else if (status === 'refund') {
      sub.status = 'canceled';
      await sub.save();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Billing] webhook error:', err.message);
    res.status(500).json({ error: 'Webhook error' });
  }
});

module.exports = router;
