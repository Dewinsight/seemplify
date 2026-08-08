import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-identities-'));
const files = Object.fromEntries(['admin-password', 'session-secret', 'x-key', 'esign-key', 'identity-key']
  .map((name) => [name, path.join(root, name)]));
fs.writeFileSync(files['admin-password']!, 'Journey-Identity-Test-2026!');
fs.writeFileSync(files['session-secret']!, 'journey-identity-session-secret-that-is-long-enough');
fs.writeFileSync(files['x-key']!, Buffer.alloc(32, 51).toString('base64url'));
fs.writeFileSync(files['esign-key']!, Buffer.alloc(32, 52).toString('base64url'));
fs.writeFileSync(files['identity-key']!, crypto.randomBytes(48));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-identities@seemplify.local',
  ADMIN_PASSWORD_FILE: files['admin-password'],
  SESSION_SECRET_FILE: files['session-secret'],
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: files['x-key'],
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: files['esign-key'],
  JOURNEY_IDENTITY_HASH_KEY_FILE: files['identity-key'],
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { signupVerifyAndOnboard } = await import('./authTestHelper.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function identity(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get('/api/auth/session').expect(200);
  return { userId: String(response.body.user.id), spaceId: String(response.body.activeSpace.id) };
}

async function ownerAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-identities@seemplify.local', password: 'Journey-Identity-Test-2026!'
  }).expect(200);
  const current = await identity(agent);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(current.spaceId);
  return { agent, ...current };
}

