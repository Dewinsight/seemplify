const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const IntegrationEventSchema = new Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    source: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    subjectId: String,
    schemaVersion: { type: String, default: '1.0' },
    occurredAt: Date,
    correlationId: String,
    idempotencyKey: String,
    status: { type: String, enum: ['processing', 'processed', 'failed'], default: 'processing' },
    error: String,
    payloadHash: String,
    processedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('IntegrationEvent', IntegrationEventSchema);
