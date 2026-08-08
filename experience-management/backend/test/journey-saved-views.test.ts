import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import type { JourneyMetricVersionInput } from '../src/journeyMetrics.js';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-saved-views-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Saved-View-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-saved-view-test-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 51).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 52).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-saved-views@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');
const metrics = await import('../src/journeyMetrics.js');
const { journeyMetricPrivacyDecision } = await import('../src/journeyMetricPrivacy.js');
const { runOneJourneyMetricRebuild } = await import('../src/journeyMetricRebuild.js');
const savedViews = await import('../src/journeySavedViews.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

type TestAgent = ReturnType<typeof request.agent>;
function testAgent() {
  const agent = request.agent(app);
  agent.app.on('listening', () => agent.app.unref());
  return agent;
}

async function ownerIdentity() {
  const agent = testAgent();
  await agent.post('/api/auth/login').send({
    email: 'journey-saved-views@seemplify.local', password: 'Journey-Saved-View-Test-Password-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId: String(session.body.user.id) };
}

async function collaborator(spaceId: string, role: 'admin' | 'member', suffix: string) {
  const agent = testAgent();
  await signupVerifyAndOnboard(agent, {
    name: `Saved view ${role}`, email: `saved-view-${role}-${suffix}@example.test`,
    password: 'Strong-saved-view-password-2026!', spaceName: `Saved view ${role} home`
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id);
  const homeSpaceId = String(session.body.activeSpace.id);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,?,?,?)`).run(spaceId, userId, role, now, now);
  return { agent, userId, homeSpaceId };
}

function inSpace(agent: TestAgent, method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, spaceId: string) {
  return agent[method](url).set('x-seemplify-space', spaceId);
}

function config(versionId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    binding: versionId ? { policy: 'exact', versionId } : { policy: 'follows_current', versionId: null },
    filters: {
      personaIds: [], segmentIds: [], cohortIds: [], channelIds: [], evidenceLinkIds: [],
      evidenceStates: [], cardKinds: [], laneKeys: [], timeWindow: null,
      ...((overrides.filters as Record<string, unknown> | undefined) || {})
    },
    comparisonTarget: overrides.comparisonTarget || null,
    presentation: {
      density: 'comfortable', showEvidenceLegend: true, showResearchGaps: true,
      showEmptyLanes: true, title: '',
      ...((overrides.presentation as Record<string, unknown> | undefined) || {})
    }
  };
}

function createView(agent: TestAgent, spaceId: string, definitionId: string, input: {
  name: string; visibility?: 'private' | 'space'; config: ReturnType<typeof config>; key?: string;
}) {
  return inSpace(agent, 'post', `/api/journey-maps/${definitionId}/saved-views`, spaceId)
    .set('Idempotency-Key', input.key || crypto.randomUUID())
    .send({ name: input.name, visibility: input.visibility || 'private', config: input.config });
}

test('saved views are exact, private/shared, re-authorised, idempotent, retained, metered, and exportable', async () => {
  const owner = await ownerIdentity();
  const member = await collaborator(owner.spaceId, 'member', 'member');
  const admin = await collaborator(owner.spaceId, 'admin', 'admin');

  const definition = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: 'Account renewal journey', purpose: 'Reduce avoidable effort', stageNames: ['Review', 'Confirm']
  });
  const futureDefinition = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: 'Future renewal journey', mapType: 'future_state', stageNames: ['Prepare', 'Confirm']
  });
  let map = maps.getJourneyMap(owner.spaceId, definition.id, undefined, owner.userId)!;
  const futureMap = maps.getJourneyMap(owner.spaceId, futureDefinition.id, undefined, owner.userId)!;
  const persona = maps.createJourneyPersona(owner.spaceId, owner.userId, {
    name: 'Renewing account owner', summary: 'Needs a clear renewal total.', lifecycleState: 'active'
  });
  const unlinkedPersona = maps.createJourneyPersona(owner.spaceId, owner.userId, {
    name: 'Unlinked procurement lead', summary: 'Must not match by name.', lifecycleState: 'active'
  });
  maps.linkPersonaToJourney(owner.spaceId, definition.id, persona.id);
  maps.linkPersonaToJourney(owner.spaceId, futureDefinition.id, persona.id);
  map = maps.addJourneyCard(owner.spaceId, definition.id, map.definition.revision, {
    stageKey: map.stages[0].stageKey, laneType: 'emotions', kind: 'emotion', title: 'Uncertain about price',
    personaId: persona.id
  }, owner.userId);
  map = maps.addJourneyCard(owner.spaceId, definition.id, map.definition.revision, {
    stageKey: map.stages[1].stageKey, laneType: 'customer_actions', kind: 'action', title: 'Confirm renewal'
  }, owner.userId);
  const originalVersionId = map.version.id;
  const personaConfig = config(originalVersionId, {
    filters: { personaIds: [persona.id], cardKinds: ['emotion'], laneKeys: ['emotions'] },
    comparisonTarget: { definitionId: futureDefinition.id, versionId: futureMap.version.id },
    presentation: { density: 'compact', showEvidenceLegend: false, showEmptyLanes: false, title: 'Renewal confidence' }
  });

  const invalidPersona = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Invalid persona scope', config: config(originalVersionId, { filters: { personaIds: [unlinkedPersona.id] } })
  }).expect(422);
  assert.equal(invalidPersona.body.code, 'JOURNEY_SAVED_VIEW_PERSONA_SCOPE_INVALID');
  const invalidCohort = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Unsupported cohort', config: config(originalVersionId, { filters: { cohortIds: ['not-a-segment'] } })
  }).expect(422);
  assert.equal(invalidCohort.body.code, 'JOURNEY_SAVED_VIEW_COHORT_UNSUPPORTED');

  const createKey = crypto.randomUUID();
  const privateCreated = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Owner private evidence', config: personaConfig, key: createKey
  }).expect(201);
  const privateReplay = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Owner private evidence', config: personaConfig, key: createKey
  }).expect(201);
  assert.equal(privateReplay.body.replayed, true);
  assert.equal(privateReplay.body.view.id, privateCreated.body.view.id);
  const conflictingIntent = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Different name', config: personaConfig, key: createKey
  }).expect(409);
  assert.equal(conflictingIntent.body.code, 'JOURNEY_SAVED_VIEW_IDEMPOTENCY_CONFLICT');

  const shared = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Shared renewal evidence', visibility: 'space', config: personaConfig
  }).expect(201);
  const memberList = await inSpace(member.agent, 'get', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId)
    .expect(200);
  assert.deepEqual(memberList.body.views.map((view: any) => view.id), [shared.body.view.id]);
  await inSpace(member.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${privateCreated.body.view.id}?revision=1`, owner.spaceId).expect(404);
  await inSpace(member.agent, 'patch',
    `/api/journey-maps/${definition.id}/saved-views/${shared.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).send({
      expectedRevision: 1, name: 'Member rewrite', visibility: 'space', config: personaConfig
    }).expect(403);
  await createView(member.agent, owner.spaceId, definition.id, {
    name: 'Member cannot share', visibility: 'space', config: personaConfig
  }).expect(403);
  const memberPrivate = await createView(member.agent, owner.spaceId, definition.id, {
    name: 'Member private evidence', config: personaConfig
  }).expect(201);
  const ownerList = await inSpace(owner.agent, 'get', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId)
    .expect(200);
  assert.equal(ownerList.body.views.some((view: any) => view.id === memberPrivate.body.view.id), false);
  await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${memberPrivate.body.view.id}?revision=1`, owner.spaceId).expect(404);
  const adminCopy = await inSpace(admin.agent, 'post',
    `/api/journey-maps/${definition.id}/saved-views/${shared.body.view.id}/duplicate`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).send({ expectedRevision: 1 }).expect(201);
  assert.equal(adminCopy.body.view.visibility, 'private');
  assert.equal(adminCopy.body.view.ownerUserId, admin.userId);

  const resolved = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${privateCreated.body.view.id}?revision=1`, owner.spaceId).expect(200);
  assert.equal(resolved.body.map.version.id, originalVersionId);
  assert.deepEqual(resolved.body.map.cards.map((card: any) => card.title), ['Uncertain about price']);
  assert.equal(resolved.body.map.lanes.length, 1);
  assert.equal(resolved.body.comparisonMap.definition.id, futureDefinition.id);
  assert.equal(resolved.body.view.config.presentation.title, 'Renewal confidence');
  const evidenceOptions = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/evidence-options?versionId=${originalVersionId}`, owner.spaceId)
    .expect(200);
  assert.deepEqual(evidenceOptions.body, { evidence: [] });

  const segment = metrics.createJourneyMetricSegment({
    spaceId: owner.spaceId, actorUserId: owner.userId, journeyDefinitionId: definition.id,
    name: 'High-value renewals', rule: { tier: 'high-value' }, idempotencyKey: crypto.randomUUID()
  }).segment;
  const analyticsView = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'High-value last month', config: config(originalVersionId, { filters: {
      segmentIds: [segment.id], timeWindow: {
        from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z', timezone: 'Europe/London'
      }
    } })
  }).expect(201);
  const analyticsResolved = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${analyticsView.body.view.id}?revision=1`, owner.spaceId).expect(200);
  assert.deepEqual(analyticsResolved.body.analytics.applied.segmentIds, [segment.id]);
  assert.equal(analyticsResolved.body.analytics.segments[0].name, 'High-value renewals');
  assert.equal(analyticsResolved.body.analytics.applied.timeWindow.timezone, 'Europe/London');
  db.prepare("UPDATE journey_metric_segments SET state='retired' WHERE id=? AND space_id=?").run(segment.id, owner.spaceId);
  const unavailable = await inSpace(owner.agent, 'get', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId)
    .expect(200);
  const unavailableAnalytics = unavailable.body.views.find((view: any) => view.id === analyticsView.body.view.id);
  assert.equal(unavailableAnalytics.availability, 'unavailable');
  assert.equal(unavailableAnalytics.config, null);
  await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${analyticsView.body.view.id}?revision=1`, owner.spaceId).expect(403);
  db.prepare("UPDATE journey_metric_segments SET state='active' WHERE id=? AND space_id=?").run(segment.id, owner.spaceId);

  const follows = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Follow renewal draft', config: config(null)
  }).expect(201);
  maps.publishJourneyMap(owner.spaceId, definition.id, map.definition.revision, owner.userId);
  const currentAfterPublish = maps.getJourneyMap(owner.spaceId, definition.id, undefined, owner.userId)!;
  assert.notEqual(currentAfterPublish.version.id, originalVersionId);
  const exactAfterPublish = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${privateCreated.body.view.id}?revision=1`, owner.spaceId).expect(200);
  const followsAfterPublish = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${follows.body.view.id}?revision=1`, owner.spaceId).expect(200);
  assert.equal(exactAfterPublish.body.map.version.id, originalVersionId);
  assert.equal(followsAfterPublish.body.map.version.id, currentAfterPublish.version.id);

  await inSpace(owner.agent, 'put',
    `/api/journey-maps/${definition.id}/saved-views/${shared.body.view.id}/default`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).send({ expectedViewRevision: 1 }).expect(200);
  let defaultList = await inSpace(owner.agent, 'get', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId)
    .expect(200);
  assert.equal(defaultList.body.selected.viewId, shared.body.view.id);
  const updatedShared = await inSpace(owner.agent, 'patch',
    `/api/journey-maps/${definition.id}/saved-views/${shared.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).send({
      expectedRevision: 1, name: 'Shared renewal evidence v2', visibility: 'space', config: personaConfig
    }).expect(200);
  assert.equal(updatedShared.body.view.revision, 2);
  defaultList = await inSpace(owner.agent, 'get', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId)
    .expect(200);
  assert.equal(defaultList.body.selected, null, 'editing a view must not silently retarget an exact default selection');
  await inSpace(owner.agent, 'patch',
    `/api/journey-maps/${definition.id}/saved-views/${shared.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).send({
      expectedRevision: 1, name: 'Lost update', visibility: 'space', config: personaConfig
    }).expect(409);
  await inSpace(owner.agent, 'delete', `/api/journey-maps/${definition.id}/saved-view-default`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).expect(200);

  const exportKey = crypto.randomUUID();
  const exported = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/export.json?viewId=${privateCreated.body.view.id}&viewRevision=1`, owner.spaceId)
    .set('Idempotency-Key', exportKey).expect(200).expect('Content-Type', /application\/json/u);
  const exportedBody = JSON.parse(exported.text);
  assert.equal(exportedBody.metadata.selectedView.id, privateCreated.body.view.id);
  assert.equal(exportedBody.metadata.selectedView.revision, 1);
  assert.deepEqual(exportedBody.journeyMap.cards.map((card: any) => card.title), ['Uncertain about price']);
  assert.match(String(exported.headers['content-disposition']), /view-owner-private-evidence-r1\.json/u);
  const replayedExport = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/export.json?viewId=${privateCreated.body.view.id}&viewRevision=1`, owner.spaceId)
    .set('Idempotency-Key', exportKey).expect(200);
  assert.equal(replayedExport.headers['x-seemplify-usage-replayed'], 'true');
  const exportAuditCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_saved_view_audit_events
    WHERE view_id=? AND action='view.exported'`).get(privateCreated.body.view.id) as any).count);
  assert.equal(exportAuditCount, 1);
  await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/export.json?viewId=${privateCreated.body.view.id}&viewRevision=999`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).expect(409);

  const deleted = await inSpace(member.agent, 'delete',
    `/api/journey-maps/${definition.id}/saved-views/${memberPrivate.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', 'member-delete-once').send({ expectedRevision: 1, reason: 'Member cleanup request' }).expect(200);
  const deletedReplay = await inSpace(member.agent, 'delete',
    `/api/journey-maps/${definition.id}/saved-views/${memberPrivate.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', 'member-delete-once').send({ expectedRevision: 1, reason: 'Member cleanup request' }).expect(200);
  assert.equal(deletedReplay.body.replayed, true);
  const restored = await inSpace(member.agent, 'post',
    `/api/journey-maps/${definition.id}/saved-views/${memberPrivate.body.view.id}/restore`, owner.spaceId)
    .set('Idempotency-Key', 'member-restore-once').send({ expectedRevision: deleted.body.revision }).expect(200);
  const restoredReplay = await inSpace(member.agent, 'post',
    `/api/journey-maps/${definition.id}/saved-views/${memberPrivate.body.view.id}/restore`, owner.spaceId)
    .set('Idempotency-Key', 'member-restore-once').send({ expectedRevision: deleted.body.revision }).expect(200);
  assert.equal(restoredReplay.body.replayed, true);
  await inSpace(member.agent, 'delete',
    `/api/journey-maps/${definition.id}/saved-views/${memberPrivate.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', 'member-delete-final').send({ expectedRevision: restored.body.revision,
      reason: 'Final retained cleanup' }).expect(200);
  assert.throws(() => db.prepare('DELETE FROM space_memberships WHERE space_id=? AND user_id=?')
    .run(owner.spaceId, member.userId), /foreign key/iu);
  db.prepare("UPDATE journey_saved_views SET retention_expires_at='2026-01-01T00:00:00.000Z' WHERE id=?")
    .run(memberPrivate.body.view.id);
  assert.deepEqual(savedViews.purgeExpiredJourneySavedViews('2026-08-05T23:00:00.000Z'), { purged: 1 });
  assert.deepEqual(savedViews.purgeExpiredJourneySavedViews('2026-08-05T23:00:00.000Z'), { purged: 0 });
  const purgeAuditCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_saved_view_audit_events
    WHERE view_id=? AND action='retention.purged'`).get(memberPrivate.body.view.id) as any).count);
  assert.equal(purgeAuditCount, 1);
  assert.equal(db.prepare('DELETE FROM space_memberships WHERE space_id=? AND user_id=?')
    .run(owner.spaceId, member.userId).changes, 1);

  const settingsOff = await inSpace(owner.agent, 'patch',
    `/api/journey-maps/${definition.id}/saved-views/settings`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ expectedRevision: 0, enabled: false, retentionDays: 30 }).expect(200);
  await inSpace(owner.agent, 'get', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId).expect(403);
  await inSpace(owner.agent, 'patch', `/api/journey-maps/${definition.id}/saved-views/settings`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ expectedRevision: settingsOff.body.settings.revision, enabled: true, retentionDays: 7 }).expect(200);

  const planRow = db.prepare("SELECT limits_json FROM platform_subscription_plans WHERE code='enterprise'").get() as any;
  const limits = JSON.parse(planRow.limits_json);
  const activeCount = Number((db.prepare("SELECT COUNT(*) count FROM journey_saved_views WHERE space_id=? AND state='active'")
    .get(owner.spaceId) as any).count);
  db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'")
    .run(JSON.stringify({ ...limits, journeySavedViews: activeCount }));
  const quotaDenied = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Beyond saved-view allowance', config: config(null)
  }).expect(409);
  assert.equal(quotaDenied.body.code, 'SUBSCRIPTION_QUOTA_EXCEEDED');
  db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(planRow.limits_json);

  // The member's personal Starter space can still own maps, but the saved-view
  // feature and API remain unavailable by plan.
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(member.homeSpaceId);
  const starterMap = maps.createJourneyMap(member.homeSpaceId, member.userId, {
    name: 'Starter map without saved views', stageNames: ['Use']
  });
  await member.agent.get(`/api/journey-maps/${starterMap.id}/saved-views`).expect(403);
});

