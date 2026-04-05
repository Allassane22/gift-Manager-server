const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  action: {
    type: String,
    required: true,
    // ex: 'CREATE_SUBSCRIPTION', 'DELETE_CLIENT', 'LOGIN', etc.
  },
  targetModel: {
    type: String,
    enum: ['User', 'Client', 'Account', 'Profile', 'Subscription', 'System'],
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ip: { type: String },
  userAgent: { type: String },
}, {
  timestamps: true,
});

// Index pour requêtes rapides
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
