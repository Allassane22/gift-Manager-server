const mongoose = require('mongoose');

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
    min: [1, 'maxSlots doit être au moins 1'],
  },
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

// Virtual: profils liés
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