/** Split a CSV document into fields the way a spreadsheet does, honouring
 * RFC 4180 quoting. Splitting naively on commas would report quoted content as
 * separate fields and hide whether the quoting is what makes it inert. */
function parseCsvFields(text: string) {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') { field += character; continue; }
      if (text[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ',' || character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      fields.push(field); field = '';
      continue;
    }
    field += character;
  }
  fields.push(field);
  return fields.filter((entry) => entry.length > 0);
}

/** A principal who belongs only to their own space. `ownerIdentity()` always
 * logs in the same bootstrap admin, so it cannot stand in for a second tenant. */
async function outsiderIdentity(suffix: string) {
  const agent = testAgent();
  await signupVerifyAndOnboard(agent, {
    name: 'Saved view outsider', email: `saved-view-outsider-${suffix}@example.test`,
    password: 'Strong-saved-view-password-2026!', spaceName: `Outsider home ${suffix}`
  });
  const session = await agent.get('/api/auth/session').expect(200);
  return { agent, userId: String(session.body.user.id), homeSpaceId: String(session.body.activeSpace.id) };
}

/** Build an isolated owner + two-card map so each focused test below fails on
 * its own behaviour instead of inheriting the mega-test's ordering. */
async function fixture(label: string) {
  const owner = await ownerIdentity();
  const definition = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: `${label} journey`, purpose: 'Focused saved-view coverage', stageNames: ['Discover', 'Decide']
  });
  let map = maps.getJourneyMap(owner.spaceId, definition.id, undefined, owner.userId)!;
  map = maps.addJourneyCard(owner.spaceId, definition.id, map.definition.revision, {
    stageKey: map.stages[0].stageKey, laneType: 'emotions', kind: 'emotion', title: 'Anxious about renewal cost'
  }, owner.userId);
  map = maps.addJourneyCard(owner.spaceId, definition.id, map.definition.revision, {
    stageKey: map.stages[1].stageKey, laneType: 'customer_actions', kind: 'action', title: 'Confirm the renewal'
  }, owner.userId);
  return { owner, definition, map };
}

