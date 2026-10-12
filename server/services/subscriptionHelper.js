// services/subscriptionHelper.js
// Helper terpusat untuk: bikin subscription free, get active, expire check.
const Subscription = require('../models/Subscription');
const { PLAN_PRICES, PLAN_ORDER, isPlanAtLeast } = require('../config/plans');

const ACTIVE_STATUSES = ['active', 'trialing'];

/**
 * Bikin subscription FREE 30 hari SEKALI per user.
 * Idempotent: kalau user sudah pernah punya subscription (status apa pun,
 * termasuk yang sudah expired), tidak dibuat trial baru — kalau tidak, trial
 * bisa diulang tiap login setelah expired.
 */
async function ensureFreeSubscription(userId) {
  const existing = await Subscription.findOne({ userId }).sort({ createdAt: -1 });
  if (existing) return existing;
  const now = new Date();
  const plan = PLAN_PRICES.free;
  return Subscription.create({
    userId,
    plan: 'free',
    status: 'trialing',
    startedAt: now,
    expiresAt: new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000),
    autoRenew: false
  });
}

/**
 * Get subscription aktif dengan plan tertinggi (atau null kalau semua expired / tidak ada).
 * Yang sudah lewat expiresAt otomatis ditandai 'expired'. Subscription 'pending'
 * (belum dibayar) tidak dihitung dan tidak menutupi trial/paket aktif yang ada.
 */
async function getActiveSubscription(userId) {
  const now = new Date();
  await Subscription.updateMany(
    { userId, status: { $in: ACTIVE_STATUSES }, expiresAt: { $lt: now } },
    { $set: { status: 'expired', updatedAt: now } }
  );
  const subs = await Subscription.find({ userId, status: { $in: ACTIVE_STATUSES } });
  if (!subs.length) return null;
  subs.sort((a, b) =>
    (PLAN_ORDER.indexOf(b.plan) - PLAN_ORDER.indexOf(a.plan)) ||
    (b.expiresAt - a.expiresAt)
  );
  return subs[0];
}

/** Batas fitur untuk satu plan (fallback ke batas free). */
function getPlanLimits(plan) {
  return (PLAN_PRICES[plan] || PLAN_PRICES.free).limits;
}

module.exports = { ensureFreeSubscription, getActiveSubscription, getPlanLimits, isPlanAtLeast };
