const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const { restrict } = require("../middleware/rbac.middleware");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const Account = require("../models/Account");
const PartnerBilling = require("../models/PartnerBilling");
const Client = require("../models/Client");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

router.use(protect);

function normalizePartnerFields(payload = {}) {
  const normalized = { ...payload };
  if (typeof normalized.name === "string") normalized.name = normalized.name.trim();
  if (typeof normalized.email === "string") normalized.email = normalized.email.trim().toLowerCase();
  if (typeof normalized.phone === "string") normalized.phone = normalized.phone.trim() || "";
  if (typeof normalized.password === "string") normalized.password = normalized.password.trim();
  return normalized;
}

// ─── GET /api/partners — admin seulement ─────────────────────────────────────
router.get("/", restrict("admin"), async (req, res, next) => {
  try {
    const partners = await User.find({ role: "partner" })
      .select("-password -refreshToken -twoFASecret")
      .sort({ totalRevenue: -1 });
    res.json({ success: true, data: partners });
  } catch (err) { next(err); }
});

// ─── GET /api/partners/me — partenaire connecté voit son profil ───────────────
router.get("/me", restrict("partner"), async (req, res, next) => {
  try {
    const partner = await User.findById(req.user._id).select("-password -refreshToken -twoFASecret");
    if (!partner) return res.status(404).json({ success: false, message: "Partenaire introuvable" });
    res.json({ success: true, data: partner });
  } catch (err) { next(err); }
});

