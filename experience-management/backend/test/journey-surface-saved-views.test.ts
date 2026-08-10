import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

/**
 * Executed behaviour contract for the runtime-55 surface saved-view tranche, run
 * against the SQLite parity schema the repository installs on import.
 *
 * SCOPE: this proves the module's own rules and the SQLite mirror's triggers. It
 * is NOT PostgreSQL proof — the plpgsql guards, the deferred pointer foreign key
 * and the `jsonb - text[]` key allowlist are asserted statically in
 * `journey-surface-view-migration.test.ts` and still need an executed PostgreSQL
 * gate before runtime-55 is registered.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-surface-views-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Surface-Views-Test-2026!');
fs.writeFileSync(sessionFile, 'surface-views-session-secret-that-is-long-enough');
fs.writeFileSync(terraFile, 'surface-views-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 61).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 62).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5413', ADMIN_EMAIL: 'surface-views@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraFile, LOCAL_LLM_SHARED_SECRET_FILE: terraFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');
// The tenancy guards read these tables; importing the owning repositories makes
// their SQLite mirrors exist before a guard can fire against them.
await import('../src/journeyHierarchyRepository.js');
await import('../src/journeyServiceBlueprintRepository.js');
const {
  journeySurfaceSavedViewRepository: repository,
  canonicalJourneySurfaceViewConfiguration,
  JOURNEY_SURFACE_VIEW_SCHEMA_VERSION
} = await import('../src/journeySurfaceSavedViewRepository.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const agent = request.agent(app);
await agent.post('/api/auth/login')
  .send({ email: 'surface-views@seemplify.local', password: 'Surface-Views-Test-2026!' }).expect(200);
const session = (await agent.get('/api/auth/session').expect(200)).body;
const ownerId = String(session.user.id);
const spaceId = String(session.activeSpace.id);
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
const map = maps.createJourneyMap(spaceId, ownerId, { name: 'Surface view map', stageNames: ['Discover'] });

const at = '2026-08-08T09:00:00.000Z';

/** A second principal in the SAME tenant, holding the weakest role. */
function addMember(suffix: string, role: 'member' | 'admin') {
  const userId = `surface-${suffix}-user`;
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
    VALUES (?,?,?,'hash','member',?,?)`)
    .run(userId, `surface-${suffix}@seemplify.local`, `Surface ${suffix}`, at, at);
  db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,?,?,?)`).run(spaceId, userId, role, at, at);
  return userId;
}
const memberId = addMember('member', 'member');
const adminId = addMember('admin', 'admin');

/** A second TENANT, created through the real path so it gets a subscription, so
 * cross-tenant reads can be probed with a principal that is a legitimate member
 * of somewhere else rather than a stranger everywhere. */
const { createSpace } = await import('../src/spaces.js');
const otherSpaceId = String(createSpace({ id: ownerId, name: 'Surface Owner' },
  { name: 'Other tenant' }).id);
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(otherSpaceId);

const blueprintId = 'surface-blueprint';
db.prepare(`INSERT INTO journey_blueprints
  (id,space_id,journey_definition_id,name,lifecycle,owner_user_id,owner_team_id,current_version_id,
    revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
  VALUES (?,?,?,'Surface blueprint','draft',?,NULL,NULL,1,?,?,?,?)`)
  .run(blueprintId, spaceId, map.id, ownerId, ownerId, ownerId, at, at);

const otherTenantMap = maps.createJourneyMap(otherSpaceId, ownerId,
  { name: 'Other tenant map', stageNames: ['Discover'] });

function hierarchyConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: JOURNEY_SURFACE_VIEW_SCHEMA_VERSION,
    surface: 'hierarchy',
    hierarchy: { rootDefinitionId: map.id, direction: 'descendants', linkType: 'parent_child',
      taxonomyTermId: null, reviewState: 'approved', lifecycle: 'active', ...overrides },
    blueprint: null,
    presentation: { density: 'comfortable', showRetired: false, showLegend: true }
  };
}
function blueprintConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: JOURNEY_SURFACE_VIEW_SCHEMA_VERSION,
    surface: 'service_blueprint',
    hierarchy: null,
    blueprint: { blueprintId, versionMode: 'current', versionId: null, tab: 'lanes',
      lifecycle: 'all', ...overrides },
    presentation: { density: 'compact', showRetired: true, showLegend: false }
  };
}
function code(run: () => unknown) {
  try { run(); return 'NO_ERROR'; } catch (error) { return String((error as { code?: string }).code || ''); }
}
function versionRows(viewId: string) {
  return db.prepare(`SELECT * FROM journey_surface_view_versions WHERE view_id=?
    ORDER BY version_number`).all(viewId) as any[];
}
function auditRows() {
  return db.prepare('SELECT * FROM journey_surface_view_audit_events ORDER BY created_at,id').all() as any[];
}

