const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');
const Account = require('../models/Account');
const Profile = require('../models/Profile');
const { findAvailableSlot } = require('../services/allocation.service');

router.use(protect, restrict('admin'));

function normalizeOptionalAccountFields(payload = {}) {
  const normalized = { ...payload };

  if (typeof normalized.email === 'string') normalized.email = normalized.email.trim().toLowerCase();
  if (typeof normalized.password === 'string') normalized.password = normalized.password.trim();
  if (typeof normalized.notes === 'string') normalized.notes = normalized.notes.trim() || '';
  if (typeof normalized.assignedPartner === 'string') normalized.assignedPartner = normalized.assignedPartner.trim() || null;
  if (normalized.purchasePrice !== undefined) normalized.purchasePrice = Number(normalized.purchasePrice);

  return normalized;
}

function ensureValidObjectId(id, label = 'Identifiant invalide') {
  return mongoose.isValidObjectId(id)
    ? null
    : { success: false, message: label };
}

// GET /api/accounts?service=Netflix
router.get('/', async (req, res, next) => {
  try {
    const { service, hasSlots } = req.query;
    const filter = {};
    if (service) filter.service = service;

    const accounts = await Account.find(filter)
      .populate('assignedPartner', 'name email')
      .sort({ service: 1, type: 1 });

    // Enrichir avec infos profils
    const enriched = await Promise.all(accounts.map(async (acc) => {
      const profiles = await Profile.find({ accountId: acc._id, isActive: true });
      const usedSlots = profiles.filter(p => p.assignedClients.length > 0 && !p.isFreeTrial).length;
      return {
        ...acc.toJSON(),
        profiles,
        usedSlots,
        freeSlots: acc.maxSlots - usedSlots,
      };
    }));

    const result = hasSlots === 'true'
      ? enriched.filter(a => a.freeSlots > 0)
      : enriched;

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounts
router.post('/', async (req, res, next) => {
  try {
    const { service, type, email, password, purchasePrice, assignedPartner, notes } = normalizeOptionalAccountFields(req.body);
    if (!service || !type || !email || !password || purchasePrice === undefined) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }
    if (Number.isNaN(purchasePrice)) {
      return res.status(400).json({ success: false, message: 'Prix d\'achat invalide' });
    }
    const account = await Account.create({ service, type, email, password, purchasePrice, assignedPartner, notes });
    res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounts/available/:service
router.get('/available/:service', async (req, res, next) => {
  try {
    const slot = await findAvailableSlot(req.params.service);
    res.json({ success: true, data: slot });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de compte invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const account = await Account.findById(req.params.id).populate('assignedPartner', 'name');
    if (!account) return res.status(404).json({ success: false, message: 'Compte introuvable' });

    const profiles = await Profile.find({ accountId: account._id })
      .populate('assignedClients', 'name phone');

    res.json({ success: true, data: { ...account.toJSON(), profiles } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/accounts/:id
router.put('/:id', async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de compte invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const { email, password, purchasePrice, assignedPartner, notes, isActive } = normalizeOptionalAccountFields(req.body);
    if (purchasePrice !== undefined && Number.isNaN(purchasePrice)) {
      return res.status(400).json({ success: false, message: 'Prix d\'achat invalide' });
    }
    const account = await Account.findByIdAndUpdate(
      req.params.id,
      { $set: { email, password, purchasePrice, assignedPartner, notes, isActive } },
      { new: true, runValidators: true }
    );
    if (!account) return res.status(404).json({ success: false, message: 'Compte introuvable' });
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de compte invalide');
    if (invalidId) return res.status(400).json(invalidId);

    await Account.findByIdAndUpdate(req.params.id, { $set: { deletedAt: new Date(), isActive: false } });
    res.json({ success: true, message: 'Compte désactivé' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
