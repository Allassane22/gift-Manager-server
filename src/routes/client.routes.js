const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const { restrict, ownDataOnly } = require('../middleware/rbac.middleware');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');
const Profile = require('../models/Profile');

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

// GET /api/clients
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

    const clientsWithSubs = await Promise.all(clients.map(async (client) => {
      const subscriptions = await Subscription.find({ clientId: client._id, deletedAt: null })
        .populate('accountId', 'service type email password')
        .populate('profileId', 'name pin')
        .populate('partnerId', 'name')
        .sort({ endDate: 1 });
 
      const refreshed = await refreshStatusBatch(subscriptions);
      return { ...client.toJSON(), subscriptions: refreshed };
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
 
    
    const refreshed = await refreshStatusBatch(subscriptions);
 
    res.json({ success: true, data: { ...client.toJSON(), subscriptions: refreshed } });
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
// FIX B5 : soft-delete des abonnements actifs + retrait du clientId dans Profile.assignedClients
router.delete('/:id', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de client invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable' });

    const clientId = client._id;
    const now = new Date();

    // 1. Soft-delete tous les abonnements actifs du client
    await Subscription.updateMany(
      { clientId, deletedAt: null },
      { $set: { deletedAt: now, status: 'cancelled' } }
    );

    // 2. Retirer le clientId de tous les profils qui l'ont assigné
    await Profile.updateMany(
      { assignedClients: clientId },
      { $pull: { assignedClients: clientId } }
    );

    // 3. Soft-delete le client
    client.deletedAt = now;
    await client.save();

    res.json({ success: true, message: 'Client supprimé, abonnements annulés et profils libérés' });
  } catch (err) { next(err); }
});

module.exports = router;