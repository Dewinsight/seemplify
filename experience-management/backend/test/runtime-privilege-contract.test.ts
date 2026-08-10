import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * STATIC registration test for runtimes 27-34.
 *
 * SCOPE WARNING — READ BEFORE TRUSTING A GREEN RUN. Every assertion below reads
 * source TEXT. This file does NOT create a database, does NOT apply a migration
 * and does NOT execute a single statement, so it is NOT executed-PostgreSQL
 * proof and must not be recorded as one. It cannot observe whether a GRANT takes
 * effect, whether the presence loop actually raises, or any plpgsql behaviour.
 *
 * What it does prove is the drift class that runtimes 27-29 shipped: a table
 * created by a migration but never registered in one of the three lists that are
 * supposed to describe it. Each list fails differently when it is short, which is
 * why none of them caught the others:
 *
 *   runtime_privileges.sql presence loop  fail-closed gate. A table missing here
 *                                         lets the file apply cleanly against a
 *                                         database that never created it, so the
 *                                         grants silently cover less than claimed.
 *   runtimeExtensionTables()              drives runtimeTableSetDifference. A
 *                                         table missing here reads as an unknown,
 *                                         unexpected table on a correct database.
 *   assertRuntimePrivileges expectations  a table missing here is never checked,
 *                                         so an over-broad grant on it is invisible.
 *
 * Runtimes 18-26 were exhaustive in all three; 27-31 were not, and no test paired
 * them (knowledge-embedding-config.test.ts stops at runtime 22 and checks one
 * runtime at a time). This pairs all three lists for every runtime 27-29 object so
 * the omission cannot recur at runtime 31.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const migrationRoot = path.join(backendRoot, 'migrations', 'postgres');
const contractSource = fs.readFileSync(
  path.resolve(backendRoot, '..', 'scripts', 'postgres-runtime-contract.mjs'), 'utf8');
const privilegeSource = fs.readFileSync(path.join(migrationRoot, 'runtime_privileges.sql'), 'utf8');
const configSource = fs.readFileSync(path.join(backendRoot, 'src', 'config.ts'), 'utf8');
const postgresE2eSource = fs.readFileSync(
  path.resolve(backendRoot, '..', 'scripts', 'test-postgres-e2e.mjs'), 'utf8');
const runtimeVerifierSource = fs.readFileSync(
  path.resolve(backendRoot, '..', 'scripts', 'verify-postgres-runtime.mjs'), 'utf8');
const actionWorkerProbeSource = fs.readFileSync(
  path.resolve(backendRoot, '..', 'scripts', 'probe-journey-action-worker-postgres.mjs'), 'utf8');
const serverSource = fs.readFileSync(path.join(backendRoot, 'src', 'server.ts'), 'utf8');
const privacyWorkerPrivilegeSource=fs.readFileSync(path.join(migrationRoot,'runtime_privacy_worker_privileges.sql'),'utf8');
const privacyRuntimeSource=fs.readFileSync(path.join(backendRoot,'src','journeyPrivacyPropagationRuntime.ts'),'utf8');
const connectorWorkerPrivilegeSource=fs.readFileSync(path.join(migrationRoot,'runtime51_connector_worker_privileges.sql'),'utf8');
const connectorWorkerRuntimeSource=fs.readFileSync(path.join(backendRoot,'src','journeyConnectorWorkerRuntime.ts'),'utf8');
const operationalFeedPrivilegeSource=fs.readFileSync(path.join(migrationRoot,'runtime52_operational_stage_feed_privileges.sql'),'utf8');
const operationalFeedRuntimeSource=fs.readFileSync(path.join(backendRoot,'src','journeyOperationalStageFeedRuntime.ts'),'utf8');
const eventRetentionPrivilegeSource=fs.readFileSync(path.join(migrationRoot,'runtime53_event_retention_privileges.sql'),'utf8');
const eventRetentionRuntimeSource=fs.readFileSync(path.join(backendRoot,'src','journeyEventRetentionRuntime.ts'),'utf8');

