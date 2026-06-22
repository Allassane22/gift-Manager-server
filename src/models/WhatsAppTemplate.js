// models/WhatsAppTemplate.js

const mongoose = require('mongoose');

// Types système — ne peuvent pas être supprimés
const SYSTEM_TYPES = [
  'reminder',
  'expired',
  'renewal',
  'payment_request',
  'payment_confirmed',
  'welcome',
  'win_back',
];

const whatsAppTemplateSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9_]+$/, 'Le type ne peut contenir que des lettres minuscules, chiffres et underscores'],
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: [80, 'Label trop long (max 80 caractères)'],
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: [4096, 'Message trop long (max 4096 caractères)'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isSystem: {
      type: Boolean,
      default: false, // true pour les 7 templates par défaut
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // null = template admin, ObjectId = template partenaire
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

whatsAppTemplateSchema.index({ type: 1 });

module.exports = mongoose.model('WhatsAppTemplate', whatsAppTemplateSchema);
module.exports.SYSTEM_TYPES = SYSTEM_TYPES;
