const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');
const Account = require('../models/Account');
const Profile = require('../models/Profile');
const Subscription = require('../models/Subscription');
const ServiceConfig = require('../models/ServiceConfig');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { findAvailableSlot } = require('../services/allocation.service');

router.use(protect, restrict('admin'));

function normalizeOptionalAccountFields(payload = {}) {
  const normalized = { ...payload };
  if (typeof normalized.email === 'string') normalized.email = normalized.email.trim().toLowerCase();
  if (typeof normalized.password === 'string') normalized.password = normalized.password.trim();
  if (typeof normalized.notes === 'string') normalized.notes = normalized.notes.trim() || '';
  if (typeof normalized.assignedPartner === 'string') normalized.assignedPartner = normalized.assignedPartner.trim() || null;
  if (normalized.purchasePrice !== undefined) normalized.purchasePrice = Number(normalized.purchasePrice);
  // Extraire les 4 derniers chiffres si un numéro de carte est fourni
  if (typeof normalized.cardNumber === 'string') {
    const digits = normalized.cardNumber.replace(/\D/g, '');
    normalized.cardLast4 = digits.length >= 4 ? digits.slice(-4) : null;
    delete normalized.cardNumber;
  }
  return normalized;
}

function ensureValidObjectId(id, label = 'Identifiant invalide') {
  return mongoose.isValidObjectId(id) ? null : { success: false, message: label };
}

// Génère les noms de profils selon le service et le nombre de slots
function generateProfileNames(service, maxSlots) {
  const singleProfile = ['Spotify', 'Apple Music', 'Snapchat+', 'Prime Video'];
  if (singleProfile.includes(service) || maxSlots === 1) return ['Principal'];
  if (service === 'Netflix') {
    return ['Profil 1', 'Profil 2', 'Profil 3', 'Profil 4', 'Profil 5'].slice(0, maxSlots);
  }
  if (maxSlots === 2) return ['Joueur 1', 'Joueur 2'];
  return Array.from({ length: maxSlots }, (_, i) => `Profil ${i + 1}`);
}

// GET /api/accounts
router.get('/', async (req, res, next) => {
  try {
    const { service, hasSlots } = req.query;
    const filter = { deletedAt: null };
    if (service) filter.service = service;

    const accounts = await Account.find(filter)
      .populate('assignedPartner', 'name email')
      .sort({ service: 1, type: 1 });

    const enriched = await Promise.all(accounts.map(async (acc) => {
      const profiles = await Profile.find({ accountId: acc._id, isActive: true })
        .populate('assignedClients', 'name phone');
      // Nettoyer les IDs fantômes (clients null après populate)
      const cleanedProfiles = await Promise.all(profiles.map(async (p) => {
        const realClients = (p.assignedClients || []).filter(c => c !== null && c !== undefined);
        if (realClients.length !== (p.assignedClients || []).length) {
          await Profile.findByIdAndUpdate(p._id, {
            $set: { assignedClients: realClients.map(c => c._id) }
          });
        }
        const isAvailable = p.isFreeTrial ? true : realClients.length === 0;
        return { ...p.toJSON(), assignedClients: realClients, isAvailable };
      }));

      // freeSlots basé sur les profils réels libres (pas maxSlots théorique)
      const freeProfilesCount = cleanedProfiles.filter(p => p.isAvailable).length;
      const usedSlots = cleanedProfiles.filter(p => !p.isAvailable && !p.isFreeTrial).length;
      const maxSlots = Number.isFinite(acc.maxSlots) ? acc.maxSlots : 0;

      return {
        ...acc.toJSON(),
        profiles: cleanedProfiles,
        usedSlots,
        // freeSlots = profils libres réels (cohérent avec ce qu'on peut réellement attribuer)
        freeSlots: freeProfilesCount,
        totalSlots: maxSlots,
      };
    }));

    const result = hasSlots === 'true' ? enriched.filter(a => a.freeSlots > 0) : enriched;
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/accounts
router.post('/', async (req, res, next) => {
  try {
    const { service, type, email, password, purchasePrice, assignedPartner, notes, cardLast4 } =
      normalizeOptionalAccountFields(req.body);

    if (!service || !type || !email || !password || purchasePrice === undefined) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }
    if (Number.isNaN(purchasePrice)) {
      return res.status(400).json({ success: false, message: "Prix d'achat invalide" });
    }

    // Vérifier la limite de 3 comptes par carte
    if (cardLast4) {
      const cardCount = await Account.countDocuments({ cardLast4, deletedAt: null });
      if (cardCount >= 3) {
        return res.status(400).json({
          success: false,
          message: `La carte se terminant par ${cardLast4} est déjà utilisée sur 3 comptes (limite atteinte)`,
        });
      }
    }

    // Résoudre maxSlots depuis ServiceConfig
    let maxSlots;
    try {
      maxSlots = await ServiceConfig.getMaxSlots(service, type);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: `Service/type introuvable : ${service}/${type}. Vérifiez le catalogue des services.`,
      });
    }

    // Créer le compte
    const account = await Account.create({
      service, type, email, password, purchasePrice,
      assignedPartner: assignedPartner || null,
      notes, maxSlots,
      cardLast4: cardLast4 || null,
    });

    // Créer automatiquement les profils selon maxSlots
    const profileNames = generateProfileNames(service, maxSlots);
    const profiles = await Profile.insertMany(
      profileNames.map(name => ({
        accountId: account._id,
        name,
        isActive: true,
        assignedClients: [],
      }))
    );

    res.status(201).json({ success: true, data: { ...account.toJSON(), profiles } });
  } catch (err) { next(err); }
});