const RUNTIMES = [
  { version: 27, file: '0027_journey_portfolio.sql' },
  { version: 28, file: '0028_journey_collaboration.sql' },
  { version: 29, file: '0029_journey_hierarchy_blueprints.sql' },
  { version: 30, file: '0030_journey_stage_reprojection.sql' },
  { version: 31, file: '0031_journey_identity_profiles.sql' },
  { version: 33, file: '0033_journey_actual_path_intelligence.sql' },
  { version: 35, file: '0035_journey_orchestration.sql' },
  { version: 36, file: '0036_journey_action_runtime.sql' }
  ,{ version: 37, file: '0037_journey_connector_imports.sql' }
  ,{ version: 38, file: '0038_journey_reviewed_adapters.sql' }
  ,{ version: 39, file: '0039_journey_predictive_governance.sql' }
  ,{ version: 40, file: '0040_journey_kill_switch.sql' }
  ,{ version: 41, file: '0041_journey_stage_intelligence.sql' }
  ,{ version: 42, file: '0042_journey_action_worker_safety.sql' }
  ,{ version: 43, file: '0043_journey_stage_survey_feed.sql' }
  ,{ version: 45, file: '0045_journey_event_stage_intelligence_adapter.sql' }
  ,{ version: 46, file: '0046_journey_portfolio_views_and_transitions.sql' }
  ,{ version: 47, file: '0047_journey_privacy_propagation_authority.sql' }
  ,{ version: 48, file: '0048_journey_blueprint_measurements.sql' }
  ,{ version: 49, file: '0049_journey_export_branding.sql' }
  ,{ version: 50, file: '0050_journey_actual_path_durability.sql' }
  ,{ version: 51, file: '0051_journey_connector_execution_plane.sql' }
  ,{ version: 52, file: '0052_journey_operational_stage_feed.sql' }
  ,{ version: 53, file: '0053_journey_event_retention_reconciliation.sql' }
  ,{ version: 54, file: '0054_journey_evidence_monitor.sql' }
  ,{ version: 55, file: '0055_journey_workspace_saved_views.sql' }
] as const;

/** Only top-of-line CREATE TABLE is a declaration; the same text inside a comment is prose. */
const createdTables = (file: string): string[] => [
  ...fs.readFileSync(path.join(migrationRoot, file), 'utf8')
    .matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*\(/gmu)
].map((match) => match[1]!);

const quotedNames = (source: string): string[] =>
  [...source.matchAll(/'([a-z_][a-z0-9_]*)'/gu)].map((match) => match[1]!);

const region = (source: string, open: string, close: string): string => {
  const start = source.indexOf(open);
  assert.notEqual(start, -1, `the source no longer contains ${open}`);
  const end = source.indexOf(close, start);
  assert.ok(end > start, `the source no longer contains ${close} after ${open}`);
  return source.slice(start, end);
};

/**
 * Splits a region into per-runtime blocks keyed by the version in its guard, so a
 * name registered under the wrong runtime fails rather than passing on presence.
 */
const versionBlocks = (source: string, variable: string): Map<number, string> => {
  const markers = [...source.matchAll(new RegExp(String.raw`if \(${variable} >= (\d+)\) \{`, 'gu'))];
  assert.ok(markers.length > 0, `no ${variable} version guards found`);
  const blocks = new Map<number, string>();
  markers.forEach((match, index) => {
    const from = match.index! + match[0].length;
    const to = markers[index + 1]?.index ?? source.length;
    blocks.set(Number(match[1]!), source.slice(from, to));
  });
  return blocks;
};

const presenceGate = new Set(quotedNames(
  region(privilegeSource, 'DO $seemplify_privilege_contract$', '$seemplify_privilege_contract$;')));

const extensionBlocks = versionBlocks(
  region(contractSource, 'export function runtimeExtensionTables(', 'export const RUNTIME_EXTENSION_TABLES'),
  'runtimeVersion');

const privilegeBlocks = versionBlocks(
  region(contractSource, 'export async function assertRuntimePrivileges(',
    'for (const [table, select, insert, update, remove] of expectations)'),
  'privilegeRuntimeVersion');

