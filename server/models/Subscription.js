// models/Subscription.js
// Catatan: status langganan user. Free plan otomatis dibuat saat register.
const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan: { type: String, enum: ['free', 'basic', 'pro'], default: 'free' },
  status: { type: String, enum: ['active', 'past_due', 'canceled', 'trialing', 'expired'], default: 'active' },
  midtransOrderId: { type: String, default: '', index: true, sparse: true },
  midtransTransactionId: { type: String, default: '' },
  startedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  autoRenew: { type: Boolean, default: false },
  // Riwayat notifikasi terakhir (biar gak spam)
  lastNotifiedExpiringAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index compound untuk query "user X subscription aktif"
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ expiresAt: 1 });

// Mongoose 9: pre('save') tanpa parameter `next` -> gunakan async middleware.
subscriptionSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