test('saved-view exports render the exact selected view and revision in every branded format', async () => {
  const { owner, definition, map } = await fixture('Export fidelity');
  const emotionOnly = config(map.version.id, { filters: { cardKinds: ['emotion'] } });
  const view = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Emotions only', config: emotionOnly
  }).expect(201);

  // Acceptance 803: PDF/PNG output must match the selected saved view. The
  // JSON/CSV bodies are the only machine-checkable proof of what was rendered;
  // PDF/PNG/PPTX are asserted on producing a real, non-empty typed artifact.
  const csv = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/export.csv?viewId=${view.body.view.id}&viewRevision=1`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).expect(200);
  assert.match(csv.text, /Anxious about renewal cost/u);
  assert.doesNotMatch(csv.text, /Confirm the renewal/u,
    'a filtered saved view must not export cards it excluded');
  assert.match(csv.text, /Emotions only/u);

  const json = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/export.json?viewId=${view.body.view.id}&viewRevision=1`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).expect(200);
  const jsonBody = JSON.parse(json.text);
  assert.equal(jsonBody.metadata.selectedView.id, view.body.view.id);
  assert.equal(jsonBody.metadata.selectedView.revision, 1);
  assert.deepEqual(jsonBody.journeyMap.cards.map((card: any) => card.title), ['Anxious about renewal cost']);

  for (const [format, signature] of [['pdf', '%PDF-'], ['png', 'PNG'], ['pptx', 'PK']] as const) {
    const artifact = await inSpace(owner.agent, 'get',
      `/api/journey-maps/${definition.id}/export.${format}?viewId=${view.body.view.id}&viewRevision=1`, owner.spaceId)
      .set('Idempotency-Key', crypto.randomUUID()).buffer(true).parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      }).expect(200);
    const body = artifact.body as Buffer;
    assert.ok(body.length > 0, `${format} export must produce a real artifact`);
    assert.ok(body.subarray(0, 8).toString('binary').includes(signature),
      `${format} export must be a real ${format} artifact`);
    assert.match(String(artifact.headers['content-disposition']), /view-emotions-only-r1/u,
      `${format} filename must name the exact saved view and revision`);
  }

  // A saved view pinned to one revision must never be rendered at another.
  await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/export.pdf?viewId=${view.body.view.id}&viewRevision=99`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).expect(409);
});

test('saved-view names cannot inject spreadsheet formulas into CSV exports', async () => {
  const { owner, definition, map } = await fixture('Formula injection');
  const hostile = '=cmd|\' /C calc\'!A0,=1+1';
  const view = await createView(owner.agent, owner.spaceId, definition.id, {
    name: hostile, config: config(map.version.id, { presentation: { title: '=HYPERLINK("http://evil","x")' } })
  }).expect(201);
  const csv = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/export.csv?viewId=${view.body.view.id}&viewRevision=1`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).expect(200);
  assert.match(csv.text, /cmd\|/u, 'the hostile name must still be present, only neutralised');
  for (const field of parseCsvFields(csv.text)) {
    assert.doesNotMatch(field, /^[=+\-@]/u,
      `a CSV field must never begin with a formula character: ${JSON.stringify(field)}`);
  }
});

