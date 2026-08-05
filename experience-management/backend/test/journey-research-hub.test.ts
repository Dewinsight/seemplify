import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-research-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Research-Test-2026!');
fs.writeFileSync(sessionFile, 'journey-research-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-research-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 61).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 62).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'journey-research@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile, LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { createJourneyMap } = await import('../src/journeyMaps.js');
const { createKnowledgeBase, createKnowledgeMarkdownDocument } = await import('../src/knowledgeRepository.js');
const research = await import('../src/journeyResearchHub.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function adminIdentity() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-research@seemplify.local', password: 'Journey-Research-Test-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id); const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, userId, spaceId };
}

function seedSurvey(spaceId: string, suffix: string) {
  const now = new Date().toISOString();
  const surveyId = `research-survey-${suffix}`; const questionId = `research-question-${suffix}`;
  const collectorId = `research-collector-${suffix}`; const responseId = `research-response-${suffix}`;
  db.prepare(`INSERT INTO surveys
    (id,space_id,title,description,purpose,audience,status,primary_metric,created_at,updated_at)
    VALUES (?,?,?,'','customer_experience','','active','csat',?,?)`)
    .run(surveyId, spaceId, `Research survey ${suffix}`, now, now);
  db.prepare(`INSERT INTO questions
    (id,survey_id,page,position,type,title,description,required,options_json,settings_json,logic_json)
    VALUES (?,?,1,0,'long_text','What was difficult?','',1,'[]','{}','[]')`).run(questionId, surveyId);
  db.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES (?,?,?,'web',?,'open','{}',?)`).run(collectorId, surveyId, 'Research', `research-${suffix}`, now);
  db.prepare(`INSERT INTO responses
    (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
    VALUES (?,?,?,?,'completed',?,'{}',?,?,42)`)
    .run(responseId, surveyId, collectorId, `respondent-${suffix}`,
      JSON.stringify({ [questionId]: 'A sensitive source answer that must not appear in list or audit output.' }), now, now);
  return { surveyId, responseId };
}

test('Research Hub is tenant-safe, fail-closed, resumable, immutable, and refreshable', async () => {
  const { agent, userId, spaceId } = await adminIdentity();
  await request(app).get('/api/journey-research/catalogue').expect(401);
  const catalogue = await agent.get('/api/journey-research/catalogue').expect(200);
  assert.ok(Array.isArray(catalogue.body.items));

  const survey = seedSurvey(spaceId, 'primary');
  const map = createJourneyMap(spaceId, userId, {
    name: 'Research-backed onboarding', purpose: 'Test evidence', stageNames: ['Discover', 'Activate']
  });
  const createdResponse = await agent.post('/api/journey-research/sources').set('Idempotency-Key', 'source-primary')
    .send({ sourceType: 'survey_response', sourceRef: survey.responseId, retentionDays: 365 }).expect(201);
  const sourceId = String(createdResponse.body.source.id);
  const firstSnapshotId = String(createdResponse.body.snapshot.id);
  const sourceReplay = await agent.post('/api/journey-research/sources').set('Idempotency-Key', 'source-primary')
    .send({ sourceType: 'survey_response', sourceRef: survey.responseId, retentionDays: 365 }).expect(200);
  assert.equal(sourceReplay.body.replayed, true);
  assert.equal(sourceReplay.body.source.id, sourceId);
  const sourceConflict = await agent.post('/api/journey-research/sources').set('Idempotency-Key', 'source-primary')
    .send({ sourceType: 'survey_response', sourceRef: 'another-response' }).expect(409);
  assert.equal(sourceConflict.body.code, 'JOURNEY_RESEARCH_IDEMPOTENCY_CONFLICT');

  const linkCreated = await agent.post('/api/journey-research/links').set('Idempotency-Key', 'link-primary')
    .send({ sourceId, targetType: 'definition', targetId: map.id }).expect(201);
  const linkId = String(linkCreated.body.link.id);
  const assessed = await agent.post(`/api/journey-research/links/${linkId}/assessments`).send({
    expectedRevision: 1, relationship: 'supports', classification: 'supported', confidence: 0.82,
    freshnessDays: 30, reason: 'Reviewed against the approved research protocol.'
  }).expect(201);
  assert.equal(assessed.body.link.relationship, 'supports');

  const accessible = research.listJourneyResearchLinks({ spaceId, userId, targetType: 'definition', targetId: map.id });
  assert.equal(accessible[0]?.access, 'available');
  assert.equal(accessible[0]?.confidence, 0.82);

  // Source-record loss never leaks the stored assessment through list views.
  db.prepare("UPDATE responses SET status='draft' WHERE id=?").run(survey.responseId);
  const lost = research.listJourneyResearchLinks({ spaceId, userId, targetType: 'definition', targetId: map.id });
  assert.equal(lost[0]?.access, 'inaccessible');
  assert.equal(lost[0]?.relationship, null);
  assert.equal(lost[0]?.confidence, null);
  assert.equal(lost[0]?.snapshotId, null);
  assert.throws(() => research.getJourneyResearchLink({ spaceId, userId, linkId }),
    (error) => Number((error as any)?.status) === 404);
  db.prepare("UPDATE responses SET status='completed' WHERE id=?").run(survey.responseId);

  // Disabling only the underlying source feature also produces a tombstone;
  // journeyEvidence itself remains enabled so the Hub is still readable.
  const plan = db.prepare("SELECT features_json FROM platform_subscription_plans WHERE code='enterprise'")
    .get() as { features_json: string };
  const originalFeatures = String(plan.features_json);
  const features = JSON.parse(originalFeatures) as Record<string, boolean>;
  db.prepare("UPDATE platform_subscription_plans SET features_json=? WHERE code='enterprise'")
    .run(JSON.stringify({ ...features, surveys: false }));
  const featureOff = research.listJourneyResearchLinks({ spaceId, userId, targetType: 'definition', targetId: map.id });
  assert.equal(featureOff[0]?.access, 'inaccessible');
  assert.equal(featureOff[0]?.classification, null);
  db.prepare("UPDATE platform_subscription_plans SET features_json=? WHERE code='enterprise'").run(originalFeatures);

  // A private knowledge source is visible to its owner but is a content-free
  // inaccessible tombstone to another member of the same space.
  const privateBase = createKnowledgeBase(spaceId, userId, { name: 'Private research', privacy: 'private' });
  const privateDocument = createKnowledgeMarkdownDocument({
    spaceId, knowledgeBaseId: privateBase.id, userId, originalName: 'private-research.md',
    markdown: '# Private\nDo not leak this research note.', idempotencyKey: 'private-research-document'
  });
  const privateSource = research.catalogueJourneyResearchSource({ spaceId, userId, sourceType: 'knowledge_document',
    sourceRef: privateDocument.document.id, idempotencyKey: 'private-research-source' });
  const privateLink = research.createJourneyResearchLink({ spaceId, userId, sourceId: privateSource.source.id,
    targetType: 'definition', targetId: map.id, idempotencyKey: 'private-research-link' });
  research.createJourneyResearchAssessment({ spaceId, userId, linkId: privateLink.link.id, expectedRevision: 1,
    relationship: 'contradicts', classification: 'contradicted', confidence: 0.65, reason: 'Approved reviewer rationale.' });
  const memberId = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,email_verified_at,created_at,updated_at)
    VALUES (?,?,?,'unused','member',?,?,?)`).run(memberId, 'research-member@example.test', 'Research member', now, now, now);
  db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,'member',?,?)`).run(spaceId, memberId, now, now);
  const memberList = research.listJourneyResearchLinks({ spaceId, userId: memberId,
    targetType: 'definition', targetId: map.id });
  const privateTombstone = memberList.find((item) => item.id === privateLink.link.id)!;
  assert.equal(privateTombstone.access, 'inaccessible');
  assert.equal(privateTombstone.relationship, null);
  assert.equal(privateTombstone.isContradictory, null);
  assert.throws(() => research.getJourneyResearchLink({ spaceId, userId: memberId, linkId: privateLink.link.id }),
    (error) => Number((error as any)?.status) === 404);

  // Refresh creates a new immutable snapshot and a bounded change set without
  // silently repinning the target link.
  db.prepare('UPDATE surveys SET title=?,updated_at=? WHERE id=? AND space_id=?')
    .run('Updated research survey', new Date(Date.now() + 1000).toISOString(), survey.surveyId, spaceId);
  const queued = research.queueJourneyResearchRefresh({ spaceId, sourceId, requestedByUserId: userId,
    trigger: 'manual', idempotencyKey: 'refresh-primary' });
  const queuedReplay = research.queueJourneyResearchRefresh({ spaceId, sourceId, requestedByUserId: userId,
    trigger: 'manual', idempotencyKey: 'refresh-primary' });
  assert.equal(queuedReplay.replayed, true);
  assert.equal(queuedReplay.run.id, queued.run.id);
  const [claim] = research.claimJourneyResearchRefreshRuns({ leaseOwner: 'research-test-worker', leaseMs: 60_000, limit: 10 });
  assert.ok(claim);
  const completed = research.processJourneyResearchRefresh(claim!);
  assert.equal(completed.state, 'completed');
  assert.ok(completed.changedFields.includes('sourceLabel'));
  const linkAfterRefresh = research.getJourneyResearchLink({ spaceId, userId, linkId });
  assert.equal(linkAfterRefresh.link.snapshotId, firstSnapshotId, 'refresh never silently repins a reviewed link');
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_research_snapshots WHERE source_id=?`)
    .get(sourceId) as any).count), 2);
  const notice = research.listJourneyResearchNotifications({ spaceId, userId })
    .find((item) => item.kind === 'source_changed');
  assert.ok(notice);
  assert.doesNotMatch(JSON.stringify(notice), /sensitive source answer|Updated research survey/u);
  assert.equal(research.notifyJourneyResearchState({ spaceId, sourceId, kind: 'source_stale', eventKey: 'stale-2026-08-04' }).length, 1);
  assert.equal(research.notifyJourneyResearchState({ spaceId, sourceId, kind: 'source_stale', eventKey: 'stale-2026-08-04' }).length, 0,
    'manual/no-run notifications use explicit non-null deduplication');

  research.createJourneyResearchGap({ spaceId, userId, targetType: 'definition', targetId: map.id,
    title: 'Validate activation evidence', idempotencyKey: 'gap-inbox-contract' });
  db.prepare(`INSERT INTO journey_evidence_links
    (id,space_id,target_type,target_id,source_type,source_ref,source_label,excerpt,assessment,confidence,
      population,source_updated_at,last_validated_at,created_by,created_at,updated_at)
    VALUES (?,?, 'definition',?,'survey_response',?,'Secret legacy label','Secret legacy excerpt','supports',0.7,
      'Secret population','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z',?,?,?)`)
    .run('legacy-inbox-link', spaceId, map.id, `survey-response:${survey.responseId}`, userId, now, now);
  db.prepare(`UPDATE journey_research_sources SET state='inaccessible',last_error_code='SOURCE_INACCESSIBLE',updated_at=?
    WHERE id=? AND space_id=?`).run(now, privateSource.source.id, spaceId);

  research.journeyResearchInbox({ spaceId, userId, limit: 100 });
  const inboxResponse = await agent.get('/api/journey-research/inbox?limit=100');
  assert.equal(inboxResponse.status, 200, JSON.stringify(inboxResponse.body));
  const inboxItems = inboxResponse.body.items as Array<Record<string, unknown>>;
  assert.ok(inboxItems.length > 0);
  for (const item of inboxItems) {
    switch (item.itemKind) {
      case 'notification':
        assert.deepEqual(Object.keys(item).sort(),
          ['createdAt','detail','id','itemKind','kind','readAt','refreshRunId','revision','sourceId','state'].sort());
        break;
      case 'gap':
        assert.deepEqual(Object.keys(item).sort(),
          ['createdAt','dueAt','id','itemKind','label','ownerUserId','priority','resolutionLinkId','revision','status',
            'targetId','targetType','updatedAt'].sort());
        break;
      case 'source_state':
        assert.deepEqual(Object.keys(item).sort(), ['itemKind','sourceId','state','updatedAt'].sort());
        break;
      case 'existing_evidence_link':
        assert.deepEqual(Object.keys(item).sort(),
          ['access','changedFields','itemKind','linkId','refreshStatus','targetId','targetType','unavailableReason','updatedAt'].sort());
        break;
      default:
        assert.fail(`Unexpected inbox discriminant: ${String(item.itemKind)}`);
    }
  }
  assert.deepEqual(new Set(inboxItems.map((item) => item.itemKind)),
    new Set(['notification','gap','source_state','existing_evidence_link']));
  assert.doesNotMatch(JSON.stringify(inboxResponse.body),
    /Secret legacy label|Secret legacy excerpt|Secret population|SOURCE_INACCESSIBLE|private-research|Do not leak/u,
    'inbox list projections stay content-free and omit adapter/error internals');

  // Crash after the knowledge document + source were committed is resumable:
  // a retry creates neither duplicate files/documents/jobs/sources nor an
  // orphan second intake.
  const intakeBase = createKnowledgeBase(spaceId, userId, { name: 'Interview repository', privacy: 'space' });
  const intakeInput = {
    spaceId, userId, knowledgeBaseId: intakeBase.id, kind: 'interview' as const, method: 'moderated_interview',
    markdown: '# Interview notes\nBounded research content.', conductedAt: '2026-08-03T10:00:00.000Z',
    population: 'Pilot participants', tags: ['activation'], consentBasis: 'documented' as const,
    retentionExpiresAt: '2027-08-04T00:00:00.000Z', idempotencyKey: 'intake-crash-recovery'
  };
  assert.throws(() => research.createJourneyResearchIntake({ ...intakeInput,
    beforeIntakeCommit: () => { throw new Error('simulated process crash'); } }), /simulated process crash/u);
  const countsBeforeRetry = {
    documents: Number((db.prepare('SELECT COUNT(*) count FROM knowledge_documents WHERE knowledge_base_id=?').get(intakeBase.id) as any).count),
    jobs: Number((db.prepare('SELECT COUNT(*) count FROM knowledge_jobs WHERE knowledge_base_id=?').get(intakeBase.id) as any).count),
    sources: Number((db.prepare(`SELECT COUNT(*) count FROM journey_research_sources WHERE space_id=? AND source_type='knowledge_document'`)
      .get(spaceId) as any).count),
    intakes: Number((db.prepare('SELECT COUNT(*) count FROM journey_research_intakes WHERE knowledge_base_id=?').get(intakeBase.id) as any).count)
  };
  assert.equal(countsBeforeRetry.documents, 1);
  assert.equal(countsBeforeRetry.jobs, 1);
  assert.equal(countsBeforeRetry.intakes, 0);
  const recovered = research.createJourneyResearchIntake(intakeInput);
  assert.equal(recovered.replayed, false);
  const recoveredReplay = research.createJourneyResearchIntake(intakeInput);
  assert.equal(recoveredReplay.replayed, true);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM knowledge_documents WHERE knowledge_base_id=?').get(intakeBase.id) as any).count), 1);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM knowledge_jobs WHERE knowledge_base_id=?').get(intakeBase.id) as any).count), 1);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_research_intakes WHERE knowledge_base_id=?').get(intakeBase.id) as any).count), 1);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_research_sources WHERE space_id=? AND source_type='knowledge_document'`)
    .get(spaceId) as any).count), countsBeforeRetry.sources);

  // Composite tenant keys reject a real document paired with the wrong base,
  // and refresh change sets cannot cite a snapshot from another source.
  const otherBase = createKnowledgeBase(spaceId, userId, { name: 'Other base', privacy: 'space' });
  assert.throws(() => db.prepare(`INSERT INTO journey_research_intakes
    (id,space_id,source_id,knowledge_base_id,knowledge_document_id,intake_kind,method,conducted_at,population,tags_json,
      consent_basis,researcher_user_id,retention_expires_at,idempotency_key,intent_sha256,created_at)
    VALUES (?,?,?,?,?,'research_note','test',NULL,'','[]','not_required',?,?,?,?,?)`)
    .run(crypto.randomUUID(), spaceId, recovered.intake.sourceId, otherBase.id, recovered.intake.knowledgeDocumentId,
      userId, '2027-08-04T00:00:00.000Z', 'invalid-intake-pair', 'a'.repeat(64), now), /FOREIGN KEY/u);
  assert.throws(() => db.prepare(`INSERT INTO journey_research_refresh_runs
    (id,space_id,source_id,monitor_id,requested_by_user_id,trigger_kind,state,revision,available_at,lease_generation,
      attempt_count,max_attempts,before_snapshot_id,changed_fields_json,idempotency_key,intent_sha256,created_at,updated_at)
    VALUES (?,?,?,NULL,?,'manual','queued',1,?,0,0,3,?,'[]',?,?,?,?)`)
    .run(crypto.randomUUID(), spaceId, sourceId, userId, now, privateSource.snapshot!.id,
      'invalid-cross-source-snapshot', 'b'.repeat(64), now, now), /FOREIGN KEY/u);

  const audit = research.listJourneyResearchAudit({ spaceId, limit: 100 });
  assert.doesNotMatch(JSON.stringify(audit), /Bounded research content|sensitive source answer|Do not leak/u);
  assert.throws(() => db.prepare("UPDATE journey_research_snapshots SET excerpt='tampered' WHERE id=?")
    .run(firstSnapshotId), /immutable/u);
  assert.throws(() => db.prepare('UPDATE journey_research_assessments SET confidence=0 WHERE link_id=?')
    .run(linkId), /immutable/u);
});
