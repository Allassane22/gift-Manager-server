/**
 * PartnerBilling.js
 * Suit la facturation des comptes assignés aux partenaires.
 * 
 * Logique :
 * - Quand un compte est assigné à un partenaire, un enregistrement est créé ici
 * - 1er mois : firstMonthPrice (ex: 7 500 FCFA)
 * - Mois suivants : monthlyPrice (ex: 10 000 FCFA)
 * - Promos : tableau de mois avec prix réduit
 */

const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
  month: { type: Number, required: true }, // ex: 202506 (YYYYMM)
  price: { type: Number, required: true }, // prix promo ce mois
  label: { type: String, trim: true },     // ex: "Promo lancement"
}, { _id: false });

const partnerBillingSchema = new mongoose.Schema({
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  assignedAt: {
    type: Date,
    default: Date.now,
  },
  unassignedAt: {
    type: Date,
    default: null,
  },
  firstMonthPrice: {
    type: Number,
    required: true,
    default: 7500,
  },
  monthlyPrice: {
    type: Number,
    required: true,
    default: 10000,
  },
  promos: {
    type: [promoSchema],
    default: [],
  },
}, {
  timestamps: true,
});

// Index pour retrouver rapidement les facturations d'un partenaire
partnerBillingSchema.index({ partnerId: 1, accountId: 1 });

/**
 * Calcule ce que le partenaire doit pour un compte donné depuis l'assignation.
 * Retourne le total et le détail mois par mois.
 */
partnerBillingSchema.methods.computeOwed = function () {
  const dayjs = require('dayjs');
  const utc   = require('dayjs/plugin/utc');
  dayjs.extend(utc);

  const start = dayjs.utc(this.assignedAt).startOf('month');
  const end   = this.unassignedAt
    ? dayjs.utc(this.unassignedAt).startOf('month')
    : dayjs.utc().startOf('month');

  let total = 0;
  const breakdown = [];
  let current = start;
  let monthIndex = 0;

  while (!current.isAfter(end)) {
    const monthKey = Number(current.format('YYYYMM'));
    // Chercher une promo pour ce mois
    const promo = this.promos.find(p => p.month === monthKey);
    let price;
    if (promo) {
      price = promo.price;
    } else if (monthIndex === 0) {
      price = this.firstMonthPrice;
    } else {
      price = this.monthlyPrice;
    }
    breakdown.push({ month: monthKey, label: current.format('MMM YYYY'), price, promo: !!promo });
    total += price;
    current = current.add(1, 'month');
    monthIndex++;
  }

  return { total, breakdown };
};

module.exports = mongoose.model('PartnerBilling', partnerBillingSchema);
