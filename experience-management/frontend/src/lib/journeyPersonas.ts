import { api, json } from '@/lib/api';

export type PersonaLifecycleState = 'draft' | 'in_review' | 'active' | 'retired';
export type PersonaReviewState = 'draft' | 'in_review' | 'changes_requested' | 'approved';
export type PersonaClaimType = 'summary' | 'attribute' | 'goal' | 'behaviour' | 'need' | 'barrier';
export type PersonaEvidenceState = 'current' | 'changed' | 'invalidated' | 'deleted';
export type PersonaSourceAccess = 'available' | 'inaccessible';

export interface PersonaRecord {
  id: string;
  name: string;
  summary: string;
  lifecycleState: PersonaLifecycleState;
  ownerUserId: string | null;
  source: 'workspace' | 'legacy_audience_draft' | 'ai_draft';
  attributes: Record<string, string>;
  goals: string[];
  behaviours: string[];
  needs: string[];
  barriers: string[];
  reviewAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  linkedJourneyCount: number;
  evidenceState: string;
}

export interface PersonaClaimEvidence {
  id: string;
  evidenceLinkId: string;
  assessmentAtLink: 'supports' | 'contradicts' | 'neutral';
  pinnedFingerprint: string;
  currentFingerprint: string | null;
  state: PersonaEvidenceState;
  createdByUserId: string | null;
  createdAt: string;
}

export interface PersonaClaim {
  id: string;
  personaVersionId: string;
  type: PersonaClaimType;
  label: string;
  value: string;
  ordinal: number;
  checksum: string;
  evidence: PersonaClaimEvidence[];
}

export interface PersonaReviewEvent {
  id: string;
  sequence: number;
  action: 'submitted' | 'approved' | 'changes_requested' | 'withdrawn';
  actorUserId: string | null;
  comment: string;
  createdAt: string;
}

export interface PersonaVersion {
  id: string;
  personaId: string;
  spaceId: string;
  versionNumber: number;
  name: string;
  summary: string;
  lifecycleState: PersonaLifecycleState;
  ownerUserId: string | null;
  source: PersonaRecord['source'];
  attributes: Record<string, string>;
  goals: string[];
  behaviours: string[];
  needs: string[];
  barriers: string[];
  reviewAt: string | null;
  checksum: string;
  createdByUserId: string | null;
  createdAt: string;
  reviewState: PersonaReviewState;
  claims: PersonaClaim[];
  reviewEvents: PersonaReviewEvent[];
  evidenceCoverage: {
    claimCount: number;
    evidencedClaimCount: number;
    currentSupportingLinks: number;
    changedLinks: number;
    invalidatedLinks: number;
  };
}

export interface PersonaSourceEvidence {
  id: string;
  sourceType: string;
  sourceLabel: string;
  assessment: 'supports' | 'contradicts' | 'neutral';
  sourceAccess: PersonaSourceAccess;
  refreshStatus: 'current' | 'changed' | 'unavailable';
  invalidatedAt: string | null;
}

export interface PersonaUsage {
  workingJourneys: Array<{ definitionId: string; name: string; ordinal: number }>;
  publishedSnapshots: Array<{
    definitionId: string; name: string; mapVersionId: string; mapVersionNumber: number;
    personaVersionId: string; reviewState: PersonaReviewState; pinnedAt: string;
  }>;
}

export type PersonaWriteInput = {
  name: string;
  summary?: string;
  lifecycleState?: PersonaLifecycleState;
  attributes?: Record<string, string>;
  goals?: string[];
  behaviours?: string[];
  needs?: string[];
  barriers?: string[];
  reviewAt?: string | null;
};

