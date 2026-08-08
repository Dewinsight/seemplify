import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-persona-versioning-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Persona-Version-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'persona-version-test-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 31).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 32).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'persona-versions@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
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

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login')
    .send({ email: 'persona-versions@seemplify.local', password: 'Persona-Version-Test-Password-2026!' }).expect(200);
  return agent;
}

async function activeIdentity(agent: ReturnType<typeof request.agent>) {
  const session = await agent.get('/api/auth/session').expect(200);
  return { userId: String(session.body.user.id), spaceId: String(session.body.activeSpace.id) };
}

async function spaceCollaborator(spaceId: string, role: 'admin' | 'member', suffix: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: `Persona ${role}`,
    email: `persona-${role}-${suffix}@example.test`,
    password: `Persona-${role}-Collaborator-2026!`,
    spaceName: `Persona ${role} home`
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,?,?,?)`).run(spaceId, String(session.body.user.id), role, now, now);
  return agent;
}

function seedSurveyResponse(spaceId: string, suffix: string) {
  const now = new Date().toISOString();
  const surveyId = `persona-survey-${suffix}`;
  const questionId = `persona-question-${suffix}`;
  const collectorId = `persona-collector-${suffix}`;
  const responseId = `persona-response-${suffix}`;
  db.prepare(`INSERT INTO surveys
    (id,space_id,title,description,purpose,audience,status,primary_metric,created_at,updated_at)
    VALUES (?,?,'Persona evidence','','customer_experience','','active','csat',?,?)`)
    .run(surveyId, spaceId, now, now);
  db.prepare(`INSERT INTO questions
    (id,survey_id,page,position,type,title,description,required,options_json,settings_json,logic_json)
    VALUES (?,?,1,0,'long_text','What do you need?','',1,'[]','{}','[]')`).run(questionId, surveyId);
  db.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES (?,?,'Persona collector','web',?,'open','{}',?)`).run(collectorId, surveyId, `persona-${suffix}`, now);
  db.prepare(`INSERT INTO responses
    (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
    VALUES (?,?,?,'persona-respondent','completed',?,'{}',?,?,60)`)
    .run(responseId, surveyId, collectorId,
      JSON.stringify({ [questionId]: 'I need a clear approval path before I can continue.' }), now, now);
  return responseId;
}

test('persona edits create immutable versions and stale optimistic writes lose without mutating history', async () => {
  const agent = await adminAgent();
  const identity = await activeIdentity(agent);
  const now = new Date().toISOString();
  assert.throws(() => db.prepare(`INSERT INTO journey_personas(id,space_id,name,created_at,updated_at)
    VALUES ('direct-null-persona',?,'Direct null persona',?,?)`).run(identity.spaceId, now, now),
  /current_version_id is required/u);
  const created = await agent.post('/api/journey-personas').send({
    name: 'Operations lead', summary: 'Coordinates approvals.',
    attributes: { Region: 'West Africa' }, goals: ['Approve work quickly'], barriers: ['Unclear ownership']
  }).expect(201);
  const initial = await agent.get(`/api/journey-personas/${created.body.id}/versions`).expect(200);
  assert.equal(initial.body.versions.length, 1);
  assert.equal(initial.body.versions[0].versionNumber, 1);
  assert.deepEqual(initial.body.versions[0].claims.map((claim: any) => claim.type),
    ['attribute', 'barrier', 'goal', 'summary']);
  const member = await spaceCollaborator(identity.spaceId, 'member', 'read-only');
  await member.get(`/api/journey-personas/${created.body.id}/versions`)
    .set('x-seemplify-space', identity.spaceId).expect(200);
  await member.patch(`/api/journey-personas/${created.body.id}`)
    .set('x-seemplify-space', identity.spaceId)
    .send({ expectedRevision: created.body.revision, name: 'Member mutation' }).expect(403);
  await member.post(`/api/journey-personas/${created.body.id}/versions/${initial.body.versions[0].id}/review`)
    .set('x-seemplify-space', identity.spaceId)
    .send({ expectedRevision: created.body.revision, decision: 'approved', comment: 'Forbidden review' }).expect(403);

  const updated = await agent.patch(`/api/journey-personas/${created.body.id}`).send({
    expectedRevision: created.body.revision,
    name: 'Senior operations lead',
    goals: ['Approve work quickly', 'Reduce escalations']
  }).expect(200);
  assert.equal(updated.body.revision, 2);
  const conflict = await agent.patch(`/api/journey-personas/${created.body.id}`).send({
    expectedRevision: created.body.revision, name: 'Lost concurrent update'
  }).expect(409);
  assert.equal(conflict.body.code, 'JOURNEY_PERSONA_REVISION_CONFLICT');

  const versions = await agent.get(`/api/journey-personas/${created.body.id}/versions`).expect(200);
  assert.deepEqual(versions.body.versions.map((version: any) => version.versionNumber), [2, 1]);
  assert.equal(versions.body.versions[1].name, 'Operations lead');
  assert.equal(versions.body.versions[0].name, 'Senior operations lead');
  assert.throws(() => db.prepare('UPDATE journey_persona_versions SET name=name WHERE id=?')
    .run(versions.body.versions[0].id), /immutable/u);
  assert.throws(() => db.prepare('UPDATE journey_persona_claims SET value=value WHERE persona_version_id=?')
    .run(versions.body.versions[0].id), /immutable/u);
  assert.throws(() => db.prepare(`UPDATE journey_personas SET current_version_id='missing-version' WHERE id=?`)
    .run(created.body.id), /must reference this persona/u);
});