async function memberAgent(spaceId: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Journey Member', email: 'journey-member@example.test', password: 'Journey-Member-2026!', spaceName: 'Journey member space'
  });
  const current = await identity(agent);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,?,?,?)`).run(spaceId, current.userId, 'member', now, now);
  db.prepare("UPDATE users SET active_space_id=? WHERE id=?").run(spaceId, current.userId);
  return { agent, ...current, sharedSpaceId: spaceId };
}

function anonymousHash(value: string) {
  return crypto.createHmac('sha256', fs.readFileSync(files['identity-key']!)).update(value, 'utf8').digest('hex');
}

test('journey identity routes persist reducer-backed profile state, resolve identifiers, and enforce member read-only access', async () => {
  const owner = await ownerAgent();
  const member = await memberAgent(owner.spaceId);

  const createdGroup = await owner.agent.post('/api/journey-identities/groups').send({
    id: 'account-a',
    groupType: 'account',
    name: 'Account A',
    externalRef: 'crm-account-a'
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(createdGroup.body.group.id, 'account-a');
  assert.equal(createdGroup.body.replayed, false);

  const replayedGroup = await owner.agent.post('/api/journey-identities/groups').send({
    id: 'account-a',
    groupType: 'account',
    name: 'Account A changed title ignored by idempotent create',
    externalRef: 'crm-account-a'
  }).set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(replayedGroup.body.replayed, true);

  const observe = await owner.agent.post('/api/journey-identities/commands').send({
    type: 'observe',
    commandId: 'observe-a',
    occurredAt: '2026-08-05T10:00:00.000Z',
    profileId: 'anon-a',
    profileKind: 'anonymous',
    identifier: { kind: 'anonymous_id', namespace: 'browser', value: 'session-a' },
    sourceFact: {
      factId: 'fact-observe-a',
      source: 'sdk',
      sourceRef: 'event:observe-a',
      occurredAt: '2026-08-05T09:59:58.000Z'
    }
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(observe.body.result.code, 'profile_observed');

  const identify = await owner.agent.post('/api/journey-identities/commands').send({
    type: 'identify',
    commandId: 'identify-a',
    occurredAt: '2026-08-05T10:05:00.000Z',
    profile: { profileId: 'anon-a' },
    identifier: { kind: 'authenticated_user_id', namespace: 'auth0', value: 'user-a' },
    sourceFact: {
      factId: 'fact-identify-a',
      source: 'auth-service',
      sourceRef: 'login:user-a',
      occurredAt: '2026-08-05T10:04:58.000Z'
    }
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(identify.body.result.code, 'profile_identified');

  const membership = await owner.agent.post('/api/journey-identities/commands').send({
    type: 'add_membership',
    commandId: 'membership-a',
    occurredAt: '2026-08-05T10:06:00.000Z',
    profile: { profileId: 'anon-a' },
    group: { groupType: 'account', groupId: 'account-a' },
    sourceFact: {
      factId: 'fact-membership-a',
      source: 'crm',
      sourceRef: 'account:account-a/member:user-a',
      occurredAt: '2026-08-05T10:05:59.000Z'
    }
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(membership.body.result.code, 'membership_added');

  const replay = await owner.agent.post('/api/journey-identities/commands').send({
    type: 'identify',
    commandId: 'identify-a',
    occurredAt: '2026-08-05T10:05:00.000Z',
    profile: { profileId: 'anon-a' },
    identifier: { kind: 'authenticated_user_id', namespace: 'auth0', value: 'user-a' },
    sourceFact: {
      factId: 'fact-identify-a',
      source: 'auth-service',
      sourceRef: 'login:user-a',
      occurredAt: '2026-08-05T10:04:58.000Z'
    }
  }).set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(replay.body.result.status, 'replayed');

  const profiles = await owner.agent.get('/api/journey-identities/profiles')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(profiles.body.profiles.length, 1);
  assert.equal(profiles.body.profiles[0].profileId, 'anon-a');
  assert.equal(profiles.body.profiles[0].canonicalProfileId, 'anon-a');
  assert.equal(profiles.body.profiles[0].identifierCount, 2);
  assert.equal(profiles.body.profiles[0].activeMembershipCount, 1);

  const detail = await owner.agent.get('/api/journey-identities/profiles/anon-a')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(detail.body.profile.kind, 'known');
  assert.equal(detail.body.bindings.length, 2);
  assert.equal(detail.body.memberships.length, 1);
  assert.equal(detail.body.sourceFacts.length, 3);

  const profileTimeline = await owner.agent.get('/api/journey-identities/profiles/anon-a/timeline')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(profileTimeline.body.events.length, 4);
  assert.deepEqual(profileTimeline.body.events.map((row: any) => row.eventKind), [
    'membership_active',
    'identity_source_fact',
    'identity_source_fact',
    'identity_source_fact'
  ]);

  const profileSessions = await owner.agent.get('/api/journey-identities/profiles/anon-a/sessions')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(profileSessions.body.sessions.length, 1);
  assert.equal(profileSessions.body.sessions[0].profileId, 'anon-a');
  assert.equal(profileSessions.body.sessions[0].canonicalProfileId, 'anon-a');
  assert.equal(profileSessions.body.sessions[0].identifierNamespace, 'browser');
  assert.equal(profileSessions.body.sessions[0].identifierValue, 'session-a');
  assert.equal(profileSessions.body.sessions[0].eventCount, 3);
  assert.equal(profileSessions.body.sessions[0].sourceFactCount, 3);

  const sessionDetail = await owner.agent.get(`/api/journey-identities/sessions/${profileSessions.body.sessions[0].id}`)
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(sessionDetail.body.session.profileId, 'anon-a');
  assert.equal(sessionDetail.body.profile.profileId, 'anon-a');
  assert.equal(sessionDetail.body.sourceFacts.length, 3);

  const groups = await owner.agent.get('/api/journey-identities/groups?groupType=account')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(groups.body.groups.length, 1);
  assert.equal(groups.body.groups[0].id, 'account-a');
  assert.equal(groups.body.groups[0].activeMemberCount, 1);

  const groupDetail = await owner.agent.get('/api/journey-identities/groups/account-a')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(groupDetail.body.group.name, 'Account A');
  assert.equal(groupDetail.body.memberships.length, 1);
  assert.equal(groupDetail.body.members[0].profileId, 'anon-a');
  assert.equal(groupDetail.body.members[0].canonicalProfileId, 'anon-a');

  const groupTimeline = await owner.agent.get('/api/journey-identities/groups/account-a/timeline?groupType=account')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(groupTimeline.body.events.length, 4);
  assert.equal(groupTimeline.body.events[0].eventKind, 'membership_active');

  const correctionsAfterMembership = await owner.agent.get('/api/journey-identities/profiles/anon-a/corrections')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(correctionsAfterMembership.body.runs.length >= 3, true);
  assert.equal(correctionsAfterMembership.body.runs.some((row: any) => row.run.reason === 'late_source_fact'), true);
  assert.equal(correctionsAfterMembership.body.runs.some((row: any) => row.run.commandId === 'membership-a'), true);
  assert.equal(typeof correctionsAfterMembership.body.runs[0].result.timelineEventCount, 'number');

  const createdSegment = await owner.agent.post('/api/journey-identities/segments').send({
    name: 'Known account-a members',
    description: 'Profiles that are known and belong to account-a.',
    rule: {
      match: 'all',
      clauses: [
        { field: 'profile.kind', op: 'eq', value: 'known' },
        { field: 'membership.accountId', op: 'eq', value: 'account-a' }
      ]
    }
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(createdSegment.body.segment.name, 'Known account-a members');
  assert.equal(createdSegment.body.segment.materializedMemberCount, 1);
  assert.equal(createdSegment.body.activeVersion.versionNumber, 1);
  assert.equal(createdSegment.body.memberships.length, 1);
  assert.equal(createdSegment.body.memberships[0].profileId, 'anon-a');

  const segmentList = await owner.agent.get('/api/journey-identities/segments')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(segmentList.body.segments.length, 1);
  assert.equal(segmentList.body.segments[0].materializedMemberCount, 1);

  const segmentVersion = await owner.agent.post(`/api/journey-identities/segments/${createdSegment.body.segment.id}/versions`).send({
    rule: {
      match: 'all',
      clauses: [
        { field: 'profile.kind', op: 'eq', value: 'anonymous' }
      ]
    }
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(segmentVersion.body.segment.activeVersionNumber, 2);
  assert.equal(segmentVersion.body.segment.materializedMemberCount, 0);
  assert.equal(segmentVersion.body.activeVersion.versionNumber, 2);
  assert.equal(segmentVersion.body.memberships.length, 0);

  const at = '2026-08-05T10:20:00.000Z';
  db.prepare(`INSERT INTO journey_event_sources
    (id,space_id,name,environment,status,validation_mode,allowed_origins_json,allowed_bundle_ids_json,events_per_minute,bytes_per_minute,created_by_user_id,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'source-a', owner.spaceId, 'Browser source', 'production', 'active', 'warn', '[]', '[]', 1000, 1000000, owner.userId, 1, at, at
    );
  db.prepare(`INSERT INTO journey_event_credentials
    (id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,created_by_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'cred-a', 'source-a', owner.spaceId, 'production', 'public_write', 'events:write', 'pk_test_a', 'scrypt-v1',
      'abcdefghijklmnop', 'a'.repeat(64), 'active', owner.userId, at
    );
  db.prepare(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,review_cadence_days,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'journey-a', owner.spaceId, 'Activation journey', 'Activation', 'customer', 'current_state', 'designed', 'published',
      owner.userId, 0, 1, at, at
    );
  const anonHash = anonymousHash('session-a');
  db.prepare(`INSERT INTO journey_raw_events
    (received_at,id,space_id,source_id,environment,credential_id,event_id,protocol_version,event_call,event_name,event_version,
      occurred_at,sent_at,schema_version_id,anonymous_id_hash,user_id_hash,account_id_hash,session_id_hash,channel,consent_state,
      ingest_state,payload_json,context_json,consent_json,validation_issues_json,envelope_sha256,payload_bytes,sdk_name,sdk_version,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      '2026-08-05T10:20:01.000Z', 'raw-a', owner.spaceId, 'source-a', 'production', 'cred-a', 'evt-a', '1.0', 'track',
      'signup_completed', 1, '2026-08-05T10:20:00.000Z', null, null, anonHash, null, null, null, 'web', 'granted', 'accepted',
      '{"properties":{"step":"complete"}}', '{"library":{"name":"browser-sdk","version":"1.0.0"}}', '{"analytics":"granted"}', '[]',
      'b'.repeat(64), 32, 'browser-sdk', '1.0.0', '2026-09-05T10:20:01.000Z'
    );
  db.prepare(`INSERT INTO journey_anonymous_instances
    (id,space_id,source_id,environment,journey_definition_id,subject_kind,anonymous_id_hash,state,current_stage_key,first_event_at,
      latest_event_at,latest_event_id,latest_visit_id,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'instance-a', owner.spaceId, 'source-a', 'production', 'journey-a', 'anonymous', anonHash, 'active', null,
      '2026-08-05T10:20:00.000Z', '2026-08-05T10:20:00.000Z', 'evt-a', null, 1, at, at
    );

  const profile360 = await owner.agent.get('/api/journey-identities/profiles/anon-a/customer-360?purpose=analytics')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(profile360.body.profile.profileId, 'anon-a');
  assert.equal(profile360.body.purpose, 'analytics');
  assert.equal(profile360.body.identitySummary.identifierCount, 2);
  assert.equal(profile360.body.memberships.accounts.length, 1);
  assert.equal(profile360.body.segmentMemberships.length, 0);
  assert.equal(profile360.body.sessions.length, 1);
  assert.equal(profile360.body.journeyInstances.length, 1);
  assert.equal(profile360.body.journeyInstances[0].journeyDefinitionId, 'journey-a');
  assert.equal(profile360.body.consentSummary.states[0].state, 'granted');

  const account360 = await owner.agent.get('/api/journey-identities/accounts/account-a/customer-360?purpose=analytics')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(account360.body.account.id, 'account-a');
  assert.equal(account360.body.memberCount, 1);
  assert.equal(account360.body.members.length, 1);
  assert.equal(account360.body.journeyInstances.length, 1);

  const defaultPrivacy = await owner.agent.get('/api/journey-identities/profiles/anon-a/privacy')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(defaultPrivacy.body.states.length, 4);
  assert.equal(defaultPrivacy.body.states.find((row: any) => row.purpose === 'analytics')?.state, 'unknown');

  const updatedPrivacy = await owner.agent.put('/api/journey-identities/profiles/anon-a/privacy').send({
    purpose: 'analytics',
    state: 'suppressed',
    lawfulBasis: 'withdrawn',
    policyReference: 'policy-analytics-withdrawn'
  }).set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(updatedPrivacy.body.state.purpose, 'analytics');
  assert.equal(updatedPrivacy.body.state.state, 'suppressed');

  await owner.agent.get('/api/journey-identities/profiles/anon-a/customer-360?purpose=analytics')
    .set('X-Seemplify-Space', owner.spaceId).expect(403);
  await owner.agent.post('/api/journey-identities/profiles/anon-a/export').send({ purpose: 'analytics' })
    .set('X-Seemplify-Space', owner.spaceId).expect(403);

  await owner.agent.put('/api/journey-identities/profiles/anon-a/privacy').send({
    purpose: 'analytics',
    state: 'granted',
    lawfulBasis: 'consent',
    policyReference: 'policy-analytics-granted'
  }).set('X-Seemplify-Space', owner.spaceId).expect(200);

  const exportJob = await owner.agent.post('/api/journey-identities/profiles/anon-a/export').send({ purpose: 'analytics' })
    .set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(exportJob.body.job.profileId, 'anon-a');
  assert.equal(exportJob.body.job.purpose, 'analytics');
  assert.equal(exportJob.body.export.schema, 'seemplify.journey-profile-export/v1');
  assert.equal(exportJob.body.export.profile360.profile.profileId, 'anon-a');

  const exportDetail = await owner.agent.get(`/api/journey-identities/exports/${exportJob.body.job.id}`)
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(exportDetail.body.job.id, exportJob.body.job.id);
  assert.equal(exportDetail.body.export.profileDetail.profile.profileId, 'anon-a');

  const suppressionJob = await owner.agent.post('/api/journey-identities/profiles/anon-a/privacy-jobs').send({
    operation: 'suppress',
    lawfulBasis: 'privacy_request',
    policyReference: 'policy-profile-suppress',
    reason: 'Manual suppression request'
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(suppressionJob.body.job.profileId, 'anon-a');
  assert.equal(suppressionJob.body.job.operation, 'suppress');
  assert.equal(suppressionJob.body.job.state, 'completed');
  assert.equal(suppressionJob.body.result.propagationState, 'partially_completed_pending_downstream_execution');
  assert.equal(suppressionJob.body.result.executedTargets.includes('journey_profile_export_jobs'), true);
  assert.equal(suppressionJob.body.result.executedTargets.includes('journey_identity_segment_memberships'), true);
  assert.equal(suppressionJob.body.result.executedTargets.includes('journey_profile_timeline_events'), true);
  assert.equal(suppressionJob.body.result.executedTargets.includes('journey_identity_sessions'), true);
  assert.equal(suppressionJob.body.result.executedTargets.includes('journey_anonymous_instances'), true);
  assert.equal(suppressionJob.body.result.pendingPropagationTargets.includes('journey_anonymous_instances'), false);
  assert.equal(suppressionJob.body.result.pendingPropagationTargets.includes('journey_anonymous_stage_visits'), false);
  assert.equal(suppressionJob.body.result.pendingPropagationTargets.includes('journey_stage_rule_decisions'), false);
  assert.equal(suppressionJob.body.result.pendingPropagationTargets.includes('journey_actual_path_snapshots'), false);
  assert.equal(suppressionJob.body.result.removedExportJobs >= 1, true);
  assert.equal(suppressionJob.body.result.removedTimelineEvents >= 1, true);
  assert.equal(suppressionJob.body.result.removedSessions >= 1, true);
  assert.equal(suppressionJob.body.result.removedAnonymousInstances >= 1, true);

  const suppressedPrivacy = await owner.agent.get('/api/journey-identities/profiles/anon-a/privacy')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedPrivacy.body.states.every((row: any) => row.state === 'suppressed'), true);

  const suppressedProfiles = await owner.agent.get('/api/journey-identities/profiles')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedProfiles.body.profiles.some((row: any) => row.profileId === 'anon-a'), false);

  await owner.agent.get('/api/journey-identities/profiles/anon-a')
    .set('X-Seemplify-Space', owner.spaceId).expect(404);

  const suppressedProfileTimeline = await owner.agent.get('/api/journey-identities/profiles/anon-a/timeline')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedProfileTimeline.body.events.length, 0);

  const suppressedProfileSessions = await owner.agent.get('/api/journey-identities/profiles/anon-a/sessions')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedProfileSessions.body.sessions.length, 0);

  const suppressedCorrections = await owner.agent.get('/api/journey-identities/profiles/anon-a/corrections')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedCorrections.body.runs.length, 0);

  await owner.agent.get(`/api/journey-identities/sessions/${profileSessions.body.sessions[0].id}`)
    .set('X-Seemplify-Space', owner.spaceId).expect(404);

  const suppressedResolve = await owner.agent.post('/api/journey-identities/resolve')
    .set('X-Seemplify-Space', owner.spaceId)
    .send({ identifier: { kind: 'authenticated_user_id', namespace: 'auth0', value: 'user-a' } })
    .expect(200);
  assert.equal(suppressedResolve.body.status, 'not_found');
  assert.equal(suppressedResolve.body.code, 'profile_suppressed');

  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_profile_export_jobs WHERE space_id=? AND profile_id=?')
    .get(owner.spaceId, 'anon-a') as any).count), 0);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_profile_timeline_events WHERE space_id=? AND profile_id=?')
    .get(owner.spaceId, 'anon-a') as any).count), 0);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_identity_sessions WHERE space_id=? AND profile_id=?')
    .get(owner.spaceId, 'anon-a') as any).count), 0);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_anonymous_instances WHERE space_id=?')
    .get(owner.spaceId) as any).count), 0);

  const suppressionDetail = await owner.agent.get(`/api/journey-identities/privacy-jobs/${suppressionJob.body.job.id}`)
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressionDetail.body.job.id, suppressionJob.body.job.id);
  assert.equal(suppressionDetail.body.result.propagationState, 'partially_completed_pending_downstream_execution');

  const suppressedAccount360 = await owner.agent.get('/api/journey-identities/accounts/account-a/customer-360?purpose=analytics')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedAccount360.body.account.id, 'account-a');
  assert.equal(suppressedAccount360.body.memberCount, 0);
  assert.equal(suppressedAccount360.body.members.length, 0);
  assert.equal(suppressedAccount360.body.segmentMemberships.length, 0);
  assert.equal(suppressedAccount360.body.journeyInstances.length, 0);
  assert.equal(suppressedAccount360.body.timeline.length, 0);

  const suppressedGroupDetail = await owner.agent.get('/api/journey-identities/groups/account-a?groupType=account')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedGroupDetail.body.memberships.length, 0);
  assert.equal(suppressedGroupDetail.body.members.length, 0);

  const suppressedGroupList = await owner.agent.get('/api/journey-identities/groups?groupType=account')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedGroupList.body.groups[0].activeMemberCount, 0);

  const suppressedGroupTimeline = await owner.agent.get('/api/journey-identities/groups/account-a/timeline?groupType=account')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedGroupTimeline.body.events.length, 0);

  const suppressedSegmentDetail = await owner.agent.get(`/api/journey-identities/segments/${createdSegment.body.segment.id}`)
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(suppressedSegmentDetail.body.memberships.length, 0);

  const erasureJob = await owner.agent.post('/api/journey-identities/profiles/anon-a/privacy-jobs').send({
    operation: 'erasure',
    lawfulBasis: 'data_subject_request',
    reason: 'Erase this profile downstream'
  }).set('X-Seemplify-Space', owner.spaceId).expect(202);
  assert.equal(erasureJob.body.job.operation, 'erasure');
  assert.equal(erasureJob.body.job.state, 'queued');
  assert.equal(erasureJob.body.result.propagationState, 'queued_for_downstream_execution');
  assert.equal(erasureJob.body.result.executedTargets.includes('journey_profile_export_jobs'), true);
  assert.equal(erasureJob.body.result.executedTargets.includes('journey_identity_segment_memberships'), true);
  assert.equal(erasureJob.body.result.executedTargets.includes('journey_profile_timeline_events'), true);
  assert.equal(erasureJob.body.result.executedTargets.includes('journey_identity_sessions'), true);
  assert.equal(erasureJob.body.result.executedTargets.includes('journey_anonymous_instances'), true);
  assert.equal(erasureJob.body.result.pendingPropagationTargets.includes('journey_anonymous_instances'), false);
  assert.equal(erasureJob.body.result.pendingPropagationTargets.includes('journey_anonymous_stage_visits'), false);
  assert.equal(erasureJob.body.result.pendingPropagationTargets.includes('journey_stage_rule_decisions'), false);
  assert.equal(erasureJob.body.result.pendingPropagationTargets.includes('journey_actual_path_snapshots'), false);

  const erasureDetail = await owner.agent.get(`/api/journey-identities/privacy-jobs/${erasureJob.body.job.id}`)
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(erasureDetail.body.job.id, erasureJob.body.job.id);
  assert.equal(erasureDetail.body.job.state, 'queued');
  assert.equal(erasureDetail.body.result.pendingPropagationTargets.includes('journey_anonymous_instances'), false);
  assert.equal(erasureDetail.body.result.pendingPropagationTargets.includes('journey_anonymous_stage_visits'), false);

  const rebuiltSegment = await owner.agent.post(`/api/journey-identities/segments/${createdSegment.body.segment.id}/versions`).send({
    rule: {
      match: 'all',
      clauses: [
        { field: 'profile.kind', op: 'eq', value: 'known' },
        { field: 'membership.accountId', op: 'eq', value: 'account-a' }
      ]
    }
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);
  assert.equal(rebuiltSegment.body.segment.materializedMemberCount, 0);

  const resolved = await owner.agent.post('/api/journey-identities/resolve')
    .set('X-Seemplify-Space', owner.spaceId)
    .send({ identifier: { kind: 'authenticated_user_id', namespace: 'auth0', value: 'user-a' } })
    .expect(200);
  assert.equal(resolved.body.status, 'not_found');
  assert.equal(resolved.body.code, 'profile_suppressed');

  const audit = await owner.agent.get('/api/journey-identities/audit')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  assert.equal(audit.body.audit.length, 0);

  const persistedProfiles = Number((db.prepare('SELECT COUNT(*) count FROM journey_identity_profiles WHERE space_id=?')
    .get(owner.spaceId) as any).count);
  const persistedBindings = Number((db.prepare('SELECT COUNT(*) count FROM journey_identity_bindings WHERE space_id=?')
    .get(owner.spaceId) as any).count);
  const persistedProcessed = Number((db.prepare('SELECT COUNT(*) count FROM journey_identity_processed_commands WHERE space_id=?')
    .get(owner.spaceId) as any).count);
  assert.equal(persistedProfiles, 1);
  assert.equal(persistedBindings, 2);
  assert.equal(persistedProcessed, 3);

  await member.agent.get('/api/journey-identities/profiles')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  await member.agent.get('/api/journey-identities/profiles/anon-a/sessions')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  await member.agent.get('/api/journey-identities/groups')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  await member.agent.get('/api/journey-identities/segments')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  await member.agent.get('/api/journey-identities/profiles/anon-a/customer-360?purpose=analytics')
    .set('X-Seemplify-Space', owner.spaceId).expect(403);
  await member.agent.get('/api/journey-identities/profiles/anon-a/privacy')
    .set('X-Seemplify-Space', owner.spaceId).expect(403);
  await member.agent.get('/api/journey-identities/profiles/anon-a/corrections')
    .set('X-Seemplify-Space', owner.spaceId).expect(403);
  await member.agent.get(`/api/journey-identities/privacy-jobs/${suppressionJob.body.job.id}`)
    .set('X-Seemplify-Space', owner.spaceId).expect(403);
  await member.agent.post('/api/journey-identities/commands').set('X-Seemplify-Space', owner.spaceId).send({
    type: 'alias',
    commandId: 'member-alias',
    occurredAt: '2026-08-05T10:10:00.000Z',
    profile: { profileId: 'anon-a' },
    identifier: { kind: 'external_user_id', namespace: 'crm', value: 'crm-a' },
    reason: 'Members must not change identity state.'
  }).expect(403);
  await member.agent.post('/api/journey-identities/groups').set('X-Seemplify-Space', owner.spaceId).send({
    id: 'group-member-denied',
    groupType: 'group',
    name: 'Member denied group'
  }).expect(403);
  await member.agent.post('/api/journey-identities/segments').set('X-Seemplify-Space', owner.spaceId).send({
    name: 'Denied member segment',
    rule: { match: 'all', clauses: [{ field: 'profile.kind', op: 'eq', value: 'known' }] }
  }).expect(403);
  await member.agent.put('/api/journey-identities/profiles/anon-a/privacy').set('X-Seemplify-Space', owner.spaceId).send({
    purpose: 'analytics',
    state: 'granted'
  }).expect(403);
  await member.agent.post('/api/journey-identities/profiles/anon-a/privacy-jobs').set('X-Seemplify-Space', owner.spaceId).send({
    operation: 'erasure'
  }).expect(403);
});

test('privacy jobs keep anonymous-instance propagation pending when append-only stage visits exist', async () => {
  const owner = await ownerAgent();

  await owner.agent.post('/api/journey-identities/commands').send({
    type: 'observe',
    commandId: 'observe-pending-anon',
    occurredAt: '2026-08-05T11:00:00.000Z',
    profileId: 'anon-pending',
    profileKind: 'anonymous',
    identifier: { kind: 'anonymous_id', namespace: 'browser', value: 'session-pending' },
    sourceFact: {
      factId: 'fact-observe-pending-anon',
      source: 'sdk',
      sourceRef: 'event:observe-pending-anon',
      occurredAt: '2026-08-05T10:59:58.000Z'
    }
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);

  const at = '2026-08-05T11:20:00.000Z';
  db.prepare(`INSERT INTO journey_event_sources
    (id,space_id,name,environment,status,validation_mode,allowed_origins_json,allowed_bundle_ids_json,events_per_minute,bytes_per_minute,created_by_user_id,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'source-pending', owner.spaceId, 'Pending source', 'production', 'active', 'warn', '[]', '[]',
      1000, 1000000, owner.userId, 1, at, at
    );
  db.prepare(`INSERT INTO journey_event_credentials
    (id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,created_by_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'cred-pending', 'source-pending', owner.spaceId, 'production', 'public_write', 'events:write', 'pk_pending', 'scrypt-v1',
      'abcdefghijklmnop', 'c'.repeat(64), 'active', owner.userId, at
    );
  db.prepare(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,review_cadence_days,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'journey-pending', owner.spaceId, 'Pending journey', 'Activation', 'customer', 'current_state', 'designed', 'published',
      owner.userId, 0, 1, at, at
    );
  const anonHash = anonymousHash('session-pending');
  db.prepare(`INSERT INTO journey_raw_events
    (received_at,id,space_id,source_id,environment,credential_id,event_id,protocol_version,event_call,event_name,event_version,
      occurred_at,sent_at,schema_version_id,anonymous_id_hash,user_id_hash,account_id_hash,session_id_hash,channel,consent_state,
      ingest_state,payload_json,context_json,consent_json,validation_issues_json,envelope_sha256,payload_bytes,sdk_name,sdk_version,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      '2026-08-05T11:20:01.000Z', 'raw-pending', owner.spaceId, 'source-pending', 'production', 'cred-pending', 'evt-pending', '1.0',
      'track', 'signup_started', 1, '2026-08-05T11:20:00.000Z', null, null, anonHash, null, null, null, 'web', 'granted', 'accepted',
      '{"properties":{"step":"start"}}', '{"library":{"name":"browser-sdk","version":"1.0.0"}}', '{"analytics":"granted"}', '[]',
      'd'.repeat(64), 32, 'browser-sdk', '1.0.0', '2026-09-05T11:20:01.000Z'
    );
  db.prepare(`INSERT INTO journey_anonymous_instances
    (id,space_id,source_id,environment,journey_definition_id,subject_kind,anonymous_id_hash,state,current_stage_key,first_event_at,
      latest_event_at,latest_event_id,latest_visit_id,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'instance-pending', owner.spaceId, 'source-pending', 'production', 'journey-pending', 'anonymous', anonHash, 'active', null,
      '2026-08-05T11:20:00.000Z', '2026-08-05T11:20:00.000Z', 'evt-pending', null, 1, at, at
    );

  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.prepare(`INSERT INTO journey_anonymous_stage_visits
      (id,assignment_key,instance_id,decision_id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,
        journey_definition_id,journey_map_version_id,subject_kind,stage_key,role,rule_definition_id,rule_version_id,rule_version_number,
        event_occurred_at,visited_at,is_late,is_out_of_order,applied_to_current,non_application_reason,prior_stage_key,provenance_json,
        created_at,retention_expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        'visit-pending', 'e'.repeat(64), 'instance-pending', 'decision-pending', '2026-08-05T11:20:01.000Z', 'raw-pending',
        owner.spaceId, 'source-pending', 'production', 'evt-pending', 'journey-pending', 'map-version-pending', 'anonymous',
        'discover', 'entry', 'rule-def-pending', 'rule-ver-pending', 1, '2026-08-05T11:20:00.000Z', '2026-08-05T11:20:02.000Z',
        0, 0, 1, null, null, '{}', at, '2026-09-05T11:20:02.000Z'
      );
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }

  const suppressionJob = await owner.agent.post('/api/journey-identities/profiles/anon-pending/privacy-jobs').send({
    operation: 'suppress',
    lawfulBasis: 'privacy_request',
    reason: 'Pending append-only anonymous traces'
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);

  assert.equal(suppressionJob.body.result.executedTargets.includes('journey_anonymous_instances'), false);
  assert.equal(suppressionJob.body.result.pendingPropagationTargets.includes('journey_anonymous_instances'), true);
  assert.equal(suppressionJob.body.result.pendingPropagationTargets.includes('journey_anonymous_stage_visits'), true);
  assert.equal(suppressionJob.body.result.pendingPropagationTargets.includes('journey_stage_rule_decisions'), true);
  assert.equal(suppressionJob.body.result.pendingPropagationTargets.includes('journey_actual_path_snapshots'), true);
  assert.equal(suppressionJob.body.result.anonymousInstanceDeletionBlocked, true);
  assert.equal(suppressionJob.body.result.linkedAnonymousStageVisits >= 1, true);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_anonymous_instances WHERE space_id=? AND id=?')
    .get(owner.spaceId, 'instance-pending') as any).count), 1);
});
