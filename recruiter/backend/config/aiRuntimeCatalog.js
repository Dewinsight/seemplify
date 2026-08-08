const GROQ_PROVIDER = 'groq';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_120B = 'openai/gpt-oss-120b';
const GROQ_20B = 'openai/gpt-oss-20b';
const LOCAL_PROVIDER = 'local-ollama';
const LOCAL_MANAGED_MODEL = 'managed-local-gpu';
const LOCAL_CV_MODEL = LOCAL_MANAGED_MODEL;
const TERRA_PROVIDER = 'local-codex';
const TERRA_MODEL = 'gpt-5.6-terra';
const CLAUDE_PROVIDER = 'local-claude';
const CLAUDE_SONNET_MODEL = 'sonnet';
/** A recruiter's own ChatGPT plan, reached through the same gateway transport
 * as the managed local runtimes but billed to that person's account. */
const CHATGPT_PROVIDER = 'chatgpt-codex';
const CHATGPT_MODEL = 'chatgpt-codex-account';
/** The Codex model every recruiter activity asks the connected account for.
 * It is a preference, not a demand: a plan that does not offer it resolves to
 * that account's own default instead of failing. */
const CHATGPT_DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
/** Groups whose work arrives from other Seemplify products through
 * /api/internal/ai. It is not a recruiter's own work, so it stays on the
 * managed runtimes and is never billed to anyone's personal ChatGPT plan. */
const CROSS_PRODUCT_GROUPS = Object.freeze(['Experience Management', 'Xplorer CRM']);
const DEFAULT_LOCAL_FAILOVER = Object.freeze({
  enabled: true,
  intervalMinutes: 30,
  active: false,
  status: 'unknown',
  checkedAt: null,
  failedAt: null,
  recoveredAt: null,
  reason: null,
  engine: null,
  model: null
});

const DEFAULT_MODELS = Object.freeze([
  {
    id: GROQ_120B,
    provider: GROQ_PROVIDER,
    label: 'GPT-OSS 120B',
    capabilities: ['text', 'reasoning', 'json_object', 'json_schema', 'tools', 'streaming'],
    pricing: { inputPerMillionUsd: 0.15, cachedInputPerMillionUsd: 0.075, outputPerMillionUsd: 0.60 },
    documentedLimits: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
    contextWindow: 131072,
    maxOutputTokens: 65536,
    enabled: true
  },
  {
    id: GROQ_20B,
    provider: GROQ_PROVIDER,
    label: 'GPT-OSS 20B',
    capabilities: ['text', 'reasoning', 'json_object', 'json_schema', 'tools', 'streaming'],
    pricing: { inputPerMillionUsd: 0.075, cachedInputPerMillionUsd: 0.037, outputPerMillionUsd: 0.30 },
    documentedLimits: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
    contextWindow: 131072,
    maxOutputTokens: 65536,
    enabled: true
  },
  {
    id: LOCAL_CV_MODEL,
    provider: LOCAL_PROVIDER,
    label: 'Managed local / local-cloud',
    capabilities: ['text', 'reasoning', 'json_object', 'json_schema', 'tools', 'streaming'],
    pricing: { inputPerMillionUsd: 0, cachedInputPerMillionUsd: 0, outputPerMillionUsd: 0 },
    documentedLimits: { concurrency: 128 },
    contextWindow: 32768,
    maxOutputTokens: 12288,
    available: true,
    enabled: true,
    localOnly: true,
    managed: true
  },
  {
    id: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    label: 'Terra (Codex local-cloud)',
    capabilities: ['text', 'reasoning', 'json_object', 'json_schema', 'tools', 'streaming'],
    pricing: { inputPerMillionUsd: 0, cachedInputPerMillionUsd: 0, outputPerMillionUsd: 0 },
    documentedLimits: { concurrency: 32 },
    contextWindow: 131072,
    maxOutputTokens: 65536,
    available: true,
    enabled: true,
    localCloud: true,
    managed: true
  },
  {
    id: CHATGPT_MODEL,
    provider: CHATGPT_PROVIDER,
    label: 'ChatGPT (connected account)',
    // json_schema is mandatory: resolveRoute rejects any model that cannot
    // satisfy a structured activity, and most Recruiter activities are.
    capabilities: ['text', 'reasoning', 'json_object', 'json_schema', 'tools', 'streaming'],
    // Inference bills to the connected user's ChatGPT plan, not to Seemplify.
    pricing: { inputPerMillionUsd: 0, cachedInputPerMillionUsd: 0, outputPerMillionUsd: 0 },
    documentedLimits: { concurrency: 1 },
    contextWindow: 131072,
    maxOutputTokens: 65536,
    available: true,
    // Recruiter AI is ChatGPT-only, so the model ships enabled; the runtime
    // policy switch is what an administrator uses to turn the runtime off.
    enabled: true,
    localCloud: true,
    managed: false,
    userOwned: true
  },
  {
    id: CLAUDE_SONNET_MODEL,
    provider: CLAUDE_PROVIDER,
    label: 'Claude Sonnet (Claude Code local-cloud)',
    capabilities: ['text', 'reasoning', 'json_object', 'json_schema', 'tools', 'streaming'],
    pricing: { inputPerMillionUsd: 0, cachedInputPerMillionUsd: 0, outputPerMillionUsd: 0 },
    documentedLimits: { concurrency: 32 },
    contextWindow: 200000,
    maxOutputTokens: 64000,
    available: true,
    enabled: true,
    localCloud: true,
    managed: true
  }
]);