// GET /api/accounts/available/:service
router.get('/available/:service', async (req, res, next) => {
  try {
    const slot = await findAvailableSlot(req.params.service);
    res.json({ success: true, data: slot });
  } catch (err) { next(err); }
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
  } catch (err) { next(err); }
});

// PUT /api/accounts/:id
router.put('/:id', async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de compte invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const { email, password, purchasePrice, assignedPartner, notes, isActive, service, type, cardLast4 } =
      normalizeOptionalAccountFields(req.body);

    if (purchasePrice !== undefined && Number.isNaN(purchasePrice)) {
      return res.status(400).json({ success: false, message: "Prix d'achat invalide" });
    }

    // Vérifier la limite de 3 comptes par carte (en excluant le compte actuel)
    if (cardLast4 !== undefined) {
      const cardCount = await Account.countDocuments({
        cardLast4,
        deletedAt: null,
        _id: { $ne: req.params.id },
      });
      if (cardCount >= 3) {
        return res.status(400).json({
          success: false,
          message: `La carte se terminant par ${cardLast4} est déjà utilisée sur 3 comptes (limite atteinte)`,
        });
      }
    }

    const updates = { email, password, purchasePrice, assignedPartner, notes, isActive };
    if (cardLast4 !== undefined) updates.cardLast4 = cardLast4 || null;

    if (service && type) {
      try {
        updates.maxSlots = await ServiceConfig.getMaxSlots(service, type);
        updates.service = service;
        updates.type = type;
      } catch (err) {
        return res.status(400).json({ success: false, message: `Service/type introuvable : ${service}/${type}.` });
      }
    }

    const account = await Account.findByIdAndUpdate(
      req.params.id, { $set: updates }, { new: true, runValidators: true }
    );
    if (!account) return res.status(404).json({ success: false, message: 'Compte introuvable' });

    // ── Synchronisation des profils si service/type a changé ─────────────────
    // Si maxSlots a changé, on ajuste les profils : on crée les manquants,
    // on supprime (soft-delete) les surplus libres. Les profils occupés ne sont
    // jamais supprimés — on retourne une info si des profils occupés sont en surplus.
    if (updates.maxSlots !== undefined) {
      const newMaxSlots = updates.maxSlots;
      const newService  = updates.service || account.service;

      const existingProfiles = await Profile.find({
        accountId: account._id,
        deletedAt: null,
      }).populate('assignedClients');

      const occupiedProfiles = existingProfiles.filter(p => p.assignedClients.length > 0);
      const freeProfiles     = existingProfiles.filter(p => p.assignedClients.length === 0);
      const currentTotal     = existingProfiles.length;

      if (newMaxSlots > currentTotal) {
        // Créer les profils manquants
        const toCreate = newMaxSlots - currentTotal;
        const profileNames = generateProfileNames(newService, newMaxSlots);
        const newNames = profileNames.slice(currentTotal);
        await Profile.insertMany(
          newNames.slice(0, toCreate).map(name => ({
            accountId: account._id,
            name,
            isActive: true,
            assignedClients: [],
          }))
        );
      } else if (newMaxSlots < currentTotal) {
        // Supprimer les profils libres en surplus (les plus récents en premier)
        const surplus = currentTotal - newMaxSlots;
        const toDelete = freeProfiles.slice(-surplus);
        if (toDelete.length > 0) {
          await Profile.updateMany(
            { _id: { $in: toDelete.map(p => p._id) } },
            { $set: { deletedAt: new Date(), isActive: false } }
          );
        }
      }
    }

    res.json({ success: true, data: account });
  } catch (err) { next(err); }
});