for (const { version, file } of RUNTIMES) {
  test(`every runtime-${version} table is registered in all three runtime contracts`, () => {
    const created = createdTables(file);
    assert.ok(created.length > 0, `${file} must declare tables`);
    assert.deepEqual([...new Set(created)], created, `${file} must not declare a table twice`);

    // Fail-closed presence gate. Without the name, runtime_privileges.sql applies
    // cleanly against a database that never ran this migration.
    const ungated = created.filter((table) => !presenceGate.has(table));
    assert.deepEqual(ungated, [],
      `runtime_privileges.sql must gate every runtime-${version} table before granting on it`);

    // Extension tables are order-sensitive: they are compared against the live
    // catalogue, so a name under the wrong version guard misreports either an
    // unknown table or a missing one.
    assert.deepEqual(quotedNames(extensionBlocks.get(version) ?? ''), created,
      `runtimeExtensionTables must list exactly the runtime-${version} tables, in migration order`);

    assert.deepEqual(quotedNames(privilegeBlocks.get(version) ?? ''), created,
      `assertRuntimePrivileges must expect a privilege set for exactly the runtime-${version} tables`);
  });
}

test('runtime verifier discovers worker-only tables without relying on application grants', () => {
  assert.match(runtimeVerifierSource, /FROM pg_catalog\.pg_class relation/u,
    'physical schema discovery must use the unfiltered PostgreSQL catalogue');
  assert.match(runtimeVerifierSource, /JOIN pg_catalog\.pg_namespace namespace/u,
    'physical schema discovery must be scoped through the PostgreSQL namespace catalogue');
  assert.doesNotMatch(runtimeVerifierSource, /FROM information_schema\.tables/u,
    'information_schema hides worker-only tables from the restricted application role');
});

test('journey action worker probe follows the requested aggregate runtime instead of a stale literal', () => {
  assert.match(actionWorkerProbeSource,
    /runtimeSchemaVersion:Number\(required\('POSTGRES_RUNTIME_SCHEMA_VERSION'\)\)/u);
  assert.doesNotMatch(actionWorkerProbeSource, /runtimeSchemaVersion:\s*\d+/u);
});

test('runtime-43 survey projection and retention workers are mounted but disabled by default', () => {
  assert.match(configSource,
    /JOURNEY_STAGE_SURVEY_FEED_WORKER_ENABLED, false,[\s\S]*?'JOURNEY_STAGE_SURVEY_FEED_WORKER_ENABLED'/u);
  assert.match(serverSource,
    /if \(config\.journeyStageSurveyFeedWorkerEnabled\)[\s\S]*journeyStageSurveyFeedWorker\.start\(\)[\s\S]*journeyStageSurveyFeedRetentionWorker\.start\(\)/u);
  assert.match(serverSource, /journeyStageSurveyFeedWorker\.drain\(8_000\)/u);
  assert.match(serverSource, /journeyStageSurveyFeedRetentionWorker\.drain\(8_000\)/u);
});

test('runtime-45 event materialization and retention lifecycle is mounted but disabled by default',()=>{
  assert.match(configSource,/JOURNEY_EVENT_INTELLIGENCE_WORKER_ENABLED, false,[\s\S]*?'JOURNEY_EVENT_INTELLIGENCE_WORKER_ENABLED'/u);
  assert.match(serverSource,/createJourneyEventStageIntelligenceWorker\(\)/u);
  assert.match(serverSource,/journeyEventIntelligenceWorker\?\.start\(\)/u);
  assert.match(serverSource,/journeyEventIntelligenceWorker\?journeyEventIntelligenceWorker\.drain\(8_000\)/u);
  assert.match(fs.readFileSync(path.join(backendRoot,'src','app.ts'),'utf8'),
    /app\.use\('\/api\/journey-event-intelligence', journeyEventStageIntelligenceRouter\)/u);
});

test('runtime-47 privacy propagation uses a disabled-by-default non-human lifecycle and dedicated least-privilege role',()=>{
  assert.match(configSource,/JOURNEY_PRIVACY_WORKER_ENABLED, false,[\s\S]*?'JOURNEY_PRIVACY_WORKER_ENABLED'/u);
  assert.match(serverSource,/createJourneyPrivacyPropagationRuntime\(\)/u);
  assert.match(serverSource,/journeyPrivacyPropagationRuntime\?\.start\(\)/u);
  assert.match(serverSource,/journeyPrivacyPropagationRuntime\?journeyPrivacyPropagationRuntime\.drain\(8_000\)/u);
  assert.match(privacyRuntimeSource,/if\(!options\.enabled\)return null/u);
  assert.match(privacyRuntimeSource,/Journey privacy worker requires PostgreSQL/u);
  assert.match(privacyRuntimeSource,/row\.key_ref!==options\.keyRef/u);
  assert.doesNotMatch(serverSource,/journeyPrivacy.*Router|\/api\/journey-privacy-worker/iu);
  assert.match(privacyWorkerPrivilegeSource,/GRANT EXECUTE ON FUNCTION public\.journey_privacy_claim/u);
  assert.match(privacyWorkerPrivilegeSource,/REVOKE ALL ON TABLE public\.journey_privacy_service_key_audit/u);
  assert.match(privacyWorkerPrivilegeSource,/REVOKE CREATE ON SCHEMA public/u);
});

