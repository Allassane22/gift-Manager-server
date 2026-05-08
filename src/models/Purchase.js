const mongoose = require('mongoose');

// Catalogue Robux : quantité → prix de vente conseillé (FCFA)
const ROBUX_CATALOG = {
  40:     975,
  88:     1255,
  440:    3319,
  880:    7000,
  1870:   12614,
  4950:   30643,
  11000:  59098,
  25000:  118635,
};

const purchaseSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Client requis'],
  },
  // Service concerné (pour l'instant Robux, extensible)
  service: {
    type: String,
    enum: ['Robux'],
    required: [true, 'Service requis'],
    default: 'Robux',
  },
  // Détail du produit (ex: "Robux 880", "Robux Abonnement")
  product: {
    type: String,
    required: [true, 'Produit requis'],
    trim: true,
  },
  // Quantité Robux (null pour abonnement Robux mensuel)
  quantity: {
    type: Number,
    default: null,
  },
  purchasePrice: {
    type: Number,
    required: [true, "Prix d'achat requis"],
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
  // Partenaire apporteur
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  commissionType:   { type: String, enum: ['fixed', 'percentage', 'none'], default: 'none' },
  commissionValue:  { type: Number, default: 0 },
  commissionAmount: { type: Number, default: 0 },

  // Preuve de paiement
  paymentProofUrl: { type: String, default: null },

  // Statut de livraison
  status: {
    type: String,
    enum: ['pending_payment', 'pending', 'delivered', 'cancelled'],
    default: 'pending',
  },

  notes: { type: String, trim: true, default: '' },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

// Calcul automatique du profit et de la commission
purchaseSchema.pre('save', function (next) {
  this.profit = parseFloat((this.pricePaid - this.purchasePrice).toFixed(2));

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

purchaseSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

module.exports = mongoose.model('Purchase', purchaseSchema);
module.exports.ROBUX_CATALOG = ROBUX_CATALOG;
