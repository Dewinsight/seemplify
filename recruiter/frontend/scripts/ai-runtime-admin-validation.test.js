const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'lib', 'aiRuntimeAdminValidation.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const streamSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'queueTelemetryStream.ts'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'admin', 'ai-runtime', 'page.tsx'), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
});
const streamTranspiled = ts.transpileModule(streamSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
});
const loadedModule = { exports: {} };
new Function('exports', 'module', transpiled.outputText)(loadedModule.exports, loadedModule);
const loadedStreamModule = { exports: {} };
new Function('exports', 'module', streamTranspiled.outputText)(loadedStreamModule.exports, loadedStreamModule);

const {
  containsGroqApiKey,
  normalizeQuotaGroupId,
  validateCredentialDraft,
  validateQuotaGroupDraft
} = loadedModule.exports;
const { parseServerSentEventBuffer } = loadedStreamModule.exports;

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
  assert.match(pageSource, /Executed provider/);
  assert.match(pageSource, /Executed model/);
  assert.match(pageSource, /Request ID/);
  assert.match(pageSource, /testResult\.execution\.usage\.inputTokens/);
  assert.match(pageSource, /testResult\.execution\.usage\.cachedInputTokens/);
  assert.match(pageSource, /testResult\.execution\.usage\.outputTokens/);
  assert.match(pageSource, /testResult\.execution\.usage\.reasoningTokens/);
  assert.match(pageSource, /testResult\.execution\.usage\.totalTokens/);
  assert.match(pageSource, /Output contract/);
});

test('activity audit filters every managed local provider and resets pagination with the range', () => {
  assert.match(pageSource, /SelectItem value="local-codex">Codex local-cloud<\/SelectItem>/);
  assert.match(pageSource, /SelectItem value="local-ollama">Ollama \(local GPU\)<\/SelectItem>/);
  assert.match(pageSource, /SelectItem value="local-vllm">vLLM \(local GPU\)<\/SelectItem>/);
  assert.match(pageSource, /setRange\(value as RangeKey\); setRequestPage\(1\);/);
});

test('overview shows provider and model token composition and follows live snapshots', () => {
  assert.match(pageSource, /function providerUsageLabel/);
  assert.match(pageSource, /model === 'gpt-5\.6-terra'\) return 'Terra \(Codex local-cloud\)'/);
  assert.match(pageSource, /return model \? `Codex local-cloud · \$\{model\}` : 'Codex local-cloud'/);
  assert.match(pageSource, /Earlier local-cloud records and direct benchmark runs cannot be reconstructed/);
  assert.match(pageSource, /formatAggregateTokens/);
  assert.match(pageSource, /providerUsageLabel\(provider\.id\)/);
  assert.match(pageSource, /providerUsageLabel\(request\.provider, request\.model\)/);
  assert.match(pageSource, /<TableHead>Token breakdown<\/TableHead>/);
  assert.match(pageSource, /row\.inputTokens/);
  assert.match(pageSource, /row\.cachedInputTokens/);
  assert.match(pageSource, /row\.outputTokens/);
  assert.match(pageSource, /row\.reasoningTokens/);
  assert.match(pageSource, /row\.averageLatencyMs/);
  assert.match(pageSource, /<TableHead>Recorded tokens<\/TableHead>/);
  assert.match(pageSource, /provider\.totalTokens/);
  assert.match(pageSource, /provider\.inputTokens/);
  assert.match(pageSource, /provider\.cachedInputTokens/);
  assert.match(pageSource, /provider\.outputTokens/);
  assert.match(pageSource, /provider\.reasoningTokens/);
  assert.match(pageSource, /liveSnapshotRevisionRef\.current \+= 1/);
  assert.match(pageSource, /context\.tab === 'requests' && context\.requestPage === 1/);
  assert.match(pageSource, /\}, 10_000\);/);
});