test('runtime-51 connector execution uses a disabled-by-default scoped lifecycle and dedicated least-privilege role',()=>{
  assert.match(configSource,/JOURNEY_CONNECTOR_WORKER_ENABLED, false,[\s\S]*?'JOURNEY_CONNECTOR_WORKER_ENABLED'/u);
  assert.match(serverSource,/createJourneyConnectorWorkerRuntime\(\)/u);
  assert.match(serverSource,/journeyConnectorWorkerRuntime\?\.start\(\)/u);
  assert.match(serverSource,/journeyConnectorWorkerRuntime\?journeyConnectorWorkerRuntime\.stop\(8_000\)/u);
  assert.match(connectorWorkerRuntimeSource,/if\(!settings\.enabled\)return null/u);
  assert.match(connectorWorkerRuntimeSource,/requires PostgreSQL/u);
  assert.match(connectorWorkerRuntimeSource,/String\(principal\.secret_ref\)!==settings\.keyRef/u);
  assert.doesNotMatch(serverSource,/journeyConnectorWorker.*Router|\/api\/journey-connector-worker/iu);
  assert.match(connectorWorkerPrivilegeSource,/UPDATE\(phase,snapshot_at,cursor_at/u);
  assert.match(connectorWorkerPrivilegeSource,/REVOKE INSERT,UPDATE,DELETE ON TABLE public\.journey_connector_worker_principals/u);
  assert.match(connectorWorkerPrivilegeSource,/REVOKE CREATE ON SCHEMA public/u);
});

test('runtime-52 operational feed uses a disabled-by-default scoped lifecycle and dedicated least-privilege role',()=>{
  assert.match(configSource,/JOURNEY_OPERATIONAL_STAGE_FEED_WORKER_ENABLED, false/u);
  assert.match(serverSource,/createJourneyOperationalStageFeedRuntime\(\)/u);
  assert.match(serverSource,/journeyOperationalStageFeedRuntime\?\.start\(\)/u);
  assert.match(serverSource,/journeyOperationalStageFeedRuntime\?journeyOperationalStageFeedRuntime\.stop\(8_000\)/u);
  assert.match(operationalFeedRuntimeSource,/if \(!settings\.enabled\) return null/u);
  assert.match(operationalFeedRuntimeSource,/requires PostgreSQL/u);
  assert.match(operationalFeedRuntimeSource,/explicit bounded tenant scope/u);
  assert.match(operationalFeedPrivilegeSource,/__OPERATIONAL_FEED_WORKER_ROLE__/u);
  assert.match(operationalFeedPrivilegeSource,/REVOKE CREATE ON SCHEMA public/u);
  assert.doesNotMatch(serverSource,/\/api\/journey-operational-stage-feed-worker/u);
});

test('runtime-32 adds a guard without widening the application table privilege surface', () => {
  const source = fs.readFileSync(path.join(migrationRoot, '0032_journey_taxonomy_retirement_safeguard.sql'), 'utf8');
  assert.doesNotMatch(source, /^CREATE TABLE/gmu, 'the safeguard migration must not invent storage or new table grants');
  assert.match(source, /journey_taxonomy_assignment_lifecycle_guard/u);
  assert.match(contractSource, /runtimeVersion >= 32 \? journeyTaxonomyRetirementRequiredTriggers/u,
    'the live runtime contract must require both runtime-32 triggers');
  assert.match(privilegeSource, /REVOKE EXECUTE ON FUNCTION public\.journey_taxonomy_assignment_lifecycle_guard\(\)/u,
    'the application must not invoke a trigger-only function directly');
  assert.match(contractSource, /privilegeRuntimeVersion >= 32[\s\S]*?taxonomyGuardPrivilege/u);
  const hierarchyPrivileges = privilegeBlocks.get(29) || '';
  assert.match(hierarchyPrivileges, /'journey_taxonomy_terms', true, true, true, true/u,
    'the existing taxonomy update grant is sufficient; runtime-32 must not broaden privileges');
  assert.match(hierarchyPrivileges, /'journey_definition_taxonomy', true, true, true, true/u);
});

test('runtime-34 replaces the live portfolio membership edge without widening table privileges', () => {
  const source = fs.readFileSync(path.join(migrationRoot, '0034_journey_portfolio_owner_attribution.sql'), 'utf8');
  assert.doesNotMatch(source, /^CREATE TABLE/gmu);
  assert.match(source, /<>33/u);
  assert.match(source, /DROP CONSTRAINT journey_portfolio_items_owner_membership_fk/u);
  assert.match(source, /journey_portfolio_items_owner_user_fk[\s\S]*?REFERENCES users\(id\) ON DELETE NO ACTION/u);
  assert.match(source, /journey_portfolio_items_owner_membership_guard/u);
  assert.match(privilegeSource,
    /REVOKE EXECUTE ON FUNCTION public\.journey_portfolio_owner_membership_guard\(\)/u);
  assert.match(contractSource, /privilegeRuntimeVersion >= 34[\s\S]*?portfolioGuardPrivilege/u);
});

test('the runtime 27-55 contracts stay pinned at registered runtime 55', () => {
  const compatibility = JSON.parse(
    fs.readFileSync(path.join(migrationRoot, 'runtime-compatibility.json'), 'utf8')) as {
      minimumRuntimeSchemaVersion: number; maximumRuntimeSchemaVersion: number;
    };
  assert.equal(compatibility.maximumRuntimeSchemaVersion, 55);
  assert.equal(compatibility.minimumRuntimeSchemaVersion, 55);
  assert.match(contractSource, /LATEST_RUNTIME_SCHEMA_VERSION = 55/u);
  assert.match(configSource,
    /POSTGRES_RUNTIME_SCHEMA_VERSION, 55, 1, 1_000_000/u,
    'the application default must require the latest runtime schema');
  assert.match(postgresE2eSource,
    /POSTGRES_RUNTIME_SCHEMA_VERSION: '55'/u,
    'the production-shaped PostgreSQL E2E environment must boot the latest runtime schema');
  assert.match(postgresE2eSource, /upgradeArgs\(55\)/u,
    'the PostgreSQL E2E migration sequence must install and replay runtime 55');
  const beyondWindow = fs.readdirSync(migrationRoot)
    .map((name) => /^(\d{4})_.*\.sql$/u.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .filter((match) => Number(match[1]!) > 55)
    .map((match) => match[0]);
  assert.deepEqual(beyondWindow, [],
    'a migration past runtime-55 must be registered before it can ship');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0048_journey_blueprint_measurements.sql')), true,
    'runtime-48 migration must remain present after aggregate registration');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0049_journey_export_branding.sql')), true,
    'runtime-49 migration must remain present after aggregate registration');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0050_journey_actual_path_durability.sql')), true,
    'runtime-50 migration must remain present after aggregate registration');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0051_journey_connector_execution_plane.sql')), true,
    'runtime-51 migration must remain present after aggregate registration');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0052_journey_operational_stage_feed.sql')), true,
    'runtime-52 migration must remain present after aggregate registration');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0053_journey_event_retention_reconciliation.sql')), true,
    'runtime-53 migration must remain present after aggregate registration');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0054_journey_evidence_monitor.sql')), true,
    'runtime-54 migration must remain present after aggregate registration');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0055_journey_workspace_saved_views.sql')), true,
    'runtime-55 migration must remain present after aggregate registration');
});