// DELETE /api/accounts/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, 'ID de compte invalide');
    if (invalidId) return res.status(400).json(invalidId);

    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Compte introuvable' });

    const now = new Date();
    const profiles = await Profile.find({ accountId: account._id, deletedAt: null }, '_id');
    const profileIds = profiles.map(p => p._id);

    // ── Récupérer les abonnements actifs avant de les annuler (pour décrémenter stats) ──
    let activeSubs = [];
    if (profileIds.length > 0) {
      activeSubs = await Subscription.find({
        profileId: { $in: profileIds },
        deletedAt: null,
        status: { $nin: ['cancelled'] },
      }).select('clientId partnerId pricePaid commissionAmount');

      await Subscription.updateMany(
        { profileId: { $in: profileIds }, deletedAt: null },
        { $set: { deletedAt: now, status: 'cancelled' } }
      );
    }

    await Profile.updateMany(
      { accountId: account._id, deletedAt: null },
      { $set: { assignedClients: [] } }
    );

    await Profile.updateMany(
      { accountId: account._id, deletedAt: null },
      { $set: { deletedAt: now, isActive: false } }
    );

    await Account.findByIdAndUpdate(req.params.id, { $set: { deletedAt: now, isActive: false } });

    // ── #17 : Décrémenter les stats dénormalisées pour chaque abonnement annulé ──
    for (const sub of activeSubs) {
      if (sub.clientId) {
        await User.findByIdAndUpdate(sub.clientId, {
          $inc: { totalPaid: -sub.pricePaid, totalSubscriptions: -1 },
        }).catch((err) => {
          console.error('[account.delete] ⚠️ Stats client non décrémentées:', err.message, { clientId: sub.clientId });
        });
      }
      if (sub.partnerId) {
        await User.findByIdAndUpdate(sub.partnerId, {
          $inc: {
            totalRevenue: -sub.pricePaid,
            totalCommission: -(sub.commissionAmount || 0),
            totalSubscriptions: -1,
          },
        }).catch((err) => {
          console.error('[account.delete] ⚠️ Stats partenaire non décrémentées:', err.message, { partnerId: sub.partnerId });
        });
      }
    }

    // ── #33 : Audit log ───────────────────────────────────────────────────────
    await AuditLog.create({
      userId: req.user._id,
      action: 'DELETE_ACCOUNT',
      targetModel: 'Account',
      targetId: account._id,
      details: { service: account.service, type: account.type, cancelledSubs: activeSubs.length },
    }).catch((err) => {
      console.error('[account.delete] ⚠️ AuditLog non enregistré:', err.message);
    });

    res.json({ success: true, message: 'Compte désactivé, profils et abonnements liés annulés' });
  } catch (err) { next(err); }
});

module.exports = router;