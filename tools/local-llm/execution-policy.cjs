const CLASSIFIER_VERSION = 'gateway-workload-v1';
const MAX_CONTEXT_BYTES = 1_200_000;
const MAX_TURNS = 10;

const WORKLOAD_POLICIES = Object.freeze({
  'long-context': Object.freeze({
    reasoningEffort: 'high', maxTurns: 8, defaultTokens: 12000, maxTokens: 16000,
    timeoutMs: 420000, maxBudgetUsd: 3.5
  }),
  'deep-analysis': Object.freeze({
    reasoningEffort: 'high', maxTurns: 6, defaultTokens: 8000, maxTokens: 12000,
    timeoutMs: 360000, maxBudgetUsd: 2.5
  }),
  'grounded-answer': Object.freeze({
    reasoningEffort: 'high', maxTurns: 5, defaultTokens: 6000, maxTokens: 8000,
    timeoutMs: 300000, maxBudgetUsd: 2
  }),
  'structured-extraction': Object.freeze({
    reasoningEffort: 'medium', maxTurns: 4, defaultTokens: 5000, maxTokens: 8000,
    timeoutMs: 300000, maxBudgetUsd: 1.5
  }),
  'short-composition': Object.freeze({
    reasoningEffort: 'medium', maxTurns: 2, defaultTokens: 3000, maxTokens: 5000,
    timeoutMs: 240000, maxBudgetUsd: 1
  }),
  conversation: Object.freeze({
    reasoningEffort: 'medium', maxTurns: 3, defaultTokens: 4000, maxTokens: 6000,
    timeoutMs: 240000, maxBudgetUsd: 1.25
  }),
  'safe-general': Object.freeze({
    reasoningEffort: 'medium', maxTurns: 4, defaultTokens: 6000, maxTokens: 6000,
    timeoutMs: 240000, maxBudgetUsd: 1.5
  })
});

const ACTIVITY_SIGNALS = Object.freeze({
  'deep-analysis': Object.freeze([
    'analysis', 'analytics', 'analyst_chat', 'insight', 'report', 'social_listening',
    'journey_mapping', 'cross_source', 'document_compare', 'recommendation', 'reasoning',
    'executive_brief', 'work_product', 'meeting_prepare', 'team_feedback', 'bias'
  ]),
  'grounded-answer': Object.freeze([
    'knowledge_answer', 'knowledge.ask', 'knowledge.draft', 'advisory', 'copilot'
  ]),
  'structured-extraction': Object.freeze([
    'cv_parse', 'classification', 'normalize', 'scoring', 'tool_selection', 'assistant.memory',
    'job_extract', 'graph_extract', 'action_extract', 'source_ingestion'
  ]),
  'short-composition': Object.freeze([
    'draft', 'reply', 'title', 'summary', 'summarization', 'generation', 'translation',
    'minutes', 'acknowledgement', 'introduction', 'clarification', 'description', 'requirements'
  ]),
  conversation: Object.freeze(['assistant.chat', 'interview.chat'])
});

const DEEP_SCHEMA_FIELDS = new Set([
  'executivesummary', 'findings', 'themes', 'risks', 'opportunities', 'recommendations',
  'recommendedactions', 'limitations', 'evidence', 'citations', 'confidence'
]);
const EXTRACTION_SCHEMA_FIELDS = new Set([
  'classification', 'category', 'label', 'score', 'skills', 'firstname', 'lastname',
  'email', 'entities', 'actions', 'intent'
]);
const GROUNDED_SCHEMA_FIELDS = new Set(['answer', 'citations', 'sources', 'evidence', 'caveats']);

function normalizedActivity(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 160);
}

function inputByteLength(messages) {
  return Buffer.byteLength(JSON.stringify(Array.isArray(messages) ? messages : []), 'utf8');
}

function schemaFieldNames(schema, output = new Set(), depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 8 || output.size >= 128) return output;
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [name, child] of Object.entries(schema.properties)) {
      output.add(String(name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80));
      schemaFieldNames(child, output, depth + 1);
      if (output.size >= 128) break;
    }
  }
  if (schema.items) schemaFieldNames(schema.items, output, depth + 1);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) {
      for (const child of schema[key].slice(0, 16)) schemaFieldNames(child, output, depth + 1);
    }
  }
  return output;
}

function intersectionCount(values, candidates) {
  let count = 0;
  for (const value of values) if (candidates.has(value)) count += 1;
  return count;
}

function activityWorkload(activity) {
  for (const workload of ['deep-analysis', 'grounded-answer', 'structured-extraction', 'short-composition', 'conversation']) {
    const matched = ACTIVITY_SIGNALS[workload].find((signal) => activity.includes(signal));
    if (matched) return { workload, matched };
  }
  return null;
}