/** Single-function REVOKE, with the grantee list that may continue on the next line. */
const FUNCTION_REVOKE =
  /REVOKE\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)\s*FROM\s+([^;]+);/gu;

const functionRevokeGrantees = (source: string): Map<string, Set<string>> => {
  const revokes = new Map<string, Set<string>>();
  for (const match of source.matchAll(FUNCTION_REVOKE)) {
    const grantees = revokes.get(match[1]!) ?? new Set<string>();
    for (const grantee of match[2]!.split(',')) grantees.add(grantee.trim().toUpperCase());
    revokes.set(match[1]!, grantees);
  }
  return revokes;
};

/**
 * PostgreSQL grants EXECUTE on every new function to PUBLIC. Naming only the
 * application role in a REVOKE therefore drops the explicit grant and leaves the
 * default one, so has_function_privilege(role,function,'EXECUTE') stays true and
 * assertRuntimePrivileges raises RUNTIME_PRIVILEGE_OVER_GRANT.
 *
 * Runtime-43 is why this test exists: 0043 created the survey retention guard
 * without the PUBLIC revoke and left it to runtime43_survey_feed_privileges.sql.
 * Only test-postgres-e2e.mjs applies that delta -- deployment (manage.ps1) and
 * the ingest gate apply runtime_privileges.sql alone -- so the guard stayed
 * app-executable on exactly the install paths the delta never reaches, and the
 * full E2E could not see it. Every other guard's own migration closes PUBLIC.
 */