test('claim evidence is exact, re-authorised, review-governed, and append-only', async () => {
  const agent = await adminAgent();
  const identity = await activeIdentity(agent);
  const responseId = seedSurveyResponse(identity.spaceId, 'review');
  const persona = await agent.post('/api/journey-personas').send({
    name: 'Procurement reviewer', summary: 'Reviews buying requests.', goals: ['Confirm compliance']
  }).expect(201);
  const evidence = await agent.post('/api/journey-evidence').send({
    targetType: 'persona', targetId: persona.body.id, sourceType: 'survey_response', sourceRef: responseId,
    assessment: 'supports'
  }).expect(201);
  const versions = await agent.get(`/api/journey-personas/${persona.body.id}/versions`).expect(200);
  const version = versions.body.versions[0];
  const goal = version.claims.find((claim: any) => claim.type === 'goal');
  const linked = await agent.post(
    `/api/journey-personas/${persona.body.id}/versions/${version.id}/claims/${goal.id}/evidence`
  ).send({ expectedRevision: persona.body.revision, evidenceLinkId: evidence.body.id }).expect(201);
  assert.equal(linked.body.evidenceCoverage.currentSupportingLinks, 1);
  assert.equal(linked.body.claims.find((claim: any) => claim.id === goal.id).evidence[0].state, 'current');

  const submitted = await agent.post(`/api/journey-personas/${persona.body.id}/versions/${version.id}/submit`)
    .send({ expectedRevision: 2, comment: 'Ready for an explicit review.' }).expect(200);
  assert.equal(submitted.body.reviewState, 'in_review');
  const selfApproval = await agent.post(`/api/journey-personas/${persona.body.id}/versions/${version.id}/review`)
    .send({ expectedRevision: 3, decision: 'approved', comment: 'Evidence supports the stated goal.' }).expect(409);
  assert.equal(selfApproval.status, 409);
  assert.equal(selfApproval.body.code, 'JOURNEY_PERSONA_TWO_PERSON_APPROVAL_REQUIRED');
  const reviewer = await spaceCollaborator(identity.spaceId, 'admin', 'review');
  const approved = await reviewer.post(`/api/journey-personas/${persona.body.id}/versions/${version.id}/review`)
    .set('x-seemplify-space', identity.spaceId)
    .send({ expectedRevision: 3, decision: 'approved', comment: 'Independent review confirms the evidence.' }).expect(200);
  assert.equal(approved.body.reviewState, 'approved');
  assert.deepEqual(approved.body.reviewEvents.map((event: any) => event.action), ['submitted', 'approved']);
  const rootPersona = await agent.get(`/api/journey-personas/${persona.body.id}`).expect(200);
  assert.equal(rootPersona.body.persona.lifecycleState, 'active');
  assert.equal(rootPersona.body.persona.revision, 4);

  await agent.post(`/api/journey-personas/${persona.body.id}/versions/${version.id}/claims/${goal.id}/evidence`)
    .send({ expectedRevision: 4, evidenceLinkId: evidence.body.id }).expect(409);
  assert.throws(() => db.prepare('DELETE FROM journey_persona_review_events WHERE persona_version_id=?')
    .run(version.id), /append-only/u);
});