test('zero-token events distinguish explicit unmetered from legacy unknown', () => {
  assert.match(pageSource, /function formatRecordedTokens/);
  assert.match(pageSource, /'Not reported' : 'Unknown \(legacy\)'/);
  assert.match(pageSource, /formatRecordedTokens\(request\.meteringStatus, request\.totalTokens\)/);
  assert.match(pageSource, /formatRecordedTokens\(data\.meteringStatus, data\.totalTokens, data\.inputTokens\)/);
  assert.match(pageSource, /formatRecordedTokens\(data\.meteringStatus, data\.totalTokens\)/);
  assert.match(pageSource, /meteredExecutions/);
  assert.match(pageSource, /unmeteredExecutions/);
  assert.match(pageSource, /unknownMeteringExecutions/);
  assert.match(pageSource, /old zero token fields remain unknown, not measured zero/);
  assert.match(pageSource, /Token metering/);
  assert.match(pageSource, /Usage source/);
  assert.match(pageSource, /aggregated-request-events-partial' \? 'Partially reported'/);
});

test('unreported local state does not claim an engine, routability, or a starting worker', () => {
  assert.match(pageSource, /if \(!runtime\?\.reachable\) return 'Not reported';/);
  assert.match(pageSource, /if \(!runtime\.reachable\) return 'Unavailable';/);
  assert.match(pageSource, /\['Worker', localQueue\?\.worker\?\.running \? 'Running' : 'Stopped'\]/);
  assert.doesNotMatch(pageSource, /: 'Ollama \(local GPU\)'\],/);
  assert.doesNotMatch(pageSource, /\['Worker',[^\n]+: 'Starting'\]/);
  assert.doesNotMatch(pageSource, /: 'Available to all activities'/);
});

test('runtime controls and interactive table rows expose keyboard semantics', () => {
  assert.match(pageSource, /aria-label="Usage date range"/);
  assert.match(pageSource, /aria-label="Refresh runtime data"/);
  assert.match(pageSource, /aria-label="Filter AI activity by provider"/);
  assert.match(pageSource, /aria-label="Filter AI activity by status"/);
  assert.match(pageSource, /function activateTableRow/);
  assert.match(pageSource, /role="button" tabIndex=\{0\} aria-haspopup="dialog"/);
  assert.match(pageSource, /aria-label="Previous request page"/);
  assert.match(pageSource, /aria-label="Next audit page"/);
});

test('request filters do not fan out into the full runtime refresh', () => {
  assert.doesNotMatch(pageSource, /if \(tab === 'requests'\) await loadRequests\(\);/);
  assert.match(pageSource, /if \(tab !== 'requests'\) return;/);
  assert.doesNotMatch(pageSource, /StatusBadge status=\{liveConnection\}/);
  assert.match(pageSource, /StatusBadge status=\{connection\}/);
});

test('requests and routing expose full operational health', () => {
  assert.match(pageSource, /Overall AI totals/);
  assert.match(pageSource, /Filtered execution events/);
  assert.match(pageSource, /permanent per-request projection/);
  assert.match(pageSource, /daily attempt rollups/);
  assert.match(pageSource, /logicalCoverage/);
  assert.match(pageSource, /not inferred as logical requests/);
  assert.doesNotMatch(pageSource, /range === 'all' \? 'Execution events' : 'Logical requests'/);
  assert.match(pageSource, /retained 90-day window/);
  assert.match(pageSource, /Reasoning tokens/);
  assert.match(pageSource, /routingHealth/);
  assert.match(pageSource, /activities configured/);
  assert.match(pageSource, /routingHealth\.issues\.map/);
});

