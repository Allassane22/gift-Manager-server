const mongoose = require('mongoose');

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
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: null,
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
