import crypto from 'node:crypto';

export const JOURNEY_EVIDENCE_LIFECYCLE_VERSION = 'journey-evidence-lifecycle/v1' as const;

export type JourneyEvidenceSnapshotField =
  | 'sourceLabel'
  | 'excerpt'
  | 'population'
  | 'sampleSize'
  | 'collectedAt'
  | 'windowStart'
  | 'windowEnd'
  | 'sourceUpdatedAt';

export interface JourneyEvidenceSnapshot {
  sourceType: string;
  sourceRef: string;
  sourceLabel: string;
  excerpt: string;
  population: string;
  sampleSize: number | null;
  collectedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  sourceUpdatedAt: string | null;
}

export interface JourneyEvidenceSourceCurrent {
  sourceType: string;
  sourceRef: string;
  label: string;
  excerpt: string;
  population: string;
  sampleSize: number | null;
  collectedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  updatedAt: string | null;
}

export type JourneyEvidenceResolution =
  | { kind: 'available'; source: JourneyEvidenceSourceCurrent }
  | { kind: 'inaccessible'; reason: 'not_found_or_not_authorised' | 'feature_disabled' | 'source_adapter_unavailable' };

export type JourneyEvidenceUnavailableReason = Extract<JourneyEvidenceResolution, { kind: 'inaccessible' }>['reason'];

export interface JourneyEvidenceSnapshotChange {
  field: JourneyEvidenceSnapshotField;
  beforeHash: string;
  afterHash: string;
}

export interface JourneyEvidenceReadState {
  lifecycleVersion: typeof JOURNEY_EVIDENCE_LIFECYCLE_VERSION;
  access: 'available' | 'inaccessible';
  refreshStatus: 'current' | 'changed' | 'unavailable';
  snapshotFingerprint: string;
  currentFingerprint: string | null;
  changedFields: JourneyEvidenceSnapshotField[];
  changes: JourneyEvidenceSnapshotChange[];
  viewerSnapshot: JourneyEvidenceSnapshot;
  unavailableReason: JourneyEvidenceUnavailableReason | null;
}

export interface JourneyEvidenceRefreshAudit {
  lifecycleVersion: typeof JOURNEY_EVIDENCE_LIFECYCLE_VERSION;
  action: 'journey.evidence.refreshed';
  actorUserId: string;
  refreshedAt: string;
  sourceType: string;
  sourceRef: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  changedFields: JourneyEvidenceSnapshotField[];
}

export class JourneyEvidenceLifecycleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'JourneyEvidenceLifecycleError';
  }
}

const orderedFields: JourneyEvidenceSnapshotField[] = [
  'sourceLabel', 'excerpt', 'population', 'sampleSize', 'collectedAt',
  'windowStart', 'windowEnd', 'sourceUpdatedAt'
];

function boundedText(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function boundedSample(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 1_000_000_000 ? number : null;
}

function instantOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const instant = String(value);
  return Number.isFinite(Date.parse(instant)) ? instant : null;
}

function canonicalSnapshot(snapshot: JourneyEvidenceSnapshot): JourneyEvidenceSnapshot {
  return {
    sourceType: boundedText(snapshot.sourceType, 80),
    sourceRef: boundedText(snapshot.sourceRef, 400),
    sourceLabel: boundedText(snapshot.sourceLabel, 200),
    excerpt: boundedText(snapshot.excerpt, 2_000),
    population: boundedText(snapshot.population, 200),
    sampleSize: boundedSample(snapshot.sampleSize),
    collectedAt: instantOrNull(snapshot.collectedAt),
    windowStart: instantOrNull(snapshot.windowStart),
    windowEnd: instantOrNull(snapshot.windowEnd),
    sourceUpdatedAt: instantOrNull(snapshot.sourceUpdatedAt)
  };
}

export function journeyEvidenceSnapshotFromSource(source: JourneyEvidenceSourceCurrent): JourneyEvidenceSnapshot {
  return canonicalSnapshot({
    sourceType: source.sourceType,
    sourceRef: source.sourceRef,
    sourceLabel: source.label,
    excerpt: source.excerpt,
    population: source.population,
    sampleSize: source.sampleSize,
    collectedAt: source.collectedAt,
    windowStart: source.windowStart,
    windowEnd: source.windowEnd,
    sourceUpdatedAt: source.updatedAt
  });
}

function stableJson(snapshot: JourneyEvidenceSnapshot) {
  const canonical = canonicalSnapshot(snapshot);
  return JSON.stringify({
    sourceType: canonical.sourceType,
    sourceRef: canonical.sourceRef,
    sourceLabel: canonical.sourceLabel,
    excerpt: canonical.excerpt,
    population: canonical.population,
    sampleSize: canonical.sampleSize,
    collectedAt: canonical.collectedAt,
    windowStart: canonical.windowStart,
    windowEnd: canonical.windowEnd,
    sourceUpdatedAt: canonical.sourceUpdatedAt
  });
}

function hash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function journeyEvidenceSnapshotFingerprint(snapshot: JourneyEvidenceSnapshot) {
  return crypto.createHash('sha256').update(stableJson(snapshot)).digest('hex');
}