test('saved views are isolated across tenants at read, resolve, and export', async () => {
  const { owner, definition, map } = await fixture('Tenant isolation');
  const view = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Tenant scoped view', visibility: 'space', config: config(map.version.id)
  }).expect(201);

  // The outsider owns a different space and is never a member of the owning
  // space, so every saved-view surface must refuse the cross-tenant identity.
  const outsider = await outsiderIdentity(crypto.randomUUID().slice(0, 8));
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(outsider.homeSpaceId);
  await inSpace(outsider.agent, 'get', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId).expect(403);
  await inSpace(outsider.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${view.body.view.id}?revision=1`, owner.spaceId).expect(403);
  await inSpace(outsider.agent, 'get',
    `/api/journey-maps/${definition.id}/export.json?viewId=${view.body.view.id}&viewRevision=1`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).expect(403);
  // Presenting the owning space's definition and view id inside the outsider's
  // own space must not resolve either.
  await inSpace(outsider.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${view.body.view.id}?revision=1`, outsider.homeSpaceId).expect(404);
  await inSpace(outsider.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views`, outsider.homeSpaceId).expect(404);
});

test('a filtered saved view reports research gaps computed over the surviving cards', async () => {
  const { owner, definition, map } = await fixture('Research gaps');
  const unfiltered = maps.getJourneyMap(owner.spaceId, definition.id, undefined, owner.userId)!;
  const emotionCard = unfiltered.cards.find((card) => card.kind === 'emotion')!;
  const view = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Emotion gaps', config: config(map.version.id, { filters: { cardKinds: ['emotion'] } })
  }).expect(201);
  const resolved = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${view.body.view.id}?revision=1`, owner.spaceId).expect(200);

  const gapCardIds = resolved.body.map.researchGaps.map((gap: any) => gap.cardId);
  const survivingCardIds = new Set(resolved.body.map.cards.map((card: any) => card.id));
  assert.ok(gapCardIds.every((id: string) => survivingCardIds.has(id)),
    'a filtered view must never report a gap for a card it filtered out');
  if (unfiltered.researchGaps.some((gap) => gap.cardId === emotionCard.id)) {
    assert.ok(gapCardIds.includes(emotionCard.id),
      'filtering must not silently suppress a gap on a card that survived the filter');
  }
});

