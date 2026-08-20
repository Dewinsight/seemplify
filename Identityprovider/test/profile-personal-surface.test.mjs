import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const viewUrl = new URL('../src/views/profile-personal.ejs', import.meta.url)
const indexUrl = new URL('../src/index.js', import.meta.url)
const routesUrl = new URL('../src/routes/profile.js', import.meta.url)

test('Identity personal information surface contains no payroll-owned journey steps', async () => {
  const [view, indexSource, routeSource] = await Promise.all([
    readFile(viewUrl, 'utf8'),
    readFile(indexUrl, 'utf8'),
    readFile(routesUrl, 'utf8'),
  ])

  assert.doesNotMatch(view, /Save and continue to dependents|payrollDependentsUrl|Employee setup progress/)
  assert.doesNotMatch(indexSource, /app\.get\('\/profile\/(?:banking|dependents)'/)
  assert.doesNotMatch(routeSource, /router\.put\('\/api\/profile\/(?:banking|dependents)'/)
  assert.match(view, /Save personal information/)
  assert.match(view, /Personal information saved\./)
})

test('all Identity personal information inputs opt into the shared form-control styles', async () => {
  const view = await readFile(viewUrl, 'utf8')
  const inputTags = view.match(/<input\b[^>]*>/g) || []

  assert.ok(inputTags.length > 0)
  for (const input of inputTags) {
    assert.match(input, /\btype="(?:text|date|tel|email)"/, `Missing explicit input type: ${input}`)
  }
})
