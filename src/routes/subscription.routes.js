const express = require('express');
const router = express.Router();
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
    } = req.body;

    if (!clientId || !service || !endDate || !purchasePrice || !pricePaid) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
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
    const { newEndDate, newPricePaid } = req.body;
    if (!newEndDate) return res.status(400).json({ success: false, message: 'Nouvelle date requise' });

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
    const { newAccountId, newProfileId, reason } = req.body;
    if (!newAccountId || !newProfileId) {
      return res.status(400).json({ success: false, message: 'Nouveau compte et profil requis' });
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
