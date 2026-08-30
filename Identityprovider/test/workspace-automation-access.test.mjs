import assert from 'node:assert/strict'
import test from 'node:test'

import {
  N8N_WORKSPACE_NODE_CLIENT_ID,
  WORKSPACE_PROTECTED_APPROVER_AUTHORIZATION,
  resolveWorkspaceAutomationAccess,
  resolveWorkspaceAutomationTokenAccess,
  resolveWorkspaceProtectedApproverAccess
} from '../src/services/workspaceAutomationAccessService.js'

const account = {
  _id: 'account-1',
  sub: 'identity-subject-1',
  email: 'operator@example.test',
  emailVerified: true,
  profile: { name: 'Automation Operator', preferred_username: 'operator' },
  organizations: [],
  teams: [],
  security: {}
}

const sessionIssuedAt = 1_788_067_200
const now = () => sessionIssuedAt * 1000 + 30_000

const AccountModel = {
  findOne(filter) {
    assert.deepEqual(filter, { sub: 'identity-subject-1' })
    return {
      select() {
        return { lean: async () => account }
      }
    }
  }
}

test('returns only the freshly rebuilt requested organization claim', async () => {
  const claim = {
    id: 'org-a',
    role: 'admin',
    authorization: {
      roleKeys: ['admin'],
      permissionsByApp: { 'automation-hub': ['automations.read'] }
    }
  }
  const identity = await resolveWorkspaceAutomationAccess({
    subject: 'identity-subject-1',
    organizationId: 'org-a',
    sessionIat: sessionIssuedAt
  }, {
    AccountModel,
    buildClaims: async () => [claim, { id: 'org-b', authorization: {} }],
    now
  })

  assert.equal(identity.sub, account.sub)
  assert.equal(identity.email_verified, true)
  assert.deepEqual(identity.organizations, [claim])
  assert.deepEqual(identity.current_organization, claim)
  assert.deepEqual(identity.product_permissions, claim.authorization.permissionsByApp)
})

test('fails closed when canonical Identity membership was revoked', async () => {
  await assert.rejects(
    resolveWorkspaceAutomationAccess({
      subject: 'identity-subject-1',
      organizationId: 'org-a',
      sessionIat: sessionIssuedAt
    }, {
      AccountModel,
      buildClaims: async () => [],
      now
    }),
    (error) => error.status === 403 && error.code === 'IDENTITY_ACCESS_REVOKED'
  )
})

test('fails closed for an unverified Identity account', async () => {
  const UnverifiedAccountModel = {
    findOne: () => ({
      select: () => ({ lean: async () => ({ ...account, emailVerified: false }) })
    })
  }
  await assert.rejects(
    resolveWorkspaceAutomationAccess({
      subject: 'identity-subject-1',
      organizationId: 'org-a',
      sessionIat: sessionIssuedAt
    }, {
      AccountModel: UnverifiedAccountModel,
      buildClaims: async () => assert.fail('claims must not build'),
      now
    }),
    (error) => error.status === 403 && error.code === 'IDENTITY_ACCESS_REVOKED'
  )
})

test('embedded editor access rejects missing, future, and centrally revoked Identity sessions', async () => {
  const claimsMustNotBuild = async () => assert.fail('revoked sessions must not build claims')
  for (const invalidIssuedAt of [undefined, 'not-a-number', sessionIssuedAt + 120]) {
    await assert.rejects(
      resolveWorkspaceAutomationAccess({
        subject: account.sub,
        organizationId: 'org-a',
        sessionIat: invalidIssuedAt
      }, { AccountModel, buildClaims: claimsMustNotBuild, now }),
      (error) => error.status === 401 && error.code === 'N8N_IDENTITY_SESSION_INVALID'
    )
  }

  const RevokedAccountModel = {
    findOne: () => ({
      select: () => ({
        lean: async () => ({
          ...account,
          security: { sessionInvalidBefore: new Date(sessionIssuedAt * 1000) }
        })
      })
    })
  }
  await assert.rejects(
    resolveWorkspaceAutomationAccess({
      subject: account.sub,
      organizationId: 'org-a',
      sessionIat: sessionIssuedAt
    }, { AccountModel: RevokedAccountModel, buildClaims: claimsMustNotBuild, now }),
    (error) => error.status === 401 && error.code === 'N8N_IDENTITY_SESSION_REVOKED'
  )
})

