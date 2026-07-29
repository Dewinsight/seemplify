const GROQ_PROVIDER = 'groq';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_120B = 'openai/gpt-oss-120b';
const GROQ_20B = 'openai/gpt-oss-20b';
const LOCAL_PROVIDER = 'local-ollama';
const LOCAL_MANAGED_MODEL = 'managed-local-gpu';
const LOCAL_CV_MODEL = LOCAL_MANAGED_MODEL;
const TERRA_PROVIDER = 'local-codex';
const TERRA_MODEL = 'gpt-5.6-terra';
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
  'job.description': { label: 'Job description generation', group: 'Jobs', model: GROQ_120B, reasoningEffort: 'medium' },
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
  'experience.survey_generation': {
    label: 'Experience survey generation',
    group: 'Experience Management',
    model: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    reasoningEffort: 'medium',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'experience.response_analysis': {
    label: 'Experience response analysis',
    group: 'Experience Management',
    model: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    reasoningEffort: 'medium',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'experience.insight_generation': {
    label: 'Experience insight generation',
    group: 'Experience Management',
    model: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    reasoningEffort: 'high',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'experience.analyst_chat': {
    label: 'Experience analyst chat',
    group: 'Experience Management',
    model: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    reasoningEffort: 'medium',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'experience.report_generation': {
    label: 'Experience report generation',
    group: 'Experience Management',
    model: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    reasoningEffort: 'high',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'experience.translation': {
    label: 'Experience survey translation',
    group: 'Experience Management',
    model: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    reasoningEffort: 'medium',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'experience.social_listening': {
    label: 'Experience social listening',
    group: 'Experience Management',
    model: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    reasoningEffort: 'high',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
  'experience.journey_mapping': {
    label: 'Experience journey mapping',
    group: 'Experience Management',
    model: TERRA_MODEL,
    provider: TERRA_PROVIDER,
    reasoningEffort: 'high',
    defaultLocal: true,
    lockedProvider: true,
    failoverPolicy: 'wait_local'
  },
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
  if (ACTIVITY_DEFINITIONS[activity]?.lockedProvider === true) return 'wait_local';
  return isManagedLocalProvider(provider) ? 'groq_immediate' : 'none';
}

function isManagedLocalProvider(provider) {
  return ['local-codex', 'local-ollama', 'local-vllm'].includes(String(provider || '').trim().toLowerCase());
}

const DEFAULT_ROUTES = Object.freeze(Object.entries(ACTIVITY_DEFINITIONS).map(([activity, definition]) => ({
  activity,
  provider: definition.provider || GROQ_PROVIDER,
  model: definition.model,
  reasoningEffort: definition.reasoningEffort,
  lockedProvider: definition.lockedProvider === true,
  failoverPolicy: failoverPolicyForRoute(activity, definition.provider || GROQ_PROVIDER),
  enabled: true,
  routeVersion: 1
})));

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

function createDefaultRuntimeSettings() {
  return {
    key: 'global',
    providerEnabled: true,
    models: DEFAULT_MODELS.map((model) => ({ ...model })),
    routes: DEFAULT_ROUTES.map((route) => ({ ...route })),
    quotaGroups: [{ id: 'groq-primary', label: 'Groq primary organization', enabled: true }],
    alerts: { ...DEFAULT_ALERT_SETTINGS },
    localFailover: { ...DEFAULT_LOCAL_FAILOVER },
    rollout: { ...DEFAULT_ROLLOUT_SETTINGS },
    version: 1
  };
}

module.exports = {
  ACTIVITY_DEFINITIONS,
  DEFAULT_ALERT_SETTINGS,
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
  isManagedLocalProvider,
  localProviderLabel
};
