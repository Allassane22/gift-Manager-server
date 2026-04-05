const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email requis'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Email invalide'],
  },
  password: {
    type: String,
    required: [true, 'Mot de passe requis'],
    minlength: [8, 'Minimum 8 caractères'],
    select: false,
  },
  role: {
    type: String,
    enum: ['admin', 'partner'],
    default: 'partner',
  },
  name: {
    type: String,
    required: [true, 'Nom requis'],
    trim: true,
  },
  phone: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  is2FAEnabled: { type: Boolean, default: false },
  twoFASecret: { type: String, select: false },
  refreshToken: { type: String, select: false },
  // Stats partenaire (dénormalisées pour perf)
  totalRevenue: { type: Number, default: 0 },
  totalCommission: { type: Number, default: 0 },
  totalSubscriptions: { type: Number, default: 0 },
  lastLoginAt: { type: Date },
  deletedAt: { type: Date, default: null }, // soft delete
}, {
  timestamps: true,
});

// Hash password avant sauvegarde
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Méthode comparaison password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Exclure les utilisateurs supprimés par défaut
userSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

module.exports = mongoose.model('User', userSchema);