const ACTIVITY_DEFINITIONS = Object.freeze({
  'recruiter.general': { label: 'Recruiter AI - general', group: 'Recruiter', model: GROQ_120B, reasoningEffort: 'medium' },
  'candidate.cv_parse': {
    label: 'Candidate CV parsing',
    group: 'Candidates',
    model: LOCAL_CV_MODEL,
    provider: LOCAL_PROVIDER,
    reasoningEffort: 'medium',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'candidate.insights': { label: 'Candidate insights', group: 'Candidates', model: GROQ_120B, reasoningEffort: 'medium' },
  'job.description': { label: 'Job description generation', group: 'Jobs', model: GROQ_120B, reasoningEffort: 'high' },
  'job.requirements': { label: 'Job requirements generation', group: 'Jobs', model: GROQ_120B, reasoningEffort: 'medium' },
  'job.normalize': { label: 'Job field normalization', group: 'Jobs', model: GROQ_120B, reasoningEffort: 'medium' },
  'matching.analysis': { label: 'Candidate matching analysis', group: 'Matching', model: GROQ_120B, reasoningEffort: 'high' },
  'matching.report': { label: 'Candidate matching report', group: 'Matching', model: GROQ_120B, reasoningEffort: 'high' },
  'assistant.chat': { label: 'Recruiter assistant', group: 'Assistant', model: GROQ_120B, reasoningEffort: 'medium' },
  'assistant.tool_selection': { label: 'Assistant tool selection', group: 'Assistant', model: GROQ_120B, reasoningEffort: 'medium' },
  'assistant.memory': { label: 'Assistant memory classification', group: 'Assistant', model: GROQ_120B, reasoningEffort: 'medium' },
  'assistant.title': { label: 'Assistant chat title', group: 'Assistant', model: GROQ_120B, reasoningEffort: 'medium' },
  'assistant.job_extract': { label: 'Assistant job extraction', group: 'Assistant', model: GROQ_120B, reasoningEffort: 'medium' },
  'analytics.candidates': { label: 'Candidate analytics', group: 'Analytics', model: GROQ_120B, reasoningEffort: 'medium' },
  'analytics.jobs': { label: 'Job analytics', group: 'Analytics', model: GROQ_120B, reasoningEffort: 'medium' },
  'analytics.hiring': { label: 'Hiring analytics', group: 'Analytics', model: GROQ_120B, reasoningEffort: 'medium' },
  'report.analysis': { label: 'Report analysis', group: 'Analytics', model: GROQ_120B, reasoningEffort: 'medium' },
  'interview.questions': {
    label: 'Interview question generation',
    group: 'Interviews',
    model: LOCAL_MANAGED_MODEL,
    provider: LOCAL_PROVIDER,
    reasoningEffort: 'medium',
    defaultLocal: true,
    failoverPolicy: 'groq_immediate'
  },
  'interview.bias': { label: 'Interview bias analysis', group: 'Interviews', model: GROQ_120B, reasoningEffort: 'medium' },
  'interview.analysis': { label: 'Interview analysis', group: 'Interviews', model: GROQ_120B, reasoningEffort: 'high' },
  'interview.summary': { label: 'Interview summary', group: 'Interviews', model: GROQ_120B, reasoningEffort: 'medium' },
  'interview.team_feedback': { label: 'Interview team feedback', group: 'Interviews', model: GROQ_120B, reasoningEffort: 'medium' },
  'ai_interview.chat.introduction': { label: 'AI Interview introduction', group: 'AI Interview', model: GROQ_20B, reasoningEffort: 'low' },
  'ai_interview.chat.clarification': { label: 'AI Interview clarification', group: 'AI Interview', model: GROQ_20B, reasoningEffort: 'low' },
  'ai_interview.chat.acknowledgement': { label: 'AI Interview acknowledgement', group: 'AI Interview', model: GROQ_20B, reasoningEffort: 'low' },
  'ai_interview.question_generation': {
    label: 'AI Interview question generation',
    group: 'AI Interview',
    model: LOCAL_MANAGED_MODEL,
    provider: LOCAL_PROVIDER,
    reasoningEffort: 'medium',
    defaultLocal: true,
    failoverPolicy: 'groq_immediate'
  },
  'ai_interview.cv_parse': {
    label: 'AI Interview CV parsing',
    group: 'AI Interview',
    model: LOCAL_CV_MODEL,
    provider: LOCAL_PROVIDER,
    reasoningEffort: 'medium',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'ai_interview.scoring': { label: 'AI Interview scoring', group: 'AI Interview', model: GROQ_120B, reasoningEffort: 'high' }
});

function failoverPolicyForRoute(activity, provider) {
  // A personal ChatGPT plan must never silently hand private work to Groq and
  // bill it to the platform. Failure is reported, not papered over.
  if (isUserOwnedProvider(provider)) return 'chatgpt_required';
  if (ACTIVITY_DEFINITIONS[activity]?.lockedProvider === true) return 'wait_local';
  return isManagedLocalProvider(provider) ? 'groq_immediate' : 'none';
}

function isManagedLocalProvider(provider) {
  return ['local-codex', 'local-claude', 'local-ollama', 'local-vllm'].includes(String(provider || '').trim().toLowerCase());
}

function isCrossProductActivity(activity) {
  return CROSS_PRODUCT_GROUPS.includes(ACTIVITY_DEFINITIONS[activity]?.group);
}

/** Turns taken during a live AI interview, plus the scoring of what was said.
 * This is the candidate's own conversation, so it runs on the candidate's own
 * connected ChatGPT account and never on the workspace's or the platform's.
 * Question generation and CV parsing are excluded: the recruiter does those
 * before any candidate is present. */
const CANDIDATE_INTERVIEW_ACTIVITIES = Object.freeze([
  'ai_interview.chat.introduction',
  'ai_interview.chat.clarification',
  'ai_interview.chat.acknowledgement',
  'ai_interview.scoring'
]);

function isCandidateInterviewActivity(activity) {
  return CANDIDATE_INTERVIEW_ACTIVITIES.includes(String(activity || ''));
}

/** Recruiter's own AI runs on the signed-in person's ChatGPT plan. Only
 * another product's intake stays on the managed runtimes. */
function isChatgptPinnedActivity(activity) {
  return Boolean(ACTIVITY_DEFINITIONS[activity]) && !isCrossProductActivity(activity);
}

function isUserOwnedProvider(provider) {
  return String(provider || '').trim().toLowerCase() === CHATGPT_PROVIDER;
}

/** Both families reach the gateway over the same signed transport, so the
 * transport branch keys off this while failover semantics stay separate. */
function isGatewayProvider(provider) {
  return isManagedLocalProvider(provider) || isUserOwnedProvider(provider);
}

/**
 * Which runtimes a platform administrator has switched on, and which one an
 * account uses when it has expressed no preference.
 */
const DEFAULT_RUNTIME_POLICY = Object.freeze({
  // Recruiter AI runs exclusively on each user's connected ChatGPT account.
  // The local runtime stays enabled only to serve the other products whose
  // work arrives through /api/internal/ai — no recruiter activity uses it.
  localEnabled: true,
  chatgptEnabled: true,
  defaultRuntime: 'chatgpt',
  chatgptRequired: true
});

function normalizeRuntimePolicy(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const localEnabled = typeof candidate.localEnabled === 'boolean'
    ? candidate.localEnabled : DEFAULT_RUNTIME_POLICY.localEnabled;
  const chatgptEnabled = typeof candidate.chatgptEnabled === 'boolean'
    ? candidate.chatgptEnabled : DEFAULT_RUNTIME_POLICY.chatgptEnabled;
  const requested = candidate.defaultRuntime === 'chatgpt' || candidate.defaultRuntime === 'local'
    ? candidate.defaultRuntime : DEFAULT_RUNTIME_POLICY.defaultRuntime;
  // A default pointing at a disabled runtime would be unenforceable, so it is
  // corrected on read rather than trusted.
  const defaultRuntime = requested === 'chatgpt' && !chatgptEnabled ? 'local'
    : requested === 'local' && !localEnabled && chatgptEnabled ? 'chatgpt'
    : requested;
  // Requiring ChatGPT is only meaningful while the runtime is switched on.
  const chatgptRequired = chatgptEnabled && (typeof candidate.chatgptRequired === 'boolean'
    ? candidate.chatgptRequired : DEFAULT_RUNTIME_POLICY.chatgptRequired);
  return { localEnabled, chatgptEnabled, defaultRuntime, chatgptRequired };
}

/** The pre-ChatGPT baseline: every activity on the platform's own managed
 * capacity. It still serves the other products' intake, and an administrator
 * who turns off the ChatGPT requirement returns recruiter work to it. */
const MANAGED_ROUTES = Object.freeze(Object.entries(ACTIVITY_DEFINITIONS).map(([activity, definition]) => ({
  activity,
  provider: definition.provider || GROQ_PROVIDER,
  model: definition.model,
  codexModel: '',
  reasoningEffort: definition.reasoningEffort,
  lockedProvider: definition.lockedProvider === true,
  failoverPolicy: failoverPolicyForRoute(activity, definition.provider || GROQ_PROVIDER),
  enabled: true,
  routeVersion: 1
})));

/** What a new install ships with: recruiter AI on each user's own ChatGPT
 * plan, other products' intake still on the managed runtimes. */
const DEFAULT_ROUTES = Object.freeze(MANAGED_ROUTES.map((route) => (
  isChatgptPinnedActivity(route.activity)
    ? {
        ...route,
        provider: CHATGPT_PROVIDER,
        model: CHATGPT_MODEL,
        codexModel: CHATGPT_DEFAULT_CODEX_MODEL,
        failoverPolicy: failoverPolicyForRoute(route.activity, CHATGPT_PROVIDER)
      }
    : { ...route }
)));

const DEFAULT_ALERT_SETTINGS = Object.freeze({
  enabled: true,
  recipients: [],
  dailyRemainingPercent: [25, 10, 0],
  monthlySpendPercent: [75, 90, 100],
  monthlyBudgetUsd: null,
  sustainedRateLimitCount: 3,
  sustainedRateLimitWindowMinutes: 5
});

const DEFAULT_ROLLOUT_SETTINGS = Object.freeze({
  groqPercent: 100,
  azureBaselineEnabled: false,
  samplingSalt: 'groq-gpt-oss-v1'
});

function localProviderLabel(provider, model) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedModel = String(model || '').trim();
  if (normalizedProvider === 'local-codex') {
    return normalizedModel.toLowerCase() === 'gpt-5.6-terra'
      ? 'Terra (Codex local-cloud)'
      : normalizedModel
        ? `Codex local-cloud: ${normalizedModel}`
        : 'Codex local-cloud';
  }
  if (normalizedProvider === 'local-claude') {
    return normalizedModel
      ? `Claude Code local-cloud: ${normalizedModel}`
      : 'Claude Code local-cloud';
  }
  if (normalizedProvider === 'local-ollama') {
    return !normalizedModel || normalizedModel === LOCAL_MANAGED_MODEL
      ? 'Managed local runtime'
      : `Ollama local GPU: ${normalizedModel}`;
  }
  if (normalizedProvider === 'local-vllm') {
    return normalizedModel
      ? `vLLM local GPU: ${normalizedModel}`
      : 'vLLM local GPU';
  }
  return normalizedModel || normalizedProvider || 'Unknown provider';
}

/** The managed-runtime posture: what an install looks like when a platform
 * administrator turns the ChatGPT requirement off. */
function createManagedRuntimeSettings() {
  return {
    ...createDefaultRuntimeSettings(),
    routes: MANAGED_ROUTES.map((route) => ({ ...route })),
    runtimePolicy: { ...DEFAULT_RUNTIME_POLICY, chatgptRequired: false, defaultRuntime: 'local' }
  };
}

function createDefaultRuntimeSettings() {
  return {
    key: 'global',
    providerEnabled: true,
    models: DEFAULT_MODELS.map((model) => ({ ...model })),
    routes: DEFAULT_ROUTES.map((route) => ({ ...route })),
    quotaGroups: [{ id: 'groq-primary', label: 'Groq primary organization', enabled: true }],
    runtimePolicy: { ...DEFAULT_RUNTIME_POLICY },
    alerts: { ...DEFAULT_ALERT_SETTINGS },
    localFailover: { ...DEFAULT_LOCAL_FAILOVER },
    rollout: { ...DEFAULT_ROLLOUT_SETTINGS },
    version: 1
  };
}

module.exports = {
  ACTIVITY_DEFINITIONS,
  CHATGPT_DEFAULT_CODEX_MODEL,
  CHATGPT_MODEL,
  CHATGPT_PROVIDER,
  CANDIDATE_INTERVIEW_ACTIVITIES,
  MANAGED_ROUTES,
  createManagedRuntimeSettings,
  isCandidateInterviewActivity,
  isChatgptPinnedActivity,
  isCrossProductActivity,
  CLAUDE_PROVIDER,
  CLAUDE_SONNET_MODEL,
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_RUNTIME_POLICY,
  DEFAULT_LOCAL_FAILOVER,
  DEFAULT_ROLLOUT_SETTINGS,
  DEFAULT_MODELS,
  DEFAULT_ROUTES,
  GROQ_20B,
  GROQ_120B,
  GROQ_BASE_URL,
  GROQ_PROVIDER,
  LOCAL_CV_MODEL,
  LOCAL_MANAGED_MODEL,
  LOCAL_PROVIDER,
  TERRA_MODEL,
  TERRA_PROVIDER,
  createDefaultRuntimeSettings,
  failoverPolicyForRoute,
  isGatewayProvider,
  isManagedLocalProvider,
  isUserOwnedProvider,
  localProviderLabel,
  normalizeRuntimePolicy
};
