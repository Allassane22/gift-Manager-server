const mongoose = require('mongoose');

const serviceConfigSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      required: [true, 'Nom du service requis'],
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'Type requis'],
      trim: true,
    },
    maxSlots: {
      type: Number,
      required: [true, 'Nombre de slots max requis'],
      min: [1, 'maxSlots doit être au moins 1'],
    },
    price: {
      type: Number,
      required: [true, 'Prix requis'],
      min: [0, 'Le prix ne peut pas être négatif'],
    },
    currency: {
      type: String,
      default: 'FCFA',
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Index unicité sur (service, type) pour les docs non supprimés ────────────
serviceConfigSchema.index(
  { service: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
  }
);

// ─── Soft-delete : exclure automatiquement les docs supprimés ─────────────────
serviceConfigSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

// ─── Méthode statique : récupère maxSlots pour un couple service/type ─────────
// ✅ Correction : on retire le filtre isActive pour ne pas bloquer la création
// si un service a isActive=false ou undefined. On vérifie juste que la combo existe.
serviceConfigSchema.statics.getMaxSlots = async function (service, type) {
  // Bypass le pre-find hook en utilisant findOne directement sur le modèle
  // avec un filtre explicite deletedAt: null
  const config = await this.findOne({ service, type, deletedAt: null });
  if (!config) {
    throw new Error(
      `Combinaison service/type introuvable : ${service}/${type}. ` +
      `Vérifiez que le catalogue a été initialisé via POST /api/service-configs/seed`
    );
  }
  return config.maxSlots;
};

module.exports = mongoose.model('ServiceConfig', serviceConfigSchema);
