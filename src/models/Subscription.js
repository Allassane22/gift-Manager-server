const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

const subscriptionSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Client requis'],
  },
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: [true, 'Compte requis'],
  },
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Profil requis'],
  },
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Dates stockées en UTC
  startDate: {
    type: Date,
    required: [true, 'Date de début requise'],
    default: () => dayjs.utc().toDate(),
  },
  endDate: {
    type: Date,
    required: [true, 'Date de fin requise'],
    // Expire à 23:59:59 UTC du jour de fin
    set: (v) => dayjs.utc(v).endOf('day').toDate(),
  },
  // Finance
  purchasePrice: {
    type: Number,
    required: [true, 'Prix d\'achat requis'],
    min: [0, 'Prix invalide'],
  },
  pricePaid: {
    type: Number,
    required: [true, 'Prix client requis'],
    min: [0, 'Prix invalide'],
  },
  profit: {
    type: Number,
    default: 0,
  },
  // Commission partenaire
  commissionType: {
    type: String,
    enum: ['fixed', 'percentage', 'none'],
    default: 'none',
  },
  commissionValue: { type: Number, default: 0 },
  commissionAmount: { type: Number, default: 0 }, // montant calculé
  // Preuve de paiement
  paymentProofUrl: { type: String, default: null },
  // Statut
  status: {
    type: String,
    enum: ['active', 'overdue', 'suspended', 'expired', 'cancelled'],
    default: 'active',
  },
  // Historique des modifications
  history: [{
    action: String,           // 'renewed', 'upgraded', 'migrated', 'suspended'
    fromAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
    fromProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    note: String,
    doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  }],
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

// ─── Calcul automatique du profit avant sauvegarde ───────────────────────────
subscriptionSchema.pre('save', function (next) {
  // profit = prix_client - prix_achat
  this.profit = parseFloat((this.pricePaid - this.purchasePrice).toFixed(2));

  // Calcul commission
  if (this.commissionType === 'fixed') {
    this.commissionAmount = this.commissionValue;
  } else if (this.commissionType === 'percentage') {
    this.commissionAmount = parseFloat(
      (this.pricePaid * this.commissionValue / 100).toFixed(2)
    );
  } else {
    this.commissionAmount = 0;
  }

  next();
});

// Virtual : jours restants
subscriptionSchema.virtual('daysLeft').get(function () {
  return dayjs.utc(this.endDate).diff(dayjs.utc(), 'day');
});

subscriptionSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