test('the saved-view retention worker executes the declared retention policy', async () => {
  const { owner, definition, map } = await fixture('Retention worker');
  const view = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Retention worker view', config: config(map.version.id)
  }).expect(201);
  await inSpace(owner.agent, 'delete',
    `/api/journey-maps/${definition.id}/saved-views/${view.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ expectedRevision: 1, reason: 'Retention worker coverage' }).expect(200);
  db.prepare("UPDATE journey_saved_views SET retention_expires_at='2026-01-01T00:00:00.000Z' WHERE id=?")
    .run(view.body.view.id);

  const { JourneySavedViewRetentionWorker } = await import('../src/journeySavedViewRetentionWorker.js');
  const worker = new JourneySavedViewRetentionWorker(60_000, undefined, () => {});
  worker.start();
  try {
    const remaining = Number((db.prepare('SELECT COUNT(*) count FROM journey_saved_views WHERE id=?')
      .get(view.body.view.id) as any).count);
    assert.equal(remaining, 0, 'starting the worker must apply the declared retention policy');
  } finally { worker.stop(); await worker.drain(2_000); }
});

/** `count` completed NPS responses, so a definition whose `minimumSampleSize`
 * sits below `count` publishes and one above it suppresses. Ported from the
 * metric analytics suite: saved-view privacy has to be proven against real
 * rebuilt observations rather than hand-written rows. */
function seedSurvey(spaceId: string, count: number, title: string) {
  const surveyId = crypto.randomUUID(); const collectorId = crypto.randomUUID(); const questionId = crypto.randomUUID();
  const occurredAt = '2026-08-04T10:00:00.000Z';
  db.prepare(`INSERT INTO surveys
    (id,space_id,title,description,purpose,audience,status,primary_metric,created_at,updated_at)
    VALUES (?,?,?,'','customer_experience','','active','nps',?,?)`).run(surveyId, spaceId, title, occurredAt, occurredAt);
  db.prepare(`INSERT INTO questions
    (id,survey_id,page,position,type,title,description,required,options_json,settings_json,logic_json)
    VALUES (?,?,1,0,'nps','Recommend?','',1,'[]','{}','[]')`).run(questionId, surveyId);
  db.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES (?,?,'Web','web',?,'open','{}',?)`).run(collectorId, surveyId, `saved-view-${collectorId}`, occurredAt);
  const insert = db.prepare(`INSERT INTO responses
    (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
    VALUES (?,?,?,?,'completed',?,'{}',?,?,10)`);
  for (let index = 0; index < count; index += 1) {
    insert.run(crypto.randomUUID(), surveyId, collectorId, `person-${index}`,
      JSON.stringify({ [questionId]: index % 2 === 0 ? 10 : 9 }), occurredAt, occurredAt);
  }
  return { surveyId, collectorId, questionId };
}

