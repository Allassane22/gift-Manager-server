const mongoose = require('mongoose');

// Regex téléphone : + optionnel, puis 7 à 15 chiffres (E.164 souple)
// Accepte : +22376543210, 76543210, 0022376543210
const PHONE_REGEX = /^\+?[0-9]{7,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nom requis'],
    trim: true,
  },
  phone: {
    type: String,
    required: [true, 'Téléphone requis'],
    trim: true,
    validate: {
      validator: (v) => PHONE_REGEX.test(v),
      message: 'Numéro de téléphone invalide (ex: +22376543210 ou 76543210)',
    },
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: null,
    validate: {
      validator: (v) => !v || EMAIL_REGEX.test(v), // optionnel mais validé si présent
      message: 'Adresse email invalide',
    },
  },
  notes: { type: String, trim: true },
  // Statistiques dénormalisées
  totalPaid: { type: Number, default: 0 },
  totalSubscriptions: { type: Number, default: 0 },
  // Partenaire qui a apporté ce client
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

// Virtual : abonnements actifs
clientSchema.virtual('subscriptions', {
  ref: 'Subscription',
  localField: '_id',
  foreignField: 'clientId',
  match: { deletedAt: null },
});

clientSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

module.exports = mongoose.model('Client', clientSchema);
