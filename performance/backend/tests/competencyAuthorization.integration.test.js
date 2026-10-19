const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ACTIONS, context, refreshContext, requireAction, assertAssessment, operation } = require('../services/competency/authorizationService');
const Operation = require('../models/CompetencyOperation');
const { validateSources, validateScoring, validateRanking, DomainError } = require('../contracts/competency');
let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Operation.init(); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
function request(permissions = ACTIONS, scope = 'organization') {
  const organization = { id: 'org-a', role: scope === 'organization' ? 'owner' : 'staff', authorization: { permissionsByApp: { 'performance-management': permissions } } };
  return { session: { user: { sub: 'actor', organizations: [organization], currentOrganization: organization }, currentOrganizationId: 'org-a' }, _performanceDirectory: { organizationId: 'org-a', scope, organizationRole: organization.role, members: [{ userId: 'actor', name: 'Assessor', teamIds: ['team-a'] }, ...(scope !== 'self' ? [{ userId: 'employee', name: 'Employee', teamIds: ['team-a'] }] : [])], reviewers: [{ userId: 'actor', eligibleTeamIds: ['team-a'], organizationWide: scope === 'organization' }], teams: [] } };
}
const scoring = () => ({ version: 1, method: 'weighted_mean', weightMode: 'relative', inputWeights: { strategy: 1 }, ratingScales: [{ id: 'percentage', label: 'Completion percentage', min: 0, max: 100 }], normalization: [{ sourceVersionId: 'strategy-v1', criterionId: 'delivery', method: 'rating_scale', ratingScaleId: 'percentage' }], thresholds: [{ id: 'developing', label: 'Development needed', minInclusive: 0, maxExclusive: 75 }, { id: 'suitable', label: 'Suitable', minInclusive: 75, maxInclusive: 100 }], missingPolicy: 'block_unless_authorised_exception' });
test('central actions and resource scopes are independent, including view-without-export and edit-without-finalise', async () => {
  const ctx = await context(request(['competency.assessment.view', 'competency.assessment.edit', 'competency.report.view'], 'managed_teams'));
  const assessment = { organizationId: 'org-a', participant: { userId: 'employee' }, assessorIds: ['actor'] };
  expect(() => assertAssessment(ctx, assessment, 'assessment.edit')).not.toThrow();
  expect(() => requireAction(ctx, 'assessment.finalise')).toThrow(DomainError);
  const revoked = { ...ctx, directory: { ...ctx.directory, reviewers: [] } };
  expect(() => assertAssessment(revoked, assessment, 'assessment.edit')).toThrow(DomainError);
  const moved = { ...ctx, directory: { ...ctx.directory, members: ctx.directory.members.map(person => person.userId === 'employee' ? { ...person, teamIds: ['different-team'] } : person) } };
  expect(() => assertAssessment(moved, { ...assessment, participant: { userId: 'employee', teamIds: ['team-a'] } }, 'assessment.edit')).toThrow(DomainError);
  expect(() => requireAction(ctx, 'report.export')).toThrow(DomainError);
  expect(() => assertAssessment(ctx, { ...assessment, organizationId: 'org-b' }, 'assessment.view')).toThrow(expect.objectContaining({ status: 404 }));
  expect(() => assertAssessment(ctx, { ...assessment, participant: { userId: 'other' }, assessorIds: [] }, 'assessment.edit')).toThrow(DomainError);
});
test('membership/directory must be current and central permissions cannot be inferred from owner label', async () => {
  const req = request(); delete req.session.user.organizations[0].authorization;
  await expect(context(req)).rejects.toMatchObject({ status: 503, code: 'PERMISSIONS_REFRESH_REQUIRED' });
  const removed = request(); removed._performanceDirectory.members = [];
  await expect(context(removed)).rejects.toMatchObject({ status: 503 });
  const foreign = request(); foreign._performanceDirectory.organizationId = 'org-b';
  await expect(context(foreign)).rejects.toMatchObject({ status: 503 });
});
test('parallel idempotent requests run once and changed payload cannot reuse a key', async () => {
  const ctx = await context(request()); let executions = 0;
  const work = async () => { executions++; await new Promise(resolve => setTimeout(resolve, 80)); return { id: 'created-once' }; };
  const results = await Promise.all([operation(ctx, 'test.create', 'unique-key-001', { a: 1 }, work), operation(ctx, 'test.create', 'unique-key-001', { a: 1 }, work)]);
  expect(executions).toBe(1); expect(results).toEqual([{ id: 'created-once' }, { id: 'created-once' }]);
  await expect(operation(ctx, 'test.create', 'unique-key-001', { a: 2 }, work)).rejects.toMatchObject({ status: 409 });
});
test('source combinations, numeric scales, weights and outcome bands reject ambiguous configuration', () => {
  for (let mask = 1; mask < 8; mask++) expect(validateSources(['sfia', 'internal', 'strategy'].filter((_, index) => mask & (1 << index)))).toHaveLength(mask.toString(2).replaceAll('0', '').length);
  for (const invalid of [[], ['internal', 'internal'], ['unknown']]) expect(() => validateSources(invalid)).toThrow(DomainError);
  expect(validateScoring(scoring(), ['strategy']).exceptionPolicy).toBe('retain_as_unscored');
  for (const mutate of [value => { value.inputWeights.strategy = 0; }, value => { value.ratingScales[0].max = 0; }, value => { value.normalization[0].levelScores = { l1: 10 }; }, value => { value.thresholds[1].minInclusive = 76; }, value => { value.inputWeights.sfia = 1; }]) {
    const value = scoring(); mutate(value); expect(() => validateScoring(value, ['strategy'])).toThrow(DomainError);
  }
  expect(() => validateRanking({ enabled: true, tieRule: 'alphabetical' })).toThrow(DomainError);
});

