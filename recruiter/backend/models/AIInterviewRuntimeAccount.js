const mongoose = require('mongoose');

/**
 * A candidate's connection to their own ChatGPT account, scoped to one AI
 * interview session.
 *
 * A candidate is not a platform user — they arrive holding only an interview
 * link — so the connection is keyed on the session rather than a User. Like
 * the recruiter equivalent it deliberately holds no OpenAI credential: the
 * refresh token lives only in the gateway host's per-subject CODEX_HOME.
 */
const AIInterviewRuntimeAccountSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId, ref: 'AIInterviewSession', required: true, unique: true, index: true
  },
  aiInterview: { type: mongoose.Schema.Types.ObjectId, ref: 'AIInterview', index: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', index: true },
  subjectKey: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    enum: ['disconnected', 'pending', 'connected', 'error'],
    default: 'disconnected',
    index: true
  },
  connectedEmail: { type: String, default: '' },
  planType: { type: String, default: '' },
  connectedAt: { type: Date, default: null },
  lastVerifiedAt: { type: Date, default: null },
  disconnectedAt: { type: Date, default: null },
  /** The candidate must acknowledge that their interview content is processed
   * by OpenAI on their own account before any turn runs on it. */
  dataSharingAcknowledgedAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  credentialCleanup: {
    status: {
      type: String,
      enum: ['idle', 'pending', 'processing', 'completed'],
      default: 'idle',
      index: true
    },
    attempts: { type: Number, default: 0, min: 0 },
    requestedAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: null, index: true },
    completedAt: { type: Date, default: null },
    reason: { type: String, default: '' },
    lastError: { type: String, default: '' }
  },
  // Terminal connection metadata is retained briefly for audit/recovery, but
  // the hosted credential is deleted first. Mongo removes the local row later.
  purgeAfter: { type: Date, default: null, index: { expires: 0 } }
}, { timestamps: true });

AIInterviewRuntimeAccountSchema.methods.isRoutable = function isRoutable() {
  return this.status === 'connected' && Boolean(this.dataSharingAcknowledgedAt);
};

AIInterviewRuntimeAccountSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    status: this.status,
    connectedEmail: this.connectedEmail || null,
    planType: this.planType || null,
    connectedAt: this.connectedAt,
    lastVerifiedAt: this.lastVerifiedAt,
    dataSharingAcknowledgedAt: this.dataSharingAcknowledgedAt,
    routable: this.isRoutable(),
    lastError: this.lastError || null,
    credentialCleanupStatus: this.credentialCleanup?.status || 'idle',
    credentialCleanupPending: ['pending', 'processing'].includes(this.credentialCleanup?.status),
    disconnectedAt: this.disconnectedAt || null
  };
};

module.exports = mongoose.model('AIInterviewRuntimeAccount', AIInterviewRuntimeAccountSchema);