test('delegated token access requires the exact n8n OAuth client and rebuilds current claims', async () => {
  const claim = { id: 'org-a', authorization: { permissionsByApp: { 'automation-hub': ['automations.read'] } } }
  const identity = await resolveWorkspaceAutomationTokenAccess({
    accessToken: 'opaque-n8n-token',
    organizationId: 'org-a'
  }, {
    findAccessToken: async (token) => {
      assert.equal(token, 'opaque-n8n-token')
      return { accountId: account.sub, clientId: N8N_WORKSPACE_NODE_CLIENT_ID, isExpired: false }
    },
    AccountModel,
    buildClaims: async () => [claim]
  })
  assert.equal(identity.sub, account.sub)
  assert.deepEqual(identity.current_organization, claim)
})

test('delegated token access rejects a token issued to another Seemplify client', async () => {
  await assert.rejects(
    resolveWorkspaceAutomationTokenAccess({
      accessToken: 'workspace-session-token',
      organizationId: 'org-a'
    }, {
      findAccessToken: async () => ({
        accountId: account.sub,
        clientId: 'messaging',
        isExpired: false
      }),
      AccountModel,
      buildClaims: async () => assert.fail('wrong-client tokens must not build claims')
    }),
    (error) => error.status === 403 && error.code === 'N8N_ACCESS_TOKEN_WRONG_CLIENT'
  )
})

test('delegated token access rejects missing and expired opaque tokens', async () => {
  await assert.rejects(
    resolveWorkspaceAutomationTokenAccess({ accessToken: '', organizationId: 'org-a' }),
    (error) => error.status === 401 && error.code === 'N8N_ACCESS_TOKEN_INVALID'
  )
  await assert.rejects(
    resolveWorkspaceAutomationTokenAccess({
      accessToken: 'expired-n8n-token',
      organizationId: 'org-a'
    }, {
      findAccessToken: async () => ({
        accountId: account.sub,
        clientId: N8N_WORKSPACE_NODE_CLIENT_ID,
        isExpired: true
      })
    }),
    (error) => error.status === 401 && error.code === 'N8N_ACCESS_TOKEN_INVALID'
  )
})

const protectedOrganizationClaim = (overrides = {}) => ({
  id: 'org-a',
  role: 'admin',
  appAccess: { mode: 'all', appIds: [] },
  authorization: {
    schemaVersion: 3,
    policyRevision: 11,
    organizationRevision: 7,
    roleKeys: ['organization_admin'],
    permissionsByApp: {
      messaging: ['boards.manage', 'messages.read'],
      'leave-management': ['approve_leaves'],
      'payroll-management': ['payrollrun:approve'],
    },
  },
  ...overrides,
})

const resolveProtected = (actionId, claim = protectedOrganizationClaim()) => (
  resolveWorkspaceProtectedApproverAccess({
    subject: account.sub,
    organizationId: 'org-a',
    actionId,
  }, {
    AccountModel,
    buildClaims: async () => [claim],
  })
)

test('protected approver action contract is explicit and closed', () => {
  assert.deepEqual(WORKSPACE_PROTECTED_APPROVER_AUTHORIZATION, {
    'boards.board.archive': [{ productId: 'messaging', permissions: ['boards.manage'] }],
    'leave.record_decision': [{ productId: 'leave-management', permissions: ['approve_leaves'] }],
    'payroll.finalize_run': [{ productId: 'payroll-management', permissions: ['payrollrun:approve'] }],
    'time.block_expected_absence': [{ productId: 'leave-management', permissions: ['approve_leaves'] }],
  })
})

test('protected approver access returns only exact current authorization without profile disclosure', async () => {
  const approver = await resolveProtected('boards.board.archive')

  assert.deepEqual(approver, {
    subject: account.sub,
    organizationId: 'org-a',
    actionId: 'boards.board.archive',
    status: 'active',
    role: 'admin',
    appAccess: { mode: 'all', appIds: [] },
    authorization: {
      schemaVersion: 3,
      policyRevision: 11,
      organizationRevision: 7,
      permissionsByApp: { messaging: ['boards.manage'] },
    },
  })
  assert.equal('email' in approver, false)
  assert.equal('name' in approver, false)
  assert.equal('profile' in approver, false)
  assert.equal('targetInput' in approver, false)
})

test('protected approver access allows an exact selected product without Messaging access', async () => {
  const approver = await resolveProtected('leave.record_decision', protectedOrganizationClaim({
    appAccess: { mode: 'selected', appIds: ['leave-management'] },
  }))

  assert.deepEqual(approver.appAccess, {
    mode: 'selected',
    appIds: ['leave-management'],
  })
  assert.deepEqual(approver.authorization.permissionsByApp, {
    'leave-management': ['approve_leaves'],
  })
})

test('protected approver access denies an absent selected product', async () => {
  await assert.rejects(
    resolveProtected('leave.record_decision', protectedOrganizationClaim({
      appAccess: { mode: 'selected', appIds: ['payroll-management'] },
    })),
    (error) => error.status === 403 && error.code === 'N8N_APPROVER_ACCESS_REVOKED',
  )
})

