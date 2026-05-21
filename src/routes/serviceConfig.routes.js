const express = require('express');
const router = express.Router();
const ServiceConfig = require('../models/ServiceConfig');

// ─── Catalogue initial (17 entrées) ──────────────────────────────────────────
const SEED_CATALOG = [
  // Netflix
  { service: 'Netflix',       type: 'Essentiel',  maxSlots: 5, price: 3500  },
  { service: 'Netflix',       type: 'Premium',    maxSlots: 1, price: 5500  },
  { service: 'Netflix',       type: 'Royal',      maxSlots: 1, price: 7000  },
  // Prime Video
  { service: 'Prime Video',   type: 'Essentiel',  maxSlots: 6, price: 2000  },
  { service: 'Prime Video',   type: 'Premium',    maxSlots: 1, price: 3500  },
  // Spotify
  { service: 'Spotify',       type: 'Family',     maxSlots: 6, price: 2500  },
  { service: 'Spotify',       type: 'Étudiant',   maxSlots: 1, price: 1500  },
  { service: 'Spotify',       type: 'Personnel',  maxSlots: 1, price: 2000  },
  // Apple Music
  { service: 'Apple Music',   type: 'Family',     maxSlots: 6, price: 2500  },
  { service: 'Apple Music',   type: 'Personnel',  maxSlots: 1, price: 2000  },
  // Snapchat+
  { service: 'Snapchat+',     type: 'Personnel',  maxSlots: 1, price: 1500  },
  // PlayStation
  { service: 'PlayStation',   type: 'Duo',        maxSlots: 2, price: 4000  },
  { service: 'PlayStation',   type: 'Personnel',  maxSlots: 1, price: 3000  },
  // Xbox
  { service: 'Xbox',          type: 'Duo',        maxSlots: 2, price: 4000  },
  { service: 'Xbox',          type: 'Personnel',  maxSlots: 1, price: 3000  },
  // Nintendo
  { service: 'Nintendo',      type: 'Personnel',  maxSlots: 1, price: 3000  },
  { service: 'Nintendo',      type: 'Duo',        maxSlots: 2, price: 4500  },
];

// ─── GET /api/service-configs ─────────────────────────────────────────────────
// Retourne les services GROUPÉS par nom de service.
// Format de réponse :
// [
//   { service: "Netflix", types: [{ type, maxSlots, price, _id }, ...] },
//   { service: "Spotify", types: [...] },
// ]
// Le frontend peut ainsi faire :
//   const selectedConfig = configs.find(s => s.service === form.service)
//   const types = selectedConfig.types  → [{ type, maxSlots, price }]
router.get('/', async (req, res, next) => {
  try {
    const { isActive } = req.query;
    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const configs = await ServiceConfig.find(filter).sort({ service: 1, type: 1 });

    // Grouper par service
    const grouped = [];
    const map = {};

    configs.forEach((doc) => {
      if (!map[doc.service]) {
        map[doc.service] = {
          service: doc.service,
          icon: doc.icon || '',
          color: doc.color || '',
          isActive: doc.isActive,
          types: [],
        };
        grouped.push(map[doc.service]);
      }
      map[doc.service].types.push({
        _id: doc._id,
        type: doc.type,
        maxSlots: doc.maxSlots,
        price: doc.price,
        suggestedPrice: doc.price, // alias pour compatibilité frontend
        currency: doc.currency,
        description: doc.description,
      });
    });

    res.json({ success: true, data: grouped });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/service-configs/flat ────────────────────────────────────────────
// Retourne la liste plate (non groupée) — utile pour l'admin ServiceConfigPage
router.get('/flat', async (req, res, next) => {
  try {
    const configs = await ServiceConfig.find({}).sort({ service: 1, type: 1 });
    res.json({ success: true, data: configs });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/service-configs/:id ─────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const config = await ServiceConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ success: false, message: 'Configuration introuvable' });
    }
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/service-configs ────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { service, type, maxSlots, price, currency, description, isActive } = req.body;
    const config = await ServiceConfig.create({
      service, type, maxSlots, price, currency, description, isActive,
    });
    res.status(201).json({ success: true, data: config });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: `La combinaison service/type "${req.body.service}/${req.body.type}" existe déjà.`,
      });
    }
    next(err);
  }
});

// ─── PUT /api/service-configs/:id ─────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['service', 'type', 'maxSlots', 'price', 'currency', 'description', 'isActive'];
    const updates = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    const config = await ServiceConfig.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!config) {
      return res.status(404).json({ success: false, message: 'Configuration introuvable' });
    }
    res.json({ success: true, data: config });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Cette combinaison service/type existe déjà.',
      });
    }
    next(err);
  }
});

// ─── DELETE /api/service-configs/:id (soft delete) ────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const config = await ServiceConfig.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: { deletedAt: new Date(), isActive: false } },
      { new: true }
    );
    if (!config) {
      return res.status(404).json({ success: false, message: 'Configuration introuvable' });
    }
    res.json({ success: true, message: 'Configuration supprimée (soft delete)', data: config });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/service-configs/seed ───────────────────────────────────────────
router.post('/seed', async (req, res, next) => {
  try {
    const results = { inserted: 0, skipped: 0, errors: [] };

    for (const entry of SEED_CATALOG) {
      try {
        const exists = await ServiceConfig.findOne({
          service: entry.service,
          type: entry.type,
        });
        if (exists) { results.skipped++; continue; }
        await ServiceConfig.create(entry);
        results.inserted++;
      } catch (err) {
        results.errors.push({ entry, error: err.message });
      }
    }

    res.status(201).json({
      success: true,
      message: `Seed terminé : ${results.inserted} insérés, ${results.skipped} ignorés.`,
      data: results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
