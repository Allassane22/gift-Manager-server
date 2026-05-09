const mongoose = require('mongoose');
const ServiceConfig = require('./ServiceConfig');

const accountSchema = new mongoose.Schema({
  service: {
    type: String,
    required: [true, 'Service requis'],
    trim: true,
  },
  type: {
    type: String,
    required: [true, 'Type requis'],
    trim: true,
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
    required: [true, "Prix d'achat requis"],
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

// Calcul automatique de maxSlots via ServiceConfig (dynamique, sans enum statique)
accountSchema.pre('save', async function (next) {
  if (this.isModified('service') || this.isModified('type')) {
    try {
      this.maxSlots = await ServiceConfig.getMaxSlots(this.service, this.type);
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Virtual: profils liés (slots utilisés calculés via populate)
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