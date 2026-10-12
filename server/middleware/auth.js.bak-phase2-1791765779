// middleware/auth.js
// requireAuth: verifikasi JWT (existing).
// requireActiveSubscription(plan): harus login + subscription aktif >= plan.
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { getActiveSubscription, isPlanAtLeast } = require('../services/subscriptionHelper');

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid' });
  }
};

/** Middleware factory: butuh subscription aktif minimal 'plan' (free|basic|pro). */
module.exports.requireActiveSubscription = (plan = 'free') => async (req, res, next) => {
  if (!req.user || !req.user.id) return res.status(401).json({ error: 'Token missing' });
  try {
    const sub = await getActiveSubscription(req.user.id);
    if (!sub) {
      return res.status(402).json({ error: 'Subscription tidak aktif', code: 'SUB_REQUIRED', plan });
    }
    if (!isPlanAtLeast(sub.plan, plan)) {
      return res.status(402).json({ error: `Butuh paket ${plan} ke atas`, code: 'PLAN_TOO_LOW', current: sub.plan, required: plan });
    }
    req.subscription = sub;
    next();
  } catch (err) {
    console.error('[auth.requireActiveSubscription]', err.message);
    res.status(500).json({ error: 'Gagal cek subscription' });
  }
};