function compareSnapshots(before: JourneyEvidenceSnapshot, after: JourneyEvidenceSnapshot) {
  const canonicalBefore = canonicalSnapshot(before);
  const canonicalAfter = canonicalSnapshot(after);
  const changes = orderedFields.filter((field) => canonicalBefore[field] !== canonicalAfter[field]).map((field) => ({
    field,
    beforeHash: hash(canonicalBefore[field]),
    afterHash: hash(canonicalAfter[field])
  }));
  return { canonicalBefore, canonicalAfter, changes };
}

function inaccessibleSnapshot(snapshot: JourneyEvidenceSnapshot): JourneyEvidenceSnapshot {
  return {
    sourceType: boundedText(snapshot.sourceType, 80),
    sourceRef: 'restricted',
    sourceLabel: 'Linked source unavailable',
    excerpt: '',
    population: '',
    sampleSize: null,
    collectedAt: null,
    windowStart: null,
    windowEnd: null,
    sourceUpdatedAt: null
  };
}

export function journeyEvidenceReadState(
  stored: JourneyEvidenceSnapshot,
  resolution: JourneyEvidenceResolution
): JourneyEvidenceReadState {
  const canonicalStored = canonicalSnapshot(stored);
  const snapshotFingerprint = journeyEvidenceSnapshotFingerprint(canonicalStored);
  if (resolution.kind === 'inaccessible') {
    return {
      lifecycleVersion: JOURNEY_EVIDENCE_LIFECYCLE_VERSION,
      access: 'inaccessible',
      refreshStatus: 'unavailable',
      snapshotFingerprint,
      currentFingerprint: null,
      changedFields: [],
      changes: [],
      viewerSnapshot: inaccessibleSnapshot(canonicalStored),
      unavailableReason: resolution.reason
    };
  }
  const current = journeyEvidenceSnapshotFromSource(resolution.source);
  if (current.sourceType !== canonicalStored.sourceType || current.sourceRef !== canonicalStored.sourceRef) {
    throw new JourneyEvidenceLifecycleError(
      'EVIDENCE_SOURCE_IDENTITY_MISMATCH',
      'The resolved source identity does not match the stored evidence link.'
    );
  }
  const compared = compareSnapshots(canonicalStored, current);
  return {
    lifecycleVersion: JOURNEY_EVIDENCE_LIFECYCLE_VERSION,
    access: 'available',
    refreshStatus: compared.changes.length ? 'changed' : 'current',
    snapshotFingerprint,
    currentFingerprint: journeyEvidenceSnapshotFingerprint(current),
    changedFields: compared.changes.map((change) => change.field),
    changes: compared.changes,
    viewerSnapshot: canonicalStored,
    unavailableReason: null
  };
}

export function refreshJourneyEvidenceSnapshot(input: {
  stored: JourneyEvidenceSnapshot;
  source: JourneyEvidenceSourceCurrent;
  expectedFingerprint: string;
  actorUserId: string;
  refreshedAt: string;
  targetVersionState: 'draft' | 'published' | 'superseded' | 'shared';
}): { snapshot: JourneyEvidenceSnapshot; audit: JourneyEvidenceRefreshAudit } {
  if (!input.actorUserId.trim()) {
    throw new JourneyEvidenceLifecycleError('EVIDENCE_REFRESH_ACTOR_REQUIRED', 'Evidence refresh requires an authenticated actor.');
  }
  if (!Number.isFinite(Date.parse(input.refreshedAt))) {
    throw new JourneyEvidenceLifecycleError('EVIDENCE_REFRESH_TIME_INVALID', 'Evidence refresh requires a valid timestamp.');
  }
  if (input.targetVersionState === 'published' || input.targetVersionState === 'superseded') {
    throw new JourneyEvidenceLifecycleError(
      'EVIDENCE_REFRESH_TARGET_IMMUTABLE',
      'Published and superseded journey-version evidence cannot be refreshed in place.'
    );
  }
  const before = canonicalSnapshot(input.stored);
  const beforeFingerprint = journeyEvidenceSnapshotFingerprint(before);
  if (input.expectedFingerprint !== beforeFingerprint) {
    throw new JourneyEvidenceLifecycleError(
      'EVIDENCE_REFRESH_CONFLICT',
      'The stored evidence snapshot changed before this refresh was applied.'
    );
  }
  const after = journeyEvidenceSnapshotFromSource(input.source);
  if (before.sourceType !== after.sourceType || before.sourceRef !== after.sourceRef) {
    throw new JourneyEvidenceLifecycleError(
      'EVIDENCE_SOURCE_IDENTITY_MISMATCH',
      'Evidence refresh cannot replace the linked source with another source.'
    );
  }
  const compared = compareSnapshots(before, after);
  const afterFingerprint = journeyEvidenceSnapshotFingerprint(after);
  return {
    snapshot: after,
    audit: {
      lifecycleVersion: JOURNEY_EVIDENCE_LIFECYCLE_VERSION,
      action: 'journey.evidence.refreshed',
      actorUserId: input.actorUserId,
      refreshedAt: input.refreshedAt,
      sourceType: after.sourceType,
      sourceRef: after.sourceRef,
      beforeFingerprint,
      afterFingerprint,
      changedFields: compared.changes.map((change) => change.field)
    }
  };
}
