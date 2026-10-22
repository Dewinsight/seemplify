'use strict';
const mongoose = require('mongoose');
const crypto = require('crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const library = require('../services/competency/libraryService');
const policy = require('../services/competency/cyclePolicy');
const unified = require('../services/competency/unifiedAppraisalService');
const auth = require('../services/competency/authorizationService');
const Appraisal = require('../models/Appraisal');
const Run = require('../models/AppraisalCycle');
const Assessment = require('../models/CompetencyAssessment');
const Cycle = require('../models/CompetencyCycle');
const { getConversationQuestionQueue } = require('../services/appraisalCustomResponseService');
const { DomainError } = require('../contracts/competency');
let mongo;
const people = ['employee-a', 'employee-b'].map(userId => ({ userId, name: userId, email: `${userId}@example.test`, teamIds: ['team-a'], managerId: 'manager', managerName: 'Manager', managerEmail: 'manager@example.test' }));
const ctx = () => ({ organizationId: 'synthetic-org', actor: { userId: 'manager', name: 'Manager' }, organizationWide: true, permissions: new Set(auth.ACTIONS), directory: { scope: 'organization', members: people, reviewers: [] }, req: { session: { user: { sub: 'manager' } } } });
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri()); });
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await require('../models/OrganizationFeatureConfig').create({ organizationId: 'synthetic-org', features: { competencyAssessments: true } });
  await Promise.all(Object.values(mongoose.models).map(model => model.createCollection()));
  await Promise.all(Object.values(mongoose.models).map(model => model.ensureIndexes()));
  jest.spyOn(require('../services/colleagueReviewService'), 'resolveColleagueParticipants').mockImplementation(async (req, selections) => selections.map(selection => people.find(p => p.userId === selection.userId)));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

async function configured(mode = 'competency', cadence = { type: 'periodic', frequency: 'quarterly' }) {
  const actor = ctx(); let role;
  const draft = { name: 'Solution architecture reviews', reviewMode: mode, cadence, period: { start: '2024-01-01', end: '2024-03-31' }, selectedInputTypes: [], frameworkVersionIds: [], strategyVersionIds: [], roleVersionIds: [], rankingConfig: { enabled: false } };
  if (mode !== 'regular') {
    const framework = await library.createFramework(actor, { name: 'Synthetic architecture skills', sourceType: 'internal', source: 'Authored fixture', licenseProvenance: 'Original synthetic content', levels: [{ id: '4', label: 'Level 4', description: 'Owns a bounded design', order: 4 }, { id: '5', label: 'Level 5', description: 'Leads solution decisions', order: 5 }], criteria: [{ id: 'architecture', code: 'ARCH-TEST', name: 'Solution architecture', description: 'Evaluate trade-offs and demonstrate decisions.', levelIds: ['4', '5'] }] });
    const version = await library.publishFramework(actor, framework.id, framework.draftVersion.id, 1);
    const roleDraft = await library.createRole(actor, { name: 'Solution Architect', description: 'Synthetic assessment role', responsibilities: [{ id: 'design', text: 'Lead design decisions' }], requirements: [], criteria: [{ id: 'architecture', sourceType: 'internal', frameworkVersionId: version.id, criterionId: 'architecture', expectedLevelId: '5', weight: 1, required: true, evidenceRequired: true, rationaleRequired: true, responsibilityIds: ['design'], requirementIds: [] }] });
    role = await library.publishRole(actor, roleDraft.id, roleDraft.draftVersion.id, 1);
    Object.assign(draft, { selectedInputTypes: ['internal'], frameworkVersionIds: [version.id], roleVersionIds: [role.id], scoringConfig: { version: 1, method: 'weighted_mean', weightMode: 'relative', inputWeights: { internal: 1 }, ratingScales: [], normalization: [{ sourceVersionId: version.id, criterionId: 'architecture', method: 'level_map', levelScores: { '4': 50, '5': 100 } }], thresholds: [{ id: 'develop', label: 'Develop', minInclusive: 0, maxExclusive: 75 }, { id: 'meets', label: 'Meets expectations', minInclusive: 75, maxInclusive: 100 }], missingPolicy: 'block_unless_authorised_exception', exceptionPolicy: 'retain_as_unscored' } });
  }
  let cycle = await library.createCycle(actor, draft);
  cycle = await library.publishCycle(actor, cycle.id, cycle.revision);
  return { cycle, role };
}
function input(fixture, period = { start: '2024-01-01', end: '2024-03-31' }, participantIds = ['employee-a']) {
  return { cycleRevision: fixture.cycle.revision, period, assignments: participantIds.map(participantId => ({ participantId, reviewerId: 'manager', ...(fixture.role ? { roleVersionId: fixture.role.id } : {}) })), responseDeadlines: { selfAssessmentDue: new Date(Date.now() + 7 * 86400000).toISOString(), managerReviewDue: new Date(Date.now() + 14 * 86400000).toISOString() } };
}
test.each(['regular', 'competency', 'combined'])('%s launches one appraisal with the appropriate frozen questions', async mode => {
  const fixture = await configured(mode);
  const result = await unified.launch(ctx(), fixture.cycle.id, input(fixture), crypto.randomUUID());
  expect(result.launched).toBe(1);
  const appraisal = await Appraisal.findById(result.appraisals[0]._id).lean();
  expect(appraisal.cycleConfigurationSnapshot.cvRequired).toBe(false);
  expect(result.appraisals[0].cycleConfigurationSnapshot.cvRequired).toBe(false);
  const prompts = getConversationQuestionQueue(appraisal);
  const linked = await Assessment.find({ appraisalId: String(appraisal._id) }).lean();
  expect(linked).toHaveLength(mode === 'regular' ? 0 : 1);
  expect(prompts.some(q => q.prompt.includes('ARCH-TEST'))).toBe(mode !== 'regular');
  if (mode === 'competency') {
    expect(appraisal.cycleConfigurationSnapshot.competencies).toEqual([]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].helpText).toContain('Level 5');
    expect(appraisal.cycleConfigurationSnapshot.roleDefinition.criteria[0].expectedLevel.id).toBe('5');
  }
  if (mode === 'combined') expect(prompts.length).toBeGreaterThan(1);
  const run = await Run.findOne().lean();
  expect(run.competencies.length).toBe(mode === 'competency' ? 0 : 5);
  expect(await Run.countDocuments()).toBe(1);
});

