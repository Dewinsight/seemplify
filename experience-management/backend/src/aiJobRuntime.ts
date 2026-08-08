import type { AiJobRuntime } from './types.js';

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  if (typeof value === 'string') {
    try { return objectValue(JSON.parse(value)); }
    catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function optionalString(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function normalizedProvider(value: unknown) {
  const provider = optionalString(value)?.toLowerCase() || null;
  return provider === 'openai-codex' ? 'codex' : provider;
}

function runtimeRecord(value: unknown) {
  const runtime = objectValue(value);
  return ['provider', 'providerLabel', 'engine', 'model', 'reasoningEffort', 'action', 'actionId']
    .some((key) => optionalString(runtime[key])) ? runtime : null;
}

function firstCandidate(value: unknown) {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const candidate = optionalString(objectValue(item).value);
    if (candidate) return candidate;
  }
  return null;
}

export function aiJobRuntime(input: {
  jobInput: unknown;
  jobResult: unknown;
  providerResult: unknown;
  actionId: string;
}): AiJobRuntime {
  const providerJournal = objectValue(input.providerResult);
  const savedResult = objectValue(input.jobResult);
  const journalRuntime = runtimeRecord(providerJournal.runtime);
  const resultRuntime = runtimeRecord(savedResult.runtime);
  const actual = journalRuntime || resultRuntime;
  const snapshot = objectValue(objectValue(input.jobInput)._aiRuntime);

  if (actual) {
    const provider = normalizedProvider(actual.provider);
    return {
      source: journalRuntime ? 'provider_result' : 'job_result',
      status: 'actual',
      provider,
      providerLabel: optionalString(actual.providerLabel) || 'ChatGPT / Codex',
      model: optionalString(actual.model),
      reasoningEffort: optionalString(actual.reasoningEffort),
      actionId: optionalString(actual.action) || optionalString(actual.actionId)
        || optionalString(snapshot.codexActionId) || input.actionId
    };
  }

  if (Object.keys(snapshot).length) {
    const provider = normalizedProvider(snapshot.provider) || 'codex';
    return {
      source: 'job_snapshot',
      status: 'planned',
      provider,
      providerLabel: 'ChatGPT / Codex',
      model: optionalString(snapshot.codexModel) || firstCandidate(snapshot.codexModelCandidates),
      reasoningEffort: optionalString(snapshot.codexReasoningEffort) || firstCandidate(snapshot.codexReasoningEffortCandidates),
      actionId: optionalString(snapshot.codexActionId) || input.actionId
    };
  }

  return {
    source: 'legacy_default',
    status: 'unknown',
    provider: 'codex',
    providerLabel: 'ChatGPT / Codex',
    model: null,
    reasoningEffort: null,
    actionId: input.actionId
  };
}