function schemaWorkload(schema) {
  if (!schema || typeof schema !== 'object') return null;
  const fields = schemaFieldNames(schema);
  const deepCount = intersectionCount(fields, DEEP_SCHEMA_FIELDS);
  const groundedCount = intersectionCount(fields, GROUNDED_SCHEMA_FIELDS);
  const extractionCount = intersectionCount(fields, EXTRACTION_SCHEMA_FIELDS);
  if (deepCount >= 3) return { workload: 'deep-analysis', matched: `deep_fields:${deepCount}` };
  if (groundedCount >= 2) return { workload: 'grounded-answer', matched: `grounded_fields:${groundedCount}` };
  if (extractionCount >= 2) return { workload: 'structured-extraction', matched: `extraction_fields:${extractionCount}` };
  return null;
}

function boundedRequestedTokens(value, fallback, maximum) {
  const requested = Number(value);
  const normalized = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : fallback;
  return Math.max(1, Math.min(normalized, maximum));
}

function resolveExecutionPolicy(input = {}) {
  const activity = normalizedActivity(input.activity);
  const inputBytes = inputByteLength(input.messages);
  if (inputBytes > MAX_CONTEXT_BYTES) {
    const error = new Error('Request context exceeds the managed 1.2 MB safety limit');
    error.code = 'LOCAL_LLM_CONTEXT_TOO_LARGE';
    error.status = 413;
    error.retryable = false;
    throw error;
  }

  const outputMode = input.jsonSchema && typeof input.jsonSchema === 'object' ? 'json_schema' : 'text';
  let classification;
  let confidence;
  let reason;
  let fallback = false;
  const signals = [];

  if (inputBytes > 300_000) {
    classification = { workload: 'long-context', matched: 'input_bytes_over_300k' };
    confidence = 0.99;
    reason = 'long_context_threshold';
  } else {
    classification = activityWorkload(activity);
    if (classification) {
      confidence = 0.96;
      reason = 'activity_contract';
    } else {
      classification = schemaWorkload(input.jsonSchema);
      if (classification) {
        confidence = 0.76;
        reason = 'schema_contract';
      }
    }
  }

  if (!classification) {
    classification = { workload: 'safe-general', matched: 'none' };
    confidence = 0.25;
    reason = 'unclassified_workload_default';
    fallback = true;
  }

  const policy = WORKLOAD_POLICIES[classification.workload];
  const responseFormat = outputMode === 'json_schema'
    ? 'json_schema'
    : ['long-context', 'deep-analysis', 'grounded-answer'].includes(classification.workload)
      ? 'markdown'
      : 'plain_text';
  if (activity) signals.push(`activity:${activity}`);
  signals.push(`match:${classification.matched}`, `output:${outputMode}`, `format:${responseFormat}`);
  if (inputBytes > 300_000) signals.push('context:long');
  if (input.reasoningEffort) signals.push(`requested_effort:${String(input.reasoningEffort).toLowerCase().slice(0, 12)}`);
  const runtimeProfile = normalizedActivity(input.runtimeProfile);
  if (runtimeProfile) signals.push(`profile:${runtimeProfile}`);

  return Object.freeze({
    classifierVersion: CLASSIFIER_VERSION,
    workload: classification.workload,
    outputMode,
    responseFormat,
    reasoningEffort: policy.reasoningEffort,
    maxTurns: Math.min(MAX_TURNS, policy.maxTurns),
    maxTokens: boundedRequestedTokens(input.maxTokens, policy.defaultTokens, policy.maxTokens),
    timeoutMs: policy.timeoutMs,
    maxBudgetUsd: policy.maxBudgetUsd,
    inputBytes,
    confidence,
    fallback,
    reason,
    signals: Object.freeze(signals.slice(0, 8))
  });
}

function executionPolicyTelemetry(policy) {
  if (!policy) return undefined;
  return {
    classifierVersion: policy.classifierVersion,
    workload: policy.workload,
    outputMode: policy.outputMode,
    responseFormat: policy.responseFormat,
    reasoningEffort: policy.reasoningEffort,
    maxTurns: policy.maxTurns,
    maxTokens: policy.maxTokens,
    timeoutMs: policy.timeoutMs,
    confidence: policy.confidence,
    fallback: policy.fallback,
    reason: policy.reason,
    signals: Array.isArray(policy.signals) ? [...policy.signals] : []
  };
}

module.exports = {
  CLASSIFIER_VERSION,
  MAX_CONTEXT_BYTES,
  MAX_TURNS,
  WORKLOAD_POLICIES,
  executionPolicyTelemetry,
  resolveExecutionPolicy,
  schemaFieldNames
};