test('every function runtime_privileges.sql revokes is also closed against the PUBLIC default', () => {
  const closedByMigration = new Set<string>();
  for (const file of fs.readdirSync(migrationRoot).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    for (const [name, grantees] of functionRevokeGrantees(
      fs.readFileSync(path.join(migrationRoot, file), 'utf8'))) {
      if (grantees.has('PUBLIC')) closedByMigration.add(name);
    }
  }
  const baseRevokes = functionRevokeGrantees(privilegeSource);
  assert.ok(baseRevokes.size > 0, 'runtime_privileges.sql must revoke the trigger-only guard functions');
  const executableThroughPublic = [...baseRevokes]
    .filter(([name, grantees]) => !grantees.has('PUBLIC') && !closedByMigration.has(name))
    .map(([name]) => name).sort();
  assert.deepEqual(executableThroughPublic, [],
    'these functions stay executable by the application role through PUBLIC once runtime_privileges.sql has applied');
  assert.equal(baseRevokes.get('journey_stage_survey_retention_delete_guard')?.has('PUBLIC'), true,
    'runtime-43 never revoked the PUBLIC default, so the aggregate privilege file must');
});

test('runtime-54 evidence monitor is disabled by default and append-only',()=>{
  assert.match(configSource,/JOURNEY_EVIDENCE_MONITOR_ENABLED,false/u);
  assert.match(serverSource,/journeyEvidenceMonitorWorker\?\.start\(\)/u);
  assert.match(privilegeSource,/REVOKE UPDATE,DELETE ON TABLE public\.journey_evidence_monitor_events/u);
});

test('runtime-55 workspace saved views are private, append-only and least privileged',()=>{
  const source=fs.readFileSync(path.join(migrationRoot,'0055_journey_workspace_saved_views.sql'),'utf8');
  assert.match(source,/owner_user_id TEXT NOT NULL/u);
  assert.match(source,/surface IN \('hierarchy','service_blueprint'\)/u);
  assert.match(source,/workspace_view_versions_guard BEFORE UPDATE OR DELETE/u);
  assert.match(privilegeSource,/REVOKE DELETE ON TABLE public\.journey_workspace_view_definitions/u);
  assert.match(privilegeSource,/REVOKE UPDATE,DELETE ON TABLE public\.journey_workspace_view_versions/u);
  assert.match(contractSource,/privilegeRuntimeVersion >= 55[\s\S]*journey_workspace_view_audit_events/u);
});

test('runtime-53 raw-event retention is disabled by default and uses a dedicated destructive role',()=>{
  assert.match(eventRetentionRuntimeSource,/journeyEventRetentionWorkerEnabled/u);
  assert.match(configSource,/JOURNEY_EVENT_RETENTION_WORKER_ENABLED, false/u);
  assert.match(eventRetentionPrivilegeSource,/__EVENT_RETENTION_WORKER_ROLE__/u);
  assert.match(eventRetentionPrivilegeSource,/REVOKE ALL ON journey_event_retention_runs[\s\S]*FROM __APP_ROLE__/u);
  assert.match(eventRetentionPrivilegeSource,/GRANT EXECUTE ON FUNCTION journey_event_retention_purge_raw/u);
});