// ─── GET /api/partners/dashboard — dashboard partenaire ──────────────────────
router.get("/dashboard", restrict("partner"), async (req, res, next) => {
  try {
    const partnerId = req.user._id;
    const now = dayjs.utc();
    const startOfMonth = now.startOf("month").toDate();

    // Abonnements du partenaire
    const subs = await Subscription.find({ partnerId, deletedAt: null })
      .populate("clientId", "name phone")
      .populate("accountId", "service type email")
      .populate("profileId", "name")
      .sort({ endDate: 1 });

    // Stats clés
    const activeSubs    = subs.filter(s => s.status === "active" || s.status === "expiring_soon");
    const expiringSoon  = subs.filter(s => {
      const days = dayjs.utc(s.endDate).diff(now, "day");
      return (s.status === "active" || s.status === "expiring_soon") && days >= 0 && days <= 7;
    });
    const overdueSubs   = subs.filter(s => s.status === "overdue");
    const monthSubs     = subs.filter(s => new Date(s.createdAt) >= startOfMonth);

    const mrr           = activeSubs.reduce((acc, s) => acc + (s.pricePaid || 0), 0);
    const monthRevenue  = monthSubs.reduce((acc, s) => acc + (s.pricePaid || 0), 0);
    const monthProfit   = monthSubs.reduce((acc, s) => acc + (s.profit || 0), 0);

    // Revenus par service
    const byService = {};
    for (const sub of subs) {
      const svc = sub.accountId?.service || "Inconnu";
      if (!byService[svc]) byService[svc] = { revenue: 0, profit: 0, count: 0 };
      byService[svc].revenue += sub.pricePaid || 0;
      byService[svc].profit  += sub.profit    || 0;
      byService[svc].count   += 1;
    }

    // Comptes assignés
    const accounts = await Account.find({ assignedPartner: partnerId, deletedAt: null });

    // Clients du partenaire
    const clientCount = await Client.countDocuments({ referredBy: partnerId, deletedAt: null });

    // Facturation — ce que le partenaire doit à l'admin
    const billings = await PartnerBilling.find({ partnerId, unassignedAt: null }).populate("accountId", "service type email");
    let totalOwed = 0;
    const billingDetails = billings.map(b => {
      const { total, breakdown } = b.computeOwed();
      totalOwed += total;
      return {
        account: b.accountId,
        assignedAt: b.assignedAt,
        firstMonthPrice: b.firstMonthPrice,
        monthlyPrice: b.monthlyPrice,
        promos: b.promos,
        owed: total,
        breakdown,
      };
    });

    res.json({
      success: true,
      data: {
        stats: {
          mrr,
          monthRevenue,
          monthProfit,
          activeSubs: activeSubs.length,
          expiringSoon: expiringSoon.length,
          overdueSubs: overdueSubs.length,
          clientCount,
          accountCount: accounts.length,
          totalOwed,
        },
        byService: Object.entries(byService).map(([service, data]) => ({ service, ...data })),
        expiringSoon,
        billing: billingDetails,
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /api/partners/:id/stats — admin seulement ───────────────────────────
router.get("/:id/stats", restrict("admin"), async (req, res, next) => {
  try {
    const partner = await User.findById(req.params.id).select("-password");
    if (!partner) return res.status(404).json({ success: false, message: "Partenaire introuvable" });

    const subs = await Subscription.find({ partnerId: req.params.id, deletedAt: null })
      .populate("clientId", "name")
      .populate("accountId", "service");

    // Facturation complète
    const billings = await PartnerBilling.find({ partnerId: req.params.id }).populate("accountId", "service type email");
    let totalOwed = 0;
    const billingDetails = billings.map(b => {
      const { total, breakdown } = b.computeOwed();
      totalOwed += total;
      return {
        _id: b._id,
        account: b.accountId,
        assignedAt: b.assignedAt,
        unassignedAt: b.unassignedAt,
        firstMonthPrice: b.firstMonthPrice,
        monthlyPrice: b.monthlyPrice,
        promos: b.promos,
        owed: total,
        breakdown,
      };
    });

    const stats = {
      totalRevenue: partner.totalRevenue,
      totalCommission: partner.totalCommission,
      totalSubscriptions: partner.totalSubscriptions,
      activeSubscriptions: subs.filter(s => s.status === "active").length,
      overdueSubscriptions: subs.filter(s => s.status === "overdue").length,
      totalOwed,
      revenueByService: subs.reduce((acc, s) => {
        const svc = s.accountId?.service || "Inconnu";
        acc[svc] = (acc[svc] || 0) + s.pricePaid;
        return acc;
      }, {}),
    };

    res.json({ success: true, data: { partner, stats, subscriptions: subs, billing: billingDetails } });
  } catch (err) { next(err); }
});

// ─── POST /api/partners — créer un compte partenaire (admin) ─────────────────
router.post("/", restrict("admin"), async (req, res, next) => {
  try {
    const { name, email, password, phone } = normalizePartnerFields(req.body);
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Nom, email et mot de passe requis" });
    }
    const partner = await User.create({ name, email, password, phone, role: "partner" });
    res.status(201).json({ success: true, data: { id: partner._id, name: partner.name, email: partner.email, role: partner.role } });
  } catch (err) { next(err); }
});

// ─── PUT /api/partners/:id — modifier un partenaire (admin) ──────────────────
router.put("/:id", restrict("admin"), async (req, res, next) => {
  try {
    const { name, phone, isActive, email, password } = normalizePartnerFields(req.body);
    const update = { $set: { name, phone, isActive, email } };
    const partner = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select("-password");
    if (!partner) return res.status(404).json({ success: false, message: "Partenaire introuvable" });
    if (password && password.length >= 8) {
      const full = await User.findById(req.params.id);
      full.password = password;
      await full.save();
    }
    res.json({ success: true, data: partner });
  } catch (err) { next(err); }
});

// ─── DELETE /api/partners/:id — désactiver un partenaire (admin) ─────────────
router.delete("/:id", restrict("admin"), async (req, res, next) => {
  try {
    const partner = await User.findById(req.params.id);
    if (!partner) return res.status(404).json({ success: false, message: "Partenaire introuvable" });
    await User.findByIdAndUpdate(req.params.id, { $set: { isActive: false, deletedAt: new Date() } });
    res.json({ success: true, message: "Partenaire désactivé" });
  } catch (err) { next(err); }
});

// ─── POST /api/partners/:id/assign-account — assigner un compte (admin) ──────
router.post("/:id/assign-account", restrict("admin"), async (req, res, next) => {
  try {
    const { accountId, firstMonthPrice = 7500, monthlyPrice = 10000 } = req.body;
    if (!accountId) return res.status(400).json({ success: false, message: "accountId requis" });

    const partner = await User.findById(req.params.id);
    if (!partner || partner.role !== "partner") {
      return res.status(404).json({ success: false, message: "Partenaire introuvable" });
    }

    const account = await Account.findById(accountId);
    if (!account) return res.status(404).json({ success: false, message: "Compte introuvable" });

    // Assigner le compte au partenaire
    account.assignedPartner = req.params.id;
    await account.save();

    // Créer l'enregistrement de facturation
    const billing = await PartnerBilling.create({
      partnerId: req.params.id,
      accountId,
      firstMonthPrice: Number(firstMonthPrice),
      monthlyPrice: Number(monthlyPrice),
      assignedAt: new Date(),
    });

    res.status(201).json({ success: true, data: { account, billing } });
  } catch (err) { next(err); }
});

// ─── DELETE /api/partners/:id/assign-account/:accountId — retirer un compte ──
router.delete("/:id/assign-account/:accountId", restrict("admin"), async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.accountId);
    if (!account) return res.status(404).json({ success: false, message: "Compte introuvable" });

    account.assignedPartner = null;
    await account.save();

    // Marquer la facturation comme terminée
    await PartnerBilling.findOneAndUpdate(
      { partnerId: req.params.id, accountId: req.params.accountId, unassignedAt: null },
      { $set: { unassignedAt: new Date() } }
    );

    res.json({ success: true, message: "Compte retiré du partenaire" });
  } catch (err) { next(err); }
});

// ─── POST /api/partners/billing/:billingId/promo — ajouter une promo (admin) ─
router.post("/billing/:billingId/promo", restrict("admin"), async (req, res, next) => {
  try {
    const { month, price, label } = req.body;
    // month = YYYYMM ex: 202506
    if (!month || price === undefined) {
      return res.status(400).json({ success: false, message: "month (YYYYMM) et price requis" });
    }

    const billing = await PartnerBilling.findById(req.params.billingId);
    if (!billing) return res.status(404).json({ success: false, message: "Facturation introuvable" });

    // Remplacer si promo existe déjà pour ce mois, sinon ajouter
    const existingIdx = billing.promos.findIndex(p => p.month === Number(month));
    if (existingIdx >= 0) {
      billing.promos[existingIdx] = { month: Number(month), price: Number(price), label };
    } else {
      billing.promos.push({ month: Number(month), price: Number(price), label });
    }
    await billing.save();

    const { total, breakdown } = billing.computeOwed();
    res.json({ success: true, data: { billing, owed: total, breakdown } });
  } catch (err) { next(err); }
});

// ─── DELETE /api/partners/billing/:billingId/promo/:month — retirer une promo ─
router.delete("/billing/:billingId/promo/:month", restrict("admin"), async (req, res, next) => {
  try {
    const billing = await PartnerBilling.findById(req.params.billingId);
    if (!billing) return res.status(404).json({ success: false, message: "Facturation introuvable" });

    billing.promos = billing.promos.filter(p => p.month !== Number(req.params.month));
    await billing.save();

    const { total, breakdown } = billing.computeOwed();
    res.json({ success: true, data: { billing, owed: total, breakdown } });
  } catch (err) { next(err); }
});

module.exports = router;
