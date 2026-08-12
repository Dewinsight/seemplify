const mongoose = require('mongoose');

const reasoningEfforts = ['minimal', 'none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const AIActivityOverrideSchema = new mongoose.Schema({
  activity: { type: String, required: true, trim: true, maxlength: 120 },
  codexModel: { type: String, default: null, trim: true, maxlength: 120 },
  reasoningEffort: { type: String, enum: [...reasoningEfforts, null], default: null }
}, { _id: false });

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
  /** Immutable Seemplify OIDC subject. This is the credential owner shared by
   * every first-party IDP-connected application. */
  idpSubject: { type: String, trim: true, sparse: true, unique: true, index: true },
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
  /** Performance has its own disclosure/consent. Connecting ChatGPT is global,
   * but approving Performance content must not implicitly approve Recruiter
   * CVs or other Recruiter workloads. */
  performanceDataSharingAcknowledgedAt: { type: Date, default: null },
  /** Messaging content has an independent disclosure even though the OpenAI
   * login itself is shared across Seemplify. */
  messagingDataSharingAcknowledgedAt: { type: Date, default: null },
  credentialNamespaceVersion: { type: Number, default: 1 },
  /** What the connected plan currently allows, as last reported by Codex. Kept
   * so the account screen can show it even when the gateway is unreachable —
   * a stale number with its timestamp beats no answer to "why has AI stopped".
   * Shaped { primary, secondary, capturedAt }; the gateway normalises it. */
  rateLimits: { type: mongoose.Schema.Types.Mixed, default: null },
  /** The last "you've hit your limit" refusal, which names when it lifts. */
  usageLimit: { type: mongoose.Schema.Types.Mixed, default: null },
  lastError: { type: String, default: '' },
  runtimePreference: {
    type: String,
    enum: ['default', 'local', 'chatgpt'],
    default: 'default'
  },
  /** Personal ChatGPT selections. Credentials remain gateway-only; these are
   * harmless routing preferences and can be shared across Seemplify apps. */
  aiDefaults: {
    codexModel: { type: String, default: null, trim: true, maxlength: 120 },
    reasoningEffort: { type: String, enum: [...reasoningEfforts, null], default: null }
  },
  activityOverrides: { type: [AIActivityOverrideSchema], default: [] }
}, { timestamps: true });

AIUserRuntimeAccountSchema.methods.consentAt = function consentAt(app = 'recruiter') {
  if (app === 'performance') return this.performanceDataSharingAcknowledgedAt;
  if (app === 'messaging') return this.messagingDataSharingAcknowledgedAt;
  return this.dataSharingAcknowledgedAt;
};

AIUserRuntimeAccountSchema.methods.isRoutable = function isRoutable(app = 'recruiter') {
  return this.status === 'connected' && Boolean(this.consentAt(app));
};

AIUserRuntimeAccountSchema.methods.toPublicJSON = function toPublicJSON(options = {}) {
  const app = ['performance', 'messaging'].includes(options.app) ? options.app : 'recruiter';
  const scopedConsent = this.consentAt(app);
  return {
    status: this.status,
    connectedEmail: this.connectedEmail || null,
    planType: this.planType || null,
    connectedAt: this.connectedAt,
    lastVerifiedAt: this.lastVerifiedAt,
    // Backward-compatible scoped alias used by each product UI.
    dataSharingAcknowledgedAt: scopedConsent,
    consentScope: app,
    consents: {
      recruiter: this.dataSharingAcknowledgedAt || null,
      performance: this.performanceDataSharingAcknowledgedAt || null,
      messaging: this.messagingDataSharingAcknowledgedAt || null
    },
    routable: this.isRoutable(app),
    rateLimits: this.rateLimits || null,
    usageLimit: this.usageLimit || null,
    lastError: this.lastError || null,
    runtimePreference: this.runtimePreference || 'default',
    /** Do not manufacture plan totals: this is explicitly an observed report
     * from the connected runtime, with the timestamp needed to judge staleness. */
    usage: {
      source: 'connected_chatgpt_runtime',
      available: Boolean(this.rateLimits || this.usageLimit),
      // Connectivity verification is not usage observation. Leave this null
      // unless the upstream actually supplied a rate/limit timestamp.
      observedAt: this.rateLimits?.capturedAt || this.usageLimit?.at || null,
      rateLimits: this.rateLimits || null,
      usageLimit: this.usageLimit || null
    }
  };
};

module.exports = mongoose.model('AIUserRuntimeAccount', AIUserRuntimeAccountSchema);
