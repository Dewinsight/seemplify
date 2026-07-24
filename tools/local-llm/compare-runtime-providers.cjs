const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const requireFromBackend = createRequire(path.join(repositoryRoot, 'recruiter', 'backend', 'package.json'));
const mongoose = requireFromBackend('mongoose');
const dotenv = requireFromBackend('dotenv');
dotenv.config({ path: path.join(repositoryRoot, 'recruiter', 'backend', '.env') });

const fixtures = require('../../recruiter/backend/tests/fixtures/aiRuntimeGoldenFixtures');
const {
  ACTIVITY_DEFINITIONS,
  DEFAULT_MODELS,
  GROQ_20B,
  GROQ_120B
} = require('../../recruiter/backend/config/aiRuntimeCatalog');
const {
  AIRuntimeService,
  signLocalRequest,
  stripReasoning
} = require('../../recruiter/backend/services/aiRuntime/aiRuntimeService');
const { evaluateOutput } = require('../../recruiter/backend/services/aiRuntime/evaluationHarness');
const {
  benchmarkErrorResult,
  compareProviderReports,
  evaluateBenchmarkResponse,
  runProvidersSequentially,
  summarizeResults
} = require('../../recruiter/backend/services/aiRuntime/providerComparisonHarness');
const {
  normalizeUsage,
  parseRateLimitHeaders,
  sanitizeMessage
} = require('../../recruiter/backend/services/aiRuntime/usageService');

const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const secretFile = path.join(runtimeDir, 'service-secret');
const gatewayUrl = String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const hasFlag = (name) => process.argv.includes(`--${name}`);
const runs = Math.max(1, Math.min(10, Number(argument('runs') || 1)));
const live = hasFlag('live');
const requestedFixtureIds = new Set(String(argument('fixtures') || '')
  .split(',').map((value) => value.trim()).filter(Boolean));
const selectedFixtures = requestedFixtureIds.size
  ? fixtures.filter((fixture) => requestedFixtureIds.has(fixture.id))
  : fixtures;
const requestedProviders = String(argument('providers') || 'local-codex,groq')
  .split(',').map((value) => value.trim()).filter(Boolean);
