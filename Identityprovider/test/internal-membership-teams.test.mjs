import test from 'node:test'
import assert from 'node:assert/strict'

import { serializeReconciliationTeams } from '../src/utils/reconciliationTeams.js'

test('membership reconciliation exposes the authoritative IdP team hierarchy and active roster', () => {
  const organization = {
    members: [
      { account: { _id: 'account-1', sub: 'subject-1', email: 'one@example.com' } },
      { account: { _id: 'account-2', sub: 'subject-2', email: 'two@example.com' } }
    ],
    getDepartmentById: () => ({ name: 'Engineering' })
  }
  const teams = [{
    _id: 'team-1',
    name: 'Platform',
    description: 'Core product infrastructure',
    parentTeam: 'team-parent',
    department: 'department-1',
    manager: 'account-1',
    members: [
      { account: 'account-1', role: 'line_manager', status: 'active' },
      { account: 'account-2', role: 'member', status: 'inactive' }
    ]
  }]

  assert.deepEqual(serializeReconciliationTeams(teams, organization), [{
    id: 'team-1',
    teamId: 'team-1',
    name: 'Platform',
    description: 'Core product infrastructure',
    parentTeamId: 'team-parent',
    departmentId: 'department-1',
    departmentName: 'Engineering',
    managerId: 'account-1',
    members: [{
      idpSubject: 'subject-1',
      subjectId: 'subject-1',
      email: 'one@example.com',
      role: 'line_manager',
      status: 'active'
    }]
  }])
})
