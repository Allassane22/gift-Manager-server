const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const { restrict } = require("../middleware/rbac.middleware");
const User = require("../models/User");
const Subscription = require("../models/Subscription");

router.use(protect, restrict("admin"));

function normalizePartnerFields(payload = {}) {
  const normalized = { ...payload };

  if (typeof normalized.name === "string") normalized.name = normalized.name.trim();
  if (typeof normalized.email === "string") normalized.email = normalized.email.trim().toLowerCase();
  if (typeof normalized.phone === "string") normalized.phone = normalized.phone.trim() || "";
  if (typeof normalized.password === "string") normalized.password = normalized.password.trim();

  return normalized;
}

// GET /api/partners
router.get("/", async (req, res, next) => {
  try {
    const partners = await User.find({ role: "partner" })
      .select("-password -refreshToken -twoFASecret")
      .sort({ totalRevenue: -1 });

    res.json({ success: true, data: partners });
  } catch (err) {
    next(err);
  }
});

// GET /api/partners/:id/stats
router.get("/:id/stats", async (req, res, next) => {
  try {
    const partner = await User.findById(req.params.id).select("-password");
    if (!partner)
      return res
        .status(404)
        .json({ success: false, message: "Partenaire introuvable" });

    const subs = await Subscription.find({ partnerId: req.params.id })
      .populate("clientId", "name")
      .populate("accountId", "service");

    const stats = {
      totalRevenue: partner.totalRevenue,
      totalCommission: partner.totalCommission,
      totalSubscriptions: partner.totalSubscriptions,
      activeSubscriptions: subs.filter((s) => s.status === "active").length,
      overdueSubscriptions: subs.filter((s) => s.status === "overdue").length,
      revenueByService: subs.reduce((acc, s) => {
        const svc = s.accountId?.service || "Inconnu";
        acc[svc] = (acc[svc] || 0) + s.pricePaid;
        return acc;
      }, {}),
    };

    res.json({ success: true, data: { partner, stats, subscriptions: subs } });
  } catch (err) {
    next(err);
  }
});

// POST /api/partners (créer un compte partenaire)
router.post("/", async (req, res, next) => {
  try {
    const { name, email, password, phone } = normalizePartnerFields(req.body);
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Nom, email et mot de passe requis" });
    }
    const partner = await User.create({
      name,
      email,
      password,
      phone,
      role: "partner",
    });
    res.status(201).json({
      success: true,
      data: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        role: partner.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/partners/:id
router.put("/:id", async (req, res, next) => {
  try {
    const { name, phone, isActive, email, password } = normalizePartnerFields(req.body);
    const update = { $set: { name, phone, isActive, email } };
    const partner = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
    }).select("-password");
    if (!partner)
      return res
        .status(404)
        .json({ success: false, message: "Partenaire introuvable" });
    // Changer le mot de passe séparément si fourni
    if (password && password.length >= 8) {
      const full = await User.findById(req.params.id);
      full.password = password;
      await full.save();
    }
    res.json({ success: true, data: partner });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/partners/:id (soft delete)
router.delete("/:id", async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.params.id, {
      $set: { isActive: false, deletedAt: new Date() },
    });
    res.json({ success: true, message: "Partenaire désactivé" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
