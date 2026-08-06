import assert from 'node:assert/strict';
import test from 'node:test';
import {
  journeyEvidenceReadState,
  journeyEvidenceSnapshotFingerprint,
  journeyEvidenceSnapshotFromSource,
  JourneyEvidenceLifecycleError,
  refreshJourneyEvidenceSnapshot,
  type JourneyEvidenceSnapshot,
  type JourneyEvidenceSourceCurrent
} from '../src/journeyEvidenceLifecycle.js';

const stored: JourneyEvidenceSnapshot = {
  sourceType: 'knowledge_document',
  sourceRef: 'knowledge-document:document-a',
  sourceLabel: 'Interview synthesis',
  excerpt: 'Customers need a faster handoff.',
  population: 'UK customers',
  sampleSize: 12,
  collectedAt: '2026-07-01T10:00:00.000Z',
  windowStart: '2026-06-01T00:00:00.000Z',
  windowEnd: '2026-06-30T23:59:59.000Z',
  sourceUpdatedAt: '2026-07-01T10:00:00.000Z'
};

function current(overrides: Partial<JourneyEvidenceSourceCurrent> = {}): JourneyEvidenceSourceCurrent {
  return {
    sourceType: stored.sourceType,
    sourceRef: stored.sourceRef,
    label: stored.sourceLabel,
    excerpt: stored.excerpt,
    population: stored.population,
    sampleSize: stored.sampleSize,
    collectedAt: stored.collectedAt,
    windowStart: stored.windowStart,
    windowEnd: stored.windowEnd,
    updatedAt: stored.sourceUpdatedAt,
    ...overrides
  };
}

test('an unchanged authorised source remains current and preserves the reviewed snapshot', () => {
  const result = journeyEvidenceReadState(stored, { kind: 'available', source: current() });
  assert.equal(result.access, 'available');
  assert.equal(result.refreshStatus, 'current');
  assert.equal(result.snapshotFingerprint, result.currentFingerprint);
  assert.deepEqual(result.changedFields, []);
  assert.deepEqual(result.viewerSnapshot, stored);
  assert.equal(result.unavailableReason, null);
});

test('source changes are reviewable by field and audit hashes do not copy source content', () => {
  const result = journeyEvidenceReadState(stored, { kind: 'available', source: current({
    excerpt: 'Customers need a faster verified handoff.',
    sampleSize: 18,
    updatedAt: '2026-08-04T09:00:00.000Z'
  }) });
  assert.equal(result.refreshStatus, 'changed');
  assert.deepEqual(result.changedFields, ['excerpt', 'sampleSize', 'sourceUpdatedAt']);
  assert.ok(result.changes.every((change) => /^[a-f0-9]{64}$/u.test(change.beforeHash)
    && /^[a-f0-9]{64}$/u.test(change.afterHash)));
  assert.ok(!JSON.stringify(result.changes).includes('verified handoff'));
  assert.deepEqual(result.viewerSnapshot, stored);
});

test('an inaccessible source contributes no stored excerpt, identity, population, sample, or dates to the viewer', () => {
  const result = journeyEvidenceReadState(stored, {
    kind: 'inaccessible', reason: 'not_found_or_not_authorised'
  });
  assert.equal(result.access, 'inaccessible');
  assert.equal(result.refreshStatus, 'unavailable');
  assert.equal(result.currentFingerprint, null);
  assert.equal(result.unavailableReason, 'not_found_or_not_authorised');
  assert.deepEqual(result.viewerSnapshot, {
    sourceType: 'knowledge_document',
    sourceRef: 'restricted',
    sourceLabel: 'Linked source unavailable',
    excerpt: '',
    population: '',
    sampleSize: null,
    collectedAt: null,
    windowStart: null,
    windowEnd: null,
    sourceUpdatedAt: null
  });
  assert.ok(!JSON.stringify(result).includes('Customers need'));
  assert.ok(!JSON.stringify(result).includes('document-a'));
});

test('explicit refresh replaces only the same canonical source and records a content-free audit change set', () => {
  const source = current({ label: 'Interview synthesis v2', sampleSize: 20, updatedAt: '2026-08-04T10:00:00.000Z' });
  const result = refreshJourneyEvidenceSnapshot({
    stored,
    source,
    expectedFingerprint: journeyEvidenceSnapshotFingerprint(stored),
    actorUserId: 'user-a',
    refreshedAt: '2026-08-04T11:00:00.000Z',
    targetVersionState: 'draft'
  });
  assert.deepEqual(result.snapshot, journeyEvidenceSnapshotFromSource(source));
  assert.deepEqual(result.audit.changedFields, ['sourceLabel', 'sampleSize', 'sourceUpdatedAt']);
  assert.equal(result.audit.sourceRef, stored.sourceRef);
  assert.notEqual(result.audit.beforeFingerprint, result.audit.afterFingerprint);
  assert.ok(!JSON.stringify(result.audit).includes('Interview synthesis v2'));
});

test('refresh is optimistic, identity-preserving, authenticated, and forbidden on immutable versions', () => {
  const base = {
    stored,
    source: current(),
    expectedFingerprint: journeyEvidenceSnapshotFingerprint(stored),
    actorUserId: 'user-a',
    refreshedAt: '2026-08-04T11:00:00.000Z',
    targetVersionState: 'draft' as const
  };
  assert.throws(() => refreshJourneyEvidenceSnapshot({ ...base, expectedFingerprint: 'stale' }),
    (error) => error instanceof JourneyEvidenceLifecycleError && error.code === 'EVIDENCE_REFRESH_CONFLICT');
  assert.throws(() => refreshJourneyEvidenceSnapshot({ ...base, source: current({ sourceRef: 'knowledge-document:document-b' }) }),
    (error) => error instanceof JourneyEvidenceLifecycleError && error.code === 'EVIDENCE_SOURCE_IDENTITY_MISMATCH');
  assert.throws(() => refreshJourneyEvidenceSnapshot({ ...base, actorUserId: '' }),
    (error) => error instanceof JourneyEvidenceLifecycleError && error.code === 'EVIDENCE_REFRESH_ACTOR_REQUIRED');
  assert.throws(() => refreshJourneyEvidenceSnapshot({ ...base, targetVersionState: 'published' }),
    (error) => error instanceof JourneyEvidenceLifecycleError && error.code === 'EVIDENCE_REFRESH_TARGET_IMMUTABLE');
});
