// config/plans.js
// Definisi tier pricing SaaS TTS-Live V2.
// Tetap konsisten dengan PLAN_PRICES di config.js — di-impor dari situ.
// Disimpan terpisah agar (a) gampang di-audit orang non-teknis & (b) gampang
// di-import di UI client/build step kalau perlu.
const PLAN_PRICES = {
  free: {
    id: 'free',
    label: 'Free (Trial 30 hari)',
    labelId: 'Gratis — Coba 30 Hari',
    price: 0,
    priceLabel: 'Rp 0',
    durationDays: 30,
    features: [
      '1 username TikTok',
      'Akses 11 game bawaan',
      'Overlay OBS dasar',
      'Gift trigger sederhana',
      'Cocok untuk coba-coba'
    ],
    limits: {
      maxGiftMappings: 4,
      maxActiveRooms: 1,
      aiQuestion: false,
      prioritySupport: false,
      customBranding: false
    }
  },
  basic: {
    id: 'basic',
    label: 'Basic',
    labelId: 'Basic — Kreator Pemula',
    price: 25000,
    priceLabel: 'Rp 25.000',
    durationDays: 30,
    features: [
      'Semua fitur Free',
      'Maks 20 gift trigger',
      'Email notifikasi pembayaran',
      'Auto-renew subscription',
      'Support via email'
    ],
    limits: {
      maxGiftMappings: 20,
      maxActiveRooms: 1,
      aiQuestion: false,
      prioritySupport: false,
      customBranding: false
    }
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    labelId: 'Pro — Kreator Serius',
    price: 50000,
    priceLabel: 'Rp 50.000',
    durationDays: 30,
    features: [
      'Semua fitur Basic',
      'Gift trigger tak terbatas',
      'AI-generated question (OpenAI)',
      'Custom branding overlay',
      'Priority support 24/7',
      'Statistik viewer & gift'
    ],
    limits: {
      maxGiftMappings: Infinity,
      maxActiveRooms: 1,
      aiQuestion: true,
      prioritySupport: true,
      customBranding: true
    }
  }
};

const PLAN_ORDER = ['free', 'basic', 'pro'];

function isPlanAtLeast(plan, required) {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(required);
}

function listPlans() {
  return Object.values(PLAN_PRICES);
}

module.exports = { PLAN_PRICES, PLAN_ORDER, isPlanAtLeast, listPlans };
