// routes/giftMapping.js
// CRUD gift trigger mapping untuk user. Milik user sendiri.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const GiftMapping = require('../models/GiftMapping');
const { TIKTOK_RE } = require('../config');

const VALID_ACTIONS = ['skip_round', 'bonus_score', 'next_question', 'reveal_answer'];

router.get('/', auth, async (req, res) => {
  try {
    const list = await GiftMapping.find({ userId: req.user.id }).sort({ giftName: 1 });
    res.json({ mappings: list });
  } catch (err) {
    res.status(500).json({ error: 'Gagal baca mappings' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { giftName, action, value, enabled } = req.body || {};
    if (typeof giftName !== 'string' || !giftName.trim()) {
      return res.status(400).json({ error: 'giftName wajib' });
    }
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'action tidak valid' });
    }
    const v = Number(value) || 0;
    // upsert by (userId, giftName)
    const mapping = await GiftMapping.findOneAndUpdate(
      { userId: req.user.id, giftName: giftName.trim() },
      { userId: req.user.id, giftName: giftName.trim(), action, value: v, enabled: enabled !== false },
      { upsert: true, new: true }
    );
    res.status(201).json({ mapping });
  } catch (err) {
    console.error('[GiftMapping] create:', err.message);
    res.status(500).json({ error: 'Gagal simpan mapping' });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const update = {};
    if (req.body.action && VALID_ACTIONS.includes(req.body.action)) update.action = req.body.action;
    if (req.body.value !== undefined) update.value = Number(req.body.value) || 0;
    if (typeof req.body.enabled === 'boolean') update.enabled = req.body.enabled;
    const m = await GiftMapping.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      update,
      { new: true }
    );
    if (!m) return res.status(404).json({ error: 'Mapping tidak ditemukan' });
    res.json({ mapping: m });
  } catch (err) {
    res.status(500).json({ error: 'Gagal update mapping' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const r = await GiftMapping.deleteOne({ _id: req.params.id, userId: req.user.id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Mapping tidak ditemukan' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal hapus mapping' });
  }
});

module.exports = router;
