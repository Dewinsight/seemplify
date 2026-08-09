const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const matchingPage = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'test-ai-matching', 'page.tsx'),
  'utf8'
)

test('matching test page recognizes active jobs and uses provider-neutral language', () => {
  assert.match(matchingPage, /\['active', 'open'\]\.includes/)
  assert.match(matchingPage, /Load Active Jobs/)
  assert.doesNotMatch(matchingPage, /job\.status === 'Open'/)
  assert.doesNotMatch(matchingPage, /Azure OpenAI embeddings/)
})