test('creating a surface view is idempotent and lands one checksummed version', () => {
  const configuration = hierarchyConfiguration();
  const created = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Executive rollup',
    audience: 'executive', ownerPrivate: false, configuration, now: at
  });
  assert.equal(created.replayed, false);
  assert.deepEqual(
    { revision: created.view.revision, versionNumber: created.view.versionNumber,
      lifecycle: created.view.lifecycle, surface: created.view.surface, audience: created.view.audience },
    { revision: 1, versionNumber: 1, lifecycle: 'active', surface: 'hierarchy', audience: 'executive' });
  const canonical = canonicalJourneySurfaceViewConfiguration(configuration);
  assert.equal(created.view.configurationSha256, canonical.checksum);
  assert.equal(created.view.configurationSha256,
    crypto.createHash('sha256').update(canonical.serialized).digest('hex'));

  // Replaying the identical intent returns the same view rather than a second one.
  const replay = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Executive rollup',
    audience: 'executive', ownerPrivate: false, configuration, now: '2026-08-08T09:05:00.000Z'
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.view.id, created.view.id);
  assert.equal(versionRows(created.view.id).length, 1);
  assert.equal(auditRows().filter((row) => row.action === 'view.created').length, 1);

  // The same name on the same surface is refused even under a different intent.
  assert.equal(code(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'executive   ROLLUP',
    audience: 'internal', ownerPrivate: false, configuration, now: at
  })), 'JOURNEY_SURFACE_VIEW_NAME_TAKEN');
});

test('revising appends an immutable version under an optimistic revision', () => {
  const created = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Revision subject',
    audience: 'internal', ownerPrivate: false, configuration: hierarchyConfiguration(), now: at
  });
  const first = versionRows(created.view.id)[0];
  const next = hierarchyConfiguration({ direction: 'both', rootDefinitionId: null, reviewState: null });

  const revised = repository.reviseView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: created.view.revision,
    configuration: next, now: '2026-08-08T10:00:00.000Z'
  });
  assert.equal(revised.replayed, false);
  assert.deepEqual({ revision: revised.view.revision, versionNumber: revised.view.versionNumber },
    { revision: 2, versionNumber: 2 });
  assert.equal(revised.view.configuration.hierarchy?.direction, 'both');

  // The superseded version is byte-identical to what it was written as.
  const afterRevision = versionRows(created.view.id);
  assert.equal(afterRevision.length, 2);
  assert.equal(afterRevision[0].configuration_json, first.configuration_json);
  assert.equal(afterRevision[0].configuration_sha256, first.configuration_sha256);
  assert.equal(afterRevision[0].definition_revision, 1);
  assert.equal(afterRevision[1].definition_revision, 1,
    'a version records the revision it was authored against, not the one it produced');

  // Replaying the same revise intent is a no-op that reports itself as one.
  const replay = repository.reviseView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: created.view.revision,
    configuration: next, now: '2026-08-08T10:05:00.000Z'
  });
  assert.equal(replay.replayed, true);
  assert.equal(versionRows(created.view.id).length, 2);
});

