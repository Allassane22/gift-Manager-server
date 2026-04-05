const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');
const Account = require('../models/Account');
const Profile = require('../models/Profile');
const { findAvailableSlot } = require('../services/allocation.service');

router.use(protect, restrict('admin'));

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

// GET /api/accounts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id).populate('assignedPartner', 'name');
    if (!account) return res.status(404).json({ success: false, message: 'Compte introuvable' });

    const profiles = await Profile.find({ accountId: account._id })
      .populate('assignedClients', 'name phone');

    res.json({ success: true, data: { ...account.toJSON(), profiles } });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounts
router.post('/', async (req, res, next) => {
  try {
    const { service, type, email, password, purchasePrice, assignedPartner, notes } = req.body;
    if (!service || !type || !email || !password || purchasePrice === undefined) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }
    const account = await Account.create({ service, type, email, password, purchasePrice, assignedPartner, notes });
    res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});

// PUT /api/accounts/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { email, password, purchasePrice, assignedPartner, notes, isActive } = req.body;
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
    await Account.findByIdAndUpdate(req.params.id, { $set: { deletedAt: new Date(), isActive: false } });
    res.json({ success: true, message: 'Compte désactivé' });
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

module.exports = router;
