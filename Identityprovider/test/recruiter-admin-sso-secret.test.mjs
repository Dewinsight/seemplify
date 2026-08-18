import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveRecruiterAdminSsoSecret } from '../src/services/recruiterAdminSsoService.js'

test('uses the registered recruiter client credential before a generic OIDC fallback', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-recruiter-sso-'))
  const clientsConfigPath = path.join(temporaryDirectory, 'clients.json')

  try {
    fs.writeFileSync(clientsConfigPath, JSON.stringify({
      clients: [{
        client_id: 'smarthr-backend',
        client_secret: 'registered-recruiter-secret'
      }]
    }))

    const secret = resolveRecruiterAdminSsoSecret({
      env: {
        OIDC_CLIENT_SECRET: 'unrelated-generic-secret'
      },
      clientsConfigPath
    })

    assert.equal(secret, 'registered-recruiter-secret')
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

test('uses an explicit dedicated SSO secret when configured', () => {
  const secret = resolveRecruiterAdminSsoSecret({
    env: {
      RECRUITER_ADMIN_SSO_SECRET: 'dedicated-sso-secret',
      OIDC_CLIENT_SECRET: 'generic-secret'
    },
    clientsConfigPath: 'missing-clients-config.json',
    logger: { warn() {} }
  })

  assert.equal(secret, 'dedicated-sso-secret')
})

test('uses the generic OIDC secret only when dedicated and registered secrets are unavailable', () => {
  const secret = resolveRecruiterAdminSsoSecret({
    env: {
      OIDC_CLIENT_SECRET: 'generic-secret'
    },
    clientsConfigPath: 'missing-clients-config.json',
    logger: { warn() {} }
  })

  assert.equal(secret, 'generic-secret')
})
