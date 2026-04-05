const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');
const Profile = require('../models/Profile');

router.use(protect, restrict('admin'));

// GET /api/profiles?accountId=xxx
router.get('/', async (req, res, next) => {
  try {
    const { accountId } = req.query;
    const filter = {};
    if (accountId) filter.accountId = accountId;

    const profiles = await Profile.find(filter)
      .populate('accountId', 'service type')
      .populate('assignedClients', 'name phone');

    res.json({ success: true, data: profiles });
  } catch (err) { next(err); }
});

// POST /api/profiles
router.post('/', async (req, res, next) => {
  try {
    const { accountId, name, pin, isFreeTrial, freeTrialExpiresAt } = req.body;
    if (!accountId || !name) {
      return res.status(400).json({ success: false, message: 'accountId et name requis' });
    }
    const profile = await Profile.create({ accountId, name, pin, isFreeTrial, freeTrialExpiresAt });
    res.status(201).json({ success: true, data: profile });
  } catch (err) { next(err); }
});

// PUT /api/profiles/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, pin, isFreeTrial, isActive } = req.body;
    const profile = await Profile.findByIdAndUpdate(
      req.params.id,
      { $set: { name, pin, isFreeTrial, isActive } },
      { new: true }
    );
    if (!profile) return res.status(404).json({ success: false, message: 'Profil introuvable' });
    res.json({ success: true, data: profile });
  } catch (err) { next(err); }
});

// DELETE /api/profiles/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await Profile.findByIdAndUpdate(req.params.id, { $set: { deletedAt: new Date(), isActive: false } });
    res.json({ success: true, message: 'Profil supprimé' });
  } catch (err) { next(err); }
});

module.exports = router;