const unknownFixtureIds = [...requestedFixtureIds].filter(
  (id) => !fixtures.some((fixture) => fixture.id === id)
);
const unknownProviders = requestedProviders.filter(
  (provider) => !['local-codex', 'groq'].includes(provider)
);
const timeoutMs = Math.max(30_000, Math.min(10 * 60_000, Number(argument('timeout-ms') || 300_000)));
const normalizer = new AIRuntimeService();
const modelConfigs = new Map(DEFAULT_MODELS.map((model) => [model.id, model]));
const runId = `${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomBytes(4).toString('hex')}`;
const reportDir = path.join(runtimeDir, 'reports', 'provider-comparison', runId);
const comparisonReportRoot = path.join(runtimeDir, 'reports', 'provider-comparison');

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadResumeResults() {
  const requested = String(argument('resume-from') || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const results = new Map();
  const sources = [];
  for (const input of requested) {
    const file = path.resolve(repositoryRoot, input);
    const relative = path.relative(comparisonReportRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Resume artifacts must be inside .local-runtime/llm/reports/provider-comparison');
    }
    const report = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (report.mode !== 'live' || !['local-codex', 'groq'].includes(report.provider)) {
      throw new Error(`Resume artifact ${path.basename(file)} is not a live provider report`);
    }
    sources.push({ runId: report.runId, provider: report.provider, file });
    for (const result of report.results || []) {
      if (!result.success) continue;
      results.set(`${report.provider}:${result.fixture}:${result.run}`, {
        ...result,
        resumedFromRunId: report.runId
      });
    }
  }
  return { results, sources };
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function localSecret() {
  if (!fs.existsSync(secretFile)) return null;
  return fs.readFileSync(secretFile, 'utf8').trim() || null;
}

function groqModelForActivity(activity) {
  return String(activity).startsWith('ai_interview.chat.') ? GROQ_20B : GROQ_120B;
}

function routeFor(provider, fixture) {
  const definition = ACTIVITY_DEFINITIONS[fixture.activity] || {};
  const model = provider === 'groq' ? groqModelForActivity(fixture.activity) : 'gpt-5.6-terra';
  return {
    activity: fixture.activity,
    provider,
    model,
    reasoningEffort: definition.reasoningEffort || 'medium',
    routeVersion: 1,
    modelConfig: modelConfigs.get(model) || {
      pricing: { inputPerMillionUsd: 0, cachedInputPerMillionUsd: 0, outputPerMillionUsd: 0 }
    }
  };
}

function normalizedInput(fixture, messages = fixture.messages) {
  const input = {
    messages,
    temperature: 0.2,
    max_tokens: 2500
  };
  if (fixture.schema) {
    input.jsonSchema = fixture.schema;
    input.schemaName = `benchmark_${fixture.id}`.replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
    input.schemaStrict = !['candidate.cv_parse', 'ai_interview.cv_parse'].includes(fixture.activity);
    input.response_format = {
      type: 'json_schema',
      json_schema: {
        name: input.schemaName,
        strict: input.schemaStrict,
        schema: fixture.schema
      }
    };
  }
  return input;
}

function aggregateUsage(usages) {
  return usages.reduce((total, item) => {
    const usage = normalizeUsage(item);
    total.inputTokens += usage.inputTokens;
    total.cachedInputTokens += usage.cachedInputTokens;
    total.outputTokens += usage.outputTokens;
    total.reasoningTokens += usage.reasoningTokens;
    total.totalTokens += usage.totalTokens;
    return total;
  }, {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  });
}

function quotaSnapshot(headers) {
  const quota = parseRateLimitHeaders(headers);
  return {
    requestLimitDaily: quota.requestLimitDaily,
    requestRemainingDaily: quota.requestRemainingDaily,
    requestResetAt: quota.requestResetAt,
    tokenLimitMinute: quota.tokenLimitMinute,
    tokenRemainingMinute: quota.tokenRemainingMinute,
    tokenResetAt: quota.tokenResetAt,
    retryAfterMs: quota.retryAfterMs
  };
}

function providerError(payload, response, fallback) {
  const error = new Error(sanitizeMessage(
    payload?.error?.message || payload?.message || fallback || `Provider returned ${response.status}`
  ));
  error.code = String(payload?.error?.code || payload?.code || `HTTP_${response.status}`);
  error.status = response.status;
  error.retryable = response.status === 429 || response.status >= 500;
  error.quota = quotaSnapshot(response.headers);
  return error;
}

async function verifyTerra() {
  const secret = localSecret();
  if (!secret) throw new Error('Local gateway service secret is unavailable');
  const body = JSON.stringify({ operation: 'status' });
  const signature = signLocalRequest(secret, body);
  const response = await fetch(`${gatewayUrl}/v1/status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': signature.timestamp,
      'x-seemplify-nonce': signature.nonce,
      'x-seemplify-signature': signature.signature
    },
    body,
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await response.json();
  if (!response.ok) throw providerError(payload, response, 'Local gateway status failed');
  if (payload.engine !== 'codex' || payload.model !== 'gpt-5.6-terra') {
    throw new Error(`Terra benchmark requires codex / gpt-5.6-terra; active runtime is ${payload.engine || 'unknown'} / ${payload.model || 'unknown'}`);
  }
  return { secret, status: payload };
}

async function localCompletion({ fixture, route, messages, secret }) {
  const input = normalizedInput(fixture, messages);
  const normalized = normalizer.normalizePayload(input, route);
  const body = JSON.stringify({
    activity: fixture.activity,
    model: route.model,
    executionMode: 'local-only',
    messages,
    jsonSchema: fixture.schema,
    schemaName: input.schemaName,
    temperature: normalized.temperature,
    maxTokens: normalized.max_tokens,
    reasoningEffort: route.reasoningEffort,
    timeoutMs
  });
  const signature = signLocalRequest(secret, body);
  const endpoint = ['candidate.cv_parse', 'ai_interview.cv_parse'].includes(fixture.activity)
    ? '/v1/cv/analyze'
    : '/v1/complete';
  const response = await fetch(`${gatewayUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': signature.timestamp,
      'x-seemplify-nonce': signature.nonce,
      'x-seemplify-signature': signature.signature
    },
    body,
    signal: AbortSignal.timeout(timeoutMs + 30_000)
  });
  const payload = await response.json();
  if (!response.ok) throw providerError(payload, response, 'Terra completion failed');
  return {
    content: String(payload.content || ''),
    data: payload.data,
    usage: payload.usage || {},
    quota: null,
    model: payload.model || route.model
  };
}

async function loadGroqTransport() {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (apiKey) {
    return {
      source: 'environment',
      request: (payload) => fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      })
    };
  }
  if (!process.env.MONGO_URI) return null;
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  const runtime = require('../../recruiter/backend/services/aiRuntime/aiRuntimeService');
  const cache = new Map();
  return {
    source: 'encrypted-database',
    request: async (payload, model) => {
      let credential = cache.get(model);
      if (!credential) {
        credential = process.env.AI_EVAL_CREDENTIAL_ID
          ? await runtime.getCredential(process.env.AI_EVAL_CREDENTIAL_ID)
          : (await runtime.listEligibleCredentials({ model, modelConfig: modelConfigs.get(model) }))[0];
        if (!credential) throw new Error(`No healthy stored Groq credential can use ${model}`);
        cache.set(model, credential);
      }
      return runtime.providerRequest({ credential, payload, timeoutMs });
    }
  };
}