test('interrupted unknown operation effects are never automatically replayed', async () => {
  const ctx = await context(request()); let writes = 0;
  await expect(operation(ctx, 'test.unknown', 'interrupted-key-001', {}, async () => { writes++; throw new Error('Persistence acknowledgement lost'); })).rejects.toThrow();
  await expect(operation(ctx, 'test.unknown', 'interrupted-key-001', {}, async () => { writes++; return {}; })).rejects.toMatchObject({ code: 'OPERATION_RECOVERY_REQUIRED' });
  expect(writes).toBe(1);
});

test('long-running AI authority refresh uses current OIDC grants and a fresh directory, never request caches', async () => {
  const req = request(); req.session.user.accessToken = 'synthetic-delegated-token';
  const old = await context(req);
  const org = { ...req.session.user.organizations[0], appAccess: { mode: 'all', appIds: [] }, authorization: { permissionsByApp: { 'performance-management': ['competency.assessment.view'] } } };
  const oidc = jest.spyOn(require('../config/oidc'), 'getUserInfo').mockResolvedValue({ sub: 'actor', name: 'Synthetic actor', organizations: [org], teams: [] });
  const axios = jest.spyOn(require('axios'), 'get').mockResolvedValue({ data: { organizationId: 'org-a', scope: 'organization', organizationRole: 'owner', members: [{ userId: 'actor', name: 'Synthetic actor', email: 'actor@example.test', teams: [] }], reviewers: [], teams: [] } });
  const fresh = await refreshContext(req);
  expect(oidc).toHaveBeenCalledWith('synthetic-delegated-token'); expect(axios).toHaveBeenCalledTimes(1);
  expect(() => requireAction(fresh, 'ai.use')).toThrow(DomainError);
  expect(old.permissions.has('competency.ai.use')).toBe(true); expect(req.competencyContext).toBe(old);
});
test('authority refresh denies changed subject, removed app membership and provider outage', async () => {
  const req = request(); req.session.user.accessToken = 'synthetic-delegated-token';
  const oidc = jest.spyOn(require('../config/oidc'), 'getUserInfo');
  oidc.mockResolvedValue({ sub: 'different-subject', organizations: req.session.user.organizations });
  await expect(refreshContext(req)).rejects.toMatchObject({ code: 'AUTHORITY_CHANGED', status: 403 });
  oidc.mockResolvedValue({ sub: 'actor', organizations: [] });
  await expect(refreshContext(req)).rejects.toMatchObject({ code: 'ORGANIZATION_DENIED', status: 403 });
  oidc.mockRejectedValue(new Error('Synthetic authority outage'));
  await expect(refreshContext(req)).rejects.toMatchObject({ code: 'AUTHORITY_REFRESH_FAILED', status: 503 });
});