test('two writers holding the same revision cannot both append', () => {
  const created = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Contended view',
    audience: 'delivery', ownerPrivate: false, configuration: hierarchyConfiguration(), now: at
  });
  // Both readers hold revision 1. This is the lost-update scenario the database
  // guard and the WHERE-clause revision predicate exist for; SQLite serialises
  // the two calls, so what is proven here is the CONTRACT, not the scheduling.
  const held = created.view.revision;
  repository.reviseView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: held,
    configuration: hierarchyConfiguration({ direction: 'ancestors' }), now: '2026-08-08T11:00:00.000Z'
  });
  assert.equal(code(() => repository.reviseView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: held,
    configuration: hierarchyConfiguration({ linkType: 'variant' }), now: '2026-08-08T11:01:00.000Z'
  })), 'JOURNEY_SURFACE_VIEW_REVISION_CONFLICT');
  assert.equal(versionRows(created.view.id).length, 2);

  // Nor can a writer that goes around the module re-use a version number, skip
  // one, or claim a revision the view is not at.
  const columns = `(id,view_id,space_id,surface,version_number,schema_version,definition_revision,
    configuration_json,configuration_sha256,request_sha256,hierarchy_direction,hierarchy_lifecycle,created_at)`;
  const canonical = canonicalJourneySurfaceViewConfiguration(hierarchyConfiguration({
    direction: 'both', rootDefinitionId: null, reviewState: null, linkType: null }));
  const insert = (versionNumber: number, definitionRevision: number) => db.prepare(
    `INSERT INTO journey_surface_view_versions ${columns} VALUES (?,?,?,'hierarchy',?,?,?,?,?,?,'both','active',?)`)
    .run(crypto.randomUUID(), created.view.id, spaceId, versionNumber,
      JOURNEY_SURFACE_VIEW_SCHEMA_VERSION, definitionRevision, canonical.serialized, canonical.checksum,
      crypto.createHash('sha256').update(`raw-${versionNumber}-${definitionRevision}`).digest('hex'), at);
  assert.throws(() => insert(2, 2), /gapless and monotone/u);
  assert.throws(() => insert(4, 2), /gapless and monotone/u);
  assert.throws(() => insert(3, 1), /revision is stale/u);
});

test('configuration versions and audit receipts are append-only', () => {
  const created = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Immutable subject',
    audience: 'research', ownerPrivate: false, configuration: hierarchyConfiguration(), now: at
  });
  const version = versionRows(created.view.id)[0];
  assert.throws(() => db.prepare('UPDATE journey_surface_view_versions SET configuration_sha256=? WHERE id=?')
    .run('0'.repeat(64), version.id), /append-only/u);
  assert.throws(() => db.prepare('DELETE FROM journey_surface_view_versions WHERE id=?').run(version.id),
    /append-only/u);
  const audit = auditRows()[0];
  assert.throws(() => db.prepare('UPDATE journey_surface_view_audit_events SET action=? WHERE id=?')
    .run('view.retired', audit.id), /append-only/u);
  assert.throws(() => db.prepare('DELETE FROM journey_surface_view_audit_events WHERE id=?').run(audit.id),
    /append-only/u);
  // Ownership and identity are immutable; the revision advances by exactly one.
  assert.throws(() => db.prepare(`UPDATE journey_surface_view_definitions
    SET owner_user_id=?,definition_revision=definition_revision+1 WHERE id=?`).run(memberId, created.view.id),
    /identity and ownership are immutable/u);
  assert.throws(() => db.prepare('UPDATE journey_surface_view_definitions SET audience=? WHERE id=?')
    .run('external', created.view.id), /revision is stale/u);
});

test('the configuration surface is closed to anything a service could interpret', () => {
  assert.equal(code(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Injected view', audience: 'internal',
    configuration: { ...hierarchyConfiguration(), sql: 'DROP TABLE journey_definitions' }, now: at
  })), 'JOURNEY_SURFACE_VIEW_CONFIG_INVALID');
  assert.equal(code(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Injected nested', audience: 'internal',
    configuration: hierarchyConfiguration({ query: 'SELECT 1' }), now: at
  })), 'JOURNEY_SURFACE_VIEW_CONFIG_INVALID');

  // And a writer that bypasses the module is refused by the stored key allowlist.
  const created = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Allowlist subject', audience: 'internal',
    configuration: hierarchyConfiguration(), now: at
  });
  const smuggled = JSON.stringify({ ...hierarchyConfiguration(), rawFilter: 'anything' });
  assert.throws(() => db.prepare(`INSERT INTO journey_surface_view_versions
    (id,view_id,space_id,surface,version_number,schema_version,definition_revision,configuration_json,
      configuration_sha256,request_sha256,hierarchy_direction,hierarchy_lifecycle,created_at)
    VALUES (?,?,?,'hierarchy',2,?,1,?,?,?,'both','active',?)`)
    .run(crypto.randomUUID(), created.view.id, spaceId, JOURNEY_SURFACE_VIEW_SCHEMA_VERSION, smuggled,
      crypto.createHash('sha256').update(smuggled).digest('hex'),
      crypto.createHash('sha256').update('smuggled').digest('hex'), at),
    /outside the closed surface/u);
});

