const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { z } = require("zod");
const { protect } = require("../middleware/auth.middleware");
const { restrict, ownDataOnly } = require("../middleware/rbac.middleware");
const { handleUpload, uploadSubscriptionProof } = require("../middleware/upload.middleware");
const {
  createSubscription,
  renewSubscription,
  migrateSubscription,
} = require("../services/allocation.service");
const { generateWhatsAppLink } = require("../services/whatsapp.service");
const Subscription = require("../models/Subscription");
const Profile = require("../models/Profile");
const Client = require("../models/Client");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

// Toutes les routes nécessitent d'être connecté
router.use(protect);

function normalizeSubscriptionFields(payload = {}) {
  const normalized = { ...payload };

  [
    "clientId",
    "accountId",
    "profileId",
    "partnerId",
    "newAccountId",
    "newProfileId",
  ].forEach((key) => {
    if (typeof normalized[key] === "string")
      normalized[key] = normalized[key].trim() || null;
  });

  ["purchasePrice", "pricePaid", "commissionValue", "newPricePaid"].forEach(
    (key) => {
      if (
        normalized[key] !== undefined &&
        normalized[key] !== null &&
        normalized[key] !== ""
      ) {
        normalized[key] = Number(normalized[key]);
      }
    },
  );

  if (typeof normalized.service === "string")
    normalized.service = normalized.service.trim();
  if (typeof normalized.commissionType === "string")
    normalized.commissionType = normalized.commissionType.trim();
  if (typeof normalized.reason === "string")
    normalized.reason = normalized.reason.trim() || "";

  return normalized;
}

function ensureValidObjectId(id, label = "Identifiant invalide") {
  return mongoose.isValidObjectId(id)
    ? null
    : { success: false, message: label };
}

// ─── Schéma Zod : création d'abonnement (#27) ─────────────────────────────────
// Valide les champs non couverts par les checks manuels existants
// (commissionType, commissionValue, notes, service longueur, etc.)
const createSubscriptionSchema = z.object({
  clientId:        z.string().min(1, 'clientId requis'),
  service:         z.string().min(1, 'service requis').max(100, 'service trop long'),
  endDate:         z.string().min(1, 'endDate requise'),
  purchasePrice:   z.number({ invalid_type_error: 'purchasePrice doit être un nombre' }).min(0),
  pricePaid:       z.number({ invalid_type_error: 'pricePaid doit être un nombre' }).min(0),
  accountId:       z.string().optional().nullable(),
  profileId:       z.string().optional().nullable(),
  partnerId:       z.string().optional().nullable(),
  startDate:       z.string().optional().nullable(),
  commissionType:  z.enum(['fixed', 'percentage', 'none']).optional().default('none'),
  commissionValue: z.number().min(0).optional().default(0),
  notes:           z.string().max(500, 'notes trop longues (max 500 car.)').optional(),
});

