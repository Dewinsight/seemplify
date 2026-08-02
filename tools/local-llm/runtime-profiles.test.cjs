const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  RUNTIME_PROFILE_DEFINITIONS,
  RUNTIME_PROFILE_IDS,
  defaultApplicationDefaults,
  isRuntimeProfile,
  mergeApplicationDefaults,
  runtimeProfileForActivity,
  runtimeProfileFromStatusInput
} = require('./runtime-profiles.cjs');

test('Experience Management is the only application profile and defaults to Terra local-cloud', () => {
  assert.deepEqual(RUNTIME_PROFILE_IDS, ['experience-management']);
  assert.deepEqual(defaultApplicationDefaults(), {
    experienceManagement: { engine: 'codex', model: 'gpt-5.6-terra' }
  });
  assert.equal(RUNTIME_PROFILE_DEFINITIONS['experience-management'].stateKey, 'experienceManagement');
  assert.equal(isRuntimeProfile('EXPERIENCE-MANAGEMENT'), true);
  assert.equal(isRuntimeProfile('xplorer'), false);
  assert.equal(isRuntimeProfile('unregistered-product'), false);
});

test('the scheduler infers the Experience profile for every Experience activity', () => {
  assert.equal(runtimeProfileForActivity('experience.analyst_chat'), 'experience-management');
  assert.equal(runtimeProfileForActivity('experience.assistant.email_summarise'), 'experience-management');
  assert.equal(runtimeProfileForActivity('recruiter.general'), '');
  assert.equal(runtimeProfileForActivity('xplorer.assistant.email_draft'), '');
});

test('saved application defaults retain only registered profiles', () => {
  assert.deepEqual(mergeApplicationDefaults({
    experienceManagement: { engine: 'ollama', model: 'approved-model' },
    xplorer: { engine: 'codex', model: 'must-be-dropped' },
    arbitrary: { engine: 'codex', model: 'must-also-be-dropped' }
  }), {
    experienceManagement: { engine: 'ollama', model: 'approved-model' }
  });
});

test('signed status profile selection accepts only Experience Management', () => {
  assert.equal(runtimeProfileFromStatusInput({ runtimeProfile: ' EXPERIENCE-MANAGEMENT ' }), 'experience-management');
  assert.equal(runtimeProfileFromStatusInput({ source: 'experience-management' }), 'experience-management');
  assert.equal(runtimeProfileFromStatusInput({ source: 'xplorer' }), '');
  assert.equal(runtimeProfileFromStatusInput({ source: 'health-harness' }), '');
  assert.equal(runtimeProfileFromStatusInput({ runtimeProfile: 'unknown' }), 'unknown');
});

test('the Windows runtime manager preserves and can update only the Experience profile', () => {
  const manager = fs.readFileSync(path.join(__dirname, 'manage.ps1'), 'utf8');
  assert.match(manager, /'set-experience-default'/);
  assert.match(manager, /experienceManagement = \[ordered\]@\{ engine='codex'; model=\$DefaultModels\.codex \}/);
  assert.match(manager, /'set-experience-default' \{/);
  assert.doesNotMatch(manager, /set-xplorer-default|applicationDefaults\.xplorer/);
});
