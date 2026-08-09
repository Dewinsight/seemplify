const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ALLOWED_APPLICATIONS = ['time-attendance', 'idp', 'payroll', 'performance', 'leave-management', 'recruiter'];

const PresenceSessionSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    appId: { type: String, enum: ALLOWED_APPLICATIONS, required: true, index: true },
    clientSessionId: { type: String, required: true },
    appVersion: { type: String, trim: true },
    startedAt: { type: Date, default: Date.now, index: true },
    lastHeartbeatAt: { type: Date, default: Date.now, index: true },
    lastActivityAt: Date,
    endedAt: Date,
    visible: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'stale', 'ended'], default: 'active', index: true },
    endReason: String,
    ipHash: String,
    userAgentFamily: String,
}, { timestamps: true });
PresenceSessionSchema.index({ organizationId: 1, userId: 1, appId: 1, clientSessionId: 1 }, { unique: true });
PresenceSessionSchema.index({ organizationId: 1, userId: 1, startedAt: -1 });

const PresenceEventSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'PresenceSession', required: true, index: true },
    appId: { type: String, enum: ALLOWED_APPLICATIONS, required: true },
    type: { type: String, enum: ['started', 'heartbeat', 'visible', 'hidden', 'activity', 'ended'], required: true },
    occurredAt: { type: Date, default: Date.now, index: true },
    activityKind: { type: String, enum: ['navigation', 'action'] },
    featureCode: { type: String, maxlength: 80 },
}, { timestamps: true });
PresenceEventSchema.index({ occurredAt: 1 });

const PresenceDailySummarySchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    appId: { type: String, enum: ALLOWED_APPLICATIONS, required: true },
    day: { type: String, required: true },
    sessionCount: { type: Number, default: 0 },
    visibleHeartbeatCount: { type: Number, default: 0 },
    meaningfulActivityCount: { type: Number, default: 0 },
    firstEvidenceAt: Date,
    lastEvidenceAt: Date,
    summarizedThrough: Date,
}, { timestamps: true });
PresenceDailySummarySchema.index({ organizationId: 1, userId: 1, appId: 1, day: 1 }, { unique: true });

const ApplicationAssignmentSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    appId: { type: String, enum: ALLOWED_APPLICATIONS, required: true },
    scopeType: { type: String, enum: ['organization', 'team', 'role', 'employee', 'shift'], required: true },
    scopeId: { type: String, required: true },
    expected: { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: Date,
    createdBy: String,
}, { timestamps: true });
ApplicationAssignmentSchema.index({ organizationId: 1, appId: 1, scopeType: 1, scopeId: 1 }, { unique: true });

const PresenceAccessLogSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    actorId: { type: String, required: true },
    subjectUserIds: [String],
    action: { type: String, enum: ['view_summary', 'export_own', 'privacy_request', 'review_privacy', 'delete_presence_data'], required: true },
    purpose: String,
    at: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

const PresencePrivacyRequestSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ['access', 'correction', 'deletion', 'objection'], required: true },
    reason: String,
    status: { type: String, enum: ['submitted', 'in_review', 'completed', 'rejected'], default: 'submitted' },
    reviewedBy: String,
    reviewNote: String,
}, { timestamps: true });

module.exports = {
    ALLOWED_APPLICATIONS,
    PresenceSession: mongoose.model('PresenceSession', PresenceSessionSchema),
    PresenceEvent: mongoose.model('PresenceEvent', PresenceEventSchema),
    PresenceDailySummary: mongoose.model('PresenceDailySummary', PresenceDailySummarySchema),
    ApplicationAssignment: mongoose.model('ApplicationAssignment', ApplicationAssignmentSchema),
    PresenceAccessLog: mongoose.model('PresenceAccessLog', PresenceAccessLogSchema),
    PresencePrivacyRequest: mongoose.model('PresencePrivacyRequest', PresencePrivacyRequestSchema),
};
