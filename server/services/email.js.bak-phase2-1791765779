// services/email.js
// Skeleton email notif via nodemailer. Queue pakai setImmediate (in-process, no extra dep).
// Kalau SMTP belum di-set, semua fungsi jadi no-op (tetap log).
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null; // SMTP belum di-set
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporter;
}

const TEMPLATES = {
  welcome: (ctx) => ({
    subject: 'Selamat datang di TTS-Live Studio!',
    text: `Halo ${ctx.username},\n\nSelamat datang! Akun Free-mu aktif 30 hari. Login di ${config.APP_BASE_URL}/login.\n\nSalam,\nTim TTS-Live`
  }),
  payment_success: (ctx) => ({
    subject: `Pembayaran ${ctx.plan} berhasil 🎉`,
    text: `Halo ${ctx.username},\n\nPembayaran paket ${ctx.plan} sukses. Langganan aktif sampai ${ctx.expiresAt}.\n\nLogin di ${config.APP_BASE_URL}/login.\n\nSalam,\nTim TTS-Live`
  }),
  payment_failed: (ctx) => ({
    subject: `Pembayaran ${ctx.plan} gagal`,
    text: `Halo ${ctx.username},\n\nPembayaran paket ${ctx.plan} tidak berhasil (${ctx.reason || 'unknown'}). Coba lagi di ${config.APP_BASE_URL}/billing.\n\nSalam,\nTim TTS-Live`
  }),
  sub_expiring_soon: (ctx) => ({
    subject: 'Langgananmu segera berakhir',
    text: `Halo ${ctx.username},\n\nLangganan ${ctx.plan} berakhir ${ctx.expiresAt}. Perpanjang di ${config.APP_BASE_URL}/billing.\n\nSalam,\nTim TTS-Live`
  })
};

// Queue: taruh ke array in-process, kirim via setImmediate
const queue = [];
function enqueue(to, kind, ctx) {
  if (!to) return; // tanpa email = skip
  const tpl = TEMPLATES[kind];
  if (!tpl) return;
  queue.push({ to, kind, msg: tpl(ctx), queuedAt: new Date() });
  setImmediate(drain);
}

async function drain() {
  const tr = getTransporter();
  if (!tr) {
    // SMTP off -> log saja
    while (queue.length) {
      const q = queue.shift();
      console.log(`[Email:no-smtp] skip ${q.kind} -> ${q.to} | ${q.msg.subject}`);
    }
    return;
  }
  while (queue.length) {
    const q = queue.shift();
    try {
      await tr.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: q.to,
        subject: q.msg.subject,
        text: q.msg.text
      });
      console.log(`[Email] sent ${q.kind} -> ${q.to}`);
    } catch (e) {
      console.error(`[Email] failed ${q.kind} -> ${q.to}: ${e.message}`);
    }
  }
}

function welcome({ to, username }) { enqueue(to, 'welcome', { username }); }
function paymentSuccess({ to, username, plan, expiresAt }) { enqueue(to, 'payment_success', { username, plan, expiresAt }); }
function paymentFailed({ to, username, plan, reason }) { enqueue(to, 'payment_failed', { username, plan, reason }); }
function subExpiringSoon({ to, username, plan, expiresAt }) { enqueue(to, 'sub_expiring_soon', { username, plan, expiresAt }); }

module.exports = { welcome, paymentSuccess, paymentFailed, subExpiringSoon, getTransporter };
