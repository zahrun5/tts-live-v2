// services/midtrans.js
// Wrapper Midtrans Snap. Dipakai routes/billing.js.
// Di sandbox: pakai SB-Mid-server-XXX dari .env. Production di-set via MIDTRANS_IS_PRODUCTION=true.
const midtransClient = require('midtrans-client');
const config = require('../config');

let snap = null;
let core = null;

function getClients() {
  if (snap && core) return { snap, core };
  if (!config.MIDTRANS_SERVER_KEY) {
    throw new Error('MIDTRANS_SERVER_KEY belum di-set di .env');
  }
  snap = new midtransClient.Snap({
    isProduction: config.MIDTRANS_IS_PRODUCTION,
    serverKey: config.MIDTRANS_SERVER_KEY,
    clientKey: config.MIDTRANS_CLIENT_KEY
  });
  core = new midtransClient.CoreApi({
    isProduction: config.MIDTRANS_IS_PRODUCTION,
    serverKey: config.MIDTRANS_SERVER_KEY,
    clientKey: config.MIDTRANS_CLIENT_KEY
  });
  return { snap, core };
}

function getClientKey() {
  return config.MIDTRANS_CLIENT_KEY;
}

// orderId harus unik per attempt. Format: <username>-<timestamp>-<rand>
function buildOrderId(username) {
  const u = String(username).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'user';
  return `${u}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Bikin Snap transaction. return { token, redirect_url, orderId }.
async function createTransaction({ username, plan, email }) {
  const { snap } = getClients();
  const price = config.PLAN_PRICES[plan];
  if (!price) throw new Error('Plan tidak dikenal: ' + plan);
  if (price.price <= 0) throw new Error('Plan free tidak butuh pembayaran');

  const orderId = buildOrderId(username);
  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: price.price
    },
    item_details: [{
      id: plan,
      price: price.price,
      quantity: 1,
      name: price.label
    }],
    customer_details: {
      first_name: username,
      email: email || undefined
    },
    custom_field1: username,
    custom_field2: plan
  };
  const tx = await snap.createTransaction(parameter);
  return { token: tx.token, redirect_url: tx.redirect_url, orderId };
}

// Verifikasi signature dari webhook notification.
// Midtrans: SHA512(orderId+statusCode+grossAmount+serverKey)
const crypto = require('crypto');
function verifySignature(notif) {
  const { order_id, status_code, gross_amount, signature_key } = notif;
  if (!order_id || !status_code || !gross_amount || !signature_key) return false;
  const input = `${order_id}${status_code}${gross_amount}${config.MIDTRANS_SERVER_KEY}`;
  const expected = crypto.createHash('sha512').update(input).digest('hex');
  return expected === signature_key;
}

// Translate notif -> action string buat Subscription.update
//   settlement | capture (kalau cc) | deny | cancel | expire | refund | pending
function classify(notif) {
  const t = notif.transaction_status;
  const f = notif.fraud_status; // untuk CC
  if (t === 'capture') {
    if (f === 'accept' || f === 'challenge') return 'settlement';
    return 'deny';
  }
  return t; // settlement, deny, cancel, expire, refund, pending
}

module.exports = { getClients, getClientKey, createTransaction, verifySignature, classify };
