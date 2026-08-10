import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('team removals and role changes commit with durable authorization invalidation', () => {
  const routeSource = fs.readFileSync(new URL('../src/routes/teams.js', import.meta.url), 'utf8')
  const modelSource = fs.readFileSync(new URL('../src/models/Team.js', import.meta.url), 'utf8')

  assert.match(routeSource, /event: 'team\.member\.removed'/)
  assert.match(routeSource, /event: 'team\.member\.role_changed'/)
  assert.equal((routeSource.match(/runAuthorizationMutationWithWebhook\(/g) || []).length, 2)
  assert.match(routeSource, /mutation: \(session\) => req\.team\.removeMember/)
  assert.match(routeSource, /mutation: \(session\) => req\.team\.updateMemberRole/)
  assert.doesNotMatch(routeSource, /notifyTeamMemberRemoved\(/)
  assert.doesNotMatch(routeSource, /notifyTeamRoleChanged\(/)

  assert.match(modelSource, /removeMember = async function\(accountId, options = \{\}\)/)
  assert.match(modelSource, /updateMemberRole = async function\(accountId, newRole, options = \{\}\)/)
  assert.match(modelSource, /session \? \{ session \} : undefined/)
})
