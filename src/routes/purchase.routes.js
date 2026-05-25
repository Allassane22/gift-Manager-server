const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');
const { handleUpload, uploadPurchaseProof } = require('../middleware/upload.middleware');
const Purchase = require('../models/Purchase');
const Client = require('../models/Client');
const AuditLog = require('../models/AuditLog');
const { ROBUX_CATALOG } = require('../models/Purchase');

router.use(protect);

function ensureValidObjectId(id, label = 'Identifiant invalide') {
  return mongoose.isValidObjectId(id) ? null : { success: false, message: label };
}

// ─── GET /api/purchases/catalog ──────────────────────────────────────────────
// Retourne le catalogue Robux (quantités + prix conseillés)
router.get('/catalog', (req, res) => {
  const catalog = Object.entries(ROBUX_CATALOG).map(([qty, price]) => ({
    product: `Robux ${qty}`,
    quantity: Number(qty),
    suggestedPrice: price,
  }));
  // Ajouter l'abonnement Robux mensuel
  catalog.unshift({ product: 'Robux Abonnement', quantity: null, suggestedPrice: 7000 });
  res.json({ success: true, data: catalog });
});

// ─── GET /api/purchases ───────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { clientId, status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (clientId) filter.clientId = clientId;
    if (status) filter.status = status;

    const purchases = await Purchase.find(filter)
      .populate('clientId', 'name phone')
      .populate('partnerId', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Purchase.countDocuments(filter);

    res.json({
      success: true,
      data: purchases,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/purchases/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, "ID d'achat invalide");
    if (invalidId) return res.status(400).json(invalidId);

    const purchase = await Purchase.findById(req.params.id)
      .populate('clientId', 'name phone email')
      .populate('partnerId', 'name email');

    if (!purchase) return res.status(404).json({ success: false, message: 'Achat introuvable' });

    res.json({ success: true, data: purchase });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/purchases ──────────────────────────────────────────────────────
router.post('/', restrict('admin'), async (req, res, next) => {
  try {
    const {
      clientId, service = 'Robux', product, quantity,
      purchasePrice, pricePaid,
      partnerId, commissionType, commissionValue,
      notes,
    } = req.body;

    if (!clientId || !product || purchasePrice === undefined || pricePaid === undefined) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants (clientId, product, purchasePrice, pricePaid)' });
    }

    const invalidClient = ensureValidObjectId(clientId, 'clientId invalide');
    if (invalidClient) return res.status(400).json(invalidClient);

    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable' });

    const purchase = await Purchase.create({
      clientId,
      service,
      product: String(product).trim(),
      quantity: quantity ? Number(quantity) : null,
      purchasePrice: Number(purchasePrice),
      pricePaid: Number(pricePaid),
      partnerId: partnerId || null,
      commissionType: commissionType || 'none',
      commissionValue: Number(commissionValue || 0),
      notes: notes || '',
    });

    // Mise à jour stats client
    await Client.findByIdAndUpdate(clientId, {
      $inc: { totalPaid: Number(pricePaid) },
    });

    await AuditLog.create({
      userId: req.user._id,
      action: 'create_purchase',
      targetModel: 'Purchase',
      targetId: purchase._id,
      details: { product: purchase.product, pricePaid: purchase.pricePaid },
    });

    const populated = await Purchase.findById(purchase._id)
      .populate('clientId', 'name phone')
      .populate('partnerId', 'name');

    res.status(201).json({ success: true, data: populated, message: 'Achat enregistré' });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/purchases/:id/status ─────────────────────────────────────────
router.patch('/:id/status', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, "ID d'achat invalide");
    if (invalidId) return res.status(400).json(invalidId);

    const { status } = req.body;
    const allowed = ['pending', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Statut invalide. Valeurs: ${allowed.join(', ')}` });
    }

    const purchase = await Purchase.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    ).populate('clientId', 'name phone');

    if (!purchase) return res.status(404).json({ success: false, message: 'Introuvable' });

    res.json({ success: true, data: purchase });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/purchases/:id (soft delete) ──────────────────────────────────
router.delete('/:id', restrict('admin'), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, "ID d'achat invalide");
    if (invalidId) return res.status(400).json(invalidId);

    const purchase = await Purchase.findByIdAndUpdate(
      req.params.id,
      { $set: { deletedAt: new Date(), status: 'cancelled' } },
      { new: true }
    );
    if (!purchase) return res.status(404).json({ success: false, message: 'Introuvable' });

    // Décrémenter stats client si annulé
    await Client.findByIdAndUpdate(purchase.clientId, {
      $inc: { totalPaid: -purchase.pricePaid },
    });

    res.json({ success: true, message: 'Achat annulé' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/purchases/:id/proof ───────────────────────────────────────────
// Upload d'une preuve de paiement → passe pending_payment → pending (prêt à livrer)
router.post(
  '/:id/proof',
  handleUpload(uploadPurchaseProof),
  async (req, res, next) => {
    try {
      const invalidId = ensureValidObjectId(req.params.id, "ID d'achat invalide");
      if (invalidId) return res.status(400).json(invalidId);

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
      }

      const purchase = await Purchase.findById(req.params.id);
      if (!purchase) return res.status(404).json({ success: false, message: 'Achat introuvable' });

      purchase.paymentProofUrl = req.file.path;
      if (purchase.status === 'pending_payment') purchase.status = 'pending';
      await purchase.save();

      res.json({ success: true, data: purchase, message: 'Preuve enregistrée' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
