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
  assert.match(pageSource, /Output contract/);
});

test('requests and routing expose full operational health', () => {
  assert.match(pageSource, /Overall AI totals/);
  assert.match(pageSource, /Filtered request totals/);
  assert.match(pageSource, /permanent daily rollups/);
  assert.match(pageSource, /retained 90-day window/);
  assert.match(pageSource, /Reasoning tokens/);
  assert.match(pageSource, /routingHealth/);
  assert.match(pageSource, /activities configured/);
  assert.match(pageSource, /routingHealth\.issues\.map/);
});

test('AI Runtime exposes managed local inference, model inventory, and its durable CV queue', () => {
  assert.match(pageSource, /TabsTrigger value="local"/);
  assert.match(pageSource, /CV parsing and question generation use the best available managed runtime/);
  assert.match(pageSource, /localRuntime\?\.cvLocalEligible/);
  assert.match(pageSource, /Codex CLI \(local-cloud\)/);
  assert.match(pageSource, /Local engines and models/);
  assert.match(pageSource, /Available in Control Center/);
  assert.match(pageSource, /route\.provider === 'groq' \? 'Groq' : 'Managed local'/);
  assert.match(pageSource, /Every \$\{localRuntime\?\.failover\?\.intervalMinutes \|\| 30\} minutes/);
  assert.match(pageSource, /\/api\/admin\/ai-runtime\/local\/health-check/);
  assert.match(pageSource, /Check and route now/);
  assert.match(pageSource, /\/api\/admin\/ai-runtime\/local\/queue\/\$\{paused \? 'pause' : 'resume'\}/);
});

test('credential removal is explicit, confirmed, and permission-aware', () => {
  assert.match(pageSource, /const canManageSecrets = canConfigure;/);
  assert.match(pageSource, /\n\s+Remove\n\s+<\/Button>/);
  assert.match(pageSource, /Remove Groq credential\?/);
  assert.match(pageSource, /erases its encrypted API key/);
  assert.match(pageSource, /disabled=\{!canManageSecrets \|\| busy === `revoke:/);
  assert.match(pageSource, /credentialAction\(credentialToRemove\._id, 'revoke'\)/);
  assert.doesNotMatch(pageSource, /window\.confirm\(/);
});
