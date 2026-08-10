import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyseServiceBlueprint } from '../src/journeyServiceBlueprint.js';
import { validateJourneyHierarchy } from '../src/journeyHierarchy.js';
import {
  buildPhase4BlueprintFixture,
  buildPhase4HierarchyFixture,
  phase4CandidateBudgetsMs,
  phase4CandidateProfile,
  phase4FixtureFingerprint
} from '../../scripts/phase4-enterprise-load-fixtures.mjs';
import { validatePhase4Approval } from '../../scripts/phase4-enterprise-load-governance.mjs';

test('enterprise candidate fixtures are deterministic, bounded and exercise shipped collection shapes', () => {
  const firstHierarchy = buildPhase4HierarchyFixture();
  const secondHierarchy = buildPhase4HierarchyFixture();
  assert.equal(firstHierarchy.nodes.length, 500);
  assert.equal(firstHierarchy.links.length, 2_000);
  assert.equal(JSON.stringify(firstHierarchy), JSON.stringify(secondHierarchy));
  const hierarchy = validateJourneyHierarchy(firstHierarchy.nodes, firstHierarchy.links, phase4CandidateProfile.hierarchy);
  assert.equal(hierarchy.topologicalOrder.length, 500);
  assert.equal(hierarchy.maximumDepth, 1);

  const firstBlueprint = buildPhase4BlueprintFixture();
  const secondBlueprint = buildPhase4BlueprintFixture();
  assert.equal(firstBlueprint.stages.length, 50);
  assert.equal(firstBlueprint.elements.length, 2_500);
  assert.equal(firstBlueprint.relationships.length, 1_450);
  assert.equal(JSON.stringify(firstBlueprint), JSON.stringify(secondBlueprint));
  assert.equal(analyseServiceBlueprint(firstBlueprint).valid, true);
  assert.equal(phase4FixtureFingerprint(), phase4FixtureFingerprint());
  assert.match(phase4FixtureFingerprint(), /^[a-f0-9]{64}$/u);
});

test('release approval fails closed unless identity, profile, budgets and fixture fingerprint match exactly', () => {
  const expected = { profile: phase4CandidateProfile, budgetsMs: phase4CandidateBudgetsMs,
    fixtureSha256: phase4FixtureFingerprint() };
  assert.equal(validatePhase4Approval(null, expected).valid, false);
  const approved = {
    version: 'phase4-enterprise-load-approval/v1', decision: 'approved', approvedBy: 'Capacity Review Board',
    approvedAt: '2026-08-08T08:00:00.000Z', loadProfileId: phase4CandidateProfile.id,
    profile: structuredClone(phase4CandidateProfile), budgetsMs: structuredClone(phase4CandidateBudgetsMs),
    fixtureSha256: expected.fixtureSha256
  };
  assert.equal(validatePhase4Approval(approved, expected).valid, true);
  assert.equal(validatePhase4Approval({ ...approved, profile: undefined }, expected).valid, false);
  assert.equal(validatePhase4Approval({ ...approved, fixtureSha256: '0'.repeat(64) }, expected).valid, false);
  assert.equal(validatePhase4Approval({ ...approved, budgetsMs: { ...approved.budgetsMs, blueprintAnalyse: 1 } }, expected).valid, false);
  assert.equal(validatePhase4Approval({ ...approved, decision: 'pending' }, expected).valid, false);
});