test('a saved view carries exactly one surface of configuration', () => {
  assert.equal(code(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'service_blueprint', name: 'Wrong surface',
    audience: 'internal', configuration: hierarchyConfiguration(), now: at
  })), 'JOURNEY_SURFACE_VIEW_CONFIG_SURFACE_MISMATCH');
  assert.equal(code(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Both surfaces', audience: 'internal',
    configuration: { ...hierarchyConfiguration(), blueprint: { blueprintId } }, now: at
  })), 'JOURNEY_SURFACE_VIEW_CONFIG_SURFACE_MISMATCH');
  assert.equal(code(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Rootless direction', audience: 'internal',
    configuration: hierarchyConfiguration({ rootDefinitionId: null }), now: at
  })), 'JOURNEY_SURFACE_VIEW_CONFIG_ROOT_REQUIRED');

  const blueprintView = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'service_blueprint', name: 'Blueprint lanes',
    audience: 'delivery', ownerPrivate: false, configuration: blueprintConfiguration(), now: at
  });
  assert.equal(blueprintView.view.configuration.blueprint?.tab, 'lanes');
  assert.equal(blueprintView.view.configuration.hierarchy, null);
  const stored = versionRows(blueprintView.view.id)[0];
  assert.deepEqual(
    { blueprint: stored.blueprint_id, tab: stored.blueprint_tab, direction: stored.hierarchy_direction },
    { blueprint: blueprintId, tab: 'lanes', direction: null },
    'the surface-specific columns are projected out of the document, not left only inside it');
});

test('configuration targets outside the tenant are refused', () => {
  assert.throws(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Foreign root', audience: 'internal',
    configuration: hierarchyConfiguration({ rootDefinitionId: otherTenantMap.id }), now: at
  }), /hierarchy root is outside the tenant/u);
  assert.throws(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Absent term', audience: 'internal',
    configuration: hierarchyConfiguration({ taxonomyTermId: 'no-such-term' }), now: at
  }), /taxonomy filter is outside the tenant/u);
  assert.throws(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'service_blueprint', name: 'Absent blueprint',
    audience: 'internal', configuration: blueprintConfiguration({ blueprintId: 'no-such-blueprint' }), now: at
  }), /blueprint is outside the tenant/u);
  assert.throws(() => repository.createView({
    spaceId, actorUserId: ownerId, surface: 'service_blueprint', name: 'Foreign pin', audience: 'internal',
    configuration: blueprintConfiguration({ versionMode: 'pinned', versionId: 'no-such-version' }), now: at
  }), /blueprint pin is outside its blueprint/u);
});

test('cross-tenant and owner-private lookups fail identically to a missing view', () => {
  const shared = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Shared board', audience: 'internal',
    ownerPrivate: false, configuration: hierarchyConfiguration(), now: at
  });
  const priv = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Owner private board',
    audience: 'internal', ownerPrivate: true, configuration: hierarchyConfiguration(), now: at
  });

  // A real view read from the wrong tenant, an invented id, and somebody else's
  // private view are one indistinguishable answer.
  const missing = code(() => repository.getView(spaceId, ownerId, 'no-such-view'));
  assert.equal(missing, 'JOURNEY_SURFACE_VIEW_NOT_FOUND');
  assert.equal(code(() => repository.getView(otherSpaceId, ownerId, shared.view.id)), missing);
  assert.equal(code(() => repository.getView(spaceId, memberId, priv.view.id)), missing);
  assert.equal(code(() => repository.reviseView({
    spaceId, actorUserId: memberId, viewId: priv.view.id, expectedRevision: 1,
    configuration: hierarchyConfiguration(), now: at
  })), missing);
  // An admin does not outrank owner-private either.
  assert.equal(code(() => repository.getView(spaceId, adminId, priv.view.id)), missing);

  // A principal with no membership at all learns nothing about the tenant.
  assert.equal(code(() => repository.getView(spaceId, 'stranger', shared.view.id)),
    'JOURNEY_SURFACE_VIEW_FORBIDDEN');

  const memberVisible = repository.listViews({ spaceId, actorUserId: memberId, surface: 'hierarchy' });
  assert.equal(memberVisible.some((view) => view.id === priv.view.id), false);
  assert.equal(memberVisible.some((view) => view.id === shared.view.id), true);
});

