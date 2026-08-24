import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import ejs from 'ejs'

const templatePath = fileURLToPath(new URL('../views/subscription-required.ejs', import.meta.url))

async function render(overrides = {}) {
  return ejs.renderFile(templatePath, {
    appName: 'Leave Management',
    organization: { name: 'AIIN' },
    reasonMessage: 'We could not verify your subscription status. Please try again.',
    canRetryAccess: false,
    retryLaunchUrl: null,
    ...overrides
  })
}

test('active subscriptions get an app retry instead of another purchase prompt', async () => {
  const html = await render({
    canRetryAccess: true,
    retryLaunchUrl: '/launch/leave-management'
  })

  assert.match(html, /Your Plan Is Active/)
  assert.match(html, /Reopen the application to refresh your session/)
  assert.match(html, /href="\/launch\/leave-management"/)
  assert.match(html, />\s*Try Again\s*</)
  assert.doesNotMatch(html, />\s*View Plans\s*</)
})

test('inactive subscriptions retain the plan-selection recovery path', async () => {
  const html = await render()

  assert.match(html, /Subscription Required/)
  assert.match(html, /We could not verify your subscription status/)
  assert.match(html, /href="\/plans"/)
  assert.match(html, />\s*View Plans\s*</)
})
