const mongoose = require('mongoose');

// Règles métier : slots max par service/type
const SLOTS_CONFIG = {
  Netflix: { Essentiel: 5, Premium: 1, Royal: 1 },
  'Prime Video': { Essentiel: 6, Premium: 1 },
  PlayStation: { Standard: 2 },
};

const accountSchema = new mongoose.Schema({
  service: {
    type: String,
    enum: ['Netflix', 'Prime Video', 'PlayStation'],
    required: [true, 'Service requis'],
  },
  type: {
    type: String,
    enum: ['Essentiel', 'Premium', 'Royal', 'Standard'],
    required: [true, 'Type requis'],
  },
  email: {
    type: String,
    required: [true, 'Email du compte requis'],
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: [true, 'Mot de passe requis'],
  },
  maxSlots: {
    type: Number,
    required: true,
  },
  // Partenaire réservé (optionnel)
  assignedPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  purchasePrice: {
    type: Number,
    required: [true, 'Prix d\'achat requis'],
    min: 0,
  },
  notes: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Calcul automatique de maxSlots selon service+type
accountSchema.pre('save', function (next) {
  if (this.isModified('service') || this.isModified('type')) {
    const config = SLOTS_CONFIG[this.service];
    if (!config || !config[this.type]) {
      return next(new Error(`Combinaison service/type invalide: ${this.service}/${this.type}`));
    }
    this.maxSlots = config[this.type];
  }
  next();
});

// Virtual: nombre de slots utilisés (calculé via populate)
accountSchema.virtual('profiles', {
  ref: 'Profile',
  localField: '_id',
  foreignField: 'accountId',
  match: { deletedAt: null },
});

accountSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

module.exports = mongoose.model('Account', accountSchema);
module.exports.SLOTS_CONFIG = SLOTS_CONFIG;