test('a member manages only its own views and never another principal', () => {
  const shared = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Owner shared board',
    audience: 'internal', ownerPrivate: false, configuration: hierarchyConfiguration(), now: at
  });
  assert.equal(code(() => repository.reviseView({
    spaceId, actorUserId: memberId, viewId: shared.view.id, expectedRevision: shared.view.revision,
    configuration: hierarchyConfiguration({ direction: 'ancestors' }), now: at
  })), 'JOURNEY_SURFACE_VIEW_NOT_OWNER');
  assert.equal(code(() => repository.retireView({
    spaceId, actorUserId: memberId, viewId: shared.view.id, expectedRevision: shared.view.revision, now: at
  })), 'JOURNEY_SURFACE_VIEW_NOT_OWNER');

  // Its own view, it does manage.
  const own = repository.createView({
    spaceId, actorUserId: memberId, surface: 'hierarchy', name: 'Member private board',
    audience: 'internal', configuration: hierarchyConfiguration(), now: at
  });
  assert.equal(own.view.ownerPrivate, true);
  assert.equal(repository.reviseView({
    spaceId, actorUserId: memberId, viewId: own.view.id, expectedRevision: own.view.revision,
    configuration: hierarchyConfiguration({ direction: 'both', rootDefinitionId: null, reviewState: null }),
    now: at
  }).view.revision, 2);
  // An admin may manage a SHARED view it does not own; that is the only widening.
  assert.equal(repository.reviseView({
    spaceId, actorUserId: adminId, viewId: shared.view.id, expectedRevision: shared.view.revision,
    configuration: hierarchyConfiguration({ direction: 'ancestors' }), now: at
  }).view.revision, 2);
});

test('retiring blocks revision and reactivation restores it, both idempotently', () => {
  const created = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Lifecycle board', audience: 'internal',
    ownerPrivate: false, configuration: hierarchyConfiguration(), now: at
  });
  const retired = repository.retireView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: created.view.revision, now: at
  });
  assert.deepEqual({ lifecycle: retired.view.lifecycle, replayed: retired.replayed, retiredAt: retired.view.retiredAt },
    { lifecycle: 'retired', replayed: false, retiredAt: at });
  assert.equal(code(() => repository.reviseView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: retired.view.revision,
    configuration: hierarchyConfiguration({ direction: 'ancestors' }), now: at
  })), 'JOURNEY_SURFACE_VIEW_RETIRED');
  // Repeating the retire is a replay, not a conflict, even with a stale revision.
  const again = repository.retireView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: created.view.revision, now: at
  });
  assert.deepEqual({ replayed: again.replayed, revision: again.view.revision },
    { replayed: true, revision: retired.view.revision });

  const reactivated = repository.reactivateView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: retired.view.revision, now: at
  });
  assert.deepEqual({ lifecycle: reactivated.view.lifecycle, retiredAt: reactivated.view.retiredAt },
    { lifecycle: 'active', retiredAt: null });
  assert.equal(reactivated.view.revision, retired.view.revision + 1);
});

