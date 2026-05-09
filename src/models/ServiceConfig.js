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
serviceConfigSchema.statics.getMaxSlots = async function (service, type) {
  const config = await this.findOne({ service, type, isActive: true });
  if (!config) {
    throw new Error(`Combinaison service/type invalide ou inactive : ${service}/${type}`);
  }
  return config.maxSlots;
};

module.exports = mongoose.model('ServiceConfig', serviceConfigSchema);
