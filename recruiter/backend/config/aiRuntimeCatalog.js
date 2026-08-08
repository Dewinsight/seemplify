'use strict';

const CHATGPT_PROVIDER = 'chatgpt-connect';
const CHATGPT_MODEL = 'chatgpt-connected-account';
const CHATGPT_DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
const LOCAL_PROVIDER = 'local-inference';
const LOCAL_MODEL = 'control-center-selected-model';

const activities = {
  'recruiter.general': ['Recruiter AI - general', 'Recruiter', 'medium'],
  'candidate.cv_parse': ['Candidate CV parsing', 'Candidates', 'medium'],
  'candidate.insights': ['Candidate insights', 'Candidates', 'medium'],
  'job.description': ['Job description generation', 'Jobs', 'high'],
  'job.requirements': ['Job requirements generation', 'Jobs', 'medium'],
  'job.normalize': ['Job field normalization', 'Jobs', 'medium'],
  'matching.analysis': ['Candidate matching analysis', 'Matching', 'high'],
  'matching.report': ['Candidate matching report', 'Matching', 'high'],
  'assistant.chat': ['Recruiter assistant', 'Assistant', 'medium'],
  'assistant.tool_selection': ['Assistant tool selection', 'Assistant', 'medium'],
  'assistant.memory': ['Assistant memory classification', 'Assistant', 'medium'],
  'assistant.title': ['Assistant chat title', 'Assistant', 'low'],
  'assistant.job_extract': ['Assistant job extraction', 'Assistant', 'medium'],
  'analytics.candidates': ['Candidate analytics', 'Analytics', 'medium'],
  'analytics.jobs': ['Job analytics', 'Analytics', 'medium'],
  'analytics.hiring': ['Hiring analytics', 'Analytics', 'medium'],
  'report.analysis': ['Report analysis', 'Analytics', 'medium'],
  'interview.questions': ['Interview question generation', 'Interviews', 'medium'],
  'interview.bias': ['Interview bias analysis', 'Interviews', 'medium'],
  'interview.analysis': ['Interview analysis', 'Interviews', 'high'],
  'interview.summary': ['Interview summary', 'Interviews', 'medium'],
  'interview.team_feedback': ['Interview team feedback', 'Interviews', 'medium'],
  'ai_interview.chat.introduction': ['AI Interview introduction', 'AI Interview', 'low'],
  'ai_interview.chat.clarification': ['AI Interview clarification', 'AI Interview', 'low'],
  'ai_interview.chat.acknowledgement': ['AI Interview acknowledgement', 'AI Interview', 'low'],
  'ai_interview.question_generation': ['AI Interview question generation', 'AI Interview', 'medium'],
  'ai_interview.cv_parse': ['AI Interview CV parsing', 'AI Interview', 'medium'],
  'ai_interview.scoring': ['AI Interview scoring', 'AI Interview', 'high']
};

const ACTIVITY_DEFINITIONS = Object.freeze(Object.fromEntries(
  Object.entries(activities).map(([id, [label, group, reasoningEffort]]) => [id, {
    label, group, reasoningEffort, provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL
  }])
));

const CANDIDATE_INTERVIEW_ACTIVITIES = Object.freeze([
  'ai_interview.chat.introduction',
  'ai_interview.chat.clarification',
  'ai_interview.chat.acknowledgement',
  'ai_interview.scoring'
]);

const DEFAULT_MODELS = Object.freeze([{
  id: CHATGPT_MODEL,
  provider: CHATGPT_PROVIDER,
  label: 'ChatGPT connected account',
  capabilities: ['text', 'reasoning', 'json_object', 'json_schema', 'tools', 'streaming'],
  pricing: { inputPerMillionUsd: 0, cachedInputPerMillionUsd: 0, outputPerMillionUsd: 0 },
  contextWindow: 131072,
  maxOutputTokens: 65536,
  available: true,
  enabled: true,
  userOwned: true
}, {
  id: LOCAL_MODEL,
  provider: LOCAL_PROVIDER,
  label: 'Local inference (Control Center selection)',
  capabilities: ['text', 'reasoning', 'json_object', 'json_schema', 'tools', 'streaming'],
  pricing: { inputPerMillionUsd: 0, cachedInputPerMillionUsd: 0, outputPerMillionUsd: 0 },
  contextWindow: 131072,
  maxOutputTokens: 65536,
  available: true,
  enabled: true,
  managed: true
}]);

