import { api, json } from '@/lib/api';
import type { JourneyMapReadModel } from '@/lib/journeyMaps';

export type JourneySuggestionState =
  | 'queued' | 'generating' | 'review' | 'ready_to_apply' | 'applied' | 'dismissed' | 'superseded' | 'failed';
export type JourneySuggestionDecisionValue = 'accepted' | 'rejected';

export interface JourneySuggestionDecision {
  id: string;
  decision: JourneySuggestionDecisionValue;
  sequence: number;
  actorUserId: string | null;
  reason: string;
  createdAt: string;
}

export interface JourneySuggestionChange {
  id: string;
  ordinal: number;
  operation: 'stage.add' | 'stage.update' | 'lane.add' | 'lane.update' | 'card.add' | 'card.update';
  targetType: 'stage' | 'lane' | 'card';
  targetRef: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  rationale: string;
  evidenceRefs: string[];
  warningCodes: string[];
  changeChecksum: string;
  decision: JourneySuggestionDecision | null;
  createdAt: string;
}

export interface JourneySuggestionEvidence {
  id: string;
  linkId: string;
  targetType: 'definition' | 'stage' | 'card';
  targetId: string;
  sourceType: string;
  sourceRef: string;
  sourceLabel: string;
  excerpt: string;
  population: string;
  sampleSize: number | null;
  collectedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  assessment: 'supports' | 'contradicts' | 'neutral';
  promptInjectionSuspected: boolean;
  currentAccess: 'available' | 'inaccessible';
  currentFingerprint: string | null;
}

export interface JourneySuggestionEvidenceOption {
  linkId: string;
  targetType: 'definition' | 'stage' | 'card';
  targetId: string;
  sourceType: string;
  sourceRef: string;
  sourceLabel: string;
  excerpt: string;
  assessment: 'supports' | 'contradicts' | 'neutral';
  promptInjectionSuspected: boolean;
}

export interface JourneySuggestionRun {
  id: string;
  spaceId: string;
  definitionId: string;
  baseVersionId: string;
  baseDefinitionRevision: number;
  baseMapChecksum: string;
  requestedByUserId: string | null;
  aiJobId: string | null;
  state: JourneySuggestionState;
  focus: string;
  summary: string;
  warningCodes: string[];
  promptContractVersion: string;
  changeSchemaVersion: number;
  selectedEvidenceChecksum: string;
  selectedEvidenceCount: number;
  revision: number;
  appliedVersionId: string | null;
  failureCode: string | null;
  createdAt: string;
  generationStartedAt: string | null;
  completedAt: string | null;
  appliedAt: string | null;
  updatedAt: string;
}

export interface JourneySuggestionDetail {
  run: JourneySuggestionRun;
  changes: JourneySuggestionChange[];
  evidence: JourneySuggestionEvidence[];
}

export function createJourneySuggestion(definitionId: string, input: {
  focus?: string; evidenceLinkIds?: string[];
}) {
  return api<{ suggestion: JourneySuggestionDetail; created: boolean; jobId: string | null; statusUrl: string | null }>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/ai-suggestions`, json('POST', input)
  );
}

export function listJourneySuggestions(definitionId: string, limit = 20) {
  const query = new URLSearchParams({ definitionId, limit: String(limit) });
  return api<{ suggestions: JourneySuggestionRun[] }>(`/api/journey-suggestions?${query.toString()}`);
}

export function listJourneySuggestionEvidence(definitionId: string, limit = 100) {
  const query = new URLSearchParams({ limit: String(limit) });
  return api<{ evidence: JourneySuggestionEvidenceOption[] }>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/ai-suggestions/evidence?${query.toString()}`
  );
}

export function readJourneySuggestion(runId: string) {
  return api<JourneySuggestionDetail>(`/api/journey-suggestions/${encodeURIComponent(runId)}`);
}

export function reviewJourneySuggestionChange(runId: string, changeId: string, input: {
  expectedRunRevision: number; decision: JourneySuggestionDecisionValue; reason: string;
}) {
  return api<JourneySuggestionDetail>(
    `/api/journey-suggestions/${encodeURIComponent(runId)}/changes/${encodeURIComponent(changeId)}/decision`,
    json('POST', input)
  );
}

export function applyJourneySuggestion(runId: string, input: {
  expectedRunRevision: number; expectedDefinitionRevision: number;
}) {
  return api<{ outcome: 'applied' | 'dismissed'; suggestion: JourneySuggestionDetail; map: JourneyMapReadModel | null }>(
    `/api/journey-suggestions/${encodeURIComponent(runId)}/apply`, json('POST', input)
  );
}

export function readJourneySuggestionAudit(runId: string) {
  return api<{ audit: Array<{
    id: string; runId: string; changeId: string | null; actorUserId: string | null;
    action: string; detail: Record<string, unknown>; createdAt: string;
  }> }>(`/api/journey-suggestions/${encodeURIComponent(runId)}/audit`);
}