test('CV requirement freezes per launch and duplicate-period replay cannot change it', async () => {
  const fixture = await configured('regular'), body = { ...input(fixture), cvRequired: true }, key = crypto.randomUUID();
  const first = await unified.launch(ctx(), fixture.cycle.id, body, key);
  expect(first.appraisals[0].cycleConfigurationSnapshot.cvRequired).toBe(true);
  expect((await Appraisal.findById(first.appraisals[0]._id)).cycleConfigurationSnapshot.cvRequired).toBe(true);
  const replay = await unified.launch(ctx(), fixture.cycle.id, { ...body, cvRequired: false }, crypto.randomUUID());
  expect(replay.replayed).toBe(1); expect(replay.existingAppraisals[0].cycleConfigurationSnapshot.cvRequired).toBe(true);
  await expect(unified.launch(ctx(), fixture.cycle.id, { ...body, cvRequired: false }, key)).rejects.toMatchObject({ code: 'REQUEST_KEY_CONFLICT' });
  const saved = await Appraisal.findById(first.appraisals[0]._id);
  expect(saved.cycleConfigurationSnapshot.cvRequired).toBe(true);
  expect(saved.auditLog.find(entry => entry.action === 'appraisal_created').details.cvRequired).toBe(true);
});

test.each([null, 'true', 1, {}])('launch rejects non-boolean CV requirement %s before creating reviews', async cvRequired => {
  const fixture = await configured('regular');
  await expect(unified.launch(ctx(), fixture.cycle.id, { ...input(fixture), cvRequired }, crypto.randomUUID())).rejects.toMatchObject({ code: 'INVALID_CV_REQUIREMENT', status: 422 });
  expect(await Appraisal.countDocuments()).toBe(0);
});
test('a quarterly second occurrence reassesses the same person; same-period replay never duplicates', async () => {
  const fixture = await configured(), body = input(fixture), key = crypto.randomUUID();
  const first = await unified.launch(ctx(), fixture.cycle.id, body, key);
  expect((await unified.launch(ctx(), fixture.cycle.id, body, key)).appraisals[0]._id.toString()).toBe(first.appraisals[0]._id.toString());
  expect((await unified.launch(ctx(), fixture.cycle.id, body, crypto.randomUUID())).replayed).toBe(1);
  const second = await unified.launch(ctx(), fixture.cycle.id, input(fixture, { start: '2024-04-01', end: '2024-06-30' }), crypto.randomUUID());
  expect(second.launched).toBe(1);
  expect(await Assessment.countDocuments()).toBe(2);
  expect(await Run.countDocuments()).toBe(2);
});
test('one-time review cannot be repeated under a different period', async () => {
  const fixture = await configured('competency', { type: 'one_time' });
  await unified.launch(ctx(), fixture.cycle.id, input(fixture), crypto.randomUUID());
  await expect(unified.launch(ctx(), fixture.cycle.id, input(fixture, { start: '2024-04-01', end: '2024-06-30' }), crypto.randomUUID())).rejects.toMatchObject({ code: 'INVALID_CYCLE_SETUP' });
  expect(await Appraisal.countDocuments()).toBe(1);
});
test('regular reviews exclude goal weighting unless approved goals are explicitly required', async () => {
  const fixture = await configured('regular');
  const result = await unified.launch(ctx(), fixture.cycle.id, input(fixture), crypto.randomUUID());
  const snapshot = (await Appraisal.findById(result.appraisals[0]._id).lean()).cycleConfigurationSnapshot;
  expect(snapshot.workflowDefinition.sections.some(section => section.type === 'goals')).toBe(false);
  expect(snapshot.workflowDefinition.scoring.goalsWeight).toBe(0);
  expect(snapshot.workflowDefinition.scoring.competenciesWeight).toBe(100);
  expect(result.appraisals[0]).not.toHaveProperty('selfAssessment');
  expect(result.appraisals[0].cycleConfigurationSnapshot).not.toHaveProperty('roleDefinition');
  // Synthetic setup of an explicit goal-required published fixture.
  await Cycle.updateOne({ _id: fixture.cycle.id }, { $set: { includeApprovedGoals: true } });
  jest.spyOn(require('../services/appraisalGoalSnapshotService'), 'buildGoalSnapshots').mockResolvedValue({ snapshots: [], goalIds: [], evidenceSummary: {} });
  await expect(unified.launch(ctx(), fixture.cycle.id, input(fixture, { start: '2024-04-01', end: '2024-06-30' }), crypto.randomUUID())).rejects.toMatchObject({ code: 'APPROVED_GOALS_REQUIRED' });
  expect(await Appraisal.countDocuments()).toBe(1);
});
test('failure in a later linked assessment rolls back all appraisals, assessments and occurrence', async () => {
  const fixture = await configured(); const original = Assessment.create.bind(Assessment); let calls = 0;
  jest.spyOn(Assessment, 'create').mockImplementation((...args) => { if (++calls === 2) throw new DomainError(422, 'SYNTHETIC_FAILURE', 'Synthetic persistence failure'); return original(...args); });
  await expect(unified.launch(ctx(), fixture.cycle.id, input(fixture, undefined, ['employee-a', 'employee-b']), crypto.randomUUID())).rejects.toMatchObject({ code: 'SYNTHETIC_FAILURE' });
  expect(await Appraisal.countDocuments()).toBe(0); expect(await Assessment.countDocuments()).toBe(0); expect(await Run.countDocuments()).toBe(0);
});
test('forged participant, stale cycle, invalid schedule and changed role cannot write', async () => {
  const fixture = await configured();
  await expect(unified.launch(ctx(), fixture.cycle.id, input(fixture, undefined, ['outside-org']), crypto.randomUUID())).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND' });
  await expect(unified.launch(ctx(), fixture.cycle.id, { ...input(fixture), cycleRevision: 1 }, crypto.randomUUID())).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  await expect(unified.launch(ctx(), fixture.cycle.id, input(fixture, { start: '2024-02-01', end: '2024-04-30' }), crypto.randomUUID())).rejects.toMatchObject({ code: 'INVALID_CYCLE_SETUP' });
  expect(await Appraisal.countDocuments()).toBe(0);
});
test('manager configures own team cycles, cannot mutate shared/other cycles, and member is denied', async () => {
  const manager = { ...ctx(), organizationWide: false, directory: { scope: 'managed_teams' } };
  const own = await library.createCycle(manager, { name: 'Team review', reviewMode: 'regular', period: { start: '2024-01-01', end: '2024-03-31' } });
  expect(own.configurationScope).toBe('managed_teams');
  const published = await library.publishCycle(manager, own.id, own.revision);
  expect(published.status).toBe('published');
  expect(() => policy.assertManage({ ...manager, actor: { userId: 'other-manager' } }, published)).toThrow('only the team cycles');
  expect(() => policy.assertUse({ ...manager, actor: { userId: 'other-manager' } }, published)).toThrow('another manager');
  expect(() => policy.assertManage(manager, { ...published, configurationScope: 'organization' })).toThrow('only the team cycles');
  await expect(library.createCycle({ ...manager, directory: { scope: 'self' } }, { name: 'Forbidden' })).rejects.toMatchObject({ code: 'CYCLE_MANAGEMENT_DENIED' });
});
test('regular setup works without the competency feature; competency launch fails closed', async () => {
  const regular = await configured('regular');
  const role = await configured('competency');
  await require('../models/OrganizationFeatureConfig').updateOne({ organizationId: 'synthetic-org' }, { $set: { 'features.competencyAssessments': false } });
  expect((await unified.launch(ctx(), regular.cycle.id, input(regular), crypto.randomUUID())).launched).toBe(1);
  await expect(unified.launch(ctx(), role.cycle.id, input(role), crypto.randomUUID())).rejects.toMatchObject({ code: 'COMPETENCY_DISABLED' });
});
test('migration retains records and replaces old uniqueness with occurrence-scoped uniqueness', async () => {
  const collection = Assessment.collection;
  await collection.createIndex({ organizationId: 1, cycleId: 1, cycleVersion: 1, 'participant.userId': 1 }, { unique: true });
  await collection.insertOne({ organizationId: 'legacy', cycleId: 'legacy', cycleVersion: 1, participant: { userId: 'person' }, definitionSnapshot: { immutable: true } });
  const { migrate } = require('../scripts/migrateCompetencyOccurrences');
  expect((await migrate(mongoose.connection.db)).legacyBackfill).toBe(1);
  await migrate(mongoose.connection.db, true);
  const old = await collection.findOne({ organizationId: 'legacy' });
  expect(old.occurrenceKey).toBe('legacy'); expect(old.definitionSnapshot).toEqual({ immutable: true });
  expect((await collection.indexes()).some(index => index.name === 'competency_occurrence_participant')).toBe(true);
});

