const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const { restrict, ownDataOnly } = require('../middleware/rbac.middleware');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');

router.use(protect);

function normalizeOptionalClientFields(payload = {}) {
  const normalized = { ...payload };

  if (typeof normalized.email === 'string') normalized.email = normalized.email.trim() || null;
  if (typeof normalized.notes === 'string') normalized.notes = normalized.notes.trim() || '';
  if (typeof normalized.referredBy === 'string') normalized.referredBy = normalized.referredBy.trim() || null;

  return normalized;
}

function ensureValidObjectId(id, label = 'Identifiant invalide') {
  return mongoose.isValidObjectId(id)
    ? null
    : { success: false, message: label };
}

// GET /api/clients — avec abonnements populés
router.get('/', ownDataOnly, async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (req.filterByPartner) filter.referredBy = req.filterByPartner;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const clients = await Client.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Populer les abonnements pour chaque client
    const clientsWithSubs = await Promise.all(clients.map(async (client) => {
      const subscriptions = await Subscription.find({ clientId: client._id, deletedAt: null })
        .populate('accountId', 'service type email password')
        .populate('profileId', 'name pin')
        .populate('partnerId', 'name')
        .sort({ endDate: 1 });
      return { ...client.toJSON(), subscriptions };
    }));

    const total = await Client.countDocuments(filter);
    res.json({ success: true, data: clientsWithSubs, pagination: { page: Number(page), total } });
  } catch (err) { next(err); }
});

// GET /api/clients/:id
router.get('/:id', async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de client invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable' });
    const subscriptions = await Subscription.find({ clientId: req.params.id, deletedAt: null })
      .populate('accountId', 'service type email password')
      .populate('profileId', 'name pin')
      .populate('partnerId', 'name')
      .sort({ endDate: 1 });
    res.json({ success: true, data: { ...client.toJSON(), subscriptions } });
  } catch (err) { next(err); }
});

// POST /api/clients
router.post('/', restrict('admin'), async (req, res, next) => {
  try {
    const { name, phone, email, notes, referredBy } = normalizeOptionalClientFields(req.body);
    if (!name || !phone) return res.status(400).json({ success: false, message: 'Nom et téléphone requis' });
    const client = await Client.create({ name, phone, email, notes, referredBy });
    res.status(201).json({ success: true, data: client });
  } catch (err) { next(err); }
});

// PUT /api/clients/:id
router.put('/:id', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de client invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const { name, phone, email, notes, referredBy } = normalizeOptionalClientFields(req.body);
    const client = await Client.findByIdAndUpdate(
      req.params.id,
      { $set: { name, phone, email, notes, referredBy } },
      { new: true, runValidators: true }
    );
    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable' });
    res.json({ success: true, data: client });
  } catch (err) { next(err); }
});

// DELETE /api/clients/:id
router.delete('/:id', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de client invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const client = await Client.findByIdAndUpdate(req.params.id, { $set: { deletedAt: new Date() } }, { new: true });
    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable' });
    res.json({ success: true, message: 'Client supprimé' });
  } catch (err) { next(err); }
});

module.exports = router;
