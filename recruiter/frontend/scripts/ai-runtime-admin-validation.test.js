const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'lib', 'aiRuntimeAdminValidation.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'admin', 'ai-runtime', 'page.tsx'), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
});
const loadedModule = { exports: {} };
new Function('exports', 'module', transpiled.outputText)(loadedModule.exports, loadedModule);

const {
  containsGroqApiKey,
  normalizeQuotaGroupId,
  validateCredentialDraft,
  validateQuotaGroupDraft
} = loadedModule.exports;

const groups = [{ id: 'groq-primary', label: 'Groq primary organization', enabled: true }];

test('normalizes generated quota group identifiers', () => {
  assert.equal(normalizeQuotaGroupId(' EU Backup / Paid '), 'eu-backup-paid');
});

test('blocks API keys from quota group labels', () => {
  const result = validateQuotaGroupDraft({ label: `gsk_${'x'.repeat(30)}`, confirmed: true }, groups);
  assert.equal(result.ok, false);
  assert.equal(result.field, 'label');
  assert.equal(containsGroqApiKey(result.message), false);
});

test('catches duplicate quota groups before an API request', () => {
  const result = validateQuotaGroupDraft({ label: 'Groq Primary', confirmed: true }, groups);
  assert.equal(result.ok, false);
  assert.match(result.message, /already exists/);
});

test('creates a safe generated quota group payload', () => {
  assert.deepEqual(
    validateQuotaGroupDraft({ label: 'EU paid organization', confirmed: true }, groups),
    {
      ok: true,
      value: {
        label: 'EU paid organization',
        id: 'eu-paid-organization',
        independentQuotaConfirmed: true
      }
    }
  );
});

test('requires credential quota groups to come from the dropdown options', () => {
  const result = validateCredentialDraft({
    label: 'Primary key',
    apiKey: `gsk_${'x'.repeat(30)}`,
    quotaGroup: 'free-text-group',
    projectLabel: '',
    priority: '100'
  }, groups);
  assert.equal(result.ok, false);
  assert.equal(result.field, 'quotaGroup');
});

test('credential setup exposes a quota-group dropdown and no free-text identifier', () => {
  assert.match(pageSource, /<Select value=\{credentialForm\.quotaGroup\}/);
  assert.match(pageSource, /Choose quota group/);
  assert.doesNotMatch(pageSource, /id="quota-id"/);
});

test('AI Runtime exposes the synthetic route test workflow', () => {
  assert.match(pageSource, /TabsTrigger value="test"/);
  assert.match(pageSource, /<Select value=\{testActivity\}/);
  assert.match(pageSource, /adminJson<RuntimeTestResult>\('\/api\/admin\/ai-runtime\/test'/);
  assert.match(pageSource, /Executed model/);
  assert.match(pageSource, /Request ID/);
});