// ─── GET /api/subscriptions ───────────────────────────────────────────────────
// Filtres: ?partnerId=&status=&service=&page=&limit=&expiringSoon=true
router.get("/", ownDataOnly, async (req, res, next) => {
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

    if (expiringSoon === "true") {
      const in7Days = dayjs.utc().add(7, "day").toDate();
      filter.endDate = { $lte: in7Days };
      filter.status = "active";
    }

    // FIX M-05: résoudre les accountIds avant pagination pour éviter les résultats tronqués
    if (service) {
      const Account = require("../models/Account");
      const matchingAccounts = await Account.find({ service, deletedAt: null }, "_id");
      filter.accountId = { $in: matchingAccounts.map((a) => a._id) };
    }

    const subscriptions = await Subscription.find(filter)
      .populate("clientId", "name phone email")
      .populate("accountId", "service type email password maxSlots")
      .populate("profileId", "name pin")
      .populate("partnerId", "name email")
      .sort({ endDate: 1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Subscription.countDocuments(filter);

    res.json({
      success: true,
      data: subscriptions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/subscriptions/:id ───────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(
      req.params.id,
      "ID d'abonnement invalide",
    );
    if (invalidId) return res.status(400).json(invalidId);

    // Les admins voient le mot de passe du compte, les partenaires non
    const accountFields = req.user.role === "admin"
      ? "service type email password"
      : "service type email";

    const sub = await Subscription.findById(req.params.id)
      .populate("clientId", "name phone email")
      .populate("accountId", accountFields)
      .populate("profileId", "name pin")
      .populate("partnerId", "name email");

    if (!sub)
      return res
        .status(404)
        .json({ success: false, message: "Abonnement introuvable" });

    // Un partenaire ne peut consulter que ses propres abonnements
    if (req.user.role === "partner" &&
        String(sub.partnerId?._id || sub.partnerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Accès refusé" });
    }

    const waLink = await generateWhatsAppLink({
      phone: sub.clientId?.phone,
      clientName: sub.clientId?.name,
      service: sub.accountId?.service,
      endDate: sub.endDate,
      amount: sub.pricePaid,
      type: sub.status === "overdue" ? "expired" : "reminder",
      profileName: sub.profileId?.name,
      pin: sub.profileId?.pin,
      accountEmail: sub.accountId?.email,
      accountPassword: sub.accountId?.password,
    });

    res.json({
      success: true,
      data: { ...sub.toJSON(), whatsappLink: waLink },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/subscriptions/:id/proof ───────────────────────────────────────
// FIX M-01: utiliser handleUpload(uploadSubscriptionProof) au lieu de uploadSubscriptionProof directement
router.post(
  "/:id/proof",
  restrict("admin"),
  handleUpload(uploadSubscriptionProof),
  async (req, res, next) => {
    try {
      const invalidId = ensureValidObjectId(
        req.params.id,
        "ID abonnement invalide",
      );
      if (invalidId) return res.status(400).json(invalidId);
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "Fichier requis" });
      const sub = await Subscription.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            proofUrl: req.file.path || req.file.filename,
            proofUploadedAt: new Date(),
          },
        },
        { new: true },
      );
      if (!sub)
        return res
          .status(404)
          .json({ success: false, message: "Abonnement introuvable" });
      res.json({ success: true, data: sub, message: "Preuve enregistrée" });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/subscriptions ──────────────────────────────────────────────────
router.post("/", restrict("admin", "partner"), async (req, res, next) => {
  try {
    const normalized = normalizeSubscriptionFields(req.body);

    // ── Validation Zod (#27) ──────────────────────────────────────────────────
    const parsed = createSubscriptionSchema.safeParse(normalized);
    if (!parsed.success) {
      const message = parsed.error.issues.map(i => i.message).join(', ');
      return res.status(400).json({ success: false, message });
    }

    let {
      clientId,
      service,
      accountId,
      profileId,
      partnerId,
      startDate,
      endDate,
      purchasePrice,
      pricePaid,
      commissionType,
      commissionValue,
    } = parsed.data;

    // ── Si partenaire : vérifier que le compte lui est bien assigné ───────────
    if (req.user.role === 'partner') {
      const Account = require('../models/Account');
      const account = await Account.findById(accountId);
      if (!account || String(account.assignedPartner) !== String(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Ce compte ne vous est pas assigné',
        });
      }
      // Le partenaire est automatiquement le partnerId
      partnerId = req.user._id;
    }

    // status optionnel : seul 'pending_payment' est accepté à la création
    const rawStatus = req.body.status;
    const initialStatus = rawStatus === 'pending_payment' ? 'pending_payment' : 'active';

    // ── Validation des dates ──────────────────────────────────────────────────
    const parsedStart = dayjs.utc(startDate || new Date());
    const parsedEnd   = dayjs.utc(endDate);
    if (!parsedEnd.isValid()) {
      return res.status(400).json({ success: false, message: "Date de fin invalide" });
    }
    if (parsedEnd.isBefore(parsedStart)) {
      return res.status(400).json({
        success: false,
        message: "La date de fin doit être postérieure à la date de début",
      });
    }
    // Tolérance J-1 pour les créations rétroactives le même jour selon fuseau horaire
    if (parsedEnd.isBefore(dayjs.utc().subtract(1, "day"))) {
      return res.status(400).json({
        success: false,
        message: "La date de fin ne peut pas être dans le passé",
      });
    }

    const subscription = await createSubscription({
      clientId,
      service,
      accountId,
      profileId,
      partnerId,
      startDate: startDate || new Date(),
      endDate,
      purchasePrice: Number(purchasePrice),
      pricePaid: Number(pricePaid),
      commissionType,
      commissionValue: Number(commissionValue || 0),
      doneBy: req.user._id,
      initialStatus,
    });

    // ── Màj nom + PIN du profil si fournis ───────────────────────────────────
    const profileName = req.body.profileName?.trim();
    const profilePin  = req.body.profilePin?.trim();
    if (profileName || profilePin) {
      const updates = {};
      if (profileName) updates.name = profileName;
      if (profilePin)  updates.pin  = profilePin;
      await Profile.findByIdAndUpdate(subscription.profileId, { $set: updates }).catch((err) => {
        console.warn('[subscription] ⚠️ Màj nom/PIN profil échouée (non bloquant):', err.message);
      });
    }

    res
      .status(201)
      .json({
        success: true,
        data: subscription,
        message: "Abonnement créé avec succès",
      });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/subscriptions/:id ───────────────────────────────────────────────
// Modification d'un abonnement existant : date de fin et prix uniquement.
// Le client, le compte et le profil ne peuvent pas être changés ici
// (utiliser /migrate pour changer de compte/profil).
router.put("/:id", restrict("admin"), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(req.params.id, "ID d'abonnement invalide");
    if (invalidId) return res.status(400).json(invalidId);

    const { endDate, pricePaid, purchasePrice, notes } = normalizeSubscriptionFields(req.body);

    if (!endDate) {
      return res.status(400).json({ success: false, message: "La date de fin est requise" });
    }
    if (pricePaid !== undefined && pricePaid !== null && Number.isNaN(pricePaid)) {
      return res.status(400).json({ success: false, message: "Prix invalide" });
    }

    // Validation date de fin
    const parsedEnd = dayjs.utc(endDate);
    if (!parsedEnd.isValid()) {
      return res.status(400).json({ success: false, message: "Date de fin invalide" });
    }
    if (parsedEnd.isBefore(dayjs.utc().subtract(1, "day"))) {
      return res.status(400).json({
        success: false,
        message: "La date de fin ne peut pas être dans le passé",
      });
    }

    const sub = await Subscription.findById(req.params.id);
    if (!sub) return res.status(404).json({ success: false, message: "Abonnement introuvable" });

    const oldPricePaid = sub.pricePaid;

    // Mise à jour des champs autorisés
    sub.endDate = endDate;
    if (pricePaid !== undefined && pricePaid !== null) sub.pricePaid = pricePaid;
    if (purchasePrice !== undefined && purchasePrice !== null) sub.purchasePrice = purchasePrice;
    if (notes !== undefined) sub.notes = notes;
    sub.status = "active";

    sub.history.push({
      action: "updated",
      note: `Modification manuelle`,
      doneBy: req.user._id,
      at: new Date(),
    });

    await sub.save();

    // Ajuster stats client si pricePaid a changé
    if (pricePaid !== undefined && pricePaid !== null && pricePaid !== oldPricePaid) {
      await Client.findByIdAndUpdate(sub.clientId, {
        $inc: { totalPaid: pricePaid - oldPricePaid },
      }).catch((err) => {
        console.error('[subscription.put] ⚠️ Stats client non mises à jour — dérive possible:', err.message, { subId: req.params.id });
      });
    }

    res.json({ success: true, data: sub, message: "Abonnement mis à jour" });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/subscriptions/:id/renew ──────────────────────────────────────
router.patch("/:id/renew", restrict("admin"), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(
      req.params.id,
      "ID d'abonnement invalide",
    );
    if (invalidId) return res.status(400).json(invalidId);

    const { newEndDate, newPricePaid } = normalizeSubscriptionFields(req.body);
    if (!newEndDate)
      return res
        .status(400)
        .json({ success: false, message: "Nouvelle date requise" });
    if (
      newPricePaid !== undefined &&
      newPricePaid !== null &&
      Number.isNaN(newPricePaid)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Nouveau montant invalide" });
    }

    const subscription = await renewSubscription({
      subscriptionId: req.params.id,
      newEndDate,
      newPricePaid: newPricePaid ? Number(newPricePaid) : undefined,
      doneBy: req.user._id,
    });

    res.json({
      success: true,
      data: subscription,
      message: "Renouvellement effectué",
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/subscriptions/:id/migrate ────────────────────────────────────
router.patch("/:id/migrate", restrict("admin"), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(
      req.params.id,
      "ID d'abonnement invalide",
    );
    if (invalidId) return res.status(400).json(invalidId);

    const { newAccountId, newProfileId, reason } = normalizeSubscriptionFields({
      newAccountId: req.body.newAccountId,
      newProfileId: req.body.newProfileId,
      reason: req.body.reason,
    });
    if (!newAccountId || !newProfileId) {
      return res
        .status(400)
        .json({ success: false, message: "Nouveau compte et profil requis" });
    }
    if (
      !mongoose.isValidObjectId(newAccountId) ||
      !mongoose.isValidObjectId(newProfileId)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "IDs de migration invalides" });
    }

    const subscription = await migrateSubscription({
      subscriptionId: req.params.id,
      newAccountId,
      newProfileId,
      reason,
      doneBy: req.user._id,
    });

    res.json({
      success: true,
      data: subscription,
      message: "Migration effectuée",
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/subscriptions/:id/status ─────────────────────────────────────
router.patch("/:id/status", restrict("admin"), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(
      req.params.id,
      "ID d'abonnement invalide",
    );
    if (invalidId) return res.status(400).json(invalidId);

    const { status } = req.body;
    // FIX Mi-06: ajout de overdue et pending_payment
    const allowed = ["active", "overdue", "suspended", "cancelled", "pending_payment"];
    if (!allowed.includes(status)) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Statut invalide. Valeurs: ${allowed.join(", ")}`,
        });
    }

    const sub = await Subscription.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true },
    );
    if (!sub)
      return res.status(404).json({ success: false, message: "Introuvable" });

    res.json({ success: true, data: sub });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/subscriptions/:id (soft delete) ─────────────────────────────
router.delete("/:id", restrict("admin"), async (req, res, next) => {
  try {
    const invalidId = ensureValidObjectId(
      req.params.id,
      "ID d'abonnement invalide",
    );
    if (invalidId) return res.status(400).json(invalidId);

    const sub = await Subscription.findById(req.params.id);
    if (!sub)
      return res.status(404).json({ success: false, message: "Introuvable" });

    // Ne décrémenter que si l'abonnement n'est pas déjà annulé
    const alreadyCancelled = sub.status === "cancelled";

    await Subscription.findByIdAndUpdate(
      req.params.id,
      { $set: { deletedAt: new Date(), status: "cancelled" } },
    );

    // Libérer le profil
    if (sub.profileId && sub.clientId) {
      await Profile.findByIdAndUpdate(sub.profileId, {
        $pull: { assignedClients: sub.clientId },
      });
    }

    // Décrémenter stats client et partenaire uniquement si pas déjà annulé
    if (!alreadyCancelled) {
      if (sub.clientId) {
        await Client.findByIdAndUpdate(sub.clientId, {
          $inc: {
            totalPaid: -sub.pricePaid,
            totalSubscriptions: -1,
          },
        }).catch((err) => {
          console.error('[subscription.delete] ⚠️ Stats client non décrémentées:', err.message, { subId: req.params.id });
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
          console.error('[subscription.delete] ⚠️ Stats partenaire non décrémentées:', err.message, { subId: req.params.id });
        });
      }
    }

    // ── #33 : Audit log ───────────────────────────────────────────────────────
    await AuditLog.create({
      userId: req.user._id,
      action: 'DELETE_SUBSCRIPTION',
      targetModel: 'Subscription',
      targetId: sub._id,
      details: { clientId: sub.clientId, partnerId: sub.partnerId, status: sub.status },
    }).catch((err) => {
      console.error('[subscription.delete] ⚠️ AuditLog non enregistré:', err.message);
    });

    res.json({ success: true, message: "Abonnement annulé" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;