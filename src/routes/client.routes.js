const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { restrict, ownDataOnly } = require('../middleware/rbac.middleware');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');

router.use(protect);

// GET /api/clients
router.get('/', ownDataOnly, async (req, res, next) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (req.filterByPartner) filter.referredBy = req.filterByPartner;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const [clients, total] = await Promise.all([
      Client.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Client.countDocuments(filter),
    ]);

    res.json({ success: true, data: clients, pagination: { page: Number(page), total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// GET /api/clients/:id (avec abonnements)
router.get('/:id', async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable' });

    const subscriptions = await Subscription.find({ clientId: req.params.id })
      .populate('accountId', 'service type email')
      .populate('profileId', 'name pin')
      .populate('partnerId', 'name')
      .sort({ endDate: 1 });

    res.json({ success: true, data: { ...client.toJSON(), subscriptions } });
  } catch (err) {
    next(err);
  }
});

// POST /api/clients
router.post('/', restrict('admin'), async (req, res, next) => {
  try {
    const { name, phone, email, notes, referredBy } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Nom et téléphone requis' });
    }
    const client = await Client.create({ name, phone, email, notes, referredBy });
    res.status(201).json({ success: true, data: client });
  } catch (err) {
    next(err);
  }
});

// PUT /api/clients/:id
router.put('/:id', restrict('admin'), async (req, res, next) => {
  try {
    const { name, phone, email, notes } = req.body;
    const client = await Client.findByIdAndUpdate(
      req.params.id,
      { $set: { name, phone, email, notes } },
      { new: true, runValidators: true }
    );
    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable' });
    res.json({ success: true, data: client });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/clients/:id (soft delete)
router.delete('/:id', restrict('admin'), async (req, res, next) => {
  try {
    const client = await Client.findByIdAndUpdate(
      req.params.id,
      { $set: { deletedAt: new Date() } },
      { new: true }
    );
    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable' });
    res.json({ success: true, message: 'Client supprimé' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
