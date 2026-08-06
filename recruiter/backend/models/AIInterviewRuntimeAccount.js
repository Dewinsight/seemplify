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
  lastError: { type: String, default: '' }
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
    lastError: this.lastError || null
  };
};

module.exports = mongoose.model('AIInterviewRuntimeAccount', AIInterviewRuntimeAccountSchema);
