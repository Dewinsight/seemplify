import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('organization team listing accepts verified OAuth callers and retains membership enforcement', () => {
  const routeSource = fs.readFileSync(new URL('../src/routes/teams.js', import.meta.url), 'utf8')

  assert.match(routeSource, /import \{ requireAuthOrAPIToken \} from '\.\.\/middleware\/apiAuth\.js'/)
  assert.match(
    routeSource,
    /router\.get\('\/organizations\/:orgId\/teams',[\s\S]*?requireAuthOrAPIToken,[\s\S]*?requireOrganizationMember,/
  )
})
