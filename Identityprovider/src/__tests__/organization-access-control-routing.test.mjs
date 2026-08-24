import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const routerPath = fileURLToPath(new URL('../routes/organizationAccessControl.js', import.meta.url))

test('access-control middleware is scoped and cannot intercept sibling organization APIs', async () => {
  const source = await readFile(routerPath, 'utf8')

  assert.match(
    source,
    /organizationAccessControlApi\.use\('\/:orgId\/access-control',\s*requireAuth,\s*requireSameOriginMutation,\s*rateLimit/s
  )
  assert.doesNotMatch(source, /organizationAccessControlApi\.use\(requireAuth\)/)
})