const DEFAULT_ROUTES = Object.freeze(Object.entries(ACTIVITY_DEFINITIONS).map(([activity, definition]) => ({
  activity,
  provider: CHATGPT_PROVIDER,
  model: CHATGPT_MODEL,
  codexModel: CHATGPT_DEFAULT_CODEX_MODEL,
  reasoningEffort: definition.reasoningEffort,
  failoverPolicy: 'chatgpt_required',
  enabled: true,
  routeVersion: 2
})));

const DEFAULT_RUNTIME_POLICY = Object.freeze({
  localEnabled: true,
  chatgptEnabled: true,
  chatgptRequired: false,
  defaultRuntime: 'local'
});

const DEFAULT_ALERT_SETTINGS = Object.freeze({
  enabled: true,
  recipients: [],
  dailyRemainingPercent: [25, 10, 0],
  sustainedRateLimitCount: 3,
  sustainedRateLimitWindowMinutes: 5
});

function normalizeRuntimePolicy(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const localEnabled = candidate.localEnabled !== false;
  const chatgptEnabled = candidate.chatgptEnabled !== false;
  const requested = ['local', 'chatgpt'].includes(candidate.defaultRuntime)
    ? candidate.defaultRuntime : DEFAULT_RUNTIME_POLICY.defaultRuntime;
  const defaultRuntime = requested === 'local' && !localEnabled && chatgptEnabled
    ? 'chatgpt'
    : requested === 'chatgpt' && !chatgptEnabled && localEnabled
      ? 'local'
      : requested;
  return {
    localEnabled,
    chatgptEnabled,
    chatgptRequired: chatgptEnabled && !localEnabled,
    defaultRuntime
  };
}

function createDefaultRuntimeSettings() {
  return {
    key: 'global',
    providerEnabled: true,
    models: DEFAULT_MODELS.map((item) => ({ ...item })),
    routes: DEFAULT_ROUTES.map((item) => ({ ...item })),
    quotaGroups: [],
    runtimePolicy: { ...DEFAULT_RUNTIME_POLICY },
    alerts: { ...DEFAULT_ALERT_SETTINGS },
    version: 2
  };
}

function failoverPolicyForRoute(_activity, provider) {
  return provider === LOCAL_PROVIDER ? 'local_required' : 'chatgpt_required';
}
function isCandidateInterviewActivity(activity) { return CANDIDATE_INTERVIEW_ACTIVITIES.includes(String(activity || '')); }
function isChatgptPinnedActivity(activity) { return Boolean(ACTIVITY_DEFINITIONS[activity]); }
function isGatewayProvider(provider) { return [CHATGPT_PROVIDER, LOCAL_PROVIDER].includes(String(provider || '')); }
function isUserOwnedProvider(provider) { return String(provider || '') === CHATGPT_PROVIDER; }
function isLocalProvider(provider) { return String(provider || '') === LOCAL_PROVIDER; }

module.exports = {
  ACTIVITY_DEFINITIONS,
  CANDIDATE_INTERVIEW_ACTIVITIES,
  CHATGPT_DEFAULT_CODEX_MODEL,
  CHATGPT_MODEL,
  CHATGPT_PROVIDER,
  LOCAL_MODEL,
  LOCAL_PROVIDER,
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_MODELS,
  DEFAULT_ROUTES,
  DEFAULT_RUNTIME_POLICY,
  createDefaultRuntimeSettings,
  failoverPolicyForRoute,
  isCandidateInterviewActivity,
  isChatgptPinnedActivity,
  isGatewayProvider,
  isLocalProvider,
  isUserOwnedProvider,
  normalizeRuntimePolicy
};
