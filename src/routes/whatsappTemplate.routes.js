const express = require('express');
const router = express.Router();

const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const { SYSTEM_TYPES } = require('../models/WhatsAppTemplate');
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');

const DEFAULT_TEMPLATES = [
  {
    type: 'reminder',
    label: 'Rappel expiration',
    body: `Bonjour {{prenom}} 👋\n\nVotre abonnement *{{service}}* expire le *{{date}}*.\n💰 Montant du renouvellement : *{{montant}} FCFA*\n\nRenouvelez maintenant pour ne pas perdre l'accès ! ✅\nPaiement via Wave / Orange Money au *{{numero}}*\n\n— ɲɛnajɛ 🙏`,
  },
  {
    type: 'expired',
    label: 'Abonnement expiré',
    body: `Bonjour {{prenom}},\n\nVotre abonnement *{{service}}* a expiré le *{{date}}*.\n💰 Pour le renouveler : *{{montant}} FCFA*\n\nContactez-nous dès que possible 🙏\nPaiement via Wave / Orange Money au *{{numero}}*\n\n— ɲɛnajɛ`,
  },
  {
    type: 'renewal',
    label: 'Confirmation renouvellement',
    body: `Bonjour {{prenom}} ✅\n\nVotre abonnement *{{service}}* a été renouvelé avec succès !\n📅 Valable jusqu'au : *{{date}}*\n\nMerci pour votre confiance 🎉\n— ɲɛnajɛ`,
  },
  {
    type: 'payment_request',
    label: 'Demande de paiement',
    body: `Bonjour {{prenom}} 👋\n\nVotre abonnement *{{service}}* est prêt.\n💰 Montant : *{{montant}} FCFA*\n\nMerci d'effectuer le paiement via Wave ou Orange Money au *{{numero}}* puis de nous envoyer la capture d'écran de confirmation. 📲\n\n— ɲɛnajɛ`,
  },
  {
    type: 'payment_confirmed',
    label: 'Paiement confirmé',
    body: `Bonjour {{prenom}} ✅\n\nVotre paiement de *{{montant}} FCFA* pour *{{service}}* a bien été reçu.\n🎉 Votre accès est activé — bonne lecture !\n\n— ɲɛnajɛ`,
  },
  {
    type: 'welcome',
    label: 'Bienvenue nouveau client',
    body: `Bonjour {{prenom}} 🎉\n\nBienvenue !\n\nVotre abonnement *{{service}}* est maintenant actif.\n📅 Valable jusqu'au : *{{date}}*\n\nPour toute question, répondez simplement à ce message. Bonne lecture ! 🍿`,
  },
  {
    type: 'win_back',
    label: 'Reconquête client inactif',
    body: `Bonjour {{prenom}} 👋\n\nVous nous manquez ! 😊\n\nVotre dernier abonnement *{{service}}* a expiré depuis un moment.\n💰 Offre spéciale de retour : *{{montant}} FCFA*\n\nRevenez profiter de vos contenus préférés !\nPaiement via Wave / Orange Money au *{{numero}}* 🎬`,
  },
];

// Helper : filtre owner (admin → null, partner → leur _id)
const ownerFilter = (user) => ({
  ownerId: user.role === 'admin' ? null : user._id,
});