test('defaults are per principal per surface, pin a version, and reset cleanly', () => {
  const hierarchyView = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Default hierarchy', audience: 'internal',
    ownerPrivate: false, configuration: hierarchyConfiguration(), now: at
  });
  const blueprintView = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'service_blueprint', name: 'Default blueprint',
    audience: 'internal', ownerPrivate: false, configuration: blueprintConfiguration(), now: at
  });

  const selected = repository.setDefault({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', viewId: hierarchyView.view.id, now: at });
  assert.deepEqual(
    { replayed: selected.replayed, revision: selected.default.revision,
      version: selected.default.viewVersionId },
    { replayed: false, revision: 1, version: hierarchyView.view.versionId });
  assert.equal(repository.setDefault({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', viewId: hierarchyView.view.id, now: at
  }).replayed, true, 'an unchanged selection is a replay, not a second write');

  // A surface's default is independent of the other surface's, and of another
  // principal's.
  assert.equal(repository.getDefault(spaceId, ownerId, 'service_blueprint'), null);
  repository.setDefault({
    spaceId, actorUserId: ownerId, surface: 'service_blueprint', viewId: blueprintView.view.id, now: at });
  assert.equal(repository.getDefault(spaceId, ownerId, 'hierarchy')?.viewId, hierarchyView.view.id);
  assert.equal(repository.getDefault(spaceId, memberId, 'hierarchy'), null);
  repository.setDefault({
    spaceId, actorUserId: memberId, surface: 'hierarchy', viewId: hierarchyView.view.id, now: at });
  assert.equal(repository.getDefault(spaceId, memberId, 'hierarchy')?.viewId, hierarchyView.view.id);

  // A view can only be a default for its own surface.
  assert.equal(code(() => repository.setDefault({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', viewId: blueprintView.view.id, now: at
  })), 'JOURNEY_SURFACE_VIEW_NOT_FOUND');

  // Revising the view does not silently redefine an existing pin; re-selecting
  // moves it forward and advances the default's own revision.
  const revised = repository.reviseView({
    spaceId, actorUserId: ownerId, viewId: hierarchyView.view.id, expectedRevision: hierarchyView.view.revision,
    configuration: hierarchyConfiguration({ direction: 'ancestors' }), now: at
  });
  assert.equal(repository.getDefault(spaceId, ownerId, 'hierarchy')?.viewVersionId,
    hierarchyView.view.versionId);
  const moved = repository.setDefault({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', viewId: hierarchyView.view.id, now: at });
  assert.deepEqual({ replayed: moved.replayed, revision: moved.default.revision,
    version: moved.default.viewVersionId },
    { replayed: false, revision: 2, version: revised.view.versionId });

  const cleared = repository.resetDefault({ spaceId, actorUserId: ownerId, surface: 'hierarchy', now: at });
  assert.deepEqual(cleared, { cleared: true, replayed: false });
  assert.equal(repository.getDefault(spaceId, ownerId, 'hierarchy'), null);
  assert.deepEqual(repository.resetDefault({ spaceId, actorUserId: ownerId, surface: 'hierarchy', now: at }),
    { cleared: false, replayed: true });
  // Resetting one principal's default leaves everybody else's alone.
  assert.equal(repository.getDefault(spaceId, memberId, 'hierarchy')?.viewId, hierarchyView.view.id);
  assert.equal(repository.getDefault(spaceId, ownerId, 'service_blueprint')?.viewId, blueprintView.view.id);
});

test('the audit trail records the change and none of the content', () => {
  const created = repository.createView({
    spaceId, actorUserId: ownerId, surface: 'hierarchy', name: 'Audited board of secrets',
    audience: 'external', ownerPrivate: false, configuration: hierarchyConfiguration(), now: at
  });
  // Distinct instants: the receipts are ordered by created_at, and equal
  // timestamps would leave the assertion below depending on random row ids.
  repository.reviseView({
    spaceId, actorUserId: ownerId, viewId: created.view.id, expectedRevision: created.view.revision,
    configuration: hierarchyConfiguration({ direction: 'ancestors' }), now: '2026-08-08T12:01:00.000Z'
  });
  repository.setDefault({ spaceId, actorUserId: ownerId, surface: 'hierarchy', viewId: created.view.id,
    now: '2026-08-08T12:02:00.000Z' });
  repository.resetDefault({ spaceId, actorUserId: ownerId, surface: 'hierarchy',
    now: '2026-08-08T12:03:00.000Z' });

  const viewSha = crypto.createHash('sha256').update(created.view.id).digest('hex');
  const mine = auditRows().filter((row) => row.view_sha256 === viewSha);
  assert.deepEqual(mine.map((row) => row.action),
    ['view.created', 'view.revised', 'default.selected', 'default.reset']);
  assert.equal(mine.every((row) => row.definition_revision > 0), true);

  const serialized = JSON.stringify(auditRows());
  assert.equal(serialized.includes('Audited board of secrets'), false);
  assert.equal(serialized.includes(created.view.id), false,
    'the audited view identity is a hash, so a receipt cannot be joined back to content by id alone');
  assert.equal(serialized.includes(map.id), false);
  assert.equal(serialized.includes('hierarchy_root'), false);

  const surfaced = repository.listAudit(spaceId, ownerId, 'hierarchy', 500);
  assert.equal(surfaced.some((row) => row.viewSha256 === viewSha), true);
  assert.equal(Object.keys(surfaced[0]!).includes('name'), false);
});