const npsVersion = (bindingId: string, minimumSampleSize: number): JourneyMetricVersionInput => ({
  sourceKind: 'survey', bindingId, calculatorKind: 'nps', aggregation: 'net_promoter_score',
  direction: 'higher_is_better', windowSeconds: 86_400, timezone: 'UTC', minimumSampleSize,
  freshnessMaxAgeSeconds: 86_400, population: { status: 'completed' }, filters: {},
  formula: { kind: 'net_promoter_score' }, configuration: {
    label: 'Saved view NPS', scale: { minimum: 0, maximum: 10, step: 1 }, decimalPlaces: 1,
    formula: { kind: 'net_promoter_score', detractorMaximum: 6, promoterMinimum: 9 }
  }
});

/** One segment-targeted governed metric, rebuilt into a real observation, so the
 * saved view's `segmentIds` filter actually selects it. */
async function seedSegmentMetric(owner: Awaited<ReturnType<typeof ownerIdentity>>, input: {
  journeyDefinitionId: string; name: string; responses: number; minimumSampleSize: number;
}) {
  const segment = metrics.createJourneyMetricSegment({
    spaceId: owner.spaceId, actorUserId: owner.userId, journeyDefinitionId: input.journeyDefinitionId,
    name: `${input.name} segment`, idempotencyKey: crypto.randomUUID()
  }).segment;
  const survey = seedSurvey(owner.spaceId, input.responses, `${input.name} survey`);
  const binding = metrics.createJourneyMetricBinding({
    spaceId: owner.spaceId, actorUserId: owner.userId, journeyDefinitionId: input.journeyDefinitionId,
    targetType: 'segment', targetId: segment.id, surveyId: survey.surveyId, collectorId: survey.collectorId,
    questionId: survey.questionId, idempotencyKey: crypto.randomUUID()
  }).binding;
  const definition = metrics.createJourneyMetricDefinition({
    spaceId: owner.spaceId, actorUserId: owner.userId, journeyDefinitionId: input.journeyDefinitionId,
    targetType: 'segment', targetId: segment.id, name: input.name,
    version: npsVersion(String(binding.id), input.minimumSampleSize),
    idempotencyKey: crypto.randomUUID(), versionIdempotencyKey: crypto.randomUUID()
  }).definition;
  metrics.queueJourneyMetricRebuild({ spaceId: owner.spaceId, actorUserId: owner.userId,
    definitionId: definition.id, reason: 'manual', asOf: '2026-08-04T11:00:00.000Z',
    idempotencyKey: crypto.randomUUID() });
  assert.equal(await runOneJourneyMetricRebuild(`saved-view-worker-${definition.id}`), true);
  return { segmentId: String(segment.id), definitionId: String(definition.id), bindingId: String(binding.id) };
}