test('protected approver access denies a missing exact checker permission', async () => {
  await assert.rejects(
    resolveProtected('payroll.finalize_run', protectedOrganizationClaim({
      authorization: {
        ...protectedOrganizationClaim().authorization,
        permissionsByApp: { 'payroll-management': ['payrollrun:view'] },
      },
    })),
    (error) => error.status === 403 && error.code === 'N8N_APPROVER_ACCESS_REVOKED',
  )
})

test('protected approver access rejects unknown actions before querying Identity', async () => {
  let queried = false
  await assert.rejects(
    resolveWorkspaceProtectedApproverAccess({
      subject: account.sub,
      organizationId: 'org-a',
      actionId: 'payroll.unknown',
    }, {
      AccountModel: { findOne: () => { queried = true } },
      buildClaims: async () => [],
    }),
    (error) => error.status === 400 && error.code === 'N8N_APPROVER_CONTEXT_INVALID',
  )
  assert.equal(queried, false)
})

test('protected approver access fails closed when canonical membership is missing or inactive', async () => {
  await assert.rejects(
    resolveWorkspaceProtectedApproverAccess({
      subject: account.sub,
      organizationId: 'org-a',
      actionId: 'boards.board.archive',
    }, {
      AccountModel,
      buildClaims: async () => [],
    }),
    (error) => error.status === 403 && error.code === 'IDENTITY_ACCESS_REVOKED',
  )
})

test('protected approver access fails closed for an unverified Identity account', async () => {
  const UnverifiedAccountModel = {
    findOne: () => ({
      select: () => ({ lean: async () => ({ ...account, emailVerified: false }) }),
    }),
  }
  await assert.rejects(
    resolveWorkspaceProtectedApproverAccess({
      subject: account.sub,
      organizationId: 'org-a',
      actionId: 'boards.board.archive',
    }, {
      AccountModel: UnverifiedAccountModel,
      buildClaims: async () => assert.fail('unverified accounts must not build claims'),
    }),
    (error) => error.status === 403 && error.code === 'IDENTITY_ACCESS_REVOKED',
  )
})

test('protected approver access fails closed on incomplete or invalid revisions', async () => {
  for (const [field, value] of [
    ['schemaVersion', 0],
    ['policyRevision', 1.5],
    ['organizationRevision', 'invalid'],
  ]) {
    await assert.rejects(
      resolveProtected('boards.board.archive', protectedOrganizationClaim({
        authorization: { ...protectedOrganizationClaim().authorization, [field]: value },
      })),
      (error) => error.status === 503 && error.code === 'N8N_APPROVER_PROJECTION_UNAVAILABLE',
      `${field} must fail closed`,
    )
  }
})

test('protected approver access fails closed on a missing or unrecognized role', async () => {
  for (const role of ['', 'external']) {
    await assert.rejects(
      resolveProtected('boards.board.archive', protectedOrganizationClaim({ role })),
      (error) => error.status === 503 && error.code === 'N8N_APPROVER_PROJECTION_UNAVAILABLE',
      `role ${role || '(missing)'} must fail closed`,
    )
  }
})

test('protected approver access fails closed on malformed app access projection', async () => {
  for (const appAccess of [undefined, { mode: 'unknown', appIds: [] }, { mode: 'selected' }]) {
    await assert.rejects(
      resolveProtected('boards.board.archive', protectedOrganizationClaim({ appAccess })),
      (error) => error.status === 503 && error.code === 'N8N_APPROVER_PROJECTION_UNAVAILABLE',
    )
  }
})

test('protected approver access fails closed on a cross-organization projection', async () => {
  await assert.rejects(
    resolveProtected('boards.board.archive', protectedOrganizationClaim({ id: 'org-b' })),
    (error) => error.status === 403 && error.code === 'IDENTITY_ACCESS_REVOKED',
  )
})

test('protected approver access fails closed on a mismatched canonical subject', async () => {
  const MismatchedAccountModel = {
    findOne: () => ({
      select: () => ({ lean: async () => ({ ...account, sub: 'different-subject' }) }),
    }),
  }
  await assert.rejects(
    resolveWorkspaceProtectedApproverAccess({
      subject: account.sub,
      organizationId: 'org-a',
      actionId: 'boards.board.archive',
    }, {
      AccountModel: MismatchedAccountModel,
      buildClaims: async () => [protectedOrganizationClaim()],
    }),
    (error) => error.status === 403 && error.code === 'N8N_APPROVER_ACCESS_REVOKED',
  )
})