async function groqCompletion({ fixture, route, messages, transport }) {
  const input = normalizedInput(fixture, messages);
  const payload = normalizer.normalizePayload(input, route);
  const response = await transport.request(payload, route.model);
  const quota = quotaSnapshot(response.headers);
  const data = await response.json();
  if (!response.ok) throw providerError(data, response, 'Groq completion failed');
  const normalized = stripReasoning(data);
  return {
    content: String(normalized?.choices?.[0]?.message?.content || ''),
    usage: normalized?.usage || {},
    quota,
    model: normalized?.model || route.model
  };
}

function dryCompletion(fixture, route) {
  const data = fixture.responseMode === 'text' ? undefined : fixture.expectedOutput;
  return {
    content: fixture.responseMode === 'text'
      ? String(fixture.expectedOutput)
      : JSON.stringify(fixture.expectedOutput),
    data,
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    quota: null,
    model: route.model
  };
}

async function structuredCompletion({ fixture, route, complete }) {
  const usages = [];
  let messages = fixture.messages;
  let totalLatencyMs = 0;
  let lastQuota = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now();
    const response = await complete({ fixture, route, messages });
    totalLatencyMs += Date.now() - startedAt;
    usages.push(response.usage || {});
    lastQuota = response.quota || lastQuota;
    const evaluation = evaluateOutput(fixture, response);
    if (!fixture.schema || evaluation.validation.valid) {
      return {
        ...response,
        usage: aggregateUsage(usages),
        quota: lastQuota,
        latencyMs: totalLatencyMs,
        schemaRepairAttempted: attempt > 0
      };
    }
    if (attempt === 0) {
      messages = [
        ...fixture.messages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: `Return a corrected JSON object that matches the supplied schema. Validation issues: ${evaluation.validation.errors.slice(0, 12).join('; ')}`
        }
      ];
    }
  }
  const error = new Error('Provider output remained schema-invalid after one production-equivalent repair');
  error.code = 'AI_SCHEMA_VALIDATION_FAILED';
  error.schemaRepairAttempted = true;
  throw error;
}

async function runProvider(provider, resources) {
  const providerStartedAt = new Date().toISOString();
  const results = [];
  const activityModels = {};
  for (const fixture of selectedFixtures) {
    const route = routeFor(provider === 'local-codex' ? 'local-ollama' : 'groq', fixture);
    activityModels[fixture.activity] = route.model;
    for (let run = 1; run <= runs; run += 1) {
      const resumed = resources.resumeResults.get(`${provider}:${fixture.id}:${run}`);
      if (resumed) {
        results.push(resumed);
        continue;
      }
      const startedAt = Date.now();
      try {
        const complete = live
          ? provider === 'local-codex'
            ? (input) => localCompletion({ ...input, secret: resources.local.secret })
            : (input) => groqCompletion({ ...input, transport: resources.groq })
          : ({ fixture: item, route: itemRoute }) => dryCompletion(item, itemRoute);
        const response = await structuredCompletion({ fixture, route, complete });
        results.push(evaluateBenchmarkResponse({
          fixture,
          provider,
          model: response.model || route.model,
          run,
          response,
          latencyMs: response.latencyMs,
          pricing: route.modelConfig.pricing,
          quota: response.quota
        }));
      } catch (error) {
        results.push(benchmarkErrorResult({
          fixture,
          provider,
          model: route.model,
          run,
          latencyMs: Date.now() - startedAt,
          error
        }));
      }
    }
  }
  return {
    runId,
    mode: live ? 'live' : 'synthetic-dry-run',
    provider,
    model: provider === 'local-codex' ? 'gpt-5.6-terra' : 'production-configured-by-activity',
    activityModels,
    startedAt: providerStartedAt,
    completedAt: new Date().toISOString(),
    sequential: true,
    runsPerFixture: runs,
    fixtureCount: selectedFixtures.length,
    results,
    summary: summarizeResults(results)
  };
}

