const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTypeScript(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', ...relativePath.split('/')), 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const loaded = { exports: {} }
  new Function('exports', 'module', transpiled.outputText)(loaded.exports, loaded)
  return loaded.exports
}

const preferences = loadTypeScript('utils/aiActivityPreferences.ts')

test('model reasoning capabilities accept gateway strings and objects without duplicates', () => {
  assert.deepEqual(preferences.supportedReasoningEfforts({
    supportedReasoningEfforts: [
      'low',
      { reasoningEffort: 'high' },
      { reasoningEffort: 'high' },
      { reasoningEffort: 'unsupported' }
    ]
  }), ['low', 'high'])
})

test('a model without reported capabilities keeps every supported UI effort available', () => {
  assert.deepEqual(
    preferences.supportedReasoningEfforts({ supportedReasoningEfforts: [] }),
    ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  )
})

test('activity grouping and search use the labels returned by the runtime contract', () => {
  const activities = [
    { activity: 'job.description', app: 'recruiter', label: 'Job description generation', group: 'Jobs' },
    { activity: 'candidate.cv_parse', app: 'recruiter', label: 'Candidate CV parsing', group: 'Candidates' },
    { activity: 'job.requirements', app: 'recruiter', label: 'Job requirements generation', group: 'Jobs' },
    { activity: 'performance.okr.generate', app: 'performance', label: 'OKR generation', group: 'Jobs' }
  ]
  assert.deepEqual(
    preferences.groupAiActivities(activities).map(({ app, group, activities: items }) => [app, group, items.map((item) => item.activity)]),
    [
      ['recruiter', 'Jobs', ['job.description', 'job.requirements']],
      ['recruiter', 'Candidates', ['candidate.cv_parse']],
      ['performance', 'Jobs', ['performance.okr.generate']]
    ]
  )
  assert.equal(preferences.activityMatchesQuery(activities[1], 'cv'), true)
  assert.equal(preferences.activityMatchesQuery(activities[1], 'jobs'), false)
})

test('an override is custom when either field differs from inherited settings', () => {
  assert.equal(preferences.hasAiActivityOverride({ codexModel: null, reasoningEffort: null }), false)
  assert.equal(preferences.hasAiActivityOverride({ codexModel: 'gpt-5.6-terra', reasoningEffort: null }), true)
  assert.equal(preferences.hasAiActivityOverride({ codexModel: null, reasoningEffort: 'high' }), true)
})

test('usage UI labels a timestamp and never draws an estimated quota bar', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'chatgpt-plan-limits.tsx'), 'utf8')
  assert.match(source, /Last reported/)
  assert.match(source, /does not estimate a quota/)
  assert.doesNotMatch(source, /style=\{\{ width:/)
})

test('the activity UI exposes both inheritance levels and resolution provenance', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'components', 'settings', 'AiActivityPreferences.tsx'), 'utf8')
  assert.match(source, /Your account defaults/)
  assert.match(source, /Use inherited default/)
  assert.match(source, /Use each action&apos;s workspace default/)
  assert.match(source, /activity_override/)
  assert.match(source, /account_default/)
  assert.match(source, /admin_default/)
  assert.match(source, /not in live catalogue/)
})

test('connecting ChatGPT does not silently acknowledge data sharing', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'ChatGptConnectionGate.tsx'),
    'utf8'
  )
  assert.match(source, /if \(next\?\.status === "connected"\) setDeviceLogin\(null\)/)
  assert.doesNotMatch(source, /if \(next\?\.status === "connected"\) void acknowledgeConsent\(\)/)
  assert.doesNotMatch(source, /if \(login\.connected\) \{\s*await acknowledgeConsent\(\)/)
  assert.match(source, /data-testid="chatgpt-gate-enable"/)
  assert.match(source, /This agreement applies only to Recruiter/)
  assert.match(source, /Performance Management asks for consent separately/)
  assert.match(source, /Agree and continue/)
})

test('Recruiter settings describe consent as app scoped', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'settings', 'ai-account', 'page.tsx'),
    'utf8'
  )
  assert.match(source, /This consent applies only to Recruiter/)
  assert.match(source, /Performance Management asks separately/)
})
