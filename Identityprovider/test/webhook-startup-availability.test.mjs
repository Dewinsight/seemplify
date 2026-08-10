import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('production can import the webhook service before its root secret is configured', () => {
  const environment = { ...process.env, NODE_ENV: 'production' }
  delete environment.IDP_WEBHOOK_SECRET

  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "await import('./src/services/webhookService.js'); process.stdout.write('ready')"],
    {
      cwd: new URL('..', import.meta.url),
      env: environment,
      encoding: 'utf8'
    }
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'ready')
})

test('production webhook signing remains fail-closed without a strong root secret', async () => {
  const service = await import(`../src/services/webhookService.js?startup-guard=${Date.now()}`)
  assert.throws(
    () => service.resolveWebhookSecret({ NODE_ENV: 'production' }),
    /IDP_WEBHOOK_SECRET must be a rotated secret/
  )
})
