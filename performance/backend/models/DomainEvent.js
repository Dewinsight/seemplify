const mongoose = require('mongoose');

const recipientSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true },
  name: { type: String, trim: true, maxlength: 160 },
  email: { type: String, trim: true, maxlength: 320 },
  channels: [{
    type: String,
    enum: ['in_app', 'email', 'chat']
  }]
}, { _id: false });

const domainEventSchema = new mongoose.Schema({
  // eventId is supplied by the business operation when possible. A caller can
  // persist this document in the same Mongo session as its domain update.
  eventId: { type: String, required: true, unique: true, trim: true, maxlength: 240 },
  contentHash: { type: String, required: true, trim: true, maxlength: 128 },
  eventType: { type: String, required: true, trim: true, maxlength: 160 },
  organizationId: { type: String, required: true, trim: true, index: true },
  aggregate: {
    type: { type: String, required: true, trim: true, maxlength: 80 },
    id: { type: String, required: true, trim: true, maxlength: 240 }
  },
  actor: {
    userId: { type: String, trim: true, maxlength: 240 }
  },
  recipients: {
    type: [recipientSchema],
    default: [],
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length <= 500;
      },
      message: 'A domain event cannot have more than 500 recipients.'
    }
  },
  notification: {
    category: { type: String, required: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    deepLink: { type: String, required: true, trim: true, maxlength: 1000 },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal'
    },
    isAction: { type: Boolean, default: true },
    action: {
      kind: {
        type: String,
        enum: ['open', 'acknowledge', 'review', 'approve', 'complete', 'view'],
        default: 'open'
      },
      label: { type: String, trim: true, maxlength: 80, default: 'Open' }
    },
    target: {
      type: { type: String, trim: true, maxlength: 80 },
      id: { type: String, trim: true, maxlength: 240 }
    },
    dueAt: Date
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  occurredAt: { type: Date, required: true, default: Date.now, index: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'processed', 'failed', 'dead_letter', 'cancelled'],
    default: 'pending',
    index: true
  },
  availableAt: { type: Date, default: Date.now, index: true },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 8, min: 1, max: 30 },
  lease: {
    owner: { type: String, trim: true, maxlength: 240 },
    claimedAt: Date,
    expiresAt: Date
  },
  lastError: {
    code: { type: String, maxlength: 120 },
    message: { type: String, maxlength: 500 },
    at: Date
  },
  processedAt: Date,
  cancelledAt: Date
}, { timestamps: true, minimize: false });

domainEventSchema.index({ status: 1, availableAt: 1, 'lease.expiresAt': 1 });
domainEventSchema.index({ organizationId: 1, eventType: 1, createdAt: -1 });
domainEventSchema.index({ 'aggregate.type': 1, 'aggregate.id': 1, organizationId: 1 });

module.exports = mongoose.models.DomainEvent || mongoose.model('DomainEvent', domainEventSchema);
