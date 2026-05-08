const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: [true, 'Compte requis'],
  },
  name: {
    type: String,
    required: [true, 'Nom du profil requis'],
    trim: true,
  },
  pin: { type: String, default: null },
  // Essai gratuit = multi-clients autorisé (5 jours max)
  isFreeTrial: { type: Boolean, default: false },
  freeTrialExpiresAt: { type: Date, default: null },
  // Clients actuellement assignés à ce profil
  assignedClients: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
  }],
  isActive: { type: Boolean, default: true },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

// Validation : un seul client sauf si essai gratuit
profileSchema.pre('save', function (next) {
  if (!this.isFreeTrial && this.assignedClients.length > 1) {
    return next(new Error('Un profil non-gratuit ne peut avoir qu\'un seul client'));
  }
  next();
});

// Virtual : disponible ?
profileSchema.virtual('isAvailable').get(function () {
  if (this.isFreeTrial) return true; // multi-clients OK
  return this.assignedClients.length === 0;
});

profileSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

module.exports = mongoose.model('Profile', profileSchema);
