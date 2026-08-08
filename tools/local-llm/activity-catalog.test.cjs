const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ACTIVITY_DEFINITIONS, localProviderLabel } = require('./activity-catalog.cjs');

test('the service owns its activity catalogue without importing a client application', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gateway.cjs'), 'utf8');
  assert.equal(ACTIVITY_DEFINITIONS['candidate.cv_parse'].reasoningEffort, 'medium');
  assert.equal(ACTIVITY_DEFINITIONS['job.description'].reasoningEffort, 'high');
  assert.equal(ACTIVITY_DEFINITIONS['performance.appraisal'].reasoningEffort, 'high');
  assert.equal(localProviderLabel('local-claude', 'sonnet'), 'Claude Code: sonnet');
  assert.doesNotMatch(source, /recruiter[\\/]backend[\\/]config[\\/]aiRuntimeCatalog/);
});