/** Observations are append-only, so a corrected or externally flagged reading
 * arrives as a superseding revision rather than an update. Everything not
 * patched is copied from the row being superseded. */
function supersedeObservation(spaceId: string, definitionId: string, patch: {
  definitionVersionId?: string; value?: number | null; sampleSize?: number;
  minimumSampleWarning?: 0 | 1; resultJson?: string;
}) {
  const current = db.prepare(`SELECT * FROM journey_metric_observations WHERE space_id=? AND definition_id=?
    ORDER BY revision DESC LIMIT 1`).get(spaceId, definitionId) as any;
  assert.ok(current, 'the rebuild must have produced an observation to supersede');
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO journey_metric_observations
    (id,space_id,definition_id,definition_version_id,revision,supersedes_observation_id,status,value,unit,numerator,
     denominator,sample_size,period_start,period_end,timezone,as_of,calculated_at,freshness_status,latest_observed_at,
     minimum_sample_warning,source_count,source_snapshot_sha256,result_sha256,result_json,rebuild_run_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, current.space_id, current.definition_id, patch.definitionVersionId || current.definition_version_id,
    Number(current.revision) + 1, current.id, 'available',
    patch.value === undefined ? current.value : patch.value, current.unit, current.numerator,
    current.denominator, patch.sampleSize ?? Number(current.sample_size), current.period_start, current.period_end,
    current.timezone, current.as_of, current.calculated_at, current.freshness_status, current.latest_observed_at,
    patch.minimumSampleWarning ?? Number(current.minimum_sample_warning), current.source_count,
    current.source_snapshot_sha256, current.result_sha256, patch.resultJson ?? current.result_json,
    current.rebuild_run_id, current.created_at);
  return id;
}

function addDefinitionVersion(owner: Awaited<ReturnType<typeof ownerIdentity>>, definitionId: string,
  bindingId: string, minimumSampleSize: number) {
  const revision = Number((db.prepare('SELECT revision FROM journey_metric_definitions WHERE id=? AND space_id=?')
    .get(definitionId, owner.spaceId) as any).revision);
  return metrics.createJourneyMetricDefinitionVersion({
    spaceId: owner.spaceId, actorUserId: owner.userId, definitionId, expectedRevision: revision,
    version: npsVersion(bindingId, minimumSampleSize), idempotencyKey: crypto.randomUUID()
  });
}

function observationFor(analytics: { observations: any[] }, metricDefinitionId: string) {
  const found = analytics.observations.filter((row) => row.metricDefinitionId === metricDefinitionId);
  assert.equal(found.length, 1, 'each seeded metric must contribute exactly one current observation');
  return found[0];
}

/** The saved-view resolver is a second read path onto the same governed
 * observations as `/api/journey-metrics/observations`. It used to serialize
 * `value` and `sample_size` straight from the row, so an ordinary member on a
 * metrics-enabled plan read exact measures the canonical route redacts. Every
 * assertion below reads the HTTP body, because the leak was in the projection
 * rather than in the decision helper. */
