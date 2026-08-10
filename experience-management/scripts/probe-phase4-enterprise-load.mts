import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  buildPhase4BlueprintFixture,
  buildPhase4HierarchyFixture,
  phase4CandidateBudgetsMs,
  phase4CandidateProfile,
  phase4FixtureFingerprint
} from './phase4-enterprise-load-fixtures.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-phase4-load-'));
const secret = (name: string, value: string | Buffer) => {
  const file = path.join(root, name); fs.writeFileSync(file, value); return file;
};
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'probe.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'phase4-load@seemplify.local',
  ADMIN_PASSWORD_FILE: secret('admin-password', 'Phase4-Load-Probe-2026!'),
  SESSION_SECRET_FILE: secret('session-secret', 'phase4-load-session-secret-that-is-long-enough'),
  TERRA_GATEWAY_SHARED_SECRET_FILE: secret('terra-secret', 'phase4-load-terra-secret-that-is-long-enough'),
  LOCAL_LLM_SHARED_SECRET_FILE: path.join(root, 'terra-secret'), EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: secret('x-key', Buffer.alloc(32, 91).toString('base64url')),
  ESIGN_STORAGE_DIR: path.join(root, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: secret('esign-key', Buffer.alloc(32, 92).toString('base64url')),
  JOURNEY_IDENTITY_HASH_KEY_FILE: secret('identity-key', Buffer.alloc(32, 93)),
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'), X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'), X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const round = (value: number) => Math.round(value * 100) / 100;
const timings: Record<string, number> = {};
function measured<T>(name: string, run: () => T): T {
  const before = performance.now(); const result = run(); timings[name] = round(performance.now() - before); return result;
}

