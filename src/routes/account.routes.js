const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');
const Account = require('../models/Account');
const Profile = require('../models/Profile');
const Subscription = require('../models/Subscription');
const ServiceConfig = require('../models/ServiceConfig');
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
      const usedSlots = profiles.filter((p) => {
        const assignedClients = Array.isArray(p.assignedClients) ? p.assignedClients : [];
        return assignedClients.length > 0 && !p.isFreeTrial;
      }).length;
      const maxSlots = Number.isFinite(acc.maxSlots) ? acc.maxSlots : 0;
      return {
        ...acc.toJSON(),
        profiles,
        usedSlots,
        freeSlots: Math.max(maxSlots - usedSlots, 0),
      };
    }));

    const result = hasSlots === 'true' ? enriched.filter(a => a.freeSlots > 0) : enriched;
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/accounts
router.post('/', async (req, res, next) => {
  try {
    const { service, type, email, password, purchasePrice, assignedPartner, notes } =
      normalizeOptionalAccountFields(req.body);

    if (!service || !type || !email || !password || purchasePrice === undefined) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }
    if (Number.isNaN(purchasePrice)) {
      return res.status(400).json({ success: false, message: "Prix d'achat invalide" });
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

    const { email, password, purchasePrice, assignedPartner, notes, isActive, service, type } =
      normalizeOptionalAccountFields(req.body);

    if (purchasePrice !== undefined && Number.isNaN(purchasePrice)) {
      return res.status(400).json({ success: false, message: "Prix d'achat invalide" });
    }

    const updates = { email, password, purchasePrice, assignedPartner, notes, isActive };

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

    if (profileIds.length > 0) {
      await Subscription.updateMany(
        { profileId: { $in: profileIds }, deletedAt: null },
        { $set: { deletedAt: now, status: 'cancelled' } }
      );
    }

    await Profile.updateMany(
      { accountId: account._id, deletedAt: null },
      { $set: { deletedAt: now, isActive: false } }
    );

    await Account.findByIdAndUpdate(req.params.id, { $set: { deletedAt: now, isActive: false } });

    res.json({ success: true, message: 'Compte désactivé, profils et abonnements liés annulés' });
  } catch (err) { next(err); }
});

module.exports = router;