test('working reuse updates two maps while a published map keeps its pinned persona version', async () => {
  const agent = await adminAgent();
  const persona = await agent.post('/api/journey-personas').send({ name: 'Current customer', summary: 'Before edit' }).expect(201);
  const other = await agent.post('/api/journey-personas').send({ name: 'Returning customer', summary: 'Comparison' }).expect(201);
  const first = await agent.post('/api/journey-maps').send({ name: 'Pinned persona map', stageNames: ['Start'] }).expect(201);
  const second = await agent.post('/api/journey-maps').send({ name: 'Reuse persona map', stageNames: ['Start'] }).expect(201);
  let firstMap = (await agent.get(`/api/journey-maps/${first.body.id}`).expect(200)).body;
  firstMap = (await agent.post(`/api/journey-maps/${first.body.id}/personas`).send({ personaId: persona.body.id }).expect(200)).body;
  firstMap = (await agent.post(`/api/journey-maps/${first.body.id}/personas`).send({ personaId: other.body.id }).expect(200)).body;
  await agent.post(`/api/journey-maps/${second.body.id}/personas`).send({ personaId: persona.body.id }).expect(200);
  firstMap = (await agent.post(`/api/journey-maps/${first.body.id}/cards`).send({
    expectedRevision: firstMap.definition.revision, stageKey: firstMap.stages[0].stageKey,
    kind: 'action', title: 'Shared step'
  }).expect(201)).body;
  firstMap = (await agent.post(`/api/journey-maps/${first.body.id}/cards`).send({
    expectedRevision: firstMap.definition.revision, stageKey: firstMap.stages[0].stageKey,
    kind: 'pain_point', title: 'Persona-specific friction', personaId: persona.body.id
  }).expect(201)).body;
  const published = await agent.post(`/api/journey-maps/${first.body.id}/publish`)
    .send({ expectedRevision: firstMap.definition.revision }).expect(200);
  const frozenBefore = await agent.get(`/api/journey-maps/${first.body.id}`)
    .query({ versionId: published.body.publishedVersionId }).expect(200);
  assert.equal(frozenBefore.body.personas.find((item: any) => item.id === persona.body.id).name, 'Current customer');
  assert.equal(frozenBefore.body.personas.find((item: any) => item.id === persona.body.id).versionPinned, true);

  await agent.patch(`/api/journey-personas/${persona.body.id}`).send({
    expectedRevision: persona.body.revision, name: 'Current account owner', summary: 'After edit'
  }).expect(200);
  const workingFirst = await agent.get(`/api/journey-maps/${first.body.id}`).expect(200);
  const workingSecond = await agent.get(`/api/journey-maps/${second.body.id}`).expect(200);
  assert.equal(workingFirst.body.personas.find((item: any) => item.id === persona.body.id).name, 'Current account owner');
  assert.equal(workingSecond.body.personas[0].name, 'Current account owner');
  const frozenAfter = await agent.get(`/api/journey-maps/${first.body.id}`)
    .query({ versionId: published.body.publishedVersionId }).expect(200);
  assert.equal(frozenAfter.body.personas.find((item: any) => item.id === persona.body.id).name, 'Current customer');
  assert.equal(frozenAfter.body.personas.find((item: any) => item.id === persona.body.id).personaVersionId,
    frozenBefore.body.personas.find((item: any) => item.id === persona.body.id).personaVersionId);

  const compared = await agent.get(`/api/journey-maps/${first.body.id}/persona-comparison`).query({
    versionId: published.body.publishedVersionId,
    personaId: [persona.body.id, other.body.id]
  }).expect(200);
  assert.equal(compared.body.personas.length, 2);
  assert.equal(compared.body.sharedCards.length, 1);
  assert.equal(compared.body.layers[0].cards.length, 2);
  assert.equal(compared.body.layers[1].cards.length, 1);

  await agent.delete(`/api/journey-maps/${first.body.id}/personas/${persona.body.id}`).expect(409);
});

test('unlinked and retired personas cannot corrupt map filters, and versioned deletion is explicit', async () => {
  const agent = await adminAgent();
  const persona = await agent.post('/api/journey-personas').send({ name: 'Retirement candidate', goals: ['Finish work'] }).expect(201);
  const map = await agent.post('/api/journey-maps').send({ name: 'Persona integrity', stageNames: ['One'] }).expect(201);
  const mapRead = (await agent.get(`/api/journey-maps/${map.body.id}`).expect(200)).body;
  const unlinked = await agent.post(`/api/journey-maps/${map.body.id}/cards`).send({
    expectedRevision: mapRead.definition.revision, stageKey: mapRead.stages[0].stageKey,
    kind: 'action', title: 'Invalid assignment', personaId: persona.body.id
  }).expect(422);
  assert.equal(unlinked.body.code, 'JOURNEY_PERSONA_NOT_LINKED');
  const deletion = await agent.delete(`/api/journey-personas/${persona.body.id}`)
    .send({ expectedRevision: persona.body.revision }).expect(409);
  assert.equal(deletion.body.code, 'JOURNEY_PERSONA_RETIRE_REQUIRED');

  const retired = await agent.patch(`/api/journey-personas/${persona.body.id}`).send({
    expectedRevision: persona.body.revision, lifecycleState: 'retired'
  }).expect(200);
  assert.equal(retired.body.lifecycleState, 'retired');
  const denied = await agent.post(`/api/journey-maps/${map.body.id}/personas`)
    .send({ personaId: persona.body.id }).expect(409);
  assert.equal(denied.body.code, 'JOURNEY_PERSONA_RETIRED');
});