test('saved-view analytics redact governed observations through the canonical privacy boundary', async () => {
  const { owner, definition, map } = await fixture('Saved view privacy');
  const small = await seedSegmentMetric(owner, { journeyDefinitionId: definition.id,
    name: 'Small sample NPS', responses: 3, minimumSampleSize: 30 });
  const permitted = await seedSegmentMetric(owner, { journeyDefinitionId: definition.id,
    name: 'Published NPS', responses: 40, minimumSampleSize: 5 });
  const flagged = await seedSegmentMetric(owner, { journeyDefinitionId: definition.id,
    name: 'Source flagged NPS', responses: 40, minimumSampleSize: 5 });
  const warned = await seedSegmentMetric(owner, { journeyDefinitionId: definition.id,
    name: 'Warned NPS', responses: 40, minimumSampleSize: 5 });

  const view = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Segment analytics', config: config(map.version.id, { filters: { segmentIds:
      [small.segmentId, permitted.segmentId, flagged.segmentId, warned.segmentId] } })
  }).expect(201);
  const viewId = String(view.body.view.id);
  const read = async () => (await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/saved-views/${viewId}?revision=1`, owner.spaceId).expect(200))
    .body.analytics as { observations: any[] };

  const first = await read();
  const suppressed = observationFor(first, small.definitionId);
  assert.deepEqual(Object.keys(suppressed).sort(), ['freshnessStatus', 'id', 'metricDefinitionId', 'metricName',
    'minimumSampleWarning', 'period', 'privacy', 'revision', 'sampleSize', 'segmentId', 'status', 'unit', 'value'],
  'the serialized shape must not carry the raw version or result columns the decision reads');
  assert.equal(suppressed.value, null, 'a below-floor observation must not disclose its value');
  assert.equal(suppressed.sampleSize, null, 'a below-floor observation must not disclose its sample');
  assert.deepEqual(suppressed.privacy, { suppressed: true, reasonCode: 'SMALL_SAMPLE_SUPPRESSED',
    minimumSampleSize: 30, privacyVersion: 1 });
  // The warning state carries no count, so suppression preserves it.
  assert.equal(suppressed.minimumSampleWarning, true);

  const open = observationFor(first, permitted.definitionId);
  assert.deepEqual(open.privacy, { suppressed: false, reasonCode: null, minimumSampleSize: 5, privacyVersion: 1 });
  assert.equal(typeof open.value, 'number', 'an ordinary permitted observation still publishes its value');
  assert.ok(Number.isSafeInteger(open.sampleSize) && open.sampleSize > 0,
    'an ordinary permitted observation still publishes its sample');
  assert.equal(open.minimumSampleWarning, false);

  // The map export is the second serialization sink for the same context.
  const exported = await inSpace(owner.agent, 'get',
    `/api/journey-maps/${definition.id}/export.json?viewId=${viewId}&viewRevision=1`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).expect(200);
  const exportedObservations = JSON.parse(exported.text).metadata.selectedView.analytics.observations as any[];
  const exportedSuppressed = exportedObservations.find((row) => row.metricDefinitionId === small.definitionId);
  assert.equal(exportedSuppressed.value, null, 'a downloadable export must redact exactly as the API does');
  assert.equal(exportedSuppressed.sampleSize, null);
  assert.equal(exportedSuppressed.privacy.reasonCode, 'SMALL_SAMPLE_SUPPRESSED');
  assert.equal(exportedObservations.find((row) => row.metricDefinitionId === permitted.definitionId).privacy.suppressed,
    false);

  // Raising the floor on a new version must not retroactively redact history,
  // and lowering it must not unsuppress history: both read the observation's own
  // immutable version rather than the definition's current one.
  addDefinitionVersion(owner, permitted.definitionId, permitted.bindingId, 500);
  supersedeObservation(owner.spaceId, small.definitionId, { value: 42, sampleSize: 10, minimumSampleWarning: 0 });
  addDefinitionVersion(owner, small.definitionId, small.bindingId, 1);
  // A source that asserted suppression is honoured well above the floor, which
  // is only reachable because the projection reads `result_json`.
  supersedeObservation(owner.spaceId, flagged.definitionId,
    { resultJson: JSON.stringify({ privacySuppressed: true }) });
  // The stored warning flag alone suppresses even when the count clears the floor.
  supersedeObservation(owner.spaceId, warned.definitionId, { minimumSampleWarning: 1 });

  const second = await read();
  const pinned = observationFor(second, permitted.definitionId);
  assert.equal(pinned.privacy.suppressed, false, 'a later, higher floor must not retroactively suppress history');
  assert.equal(pinned.privacy.minimumSampleSize, 5, 'the floor is read from the observation version, not the current one');
  assert.equal(typeof pinned.value, 'number');

  const stalePin = observationFor(second, small.definitionId);
  assert.equal(stalePin.privacy.suppressed, true, 'a later, lower floor must not unsuppress history');
  assert.equal(stalePin.privacy.minimumSampleSize, 30);
  assert.equal(stalePin.value, null);
  assert.equal(stalePin.sampleSize, null);

  const source = observationFor(second, flagged.definitionId);
  assert.deepEqual(source.privacy, { suppressed: true, reasonCode: 'PRIVACY_SUPPRESSED_SOURCE',
    minimumSampleSize: 5, privacyVersion: 1 });
  assert.equal(source.value, null);
  assert.equal(source.sampleSize, null);

  const warning = observationFor(second, warned.definitionId);
  assert.equal(warning.privacy.reasonCode, 'SMALL_SAMPLE_SUPPRESSED');
  assert.equal(warning.minimumSampleWarning, true, 'the warning state survives suppression');
  assert.equal(warning.value, null);
  assert.equal(warning.sampleSize, null);

  // An observation whose version cannot be resolved inside the tenant has no
  // trustworthy floor. The composite foreign key makes a dangling or borrowed
  // version impossible to seed, so the structural guarantee is asserted here and
  // the fail-closed branch it feeds is asserted on the decision itself.
  const foreignVersionId = String((db.prepare(`SELECT id FROM journey_metric_definition_versions
    WHERE space_id=? AND definition_id=? LIMIT 1`).get(owner.spaceId, permitted.definitionId) as any).id);
  assert.throws(() => supersedeObservation(owner.spaceId, warned.definitionId,
    { definitionVersionId: foreignVersionId }), /foreign key/iu);
  assert.equal(journeyMetricPrivacyDecision({ sample_size: 4_000, minimum_sample_warning: 0 }, undefined).reasonCode,
    'DEFINITION_VERSION_UNAVAILABLE');
});

test('a replayed mutation whose view was deleted reports a conflict rather than a missing view', async () => {
  const { owner, definition, map } = await fixture('Replay after delete');
  const key = crypto.randomUUID();
  const created = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Replay after delete', config: config(map.version.id), key
  }).expect(201);
  await inSpace(owner.agent, 'delete',
    `/api/journey-maps/${definition.id}/saved-views/${created.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ expectedRevision: 1, reason: 'Deleted before the replay' }).expect(200);
  const replay = await createView(owner.agent, owner.spaceId, definition.id, {
    name: 'Replay after delete', config: config(map.version.id), key
  }).expect(409);
  assert.equal(replay.body.code, 'JOURNEY_SAVED_VIEW_REPLAY_UNAVAILABLE');
});
