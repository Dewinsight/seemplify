const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');
const User = require('../models/User');
const { loadPerformanceDirectory } = require('../services/performanceDirectoryService');
const { resolveAppraisalAccessScope } = require('../services/appraisalAccessService');
const { resolveColleagueParticipants } = require('../services/colleagueReviewService');
let mongo;
const organizationId = 'directory-org';
const req = (role = 'hr_admin') => ({ headers: {}, query: {}, userRole: role, directReports: ['forged-outside'], currentOrganization: { id: organizationId },
  session: { currentOrganizationId: organizationId, user: { id: 'manager', sub: 'manager', email: 'manager@example.test', name: 'Manager', accessToken: 'isolated-directory-test-token',
    currentOrganization: { id: organizationId, role: role === 'hr_admin' ? 'owner' : 'employee' }, organizations: [{ id: organizationId, role: role === 'hr_admin' ? 'owner' : 'employee' }] } } });
function directory(scope = 'organization') {
  const teams = [{ id: 'product', name: 'Product', organizationId }];
  return { organizationId, organizationRole: scope === 'organization' ? 'owner' : 'staff', scope, canStartAppraisals: true, teams,
    members: [{ userId: 'manager', name: 'Manager', email: 'manager@example.test', organizationRole: 'owner', teams: [{ ...teams[0], role: 'line_manager' }] },
      { userId: 'never-logged-in', name: 'New Member', email: 'new@example.test', organizationRole: 'staff', teams: [{ ...teams[0], role: 'member' }] },
      ...(scope === 'organization' ? [{ userId: 'teamless', name: 'Teamless', email: 'teamless@example.test', organizationRole: 'staff', teams: [] }] : [])],
    reviewers: [{ userId: 'manager', name: 'Manager', email: 'manager@example.test', organizationWide: true, organizationRole: 'owner', eligibleTeamIds: ['product'] }]
  };
}
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); jest.spyOn(axios, 'get').mockResolvedValue({ data: directory() }); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
test('loads everyone from authoritative Identity including people who never logged in and people without teams', async () => {
  const request = req(); const scope = await resolveAppraisalAccessScope(request, { includeSelf: true });
  expect(scope.organizationUsers.map(person => person.userId)).toEqual(['manager', 'never-logged-in', 'teamless']);
  expect(await User.countDocuments()).toBe(3);
  await resolveAppraisalAccessScope(request); expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][0]).toMatch(/\/api\/organizations\/directory-org\/performance-directory$/);
});
test('refreshes current membership while retaining another organization and the user workspace preference', async () => {
  await User.create({ idpSub: 'never-logged-in', email: 'new@example.test', currentOrganizationId: 'other-org', idpTeams: [{ id: 'foreign-team', organizationId: 'other-org', role: 'member' }], organizationMemberships: [{ organization: 'other-org', role: 'staff', isActive: true }] });
  await loadPerformanceDirectory(req()); const member = await User.findOne({ idpSub: 'never-logged-in' });
  expect(member.currentOrganizationId).toBe('other-org'); expect(member.idpTeams.map(team => team.id)).toEqual(['foreign-team', 'product']);
  expect(member.organizationMemberships.map(entry => entry.organization)).toEqual(['other-org', organizationId]);
});
test('simultaneous team statistics requests share one directory refresh without retaining a stale cache', async () => {
  await Promise.all(Array.from({ length: 10 }, () => loadPerformanceDirectory(req())));
  expect(axios.get).toHaveBeenCalledTimes(1);
  await loadPerformanceDirectory(req()); expect(axios.get).toHaveBeenCalledTimes(2);
});
test('scoped directory rejects stale direct-report claims and validates selected reviewer identity', async () => {
  axios.get.mockResolvedValue({ data: directory('managed_teams') }); const request = req('line_manager'); request.body = { reviewerMode: 'selected' };
  const scope = await resolveAppraisalAccessScope(request); expect(scope.directReportIds).not.toContain('forged-outside');
  const [person] = await resolveColleagueParticipants(request, [{ userId: 'never-logged-in', reviewerId: 'manager', managerEmail: 'forged@example.test' }]);
  expect(person.managerEmail).toBe('manager@example.test');
  await expect(resolveColleagueParticipants(request, [{ userId: 'forged-outside', reviewerId: 'manager' }])).rejects.toMatchObject({ status: 403 });
  await expect(resolveColleagueParticipants(request, [{ userId: 'never-logged-in', reviewerId: 'never-logged-in' }])).rejects.toMatchObject({ status: 403 });
});
test('a failed or foreign directory fails closed and does not mirror foreign people', async () => {
  axios.get.mockResolvedValue({ data: { ...directory(), organizationId: 'foreign-org' } });
  await expect(loadPerformanceDirectory(req())).rejects.toMatchObject({ status: 503 }); expect(await User.countDocuments()).toBe(0);
  axios.get.mockRejectedValue(new Error('Identity unavailable'));
  await expect(resolveAppraisalAccessScope(req())).rejects.toMatchObject({ status: 503 });
});
test('expired Identity sessions and removed organization membership preserve their authentication errors', async () => {
  for (const status of [401, 403]) {
    axios.get.mockRejectedValue({ response: { status } });
    await expect(loadPerformanceDirectory(req())).rejects.toMatchObject({ status });
  }
});
