// services/subscriptionHelper.js
// Helper terpusat untuk: bikin subscription free, get active, expire check.
const Subscription = require('../models/Subscription');
const { PLAN_PRICES } = require('../config');

/** Bikin subscription FREE 30 hari (idempotent: kalau udah ada active, return yang existing). */
async function ensureFreeSubscription(userId) {
  const existing = await Subscription.findOne({ userId, status: { $in: ['active', 'trialing'] } });
  if (existing) return existing;
  const now = new Date();
  const plan = PLAN_PRICES.free;
  const sub = await Subscription.create({
    userId,
    plan: 'free',
    status: 'trialing',
    startedAt: now,
    expiresAt: new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000),
    autoRenew: false
  });
  return sub;
}

/** Get subscription aktif (atau null kalau expired / ga ada). Otomatis tandai 'expired' kalau lewat. */
async function getActiveSubscription(userId) {
  const sub = await Subscription.findOne({ userId }).sort({ createdAt: -1 });
  if (!sub) return null;
  if (sub.expiresAt && sub.expiresAt < new Date() && (sub.status === 'active' || sub.status === 'trialing')) {
    sub.status = 'expired';
    await sub.save();
  }
  if (!['active', 'trialing'].includes(sub.status)) return null;
  return sub;
}

/** Cek apakah user punya plan >= requiredPlan. Plan order: free < basic < pro. */
function isPlanAtLeast(plan, requiredPlan) {
  const order = ['free', 'basic', 'pro'];
  return order.indexOf(plan) >= order.indexOf(requiredPlan);
}

module.exports = { ensureFreeSubscription, getActiveSubscription, isPlanAtLeast };
