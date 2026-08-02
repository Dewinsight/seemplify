const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'lib', 'platformFeatures.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const loadedModule = { exports: {} };
new Function('exports', 'module', transpiled.outputText)(loadedModule.exports, loadedModule);

const {
  DEFAULT_PLATFORM_FEATURES,
  getFeatureForPath,
  normalizePlatformFeatures,
} = loadedModule.exports;

test('platform features default to enabled when settings are absent or partial', () => {
  assert.deepEqual(normalizePlatformFeatures(), DEFAULT_PLATFORM_FEATURES);
  assert.deepEqual(normalizePlatformFeatures({ aiInterviews: false }), {
    ...DEFAULT_PLATFORM_FEATURES,
    aiInterviews: false,
  });
});

test('controlled recruiter and candidate routes map to their platform features', () => {
  assert.equal(getFeatureForPath('/ai-interviews'), 'aiInterviews');
  assert.equal(getFeatureForPath('/ai-interviews/123/edit'), 'aiInterviews');
  assert.equal(getFeatureForPath('/public/ai-interview/token'), 'aiInterviews');
  assert.equal(getFeatureForPath('/assistant'), 'aiAssistant');
  assert.equal(getFeatureForPath('/test-ai-matching'), 'aiAssistant');
  assert.equal(getFeatureForPath('/bulk-upload/history'), 'bulkCvUpload');
  assert.equal(getFeatureForPath('/people-transitions/offboarding'), 'peopleTransitions');
  assert.equal(getFeatureForPath('/onboarding/candidate'), 'peopleTransitions');
  assert.equal(getFeatureForPath('/my-documents/packet-id'), 'peopleTransitions');
  assert.equal(getFeatureForPath('/jobs'), null);
  assert.equal(getFeatureForPath('/assistant-tools'), null);
});
