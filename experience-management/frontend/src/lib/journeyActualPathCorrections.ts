import { api } from '@/lib/api';

const states = ['pending', 'leased', 'retryable', 'completed', 'failed', 'cancelled'] as const;
export type JourneyActualPathCorrectionState = typeof states[number];
export type JourneyActualPathCorrectionRun = {
  id: string; reason: 'manual'; journeyDefinitionId: string; journeyMapVersionId: string;
  state: JourneyActualPathCorrectionState; attemptCount: number; maxAttempts: number;
  requestReasonProof: { sha256: string; length: number } | null;
  progress: { processedCount: number; matchedCount: number; noMatchCount: number;
    changedCurrentStageCount: number; changedTerminalStateCount: number; noChangeCount: number } | null;
  errorCode: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
};

function fail(label: string): never { throw new Error(`${label} is invalid.`); }
function object(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label);
  return value as Record<string, unknown>;
}
function exact(value: unknown, label: string, keys: readonly string[]) {
  const row = object(value, label); const expected = new Set(keys);
  if (Object.keys(row).some((key) => !expected.has(key)) || keys.some((key) => !(key in row))) fail(label);
  return row;
}
function text(value: unknown, label: string) { return typeof value === 'string' && value ? value : fail(label); }
function iso(value: unknown, label: string) { const result = text(value, label); return Number.isFinite(Date.parse(result)) ? result : fail(label); }
function nullableText(value: unknown, label: string) { return value === null ? null : text(value, label); }
function integer(value: unknown, label: string) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(label); }

export function parseJourneyActualPathCorrectionRun(value: unknown): JourneyActualPathCorrectionRun {
  const row = exact(value, 'actual path correction run', ['id', 'reason', 'journeyDefinitionId', 'journeyMapVersionId',
    'state', 'attemptCount', 'maxAttempts', 'requestReasonProof', 'progress', 'errorCode', 'createdAt', 'updatedAt', 'completedAt']);
  const state = text(row.state, 'actual path correction state');
  if (!states.includes(state as JourneyActualPathCorrectionState) || row.reason !== 'manual') fail('actual path correction state');
  const proof = row.requestReasonProof === null ? null : exact(row.requestReasonProof, 'actual path correction reason proof', ['sha256', 'length']);
  const proofSha = proof ? text(proof.sha256, 'actual path correction reason SHA-256') : null;
  if (proofSha && !/^[a-f0-9]{64}$/u.test(proofSha)) fail('actual path correction reason SHA-256');
  const progress = row.progress === null ? null : exact(row.progress, 'actual path correction progress', [
    'processedCount', 'matchedCount', 'noMatchCount', 'changedCurrentStageCount', 'changedTerminalStateCount', 'noChangeCount']);
  return { id: text(row.id, 'actual path correction id'), reason: 'manual',
    journeyDefinitionId: text(row.journeyDefinitionId, 'actual path correction journey'),
    journeyMapVersionId: text(row.journeyMapVersionId, 'actual path correction version'),
    state: state as JourneyActualPathCorrectionState, attemptCount: integer(row.attemptCount, 'actual path correction attempts'),
    maxAttempts: integer(row.maxAttempts, 'actual path correction maximum attempts'),
    requestReasonProof: proof ? { sha256: proofSha!, length: integer(proof.length, 'actual path correction reason length') } : null,
    progress: progress ? { processedCount: integer(progress.processedCount, 'processed count'),
      matchedCount: integer(progress.matchedCount, 'matched count'), noMatchCount: integer(progress.noMatchCount, 'no-match count'),
      changedCurrentStageCount: integer(progress.changedCurrentStageCount, 'changed-stage count'),
      changedTerminalStateCount: integer(progress.changedTerminalStateCount, 'changed-terminal count'),
      noChangeCount: integer(progress.noChangeCount, 'no-change count') } : null,
    errorCode: nullableText(row.errorCode, 'actual path correction error'), createdAt: iso(row.createdAt, 'actual path correction created time'),
    updatedAt: iso(row.updatedAt, 'actual path correction updated time'),
    completedAt: row.completedAt === null ? null : iso(row.completedAt, 'actual path correction completed time') };
}

export async function listJourneyActualPathCorrections(journeyDefinitionId: string) {
  const query = new URLSearchParams({ journeyDefinitionId, limit: '20' });
  const raw = exact(await api<unknown>(`/api/journey-metrics/actual-path-corrections?${query}`),
    'actual path correction list', ['runs']);
  if (!Array.isArray(raw.runs)) fail('actual path correction runs');
  return raw.runs.map(parseJourneyActualPathCorrectionRun);
}

export async function requestJourneyActualPathCorrection(input: { journeyDefinitionId: string;
  journeyMapVersionId: string; requestReason: string; windowStart?: string; windowEnd?: string }) {
  const raw = exact(await api<unknown>('/api/journey-metrics/actual-path-corrections', {
    method: 'POST', headers: { 'Idempotency-Key': `actual-path-correction:${crypto.randomUUID()}` },
    body: JSON.stringify(input)
  }), 'actual path correction response', ['run', 'replayed']);
  if (typeof raw.replayed !== 'boolean') fail('actual path correction replay state');
  return { run: parseJourneyActualPathCorrectionRun(raw.run), replayed: raw.replayed };
}