function markdownSummary(report) {
  const lines = [
    '# Terra vs Groq provider comparison',
    '',
    `- Run: ${report.runId}`,
    `- Mode: ${report.mode}`,
    '- Execution: strictly sequential; providers were never active at the same time',
    `- Fixtures: ${report.fixtureCount}`,
    `- Repetitions per fixture: ${report.runsPerFixture}`,
    '',
    '| Activity | Recommendation | Confidence | Reason |',
    '| --- | --- | --- | --- |'
  ];
  if (!report.comparison.activities.length) {
    lines.push(
      `| n/a | no live recommendation | n/a | ${report.comparison.caveat} |`
    );
  }
  for (const item of report.comparison.activities) {
    lines.push(`| ${item.activity} | ${item.recommendation} | ${item.confidence || 'n/a'} | ${item.reason || 'No provider passed all gates.'} |`);
  }
  lines.push('', 'Quality gates are applied before speed. A provider must reach at least 95% success, 100% schema validity on successful responses, 100% grounding, and zero hallucination/policy failures.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  if (!selectedFixtures.length) throw new Error('No benchmark fixtures were selected');
  if (unknownFixtureIds.length) throw new Error(`Unknown fixture ids: ${unknownFixtureIds.join(', ')}`);
  if (unknownProviders.length) throw new Error(`Unknown providers: ${unknownProviders.join(', ')}`);
  if (new Set(requestedProviders).size !== requestedProviders.length) throw new Error('Duplicate providers are not allowed');
  fs.mkdirSync(reportDir, { recursive: true });

  const manifest = {
    runId,
    generatedAt: new Date().toISOString(),
    mode: live ? 'live' : 'synthetic-dry-run',
    sequential: true,
    simultaneousProvidersAllowed: false,
    fixtureSource: 'recruiter/backend/tests/fixtures/aiRuntimeGoldenFixtures.js',
    productionNormalization: 'AIRuntimeService.normalizePayload',
    productionRepairAttempts: 1,
    providers: requestedProviders,
    resumeSources: [],
    runsPerFixture: runs,
    fixtures: selectedFixtures.map((fixture) => ({
      id: fixture.id,
      activity: fixture.activity,
      promptSha256: stableHash(fixture.messages),
      schemaSha256: fixture.schema ? stableHash(fixture.schema) : null
    }))
  };
  const resume = loadResumeResults();
  manifest.resumeSources = resume.sources;
  atomicJson(path.join(reportDir, 'manifest.json'), manifest);

  const resources = { local: null, groq: null, resumeResults: resume.results };
  if (live && requestedProviders.includes('local-codex')) resources.local = await verifyTerra();
  if (live && requestedProviders.includes('groq')) resources.groq = await loadGroqTransport();

  const runnableProviders = requestedProviders.filter((provider) => {
    if (provider === 'groq' && live && !resources.groq) return false;
    return true;
  });
  const providerReports = await runProvidersSequentially({
    providers: runnableProviders,
    runProvider: (provider) => runProvider(provider, resources),
    onProviderComplete: async (report) => {
      atomicJson(path.join(reportDir, `${report.provider}.json`), report);
      process.stdout.write(`${JSON.stringify({
        provider: report.provider,
        model: report.model,
        completed: true,
        runs: report.summary.runs,
        successes: report.summary.successes,
        averageQuality: report.summary.averageQuality,
        p50LatencyMs: report.summary.latencyMs.p50
      })}\n`);
    }
  });
  for (const provider of requestedProviders.filter((item) => !runnableProviders.includes(item))) {
    const skipped = {
      runId,
      mode: live ? 'live' : 'synthetic-dry-run',
      provider,
      skipped: true,
      reason: 'No local GROQ_API_KEY or MONGO_URI-backed encrypted credential was available. No secret was read or printed.',
      summary: summarizeResults([])
    };
    providerReports.push(skipped);
    atomicJson(path.join(reportDir, `${provider}.json`), skipped);
  }
  const comparableReports = providerReports.filter((report) => !report.skipped);
  const comparisonRequested = requestedProviders.includes('local-codex')
    && requestedProviders.includes('groq');
  const completeComparison = live && comparisonRequested && comparableReports.length === 2;
  const report = {
    ...manifest,
    completedAt: new Date().toISOString(),
    fixtureCount: selectedFixtures.length,
    providerArtifacts: providerReports.map((provider) => ({
      provider: provider.provider,
      file: `${provider.provider}.json`,
      skipped: Boolean(provider.skipped)
    })),
    liveEvidence: live,
    comparison: live && completeComparison
      ? compareProviderReports(comparableReports)
      : {
          activities: [],
          caveat: live
            ? 'Both Terra and Groq live evidence are required before the harness will rank providers.'
            : 'Synthetic dry mode validates schemas, scoring, artifact isolation, and sequencing; it cannot rank providers.'
        },
    completeComparison
  };
  atomicJson(path.join(reportDir, 'summary.json'), report);
  fs.writeFileSync(path.join(reportDir, 'summary.md'), markdownSummary(report), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    runId,
    mode: report.mode,
    completeComparison: report.completeComparison,
    reportDir,
    providers: report.providerArtifacts
  })}\n`);
  if (live && comparisonRequested && !report.completeComparison) process.exitCode = 2;
}

main()
  .catch((error) => {
    process.stderr.write(`${sanitizeMessage(error.stack || error.message)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
