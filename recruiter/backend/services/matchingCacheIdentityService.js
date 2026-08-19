const crypto = require('crypto');
const aiRuntimeService = require('./aiRuntime/aiRuntimeService');
const { getAIRequestContext } = require('./aiRuntime/requestContext');
const { getEmbeddingRuntimeConfig } = require('../config/embeddingRuntimeConfig');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function fingerprintMatchingInput(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(value || {})))
    .digest('hex');
}

function matchingJobFingerprint(job = {}) {
  const department = job.department && typeof job.department === 'object'
    ? (job.department._id || job.department.id || job.department.name || '')
    : (job.department || '');
  return fingerprintMatchingInput({
    id: String(job._id || job.id || ''),
    title: job.title || '',
    description: job.description || '',
    requirements: job.requirements || '',
    responsibilities: job.responsibilities || '',
    skills: job.skills || [],
    experience: job.experience || '',
    education: job.education || '',
    level: job.level || '',
    location: job.location || '',
    department: String(department),
    type: job.type || ''
  });
}

async function resolveMatchingRuntimeIdentity(activity, promptVersion) {
  const settings = await aiRuntimeService.getSettings();
  const context = getAIRequestContext();
  const selectedRuntime = await aiRuntimeService.selectRuntime(settings, context);
  let route = aiRuntimeService.resolveRoute(activity, settings, selectedRuntime);
  const actorId = String(context.runtimeActorId || context.actorId || '').trim();
  if (route.provider === 'chatgpt-connect') {
    route = await aiRuntimeService.resolveUserRoute(actorId, activity, route);
  }

  return {
    provider: String(route.provider || selectedRuntime || 'unknown'),
    model: String(
      route.provider === 'chatgpt-connect'
        ? (route.codexModel || route.model || 'unknown')
        : (route.model || 'unknown')
    ),
    routeVersion: String(route.routeVersion || settings.version || 1),
    promptVersion: String(promptVersion || 'unknown'),
    reasoningEffort: String(route.reasoningEffort || '')
  };
}

function vectorMatchingIdentity(job) {
  return {
    provider: 'weaviate',
    model: getEmbeddingRuntimeConfig().model,
    routeVersion: 'quick-rerank-v4',
    promptVersion: 'full-profile-evidence-v4',
    inputFingerprint: matchingJobFingerprint(job)
  };
}

module.exports = {
  fingerprintMatchingInput,
  matchingJobFingerprint,
  resolveMatchingRuntimeIdentity,
  vectorMatchingIdentity
};
