const test = require('node:test');
const assert = require('node:assert/strict');
const { mapIdentityRoster, getIdentityRoster } = require('../services/identityRosterService');
const member = (id, extra = {}) => ({ id, sub: `sub-${id}`, email: `${id}@example.test`, name: id, role: 'staff', appAccess: { mode: 'all' }, ...extra });
test('live roster includes never-logged-in people and no-team people and resolves manager subjects', () => {
  const rows = mapIdentityRoster('org', { organizationId: 'org', members: [member('manager'), member('employee', { teamIds: ['team'] }), member('no-team')] }, [{ id: 'team', name: 'Team', manager: { id: 'manager' } }]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].idpTeams[0].managerId, 'sub-manager');
  assert.equal(rows[2].idpTeams.length, 0);
  assert.equal(rows[2].organizationMemberships[0].organization, 'org');
});
test('roster excludes inactive and app-unassigned members and refuses mismatched tenant', () => {
  const members = [member('inactive', { status: 'inactive' }), member('unassigned', { appAccess: { mode: 'selected', appIds: ['payroll-management'] } }), member('missing', { appAccess: null }), member('ok')];
  assert.deepEqual(mapIdentityRoster('org', { organizationId: 'org', members }, []).map(x => x.idpSub), ['sub-ok']);
  assert.throws(() => mapIdentityRoster('other', { organizationId: 'org', members }, []));
});
test('upstream error is surfaced rather than silently authorizing stale roster data', async () => {
  const req = { session: { user: { accessToken: 'synthetic' } } };
  await assert.rejects(getIdentityRoster(req, 'org', { get: async () => { throw new Error('upstream'); } }), { status: 503, code: 'IDENTITY_ROSTER_UNAVAILABLE' });
});
