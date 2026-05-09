// models/WhatsAppTemplate.js

const mongoose = require('mongoose');

const TEMPLATE_TYPES = [
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
      enum: TEMPLATE_TYPES,
      required: true,
      unique: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Index utile pour les lookups fréquents par type
whatsAppTemplateSchema.index({ type: 1 });

module.exports = mongoose.model('WhatsAppTemplate', whatsAppTemplateSchema);
module.exports.TEMPLATE_TYPES = TEMPLATE_TYPES;
