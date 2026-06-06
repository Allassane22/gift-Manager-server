// routes/whatsappTemplate.routes.js

const express = require('express');
const router = express.Router();

const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');

// ─── Textes par défaut (FCFA / Mali) ─────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  {
    type: 'reminder',
    label: 'Rappel expiration',
    body: `Bonjour {{prenom}} 👋

Votre abonnement *{{service}}* expire le *{{date}}*.
💰 Montant du renouvellement : *{{montant}} FCFA*

Renouvelez maintenant pour ne pas perdre l'accès ! ✅
Paiement via Wave / Orange Money au *{{numero}}*`,
  },
  {
    type: 'expired',
    label: 'Abonnement expiré',
    body: `Bonjour {{prenom}},

Votre abonnement *{{service}}* a expiré le *{{date}}*.
💰 Pour le renouveler : *{{montant}} FCFA*

Contactez-nous dès que possible 🙏
Paiement via Wave / Orange Money au *{{numero}}*`,
  },
  {
    type: 'renewal',
    label: 'Confirmation renouvellement',
    body: `Bonjour {{prenom}} ✅

Votre abonnement *{{service}}* a été renouvelé avec succès !
📅 Valable jusqu'au : *{{date}}*

Merci pour votre confiance 🎉`,
  },
  {
    type: 'payment_request',
    label: 'Demande de paiement',
    body: `Bonjour {{prenom}} 👋

Votre abonnement *{{service}}* est prêt.
💰 Montant : *{{montant}} FCFA*

Merci d'effectuer le paiement via Wave ou Orange Money au *{{numero}}* puis de nous envoyer la capture d'écran de confirmation. 📲`,
  },
  {
    type: 'payment_confirmed',
    label: 'Paiement confirmé',
    body: `Bonjour {{prenom}} ✅

Votre paiement de *{{montant}} FCFA* pour *{{service}}* a bien été reçu.
🎉 Votre accès est activé — bonne lecture !`,
  },
  {
    type: 'welcome',
    label: 'Bienvenue nouveau client',
    body: `Bonjour {{prenom}} 🎉

Bienvenue chez *Netflix and ɲɛnajɛ* !

Votre abonnement *{{service}}* est maintenant actif.
📅 Valable jusqu'au : *{{date}}*

Pour toute question, répondez simplement à ce message. Bonne lecture ! 🍿`,
  },
  {
    type: 'win_back',
    label: 'Reconquête client inactif',
    body: `Bonjour {{prenom}} 👋

Vous nous manquez ! 😊

Votre dernier abonnement *{{service}}* a expiré depuis un moment.
💰 Offre spéciale de retour : *{{montant}} FCFA*

Revenez profiter de vos contenus préférés !
Paiement via Wave / Orange Money au *{{numero}}* 🎬`,
  },
];

// ─── GET /api/whatsapp-templates ─────────────────────────────────────────────
// Admin → voit tous les templates (actifs + inactifs)
// Partner → voit uniquement les templates actifs
router.get('/', protect, restrict('admin', 'partner'), async (req, res) => {
  try {
    const filter = req.user.role === 'admin'
      ? { deletedAt: null }
      : { isActive: true, deletedAt: null };

    const templates = await WhatsAppTemplate.find(filter, '-__v').sort({ type: 1 });
    res.json({ success: true, data: templates });
  } catch (err) {
    console.error('[WhatsAppTemplates] GET /', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ─── GET /api/whatsapp-templates/:type ───────────────────────────────────────
// Accessible admin + partner
router.get('/:type', protect, restrict('admin', 'partner'), async (req, res) => {
  try {
    const template = await WhatsAppTemplate.findOne(
      { type: req.params.type, isActive: true, deletedAt: null },
      '-__v'
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        message: `Template "${req.params.type}" introuvable`,
      });
    }

    res.json({ success: true, data: template });
  } catch (err) {
    console.error('[WhatsAppTemplates] GET /:type', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ─── PUT /api/whatsapp-templates/:type ───────────────────────────────────────
// Admin seulement — modifie body, label et/ou isActive
router.put('/:type', protect, restrict('admin'), async (req, res) => {
  try {
    const { body, label, isActive } = req.body;

    // body est requis sauf si on fait uniquement un toggle isActive
    const onlyToggle = isActive !== undefined && body === undefined && label === undefined;
    if (!onlyToggle && (!body || typeof body !== 'string' || !body.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Le champ "body" est requis et ne peut pas être vide',
      });
    }

    // #32 : WhatsApp limite les messages à ~4096 caractères
    // Un body trop long génère des liens wa.me tronqués silencieusement
    const MAX_BODY_LENGTH = 4096;
    if (body && body.trim().length > MAX_BODY_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Le corps du template ne peut pas dépasser ${MAX_BODY_LENGTH} caractères (actuellement : ${body.trim().length})`,
      });
    }

    const update = {};
    if (body && typeof body === 'string' && body.trim()) {
      update.body = body.trim();
    }
    if (label && typeof label === 'string' && label.trim()) {
      update.label = label.trim();
    }
    // isActive est maintenant inclus dans l'update si présent
    if (isActive !== undefined) {
      update.isActive = Boolean(isActive);
    }

    const template = await WhatsAppTemplate.findOneAndUpdate(
      { type: req.params.type, deletedAt: null },
      { $set: update },
      { new: true, runValidators: true, select: '-__v' }
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        message: `Template "${req.params.type}" introuvable`,
      });
    }

    res.json({ success: true, data: template });
  } catch (err) {
    console.error('[WhatsAppTemplates] PUT /:type', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ─── POST /api/whatsapp-templates/seed ───────────────────────────────────────
// Admin seulement — initialise les 7 templates (idempotent).
// #34 : Utilise findOneAndUpdate avec upsert:true plutôt que findOne+create
// pour éviter la race condition entre vérification et insertion.
router.post('/seed', protect, restrict('admin'), async (req, res) => {
  try {
    const results = [];

    for (const tpl of DEFAULT_TEMPLATES) {
      const result = await WhatsAppTemplate.findOneAndUpdate(
        { type: tpl.type },                       // filtre : type unique
        { $setOnInsert: tpl },                    // n'écrit que si insertion (nouveau doc)
        { upsert: true, new: false, select: '_id' } // new:false → null si insertion
      );
      // result === null → document inséré ; result !== null → document existait déjà
      results.push({ type: tpl.type, status: result === null ? 'created' : 'skipped' });
    }

    const created = results.filter(r => r.status === 'created').length;
    const skipped = results.filter(r => r.status === 'skipped').length;

    res.status(201).json({
      success: true,
      message: `Seed terminé : ${created} créé(s), ${skipped} ignoré(s) (déjà existant)`,
      data: results,
    });
  } catch (err) {
    console.error('[WhatsAppTemplates] POST /seed', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors du seed' });
  }
});

module.exports = router;