// GET /api/whatsapp-templates
// Admin → ses templates (ownerId: null) + templates système
// Partner → ses templates (ownerId: partnerId) + templates système actifs
router.get('/', protect, restrict('admin', 'partner'), async (req, res) => {
  try {
    let filter;
    if (req.user.role === 'admin') {
      filter = { deletedAt: null, $or: [{ ownerId: null }, { ownerId: { $exists: false } }] };
    } else {
      // Partenaire voit ses propres templates + les templates système actifs de l'admin
      filter = {
        deletedAt: null,
        isActive: true,
        $or: [
          { ownerId: req.user._id },
          { ownerId: null, isSystem: true },
          { ownerId: { $exists: false }, isSystem: true },
        ],
      };
    }
    const templates = await WhatsAppTemplate.find(filter, '-__v').sort({ type: 1 });
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/whatsapp-templates/:type
router.get('/:type', protect, restrict('admin', 'partner'), async (req, res) => {
  try {
    const filter = req.user.role === 'admin'
      ? { type: req.params.type, isActive: true, deletedAt: null, $or: [{ ownerId: null }, { ownerId: { $exists: false } }] }
      : { type: req.params.type, isActive: true, deletedAt: null, $or: [{ ownerId: req.user._id }, { ownerId: null }, { ownerId: { $exists: false } }] };

    const template = await WhatsAppTemplate.findOne(filter, '-__v');
    if (!template) {
      return res.status(404).json({ success: false, message: `Template "${req.params.type}" introuvable` });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/whatsapp-templates — admin ET partenaires peuvent créer leurs propres templates
router.post('/', protect, restrict('admin', 'partner'), async (req, res) => {
  try {
    const { type, label, body } = req.body;
    if (!type || !label || !body) {
      return res.status(400).json({ success: false, message: 'type, label et body sont requis' });
    }
    const normalizedType = type.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!normalizedType) return res.status(400).json({ success: false, message: 'Type invalide' });
    if (body.trim().length > 4096) return res.status(400).json({ success: false, message: 'Message trop long (max 4096 caractères)' });

    // Unicité par type + owner
    const ownerId = req.user.role === 'admin' ? null : req.user._id;
    const existing = await WhatsAppTemplate.findOne({
      type: normalizedType,
      ownerId: ownerId,
      deletedAt: null,
    });
    if (existing) {
      return res.status(409).json({ success: false, message: `Un template avec le type "${normalizedType}" existe déjà` });
    }

    const template = await WhatsAppTemplate.create({
      type: normalizedType,
      label: label.trim(),
      body: body.trim(),
      isSystem: false,
      isActive: true,
      ownerId,
    });
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/whatsapp-templates/:type
router.delete('/:type', protect, restrict('admin', 'partner'), async (req, res) => {
  try {
    const ownerId = req.user.role === 'admin' ? null : req.user._id;
    const template = await WhatsAppTemplate.findOne({
      type: req.params.type,
      ownerId: ownerId,
      deletedAt: null,
    });
    if (!template) return res.status(404).json({ success: false, message: `Template "${req.params.type}" introuvable` });
    if (SYSTEM_TYPES.includes(template.type) && req.user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Les templates système ne peuvent pas être supprimés' });
    }
    await WhatsAppTemplate.findByIdAndUpdate(template._id, { $set: { deletedAt: new Date() } });
    res.json({ success: true, message: `Template "${template.label}" supprimé` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/whatsapp-templates/:type
router.put('/:type', protect, restrict('admin', 'partner'), async (req, res) => {
  try {
    const { body, label, isActive } = req.body;
    const onlyToggle = isActive !== undefined && body === undefined && label === undefined;
    if (!onlyToggle && (!body || !body.trim())) {
      return res.status(400).json({ success: false, message: 'Le champ "body" est requis' });
    }
    if (body && body.trim().length > 4096) {
      return res.status(400).json({ success: false, message: 'Le corps du template ne peut pas dépasser 4096 caractères' });
    }

    const ownerId = req.user.role === 'admin' ? null : req.user._id;
    const update = {};
    if (body?.trim()) update.body = body.trim();
    if (label?.trim()) update.label = label.trim();
    if (isActive !== undefined) update.isActive = Boolean(isActive);

    const template = await WhatsAppTemplate.findOneAndUpdate(
      { type: req.params.type, ownerId: ownerId, deletedAt: null },
      { $set: update },
      { new: true, runValidators: true, select: '-__v' }
    );
    if (!template) return res.status(404).json({ success: false, message: `Template "${req.params.type}" introuvable` });
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/whatsapp-templates/seed — admin seulement
router.post('/seed', protect, restrict('admin'), async (req, res) => {
  try {
    const results = [];
    for (const tpl of DEFAULT_TEMPLATES) {
      const result = await WhatsAppTemplate.findOneAndUpdate(
        { type: tpl.type, ownerId: null },
        { $setOnInsert: { ...tpl, isSystem: true, ownerId: null } },
        { upsert: true, new: false, select: '_id' }
      );
      results.push({ type: tpl.type, status: result === null ? 'created' : 'skipped' });
    }
    const created = results.filter(r => r.status === 'created').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    res.status(201).json({ success: true, message: `Seed terminé : ${created} créé(s), ${skipped} ignoré(s)`, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur lors du seed' });
  }
});

module.exports = router;