test('concurrent requests and mixed-case cycle IDs cannot duplicate a review occurrence', async () => {
  const fixture = await configured(), body = input(fixture);
  const results = await Promise.all([
    unified.launch(ctx(), fixture.cycle.id, body, crypto.randomUUID()),
    unified.launch(ctx(), fixture.cycle.id.toUpperCase(), body, crypto.randomUUID()),
  ]);
  expect(results.reduce((sum, result) => sum + result.launched, 0)).toBe(1);
  expect(await Appraisal.countDocuments()).toBe(1);
  expect(await Assessment.countDocuments()).toBe(1);
  expect(await Run.countDocuments()).toBe(1);
});
test('legacy one-time assessments are not duplicated by the unified launch', async () => {
  const fixture = await configured('competency', { type: 'one_time' });
  await Assessment.create({ organizationId: 'synthetic-org', cycleId: fixture.cycle.id, cycleVersion: 1, participant: { userId: 'employee-a' }, definitionSnapshot: {} });
  await expect(unified.launch(ctx(), fixture.cycle.id, input(fixture), crypto.randomUUID())).rejects.toMatchObject({ code: 'LEGACY_ASSESSMENT_EXISTS' });
  expect(await Appraisal.countDocuments()).toBe(0);
  expect(await Assessment.countDocuments()).toBe(1);
});
test('closed periods and legacy endpoints cannot create another assessment in a unified period', async () => {
  const fixture = await configured();
  const first = await unified.launch(ctx(), fixture.cycle.id, input(fixture), crypto.randomUUID());
  const actor = ctx(); actor.directory.reviewers = [{ userId: 'manager', name: 'Manager', organizationWide: true }];
  await expect(require('../services/competency/assessmentService').launch(actor, { cycleId: fixture.cycle.id.toUpperCase(), cycleRevision: fixture.cycle.revision, assignments: [{ participantId: 'employee-a', roleVersionId: fixture.role.id, assessorIds: ['manager'] }] }, crypto.randomUUID())).rejects.toMatchObject({ code: 'USE_UNIFIED_APPRAISALS' });
  await Run.updateOne({ _id: first.runId }, { $set: { status: 'cancelled' } });
  await expect(unified.launch(ctx(), fixture.cycle.id, input(fixture, undefined, ['employee-b']), crypto.randomUUID())).rejects.toMatchObject({ code: 'REVIEW_PERIOD_CLOSED' });
  expect(await Appraisal.countDocuments()).toBe(1);
  expect(await Assessment.countDocuments()).toBe(1);
});
test('configured optional stages retain manual/meeting-first flows without fabricated employee reminders', async () => {
  const fixture = await configured(); const body = input(fixture);
  body.appraisalFlow = { version: 1, assessmentMode: 'form', steps: [{ id: 'meeting', type: 'oneOnOne', label: 'Evidence discussion' }, { id: 'final', type: 'finalReview', label: 'Human final outcome' }] };
  const result = await unified.launch(ctx(), fixture.cycle.id, body, crypto.randomUUID());
  expect(result.appraisals[0].status).toBe('meeting_pending');
  const appraisal = await Appraisal.findById(result.appraisals[0]._id).lean();
  expect(appraisal.cycleConfigurationSnapshot.appraisalFlow.assessmentMode).toBe('form');
  expect(appraisal.cycleConfigurationSnapshot.appraisalFlow.steps.map(step => step.type)).toEqual(['oneOnOne', 'finalReview']);
  expect(await require('../models/ScheduledReminder').countDocuments({ organizationId: 'synthetic-org' })).toBe(0);
  expect(await Assessment.countDocuments()).toBe(1);
});
test('combined reviews never silently truncate role questions when regular sections fill the limit', () => {
  const sections = Array.from({ length: 20 }, (_, index) => ({ id: `custom-${index}`, title: `Custom ${index}`, type: 'custom', respondent: 'both', required: true, scored: index === 0, weight: index === 0 ? 100 : 0, questions: [{ id: `q-${index}`, prompt: 'Describe the outcome.', responseType: index === 0 ? 'rating' : 'long_text' }] }));
  expect(() => unified.workflow({ reviewMode: 'combined', workflowDefinition: { sections, scoring: { goalsWeight: 0, competenciesWeight: 0 }, stages: {} } }, { role: { name: 'Synthetic role' }, criteria: [{ id: 'skill', name: 'Required skill' }] })).toThrow('every role evidence question');
});
test('professional role setup is tenant-scoped, idempotent and creates no employee appraisals', async () => {
  const { configure } = require('../scripts/configureProfessionalRoleCycle');
  const organizationId = String(new mongoose.Types.ObjectId());
  await expect(configure(organizationId, '', true)).rejects.toThrow('permission/provenance');
  const first = await configure(organizationId, 'Synthetic test-only provenance; no assertion of live permission', true);
  const second = await configure(organizationId, 'Synthetic test-only provenance; no assertion of live permission', true);
  expect(first.cycleId).toBe(second.cycleId);
  expect(first.roleVersionIds).toEqual(second.roleVersionIds);
  expect(first.roleVersionIds).toHaveLength(2);
  expect(await require('../models/CompetencyFramework').countDocuments({ organizationId })).toBe(1);
  expect(await require('../models/CompetencyRole').countDocuments({ organizationId })).toBe(2);
  const cycle = await Cycle.findById(first.cycleId).lean();
  expect(cycle.reviewMode).toBe('competency');
  expect(cycle.cadence).toEqual({ type: 'periodic', frequency: 'quarterly' });
  for (const roleVersionId of first.roleVersionIds) {
    const definition = await library.getPublishedDefinition({ organizationId, cycleId: first.cycleId, cycleRevision: cycle.revision, roleVersionId });
    expect(definition.criteria).toHaveLength(5);
    expect(definition.criteria.every(criterion => criterion.levelIds.includes(criterion.expectedLevel.id))).toBe(true);
  }
  expect(await Appraisal.countDocuments()).toBe(0);
  expect(await Assessment.countDocuments()).toBe(0);
});