export class PersonaResponseError extends Error {
  constructor(message: string) { super(message); this.name = 'PersonaResponseError'; }
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersonaResponseError(`${context} was not a valid object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, context: string) {
  if (typeof value !== 'string') throw new PersonaResponseError(`${context} was not text.`);
  return value;
}

function nullableText(value: unknown, context: string) {
  return value === null ? null : text(value, context);
}

function integer(value: unknown, context: string) {
  if (!Number.isSafeInteger(value)) throw new PersonaResponseError(`${context} was not an integer.`);
  return Number(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new PersonaResponseError(`${context} contained an unsupported value.`);
  }
  return value as T;
}

function texts(value: unknown, context: string) {
  if (!Array.isArray(value)) throw new PersonaResponseError(`${context} was not a list.`);
  return value.map((item, index) => text(item, `${context}[${index}]`));
}

function attributes(value: unknown, context: string) {
  const source = record(value, context);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, text(item, `${context}.${key}`)]));
}

function parsePersona(value: unknown): PersonaRecord {
  const item = record(value, 'Persona');
  return {
    id: text(item.id, 'Persona id'),
    name: text(item.name, 'Persona name'),
    summary: text(item.summary, 'Persona summary'),
    lifecycleState: oneOf(item.lifecycleState, ['draft', 'in_review', 'active', 'retired'], 'Persona lifecycle'),
    ownerUserId: nullableText(item.ownerUserId, 'Persona owner'),
    source: oneOf(item.source, ['workspace', 'legacy_audience_draft', 'ai_draft'], 'Persona source'),
    attributes: attributes(item.attributes, 'Persona attributes'),
    goals: texts(item.goals, 'Persona goals'),
    behaviours: texts(item.behaviours, 'Persona behaviours'),
    needs: texts(item.needs, 'Persona needs'),
    barriers: texts(item.barriers, 'Persona barriers'),
    reviewAt: nullableText(item.reviewAt, 'Persona review date'),
    revision: integer(item.revision, 'Persona revision'),
    createdAt: text(item.createdAt, 'Persona created time'),
    updatedAt: text(item.updatedAt, 'Persona updated time'),
    linkedJourneyCount: item.linkedJourneyCount === undefined ? 0 : integer(item.linkedJourneyCount, 'Linked journey count'),
    evidenceState: item.evidenceState === undefined ? 'hypothesis' : text(item.evidenceState, 'Persona evidence state')
  };
}

function parseClaimEvidence(value: unknown): PersonaClaimEvidence {
  const item = record(value, 'Persona claim evidence');
  return {
    id: text(item.id, 'Claim evidence id'),
    evidenceLinkId: text(item.evidenceLinkId, 'Evidence link id'),
    assessmentAtLink: oneOf(item.assessmentAtLink, ['supports', 'contradicts', 'neutral'], 'Evidence assessment'),
    pinnedFingerprint: text(item.pinnedFingerprint, 'Pinned evidence fingerprint'),
    currentFingerprint: nullableText(item.currentFingerprint, 'Current evidence fingerprint'),
    state: oneOf(item.state, ['current', 'changed', 'invalidated', 'deleted'], 'Evidence state'),
    createdByUserId: nullableText(item.createdByUserId, 'Evidence author'),
    createdAt: text(item.createdAt, 'Evidence created time')
  };
}

function parseClaim(value: unknown): PersonaClaim {
  const item = record(value, 'Persona claim');
  if (!Array.isArray(item.evidence)) throw new PersonaResponseError('Persona claim evidence was not a list.');
  return {
    id: text(item.id, 'Claim id'),
    personaVersionId: text(item.personaVersionId, 'Claim version id'),
    type: oneOf(item.type, ['summary', 'attribute', 'goal', 'behaviour', 'need', 'barrier'], 'Claim type'),
    label: text(item.label, 'Claim label'),
    value: text(item.value, 'Claim value'),
    ordinal: integer(item.ordinal, 'Claim ordinal'),
    checksum: text(item.checksum, 'Claim checksum'),
    evidence: item.evidence.map(parseClaimEvidence)
  };
}

function parseReviewEvent(value: unknown): PersonaReviewEvent {
  const item = record(value, 'Persona review event');
  return {
    id: text(item.id, 'Review event id'),
    sequence: integer(item.sequence, 'Review sequence'),
    action: oneOf(item.action, ['submitted', 'approved', 'changes_requested', 'withdrawn'], 'Review action'),
    actorUserId: nullableText(item.actorUserId, 'Review actor'),
    comment: text(item.comment, 'Review comment'),
    createdAt: text(item.createdAt, 'Review created time')
  };
}

export function parsePersonaVersion(value: unknown): PersonaVersion {
  const item = record(value, 'Persona version');
  const coverage = record(item.evidenceCoverage, 'Persona evidence coverage');
  if (!Array.isArray(item.claims) || !Array.isArray(item.reviewEvents)) {
    throw new PersonaResponseError('Persona version history was incomplete.');
  }
  return {
    id: text(item.id, 'Persona version id'),
    personaId: text(item.personaId, 'Version persona id'),
    spaceId: text(item.spaceId, 'Version space id'),
    versionNumber: integer(item.versionNumber, 'Persona version number'),
    name: text(item.name, 'Version name'),
    summary: text(item.summary, 'Version summary'),
    lifecycleState: oneOf(item.lifecycleState, ['draft', 'in_review', 'active', 'retired'], 'Version lifecycle'),
    ownerUserId: nullableText(item.ownerUserId, 'Version owner'),
    source: oneOf(item.source, ['workspace', 'legacy_audience_draft', 'ai_draft'], 'Version source'),
    attributes: attributes(item.attributes, 'Version attributes'),
    goals: texts(item.goals, 'Version goals'),
    behaviours: texts(item.behaviours, 'Version behaviours'),
    needs: texts(item.needs, 'Version needs'),
    barriers: texts(item.barriers, 'Version barriers'),
    reviewAt: nullableText(item.reviewAt, 'Version review date'),
    checksum: text(item.checksum, 'Version checksum'),
    createdByUserId: nullableText(item.createdByUserId, 'Version author'),
    createdAt: text(item.createdAt, 'Version created time'),
    reviewState: oneOf(item.reviewState, ['draft', 'in_review', 'changes_requested', 'approved'], 'Version review state'),
    claims: item.claims.map(parseClaim),
    reviewEvents: item.reviewEvents.map(parseReviewEvent),
    evidenceCoverage: {
      claimCount: integer(coverage.claimCount, 'Claim count'),
      evidencedClaimCount: integer(coverage.evidencedClaimCount, 'Evidenced claim count'),
      currentSupportingLinks: integer(coverage.currentSupportingLinks, 'Current supporting links'),
      changedLinks: integer(coverage.changedLinks, 'Changed evidence count'),
      invalidatedLinks: integer(coverage.invalidatedLinks, 'Invalidated evidence count')
    }
  };
}

function parseSourceEvidence(value: unknown): PersonaSourceEvidence {
  const item = record(value, 'Persona source evidence');
  return {
    id: text(item.id, 'Source evidence id'),
    sourceType: text(item.sourceType, 'Source evidence type'),
    sourceLabel: text(item.sourceLabel, 'Source evidence label'),
    assessment: oneOf(item.assessment, ['supports', 'contradicts', 'neutral'], 'Source evidence assessment'),
    sourceAccess: oneOf(item.sourceAccess, ['available', 'inaccessible'], 'Source evidence access'),
    refreshStatus: oneOf(item.refreshStatus, ['current', 'changed', 'unavailable'], 'Source evidence refresh state'),
    invalidatedAt: nullableText(item.invalidatedAt, 'Source evidence invalidation time')
  };
}

export async function listPersonaLibrary() {
  const response = record(await api<unknown>('/api/journey-personas'), 'Persona list response');
  if (!Array.isArray(response.personas)) throw new PersonaResponseError('Persona list was not an array.');
  return response.personas.map(parsePersona);
}

export async function readPersonaWorkspace(personaId: string) {
  const response = record(await api<unknown>(`/api/journey-personas/${encodeURIComponent(personaId)}`), 'Persona response');
  if (!Array.isArray(response.evidence)) throw new PersonaResponseError('Persona source evidence was not a list.');
  return { persona: parsePersona(response.persona), evidence: response.evidence.map(parseSourceEvidence) };
}

export async function listPersonaVersions(personaId: string) {
  const response = record(await api<unknown>(`/api/journey-personas/${encodeURIComponent(personaId)}/versions`),
    'Persona versions response');
  if (!Array.isArray(response.versions)) throw new PersonaResponseError('Persona versions were not a list.');
  return response.versions.map(parsePersonaVersion);
}

export async function readPersonaVersion(personaId: string, versionId: string) {
  const response = record(await api<unknown>(`/api/journey-personas/${encodeURIComponent(personaId)}/versions/${encodeURIComponent(versionId)}`),
    'Persona version response');
  const sourceAccessValue = record(response.sourceAccess, 'Persona source access');
  const sourceAccess = Object.fromEntries(Object.entries(sourceAccessValue).map(([id, access]) => [
    id, oneOf(access, ['available', 'inaccessible'], `Source access ${id}`)
  ])) as Record<string, PersonaSourceAccess>;
  return { version: parsePersonaVersion(response.version), sourceAccess };
}

export async function readPersonaUsage(personaId: string): Promise<PersonaUsage> {
  const response = record(await api<unknown>(`/api/journey-personas/${encodeURIComponent(personaId)}/usage`), 'Persona usage');
  if (!Array.isArray(response.workingJourneys) || !Array.isArray(response.publishedSnapshots)) {
    throw new PersonaResponseError('Persona usage was incomplete.');
  }
  return {
    workingJourneys: response.workingJourneys.map((value) => {
      const item = record(value, 'Working journey usage');
      return { definitionId: text(item.definitionId, 'Journey id'), name: text(item.name, 'Journey name'),
        ordinal: integer(item.ordinal, 'Journey persona order') };
    }),
    publishedSnapshots: response.publishedSnapshots.map((value) => {
      const item = record(value, 'Published persona usage');
      return {
        definitionId: text(item.definitionId, 'Published journey id'), name: text(item.name, 'Published journey name'),
        mapVersionId: text(item.mapVersionId, 'Map version id'), mapVersionNumber: integer(item.mapVersionNumber, 'Map version number'),
        personaVersionId: text(item.personaVersionId, 'Pinned persona version id'),
        reviewState: oneOf(item.reviewState, ['draft', 'in_review', 'changes_requested', 'approved'], 'Pinned review state'),
        pinnedAt: text(item.pinnedAt, 'Persona pinned time')
      };
    })
  };
}

export async function createLibraryPersona(input: PersonaWriteInput) {
  return parsePersona(await api<unknown>('/api/journey-personas', json('POST', input)));
}

export async function updateLibraryPersona(personaId: string, expectedRevision: number, input: Partial<PersonaWriteInput>) {
  return parsePersona(await api<unknown>(`/api/journey-personas/${encodeURIComponent(personaId)}`,
    json('PATCH', { expectedRevision, ...input })));
}

async function versionMutation(path: string, body: unknown) {
  return parsePersonaVersion(await api<unknown>(path, json('POST', body)));
}

export function attachPersonaClaimEvidence(input: {
  personaId: string; versionId: string; claimId: string; evidenceLinkId: string; expectedRevision: number;
}) {
  return versionMutation(`/api/journey-personas/${encodeURIComponent(input.personaId)}/versions/${encodeURIComponent(input.versionId)}`
    + `/claims/${encodeURIComponent(input.claimId)}/evidence`, {
    evidenceLinkId: input.evidenceLinkId, expectedRevision: input.expectedRevision
  });
}

export function submitPersonaForReview(personaId: string, versionId: string, expectedRevision: number, comment: string) {
  return versionMutation(`/api/journey-personas/${encodeURIComponent(personaId)}/versions/${encodeURIComponent(versionId)}/submit`,
    { expectedRevision, comment });
}

export function reviewPersonaVersion(
  personaId: string,
  versionId: string,
  expectedRevision: number,
  decision: 'approved' | 'changes_requested',
  comment: string
) {
  return versionMutation(`/api/journey-personas/${encodeURIComponent(personaId)}/versions/${encodeURIComponent(versionId)}/review`,
    { expectedRevision, decision, comment });
}

export function withdrawPersonaReview(personaId: string, versionId: string, expectedRevision: number, comment: string) {
  return versionMutation(`/api/journey-personas/${encodeURIComponent(personaId)}/versions/${encodeURIComponent(versionId)}/withdraw`,
    { expectedRevision, comment });
}