test('AI Runtime exposes managed local inference, model inventory, and its durable CV queue', () => {
  assert.match(pageSource, /TabsTrigger value="local"/);
  assert.match(pageSource, /CV parsing is locked to the selected managed runtime/);
  assert.match(pageSource, /CV jobs never fall back to Groq/);
  assert.match(pageSource, /localRuntime\?\.cvLocalEligible/);
  assert.match(pageSource, /Codex CLI \(local-cloud\)/);
  assert.match(pageSource, /Local engines and models/);
  assert.match(pageSource, /Available in Control Center/);
  assert.match(pageSource, /route\.provider === 'groq' \? 'Groq' : 'Managed local'/);
  assert.match(pageSource, /localRuntime\?\.failover\?\.intervalMinutes \? `Every \$\{localRuntime\.failover\.intervalMinutes\} minutes` : 'Not reported'/);
  assert.match(pageSource, /Gateway metering/);
  assert.match(pageSource, /localRuntime\?\.usageMetering/);
  assert.match(pageSource, /Metering backlog/);
  assert.match(pageSource, /Last meter delivery/);
  assert.match(pageSource, /\/api\/admin\/ai-runtime\/local\/health-check/);
  assert.match(pageSource, /Check and route now/);
  assert.match(pageSource, /\/api\/admin\/ai-runtime\/local\/queue\/\$\{paused \? 'pause' : 'resume'\}/);
  assert.match(pageSource, /\/api\/admin\/ai-runtime\/local\/queue\/stream/);
  assert.match(pageSource, /Live updates/);
  assert.match(pageSource, /Every 2 seconds/);
  assert.match(pageSource, /BullMQ counts are dispatch records/);
  assert.match(pageSource, /Recent jobs/);
});

test('AI Runtime exposes live cross-provider operations and clickable attributable audits', () => {
  assert.match(pageSource, /\/api\/admin\/ai-runtime\/live\/stream/);
  assert.match(pageSource, /All Groq and managed-local AI activity/);
  assert.match(pageSource, /Logical requests · 5 min/);
  assert.match(pageSource, /Execution events · 5 min/);
  assert.match(pageSource, /Logical requests count each request ID once/);
  assert.match(pageSource, /Separately recorded retries and failovers appear as distinct events/);
  assert.match(pageSource, /Hosted Redis metering outbox/);
  assert.match(pageSource, /Usage projection repair/);
  assert.match(pageSource, /Execution metering · 1 hour/);
  assert.match(pageSource, /meteringCoverageLabel\(provider\)/);
  assert.match(pageSource, /Provider health Â· 1 hour|Provider health · 1 hour/);
  assert.match(pageSource, /Activity audit/);
  assert.match(pageSource, /Search person, company, activity or request/);
  assert.match(pageSource, /openOperationalDetail\('request'/);
  assert.match(pageSource, /openOperationalDetail\('queue'/);
  assert.match(pageSource, /openOperationalDetail\('audit'/);
  assert.match(pageSource, /Uploader and company/);
  assert.match(pageSource, /Prompts, CV contents and provider credentials are not included/);
});

test('live queue parser handles snapshots, heartbeats, and partial frames', () => {
  const first = parseServerSentEventBuffer([
    ': keep-alive',
    '',
    'id: 1721851200000-1',
    'event: snapshot',
    'data: {"waiting":2}',
    '',
    'event: snapshot',
    'data: {"waiting":'
  ].join('\n'));
  assert.deepEqual(first.frames, [{ id: '1721851200000-1', event: 'snapshot', data: '{"waiting":2}' }]);
  assert.equal(first.remainder, 'event: snapshot\ndata: {"waiting":');

  const second = parseServerSentEventBuffer(`${first.remainder}3}\n\n`);
  assert.deepEqual(second.frames, [{ event: 'snapshot', data: '{"waiting":3}' }]);
  assert.equal(second.remainder, '');
  assert.match(pageSource, /headers\['Last-Event-ID'\] = liveEventIdRef\.current/);
  assert.match(pageSource, /headers\['Last-Event-ID'\] = queueEventIdRef\.current/);
  assert.match(pageSource, /sampledAt < queueSampledAtRef\.current/);
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
