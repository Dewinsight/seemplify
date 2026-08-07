const mongoose = require('mongoose');

/**
 * One recruiter's connection to their own ChatGPT account.
 *
 * This record deliberately holds no OpenAI credential. The refresh token lives
 * only inside the gateway host's per-subject CODEX_HOME, so a database dump,
 * backup, or replica never carries a user's ChatGPT session. What is stored
 * here is connection *state*: enough to render the settings page, resolve a
 * subject at inference time, and prove consent.
 */
const AIUserRuntimeAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true
  },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
  // The opaque handle the gateway derives its CODEX_HOME from. Stored so a
  // rename or re-key is visible rather than silently orphaning a session.
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
  /** Routing to a personal plan requires an explicit acknowledgement that task
   * content leaves for OpenAI. Revoking it stops routing immediately. */
  dataSharingAcknowledgedAt: { type: Date, default: null },
  /** What the connected plan currently allows, as last reported by Codex. Kept
   * so the account screen can show it even when the gateway is unreachable —
   * a stale number with its timestamp beats no answer to "why has AI stopped".
   * Shaped { primary, secondary, capturedAt }; the gateway normalises it. */
  rateLimits: { type: mongoose.Schema.Types.Mixed, default: null },
  /** The last "you've hit your limit" refusal, which names when it lifts. */
  usageLimit: { type: mongoose.Schema.Types.Mixed, default: null },
  lastError: { type: String, default: '' }
}, { timestamps: true });

AIUserRuntimeAccountSchema.methods.isRoutable = function isRoutable() {
  return this.status === 'connected' && Boolean(this.dataSharingAcknowledgedAt);
};

AIUserRuntimeAccountSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    status: this.status,
    connectedEmail: this.connectedEmail || null,
    planType: this.planType || null,
    connectedAt: this.connectedAt,
    lastVerifiedAt: this.lastVerifiedAt,
    dataSharingAcknowledgedAt: this.dataSharingAcknowledgedAt,
    routable: this.isRoutable(),
    rateLimits: this.rateLimits || null,
    usageLimit: this.usageLimit || null,
    lastError: this.lastError || null
  };
};

module.exports = mongoose.model('AIUserRuntimeAccount', AIUserRuntimeAccountSchema);
