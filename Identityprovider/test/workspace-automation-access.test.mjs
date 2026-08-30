import assert from 'node:assert/strict'
import test from 'node:test'

import {
  N8N_WORKSPACE_NODE_CLIENT_ID,
  resolveWorkspaceAutomationAccess,
  resolveWorkspaceAutomationTokenAccess
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
    sessionIssuedAt
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
      sessionIssuedAt
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
      sessionIssuedAt
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
        sessionIssuedAt: invalidIssuedAt
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
      sessionIssuedAt
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
