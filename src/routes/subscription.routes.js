const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const { restrict, ownDataOnly } = require('../middleware/rbac.middleware');
const { createSubscription, renewSubscription, migrateSubscription } = require('../services/allocation.service');
const { generateWhatsAppLink } = require('../services/whatsapp.service');
const Subscription = require('../models/Subscription');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

// Toutes les routes nécessitent d'être connecté
router.use(protect);

function normalizeSubscriptionFields(payload = {}) {
  const normalized = { ...payload };

  ['clientId', 'accountId', 'profileId', 'partnerId', 'newAccountId', 'newProfileId'].forEach((key) => {
    if (typeof normalized[key] === 'string') normalized[key] = normalized[key].trim() || null;
  });

  ['purchasePrice', 'pricePaid', 'commissionValue', 'newPricePaid'].forEach((key) => {
    if (normalized[key] !== undefined && normalized[key] !== null && normalized[key] !== '') {
      normalized[key] = Number(normalized[key]);
    }
  });

  if (typeof normalized.service === 'string') normalized.service = normalized.service.trim();
  if (typeof normalized.commissionType === 'string') normalized.commissionType = normalized.commissionType.trim();
  if (typeof normalized.reason === 'string') normalized.reason = normalized.reason.trim() || '';

  return normalized;
}

function ensureValidObjectId(id, label = 'Identifiant invalide') {
  return mongoose.isValidObjectId(id)
    ? null
    : { success: false, message: label };
}

// ─── GET /api/subscriptions ───────────────────────────────────────────────────
// Filtres: ?partnerId=&status=&service=&page=&limit=&expiringSoon=true
router.get('/', ownDataOnly, async (req, res, next) => {
  try {
    const { status, service, expiringSoon, page = 1, limit = 20 } = req.query;

    const filter = { deletedAt: null };

    // Un partenaire ne voit que ses abonnements
    if (req.filterByPartner) {
      filter.partnerId = req.filterByPartner;
    } else if (req.query.partnerId) {
      filter.partnerId = req.query.partnerId;
    }

    if (status) filter.status = status;

    if (expiringSoon === 'true') {
      const in7Days = dayjs.utc().add(7, 'day').toDate();
      filter.endDate = { $lte: in7Days };
      filter.status = 'active';
    }

    // Filtre par service (via populate account)
    const subscriptions = await Subscription.find(filter)
      .populate('clientId', 'name phone email')
      .populate({
        path: 'accountId',
        select: 'service type email maxSlots',
        ...(service && { match: { service } }),
      })
      .populate('profileId', 'name pin')
      .populate('partnerId', 'name email')
      .sort({ endDate: 1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Filtrer les null accountId si filtre service actif
    const filtered = service
      ? subscriptions.filter(s => s.accountId !== null)
      : subscriptions;

    const total = await Subscription.countDocuments(filter);

    res.json({
      success: true,
      data: filtered,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/subscriptions/:id ───────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID d\'abonnement invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const sub = await Subscription.findById(req.params.id)
      .populate('clientId', 'name phone email')
      .populate('accountId', 'service type email password')
      .populate('profileId', 'name pin')
      .populate('partnerId', 'name email');

    if (!sub) return res.status(404).json({ success: false, message: 'Abonnement introuvable' });

    // Générer lien WhatsApp
    const waLink = generateWhatsAppLink({
      phone: sub.clientId?.phone,
      clientName: sub.clientId?.name,
      service: sub.accountId?.service,
      endDate: sub.endDate,
      amount: sub.pricePaid,
      type: sub.status === 'overdue' ? 'expired' : 'reminder',
    });

    res.json({ success: true, data: { ...sub.toJSON(), whatsappLink: waLink } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/subscriptions ──────────────────────────────────────────────────
router.post('/', restrict('admin'), async (req, res, next) => {
  try {
    const {
      clientId, service, accountId, profileId, partnerId,
      startDate, endDate, purchasePrice, pricePaid,
      commissionType, commissionValue,
    } = normalizeSubscriptionFields(req.body);

    if (!clientId || !service || !endDate || purchasePrice === undefined || purchasePrice === null || pricePaid === undefined || pricePaid === null) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }
    if ([purchasePrice, pricePaid, commissionValue].some((value) => value !== null && value !== undefined && Number.isNaN(value))) {
      return res.status(400).json({ success: false, message: 'Montants invalides' });
    }

    const subscription = await createSubscription({
      clientId, service, accountId, profileId, partnerId,
      startDate: startDate || new Date(),
      endDate,
      purchasePrice: Number(purchasePrice),
      pricePaid: Number(pricePaid),
      commissionType, commissionValue: Number(commissionValue || 0),
      doneBy: req.user._id,
    });

    res.status(201).json({ success: true, data: subscription, message: 'Abonnement créé avec succès' });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/subscriptions/:id/renew ──────────────────────────────────────
router.patch('/:id/renew', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID d\'abonnement invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const { newEndDate, newPricePaid } = normalizeSubscriptionFields(req.body);
    if (!newEndDate) return res.status(400).json({ success: false, message: 'Nouvelle date requise' });
    if (newPricePaid !== undefined && newPricePaid !== null && Number.isNaN(newPricePaid)) {
      return res.status(400).json({ success: false, message: 'Nouveau montant invalide' });
    }

    const subscription = await renewSubscription({
      subscriptionId: req.params.id,
      newEndDate,
      newPricePaid: newPricePaid ? Number(newPricePaid) : undefined,
      doneBy: req.user._id,
    });

    res.json({ success: true, data: subscription, message: 'Renouvellement effectué' });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/subscriptions/:id/migrate ────────────────────────────────────
router.patch('/:id/migrate', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID d\'abonnement invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const { newAccountId, newProfileId, reason } = normalizeSubscriptionFields({
      newAccountId: req.body.newAccountId,
      newProfileId: req.body.newProfileId,
      reason: req.body.reason,
    });
    if (!newAccountId || !newProfileId) {
      return res.status(400).json({ success: false, message: 'Nouveau compte et profil requis' });
    }
    if (!mongoose.isValidObjectId(newAccountId) || !mongoose.isValidObjectId(newProfileId)) {
      return res.status(400).json({ success: false, message: 'IDs de migration invalides' });
    }

    const subscription = await migrateSubscription({
      subscriptionId: req.params.id,
      newAccountId, newProfileId, reason,
      doneBy: req.user._id,
    });

    res.json({ success: true, data: subscription, message: 'Migration effectuée' });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/subscriptions/:id/status ─────────────────────────────────────
router.patch('/:id/status', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID d\'abonnement invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const { status } = req.body;
    const allowed = ['active', 'suspended', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Statut invalide. Valeurs: ${allowed.join(', ')}` });
    }

    const sub = await Subscription.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );
    if (!sub) return res.status(404).json({ success: false, message: 'Introuvable' });

    res.json({ success: true, data: sub });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/subscriptions/:id (soft delete) ─────────────────────────────
router.delete('/:id', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID d\'abonnement invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const sub = await Subscription.findByIdAndUpdate(
      req.params.id,
      { $set: { deletedAt: new Date(), status: 'cancelled' } },
      { new: true }
    );
    if (!sub) return res.status(404).json({ success: false, message: 'Introuvable' });

    res.json({ success: true, message: 'Abonnement annulé' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