try {
  await import('../backend/src/app.js');
  const { db } = await import('../backend/src/database.js');
  const { bootstrapAdminAccount } = await import('../backend/src/auth.js');
  const {
    journeyHierarchyBreadcrumbTrails, rollUpJourneyHierarchyHealth, traverseJourneyHierarchy, validateJourneyHierarchy
  } = await import('../backend/src/journeyHierarchy.js');
  const { analyseServiceBlueprint, compareServiceBlueprints } = await import('../backend/src/journeyServiceBlueprint.js');
  const {
    exportJourneyHierarchy, listJourneyHierarchy, persistedJourneyHierarchyBreadcrumbs, traversePersistedJourneyHierarchy
  } = await import('../backend/src/journeyHierarchyRepository.js');
  const {
    createJourneyServiceBlueprint, createJourneyServiceBlueprintVersion, exportJourneyServiceBlueprintVersion,
    readJourneyServiceBlueprintVersion
  } = await import('../backend/src/journeyServiceBlueprintRepository.js');
  try {
    bootstrapAdminAccount();
    const identity = db.prepare(`SELECT user_row.id user_id,membership.space_id FROM users user_row
      JOIN space_memberships membership ON membership.user_id=user_row.id WHERE lower(user_row.email)=lower(?)
      ORDER BY membership.joined_at LIMIT 1`).get('phase4-load@seemplify.local') as { user_id: string; space_id: string } | undefined;
    assert.ok(identity);
    db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(identity.space_id);
    const hierarchy = buildPhase4HierarchyFixture(identity.space_id);
    const permitted = new Set(hierarchy.nodes.map((node) => node.definitionId));
    const validation = measured('hierarchyValidate', () => validateJourneyHierarchy(
      hierarchy.nodes, hierarchy.links, phase4CandidateProfile.hierarchy));
    const traversal = measured('hierarchyTraverse', () => traverseJourneyHierarchy({
      ...hierarchy, startDefinitionId: hierarchy.nodes[0]!.definitionId, direction: 'both', permittedDefinitionIds: permitted,
      limits: phase4CandidateProfile.hierarchy, maximumNodes: phase4CandidateProfile.hierarchy.nodes
    }));
    const breadcrumbs = measured('hierarchyBreadcrumbs', () => journeyHierarchyBreadcrumbTrails({
      ...hierarchy, targetDefinitionId: hierarchy.nodes.at(-1)!.definitionId, permittedDefinitionIds: permitted,
      limits: phase4CandidateProfile.hierarchy, maximumPaths: 20
    }));
    const observations = hierarchy.nodes.map((node, index) => ({
      definitionId: node.definitionId, score: index % 101, observedAt: '2026-08-08T00:00:00.000Z', sourceRevision: `revision-${index}`
    }));
    const health = measured('hierarchyHealth', () => rollUpJourneyHierarchyHealth(
      hierarchy.nodes, hierarchy.links, observations,
      { version: 'phase4-load-policy/v1', ownWeight: 0.5, missingChild: 'exclude', healthyAt: 80, watchAt: 50 },
      phase4CandidateProfile.hierarchy));
    assert.equal(validation.topologicalOrder.length, phase4CandidateProfile.hierarchy.nodes);
    assert.equal(traversal.definitionIds.length, phase4CandidateProfile.hierarchy.nodes);
    assert.equal(breadcrumbs.trails.length, 1);
    assert.equal(health.length, phase4CandidateProfile.hierarchy.nodes);

    const blueprint = buildPhase4BlueprintFixture({ spaceId: identity.space_id, versionId: 'phase4-current-version' });
    const blueprintAnalysis = measured('blueprintAnalyse', () => analyseServiceBlueprint(blueprint));
    const future = buildPhase4BlueprintFixture({ spaceId: identity.space_id, state: 'future', versionId: 'phase4-future-version',
      journeyVersionId: 'journey-version-future', versionNumber: 2, titleSuffix: ' future' });
    const comparison = measured('blueprintCompare', () => compareServiceBlueprints(blueprint, future));
    assert.equal(blueprintAnalysis.valid, true);
    assert.equal(comparison.changed.length, phase4CandidateProfile.blueprint.elements);

    const at = '2026-08-08T00:00:00.000Z';
    const definitionInsert = db.prepare(`INSERT INTO journey_definitions
      (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,published_version_id,
       review_cadence_days,revision,created_at,updated_at) VALUES (?,?,'Phase 4 load','','customer','current_state','designed',
       'published',?,NULL,NULL,0,1,?,?)`);
    const linkInsert = db.prepare(`INSERT INTO journey_hierarchy_links
      (id,space_id,link_type,from_definition_id,to_definition_id,from_version_id,to_version_id,from_stage_key,to_stage_key,
       variant_dimension,variant_value_id,handoff_owner_user_id,handoff_owner_team_id,review_state,reviewed_by_user_id,
       reviewed_at,lifecycle,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
       VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'approved',?,?,'active',1,?,?,?,?)`);
    db.transaction(() => {
      hierarchy.nodes.forEach((node) => definitionInsert.run(node.definitionId, identity.space_id, identity.user_id, at, at));
      hierarchy.links.forEach((link) => linkInsert.run(link.id, identity.space_id, link.type, link.fromDefinitionId,
        link.toDefinitionId, identity.user_id, at, identity.user_id, identity.user_id, at, at));
    })();
    const rootDefinitionId = hierarchy.nodes[0]!.definitionId;
    const mapVersionId = 'phase4-map-version';
    db.prepare(`INSERT INTO journey_map_versions
      (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,industry,
       summary,legacy_audience,provenance_json,source_job_id,author_user_id,published_at,created_at)
       VALUES (?,?,?,1,2,'published','current_state','designed','customer','','','','','{}',NULL,?,?,?)`)
      .run(mapVersionId, rootDefinitionId, identity.space_id, identity.user_id, at, at);
    db.prepare('UPDATE journey_definitions SET current_version_id=?,published_version_id=? WHERE id=? AND space_id=?')
      .run(mapVersionId, mapVersionId, rootDefinitionId, identity.space_id);
    db.prepare(`INSERT INTO journey_map_stages (id,version_id,space_id,stage_key,name,goal,description,ordinal)
      VALUES ('phase4-map-stage',?,?, 'entry','Entry','','',0)`).run(mapVersionId, identity.space_id);

    const persistedHierarchy = measured('hierarchyRepositoryRead', () => listJourneyHierarchy({
      spaceId: identity.space_id, actorUserId: identity.user_id, includeRetired: true }));
    measured('hierarchyRepositoryTraverse', () => traversePersistedJourneyHierarchy({
      spaceId: identity.space_id, actorUserId: identity.user_id, startDefinitionId: rootDefinitionId,
      direction: 'both', maximumDefinitions: phase4CandidateProfile.hierarchy.nodes }));
    measured('hierarchyRepositoryBreadcrumbs', () => persistedJourneyHierarchyBreadcrumbs({
      spaceId: identity.space_id, actorUserId: identity.user_id,
      targetDefinitionId: hierarchy.nodes.at(-1)!.definitionId, maximumTrails: 20 }));
    const hierarchyJson = measured('hierarchyJsonExport', () => exportJourneyHierarchy({
      spaceId: identity.space_id, actorUserId: identity.user_id, format: 'json', requestId: 'phase4-load-json' }));
    const hierarchyCsv = measured('hierarchyCsvExport', () => exportJourneyHierarchy({
      spaceId: identity.space_id, actorUserId: identity.user_id, format: 'csv', requestId: 'phase4-load-csv' }));
    assert.equal(persistedHierarchy.nodes.length, phase4CandidateProfile.hierarchy.nodes);
    assert.equal(persistedHierarchy.links.length, phase4CandidateProfile.hierarchy.links);

    const blueprintRecord = createJourneyServiceBlueprint({ spaceId: identity.space_id, actorUserId: identity.user_id,
      journeyDefinitionId: rootDefinitionId, name: 'Phase 4 enterprise load blueprint' });
    const persisted = measured('blueprintRepositoryPersist', () => createJourneyServiceBlueprintVersion({
      spaceId: identity.space_id, actorUserId: identity.user_id, blueprintId: blueprintRecord.id,
      journeyVersionId: mapVersionId, state: 'current', stages: blueprint.stages, elements: blueprint.elements,
      relationships: blueprint.relationships
    }));
    const persistedVersion = measured('blueprintRepositoryRead', () => readJourneyServiceBlueprintVersion({
      spaceId: identity.space_id, actorUserId: identity.user_id, versionId: persisted.version.versionId! }));
    const blueprintJson = measured('blueprintJsonExport', () => exportJourneyServiceBlueprintVersion({
      spaceId: identity.space_id, actorUserId: identity.user_id, versionId: persisted.version.versionId!, format: 'json',
      requestId: 'phase4-blueprint-json' }));
    const blueprintCsv = measured('blueprintCsvExport', () => exportJourneyServiceBlueprintVersion({
      spaceId: identity.space_id, actorUserId: identity.user_id, versionId: persisted.version.versionId!, format: 'csv',
      requestId: 'phase4-blueprint-csv' }));
    const projection = measured('backendProjectionSerialise', () => JSON.stringify({
      hierarchy: persistedHierarchy, blueprint: persistedVersion, analysis: persisted.analysis
    }));
    assert.equal(persistedVersion.elements.length, phase4CandidateProfile.blueprint.elements);
    assert.equal(persistedVersion.relationships.length, phase4CandidateProfile.blueprint.relationships);
    assert.ok(JSON.parse(projection).blueprint);

    const budgetMapping: Record<string, keyof typeof timings> = {
      hierarchyValidate: 'hierarchyValidate', hierarchyTraverse: 'hierarchyTraverse',
      hierarchyBreadcrumbs: 'hierarchyBreadcrumbs', hierarchyHealth: 'hierarchyHealth',
      hierarchyRepositoryRead: 'hierarchyRepositoryRead',
      hierarchyRepositoryTraverse: 'hierarchyRepositoryTraverse',
      hierarchyRepositoryBreadcrumbs: 'hierarchyRepositoryBreadcrumbs', hierarchyJsonExport: 'hierarchyJsonExport',
      hierarchyCsvExport: 'hierarchyCsvExport', blueprintAnalyse: 'blueprintAnalyse', blueprintCompare: 'blueprintCompare',
      blueprintRepositoryPersist: 'blueprintRepositoryPersist', blueprintRepositoryRead: 'blueprintRepositoryRead',
      blueprintJsonExport: 'blueprintJsonExport', blueprintCsvExport: 'blueprintCsvExport',
      backendProjectionSerialise: 'backendProjectionSerialise'
    };
    const budgetResults = Object.fromEntries(Object.entries(phase4CandidateBudgetsMs).map(([name, budget]) => [name, {
      measuredMs: timings[budgetMapping[name]!]!, budgetMs: budget, passed: timings[budgetMapping[name]!]! <= budget
    }]));
    const candidateBudgetsPassed = Object.values(budgetResults).every((result) => result.passed);
    assert.equal(candidateBudgetsPassed, true, 'Every unratified candidate backend budget must pass.');
    console.log(JSON.stringify({
      ok: true, probe: 'phase4-enterprise-load/v1', startedAt: at, completedAt: new Date().toISOString(),
      profile: phase4CandidateProfile, budgetsMs: phase4CandidateBudgetsMs, fixtureSha256: phase4FixtureFingerprint(),
      host: { node: process.version, platform: process.platform, arch: process.arch,
        logicalCpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
      assertions: { deterministicSyntheticFixtures: true, candidateBudgetsPassed, browserCertified: false,
        productionDataUsed: false, hierarchyNodeCount: persistedHierarchy.nodes.length,
        hierarchyLinkCount: persistedHierarchy.links.length, blueprintElementCount: persistedVersion.elements.length,
        blueprintRelationshipCount: persistedVersion.relationships.length },
      artifactBytes: { hierarchyJson: hierarchyJson.bytes.byteLength, hierarchyCsv: hierarchyCsv.bytes.byteLength,
        blueprintJson: blueprintJson.bytes.byteLength, blueprintCsv: blueprintCsv.bytes.byteLength,
        backendProjection: Buffer.byteLength(projection) },
      timings, budgetResults
    }));
  } finally { db.close(); }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
