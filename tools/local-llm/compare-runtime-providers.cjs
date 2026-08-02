const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const requireFromBackend = createRequire(path.join(repositoryRoot, 'recruiter', 'backend', 'package.json'));
const mongoose = requireFromBackend('mongoose');
const dotenv = requireFromBackend('dotenv');

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
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const hasFlag = (name) => process.argv.includes(`--${name}`);
const live = hasFlag('live');
if (live && require.main === module) {
  dotenv.config({ path: path.join(repositoryRoot, 'recruiter', 'backend', '.env') });
}
const gatewayUrl = String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
const boundedNumber = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
};
const runs = Math.floor(boundedNumber(argument('runs'), 1, 1, 10));
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
const timeoutMs = Math.floor(boundedNumber(argument('timeout-ms'), 300_000, 30_000, 10 * 60_000));
const BENCHMARK_CODE_VERSION = 2;
const BENCHMARK_TEMPERATURE = 0.2;
const BENCHMARK_MAX_TOKENS = 2500;
const BENCHMARK_REPAIR_ATTEMPTS = 1;
const quotaLimits = Object.freeze({
  tpm: boundedNumber(argument('groq-tpm') || process.env.AI_BENCHMARK_GROQ_TPM, 7200, 1, 8000),
  tpd: boundedNumber(argument('groq-tpd') || process.env.AI_BENCHMARK_GROQ_TPD, 180000, 1, 200000),
  rpm: boundedNumber(argument('groq-rpm') || process.env.AI_BENCHMARK_GROQ_RPM, 27, 1, 30),
  rpd: boundedNumber(argument('groq-rpd') || process.env.AI_BENCHMARK_GROQ_RPD, 900, 1, 1000),
  inputHeadroomPercent: boundedNumber(
    argument('groq-input-headroom-percent') || process.env.AI_BENCHMARK_GROQ_INPUT_HEADROOM_PERCENT,
    20,
    0,
    100
  )
});
const retryOptions = Object.freeze({
  maxAttempts: boundedNumber(argument('groq-retry-attempts'), 5, 1, 8),
  baseDelayMs: boundedNumber(argument('groq-backoff-ms'), 1000, 100, 60_000),
  jitterMs: boundedNumber(argument('groq-jitter-ms'), 250, 0, 5000)
});
const normalizer = new AIRuntimeService();
const modelConfigs = new Map(DEFAULT_MODELS.map((model) => [model.id, model]));
const runId = `${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomBytes(4).toString('hex')}`;
const reportDir = path.join(runtimeDir, 'reports', 'provider-comparison', runId);
const comparisonReportRoot = path.join(runtimeDir, 'reports', 'provider-comparison');
const groqQuotaLedgerFile = path.join(comparisonReportRoot, 'groq-quota-ledger.json');

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function utcDayKey(value = Date.now()) {
  return new Date(value).toISOString().slice(0, 10);
}

function nextUtcDay(value = Date.now()) {
  const current = new Date(value);
  return new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1
  ));
}

class DailyQuotaWaitError extends Error {
  constructor(message, { resumeAt, quota } = {}) {
    super(message);
    this.name = 'DailyQuotaWaitError';
    this.code = 'BENCHMARK_WAITING_FOR_DAILY_QUOTA';
    this.retryable = true;
    this.resumable = true;
    this.resumeAt = resumeAt ? new Date(resumeAt) : nextUtcDay();
    this.quota = quota || null;
  }
}

class GroqQuotaGovernor {
  constructor({
    file = groqQuotaLedgerFile,
    limits = quotaLimits,
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  } = {}) {
    this.file = file;
    this.limits = { ...quotaLimits, ...limits };
    this.now = now;
    this.sleep = sleep;
    this.state = this.loadState();
  }

  loadState() {
    const today = utcDayKey(this.now());
    const stored = readJson(this.file, null);
    if (!stored || stored.schemaVersion !== 1 || stored.utcDay !== today) {
      return {
        schemaVersion: 1,
        utcDay: today,
        attempts: [],
        lastProviderQuota: null,
        updatedAt: new Date(this.now()).toISOString()
      };
    }
    return {
      ...stored,
      attempts: Array.isArray(stored.attempts) ? stored.attempts : []
    };
  }

  refreshDay() {
    const today = utcDayKey(this.now());
    if (this.state.utcDay !== today) {
      this.state = {
        schemaVersion: 1,
        utcDay: today,
        attempts: [],
        lastProviderQuota: this.state.lastProviderQuota || null,
        updatedAt: new Date(this.now()).toISOString()
      };
      this.persist();
    }
  }

  persist() {
    this.state.updatedAt = new Date(this.now()).toISOString();
    atomicJson(this.file, {
      ...this.state,
      configuredLimits: this.limits
    });
  }

  effectiveLimits() {
    const provider = this.state.lastProviderQuota || {};
    const tokenLimit = Number(provider.tokenLimitMinute || 0);
    const requestLimit = Number(provider.requestLimitDaily || 0);
    return {
      ...this.limits,
      tpm: tokenLimit > 0 ? Math.min(this.limits.tpm, Math.floor(tokenLimit * 0.9)) : this.limits.tpm,
      rpd: requestLimit > 0 ? Math.min(this.limits.rpd, Math.floor(requestLimit * 0.9)) : this.limits.rpd
    };
  }

  usageSnapshot(nowMs = this.now()) {
    this.refreshDay();
    const minuteStart = nowMs - 60_000;
    const minuteAttempts = this.state.attempts.filter((attempt) => Number(attempt.at) > minuteStart);
    return {
      minuteTokens: minuteAttempts.reduce((sum, attempt) => sum + Number(attempt.tokens || 0), 0),
      minuteRequests: minuteAttempts.length,
      dayTokens: this.state.attempts.reduce((sum, attempt) => sum + Number(attempt.tokens || 0), 0),
      dayRequests: this.state.attempts.length,
      minuteAttempts
    };
  }

  async acquireInflightLock() {
    const lockFile = `${this.file}.inflight`;
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    while (true) {
      let descriptor;
      const lock = {
        id: crypto.randomUUID(),
        at: this.now(),
        pid: process.pid
      };
      try {
        descriptor = fs.openSync(lockFile, 'wx', 0o600);
        fs.writeFileSync(descriptor, JSON.stringify(lock), 'utf8');
        return { ...lock, descriptor, file: lockFile };
      } catch (error) {
        if (descriptor !== undefined) {
          try { fs.closeSync(descriptor); } catch {}
          try { fs.unlinkSync(lockFile); } catch {}
        }
        if (error.code !== 'EEXIST') throw error;
        let existing = {};
        try { existing = readJson(lockFile, {}); } catch {}
        const staleAt = Number(existing?.at || 0) + timeoutMs + 60_000;
        if (Number(existing?.at || 0) > 0 && staleAt <= this.now()) {
          try { fs.unlinkSync(lockFile); } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') throw unlinkError;
          }
          continue;
        }
        await this.sleep(250);
      }
    }
  }

  releaseInflightLock(lock) {
    if (!lock) return;
    try { fs.closeSync(lock.descriptor); } catch {}
    try {
      const existing = readJson(lock.file, {});
      if (existing?.id === lock.id) fs.unlinkSync(lock.file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async reserve({ estimatedInputTokens = 0, maxOutputTokens = 0 } = {}) {
    const inputHeadroom = 1 + (Number(this.limits.inputHeadroomPercent || 0) / 100);
    const tokens = Math.max(
      1,
      Math.ceil(Math.max(0, Number(estimatedInputTokens || 0)) * inputHeadroom)
        + Math.max(0, Number(maxOutputTokens || 0))
    );
    while (true) {
      const lock = await this.acquireInflightLock();
      try {
        const nowMs = this.now();
        this.state = this.loadState();
        const providerQuota = this.state.lastProviderQuota || {};
        const tokenResetAt = providerQuota.tokenResetAt ? new Date(providerQuota.tokenResetAt).getTime() : 0;
        const requestResetAt = providerQuota.requestResetAt ? new Date(providerQuota.requestResetAt).getTime() : 0;
        if (Number.isFinite(tokenResetAt) && tokenResetAt > 0 && tokenResetAt <= nowMs) {
          providerQuota.tokenRemainingMinute = null;
          providerQuota.tokenResetAt = null;
          this.persist();
        }
        if (Number.isFinite(requestResetAt) && requestResetAt > 0 && requestResetAt <= nowMs) {
          providerQuota.requestRemainingDaily = null;
          providerQuota.requestResetAt = null;
          this.persist();
        }
        const active = this.state.attempts.find((attempt) => !attempt.completedAt);
        if (active) {
          const staleAt = Number(active.at) + timeoutMs + 60_000;
          if (staleAt > nowMs) {
            this.releaseInflightLock(lock);
            await this.sleep(Math.max(25, Math.min(1000, staleAt - nowMs)));
            continue;
          }
          // A crashed process keeps its conservative token reservation, but it
          // must not block all future benchmark attempts forever.
          active.completedAt = new Date(nowMs).toISOString();
          active.recoveredAsStale = true;
          this.persist();
        }
        const limits = this.effectiveLimits();
        if (providerQuota.requestRemainingDaily != null && Number(providerQuota.requestRemainingDaily) === 0) {
          throw new DailyQuotaWaitError('Groq reports that the daily request quota is exhausted', {
            resumeAt: requestResetAt > nowMs ? new Date(requestResetAt) : nextUtcDay(nowMs),
            quota: providerQuota
          });
        }
        if (
          providerQuota.tokenRemainingMinute != null
          && Number.isFinite(Number(providerQuota.tokenRemainingMinute))
          && Number(providerQuota.tokenRemainingMinute) >= 0
          && tokens > Number(providerQuota.tokenRemainingMinute)
        ) {
          const waitMs = tokenResetAt > nowMs ? tokenResetAt - nowMs + 25 : 60_025;
          this.releaseInflightLock(lock);
          await this.sleep(waitMs);
          if (!(tokenResetAt > nowMs)) {
            this.state = this.loadState();
            if (this.state.lastProviderQuota) {
              this.state.lastProviderQuota.tokenRemainingMinute = null;
              this.persist();
            }
          }
          continue;
        }
        if (tokens > limits.tpm) {
          const error = new Error(`One Groq request reserves ${tokens} tokens, above the ${limits.tpm} TPM safety ceiling`);
          error.code = 'BENCHMARK_REQUEST_EXCEEDS_TPM';
          throw error;
        }
        const usage = this.usageSnapshot(nowMs);
        if (usage.dayTokens + tokens > limits.tpd || usage.dayRequests + 1 > limits.rpd) {
          throw new DailyQuotaWaitError('Groq benchmark reached its conservative daily quota ceiling', {
            resumeAt: nextUtcDay(nowMs),
            quota: this.state.lastProviderQuota
          });
        }
        if (usage.minuteTokens + tokens <= limits.tpm && usage.minuteRequests + 1 <= limits.rpm) {
          const reservation = {
            id: crypto.randomUUID(),
            at: nowMs,
            tokens,
            reservedTokens: tokens,
            reconciled: false
          };
          this.state.attempts.push(reservation);
          this.persist();
          return { ...reservation, inflightLock: lock };
        }
        const waitUntil = Math.min(...usage.minuteAttempts.map((attempt) => Number(attempt.at))) + 60_000;
        this.releaseInflightLock(lock);
        await this.sleep(Math.max(1, waitUntil - nowMs + 25));
      } catch (error) {
        this.releaseInflightLock(lock);
        throw error;
      }
    }
  }

  reconcile(reservation, { totalTokens, metered = false } = {}) {
    if (!reservation?.id) return;
    try {
      this.state = this.loadState();
      this.refreshDay();
      const stored = this.state.attempts.find((attempt) => attempt.id === reservation.id);
      if (!stored) return;
      if (metered && Number.isFinite(Number(totalTokens)) && Number(totalTokens) >= 0) {
        stored.tokens = Number(totalTokens);
        stored.reconciled = true;
      }
      stored.completedAt = new Date(this.now()).toISOString();
      this.persist();
    } finally {
      this.releaseInflightLock(reservation.inflightLock);
    }
  }

  observeQuota(quota) {
    if (!quota) return;
    this.state = this.loadState();
    this.refreshDay();
    this.state.lastProviderQuota = {
      requestLimitDaily: quota.requestLimitDaily,
      requestRemainingDaily: quota.requestRemainingDaily,
      requestResetAt: quota.requestResetAt,
      tokenLimitMinute: quota.tokenLimitMinute,
      tokenRemainingMinute: quota.tokenRemainingMinute,
      tokenResetAt: quota.tokenResetAt,
      observedAt: new Date(this.now()).toISOString()
    };
    this.persist();
  }

  snapshot() {
    const usage = this.usageSnapshot(this.now());
    return {
      utcDay: this.state.utcDay,
      limits: this.effectiveLimits(),
      minuteTokens: usage.minuteTokens,
      minuteRequests: usage.minuteRequests,
      dayTokens: usage.dayTokens,
      dayRequests: usage.dayRequests,
      lastProviderQuota: this.state.lastProviderQuota
    };
  }
}

function retryDelayMs(error, attempt, {
  now = () => Date.now(),
  random = Math.random,
  baseDelayMs = retryOptions.baseDelayMs,
  jitterMs = retryOptions.jitterMs
} = {}) {
  const quota = error?.quota || {};
  const tokenResetAt = quota.tokenResetAt ? new Date(quota.tokenResetAt).getTime() : 0;
  const resetDelay = Number.isFinite(tokenResetAt) ? Math.max(0, tokenResetAt - now()) : 0;
  const retryAfter = Math.max(0, Number(quota.retryAfterMs || 0));
  const backoff = baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.max(0, Number(jitterMs || 0)) * Math.max(0, Math.min(1, Number(random()) || 0)));
  return Math.max(retryAfter, resetDelay, backoff) + jitter;
}

async function executeWithRetry(operation, {
  maxAttempts = retryOptions.maxAttempts,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random = Math.random,
  baseDelayMs = retryOptions.baseDelayMs,
  jitterMs = retryOptions.jitterMs
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      error.providerAttempts = attempt;
      if (error instanceof DailyQuotaWaitError || error?.code === 'BENCHMARK_WAITING_FOR_DAILY_QUOTA') throw error;
      const quota = error?.quota || {};
      if (quota.requestRemainingDaily != null && Number(quota.requestRemainingDaily) === 0) {
        const requestResetAt = quota.requestResetAt ? new Date(quota.requestResetAt).getTime() : 0;
        throw new DailyQuotaWaitError('Groq reports that the daily request quota is exhausted', {
          resumeAt: requestResetAt > now() ? new Date(requestResetAt) : nextUtcDay(now()),
          quota
        });
      }
      const retryable = Boolean(error?.retryable || error?.status === 429 || error?.status >= 500);
      if (!retryable || attempt >= maxAttempts) throw error;
      await sleep(retryDelayMs(error, attempt, { now, random, baseDelayMs, jitterMs }));
    }
  }
  throw lastError;
}

function loadResumeResults({
  inputs = String(argument('resume-from') || '')
    .split(',').map((value) => value.trim()).filter(Boolean),
  expectedConfigSha256,
  maximumRun = runs
} = {}) {
  const requested = Array.isArray(inputs) ? inputs : String(inputs || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const results = new Map();
  const sources = [];
  const seen = new Set();
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
    if (!report.benchmarkConfigSha256 || report.benchmarkConfigSha256 !== expectedConfigSha256) {
      throw new Error(`Resume artifact ${path.basename(file)} does not match benchmarkConfigSha256`);
    }
    sources.push({ runId: report.runId, provider: report.provider, file });
    for (const result of report.results || []) {
      const fixture = fixtures.find((item) => item.id === result.fixture);
      if (!fixture || result.activity !== fixture.activity) {
        throw new Error(`Resume artifact ${path.basename(file)} contains unknown fixture ${result.fixture}`);
      }
      if (!Number.isInteger(result.run) || result.run < 1 || result.run > maximumRun) {
        throw new Error(`Resume artifact ${path.basename(file)} contains invalid run ${result.run}`);
      }
      const key = `${report.provider}:${result.fixture}:${result.run}`;
      if (seen.has(key)) throw new Error(`Duplicate resume result ${key}`);
      seen.add(key);
      if (result.provider !== report.provider) {
        throw new Error(`Resume result ${key} has a mismatched provider`);
      }
      const expectedRoute = routeFor(report.provider === 'local-codex' ? 'local-ollama' : 'groq', fixture);
      if (result.model !== expectedRoute.model) {
        throw new Error(`Resume result ${key} has model ${result.model}; expected ${expectedRoute.model}`);
      }
      if (!result.success && result.error?.retryable) continue;
      results.set(key, {
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
  const modelConfig = modelConfigs.get(model);
  return {
    activity: fixture.activity,
    provider,
    model,
    reasoningEffort: definition.reasoningEffort || 'medium',
    routeVersion: 1,
    modelConfig: modelConfig || { pricing: null, pricingStatus: 'unpriced' }
  };
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function createBenchmarkConfig({ targetRuns = runs } = {}) {
  const contractFixtures = fixtures.map((fixture) => ({
    id: fixture.id,
    activity: fixture.activity,
    responseMode: fixture.responseMode || (fixture.schema ? 'structured' : 'text'),
    promptSha256: stableHash(fixture.messages),
    schemaSha256: fixture.schema ? stableHash(fixture.schema) : null,
    evaluationContractSha256: stableHash({
      azureBaselineScore: fixture.azureBaselineScore,
      expectedKeywords: fixture.expectedKeywords,
      forbiddenPhrases: fixture.forbiddenPhrases,
      qualityEvaluator: fixture.qualityEvaluator,
      qualityContext: fixture.qualityContext
    }),
    routes: {
      'local-codex': {
        model: routeFor('local-ollama', fixture).model,
        reasoningEffort: routeFor('local-ollama', fixture).reasoningEffort,
        pricing: routeFor('local-ollama', fixture).modelConfig.pricing
      },
      groq: {
        model: routeFor('groq', fixture).model,
        reasoningEffort: routeFor('groq', fixture).reasoningEffort,
        pricing: routeFor('groq', fixture).modelConfig.pricing
      }
    }
  }));
  return {
    schemaVersion: 2,
    codeVersion: BENCHMARK_CODE_VERSION,
    runsPerFixture: targetRuns,
    sourceContract: contractFixtures,
    requestOptions: {
      temperature: BENCHMARK_TEMPERATURE,
      requestedMaxTokens: BENCHMARK_MAX_TOKENS,
      schemaRepairAttempts: BENCHMARK_REPAIR_ATTEMPTS,
      chatMaxTokens: 600,
      includeReasoning: false,
      localRequestSource: 'provider-benchmark',
      timeoutMs,
      nonStrictSchemaActivities: ['candidate.cv_parse', 'ai_interview.cv_parse']
    },
    quotaSafety: quotaLimits,
    retryPolicy: retryOptions,
    implementation: {
      compareRuntimeProvidersSha256: fileSha256(__filename),
      providerComparisonHarnessSha256: fileSha256(path.join(
        repositoryRoot,
        'recruiter',
        'backend',
        'services',
        'aiRuntime',
        'providerComparisonHarness.js'
      )),
      evaluatorSha256: fileSha256(path.join(
        repositoryRoot,
        'recruiter',
        'backend',
        'services',
        'aiRuntime',
        'evaluationHarness.js'
      )),
      schemaValidatorSha256: fileSha256(path.join(
        repositoryRoot,
        'recruiter',
        'backend',
        'services',
        'aiRuntime',
        'jsonSchemaValidator.js'
      )),
      usageSha256: fileSha256(path.join(
        repositoryRoot,
        'recruiter',
        'backend',
        'services',
        'aiRuntime',
        'usageService.js'
      )),
      normalizerSha256: fileSha256(path.join(
        repositoryRoot,
        'recruiter',
        'backend',
        'services',
        'aiRuntime',
        'aiRuntimeService.js'
      )),
      adapterSha256: fileSha256(path.join(repositoryRoot, 'tools', 'local-llm', 'engine-adapters.cjs')),
      gatewaySha256: fileSha256(path.join(repositoryRoot, 'tools', 'local-llm', 'gateway.cjs'))
    }
  };
}

function normalizedInput(fixture, messages = fixture.messages) {
  const input = {
    messages,
    temperature: BENCHMARK_TEMPERATURE,
    max_tokens: BENCHMARK_MAX_TOKENS
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
  const retryAfter = typeof headers?.get === 'function' ? headers.get('retry-after') : null;
  if (quota.retryAfterMs == null && retryAfter) {
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) quota.retryAfterMs = Math.max(0, retryAt - Date.now());
  }
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
  const signature = signLocalRequest(secret, body, { method: 'POST', path: '/v1/status' });
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
    requestSource: 'provider-benchmark',
    metering: { record: false, exclusion: 'harness' },
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
  const endpoint = ['candidate.cv_parse', 'ai_interview.cv_parse'].includes(fixture.activity)
    ? '/v1/cv/analyze'
    : '/v1/complete';
  const signature = signLocalRequest(secret, body, { method: 'POST', path: endpoint });
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

function estimatePayloadInputTokens(payload) {
  // GPT-OSS uses a provider tokenizer that is not bundled here. Three UTF-8
  // characters per token plus the governor's configurable headroom is
  // intentionally conservative for the fixed English/JSON fixtures.
  return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(payload), 'utf8') / 3));
}

async function groqCompletion({
  fixture,
  route,
  messages,
  transport,
  governor,
  retry = executeWithRetry
}) {
  const input = normalizedInput(fixture, messages);
  const payload = normalizer.normalizePayload(input, route);
  const estimatedInputTokens = estimatePayloadInputTokens(payload);
  const maxOutputTokens = Number(payload.max_tokens || BENCHMARK_MAX_TOKENS);
  const retried = await retry(async () => {
    const reservation = await governor.reserve({ estimatedInputTokens, maxOutputTokens });
    let reconciled = false;
    try {
      const response = await transport.request(payload, route.model);
      const quota = quotaSnapshot(response.headers);
      governor.observeQuota(quota);
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 429) {
          governor.reconcile(reservation, { totalTokens: 0, metered: true });
          reconciled = true;
        }
        throw providerError(data, response, 'Groq completion failed');
      }
      const normalized = stripReasoning(data);
      const usage = normalizeUsage(normalized?.usage || {});
      governor.reconcile(reservation, {
        totalTokens: usage.totalTokens,
        metered: usage.totalTokens > 0
      });
      reconciled = true;
      return {
        content: String(normalized?.choices?.[0]?.message?.content || ''),
        usage: normalized?.usage || {},
        quota,
        model: normalized?.model || route.model
      };
    } finally {
      // Unknown 5xx/network consumption retains the reservation. This is
      // intentionally conservative and still persists completion metadata.
      if (!reconciled) governor.reconcile(reservation, { metered: false });
    }
  }, retryOptions);
  const normalized = retried.value;
  return {
    ...normalized,
    providerAttempts: retried.attempts
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
  let providerAttempts = 0;
  for (let attempt = 0; attempt <= BENCHMARK_REPAIR_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    let response;
    try {
      response = await complete({ fixture, route, messages });
    } catch (error) {
      totalLatencyMs += Date.now() - startedAt;
      providerAttempts += Math.max(1, Number(error?.providerAttempts || 1));
      error.usage = aggregateUsage([...usages, error?.usage || {}]);
      error.quota = error?.quota || lastQuota;
      error.providerAttempts = providerAttempts;
      error.latencyMs = totalLatencyMs;
      throw error;
    }
    totalLatencyMs += Date.now() - startedAt;
    usages.push(response.usage || {});
    providerAttempts += Math.max(1, Number(response.providerAttempts || 1));
    lastQuota = response.quota || lastQuota;
    const evaluation = evaluateOutput(fixture, response);
    if (!fixture.schema || evaluation.validation.valid) {
      return {
        ...response,
        usage: aggregateUsage(usages),
        quota: lastQuota,
        latencyMs: totalLatencyMs,
        schemaRepairAttempted: attempt > 0,
        providerAttempts
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
  error.usage = aggregateUsage(usages);
  error.quota = lastQuota;
  error.providerAttempts = providerAttempts;
  error.providerCalls = usages.length;
  error.latencyMs = totalLatencyMs;
  throw error;
}

function providerReport({
  provider,
  providerStartedAt,
  results,
  activityModels,
  benchmarkConfigSha256,
  outcome,
  governor
}) {
  return {
    runId,
    mode: live ? 'live' : 'synthetic-dry-run',
    provider,
    model: provider === 'local-codex' ? 'gpt-5.6-terra' : 'production-configured-by-activity',
    activityModels,
    benchmarkConfigSha256,
    startedAt: providerStartedAt,
    completedAt: outcome.state === 'completed' ? new Date().toISOString() : null,
    checkpointedAt: new Date().toISOString(),
    sequential: true,
    singleInflight: true,
    runsPerFixture: runs,
    fixtureCount: selectedFixtures.length,
    outcome,
    quota: provider === 'groq' && governor ? governor.snapshot() : null,
    results,
    summary: summarizeResults(results)
  };
}

function writeProviderCheckpoint(report) {
  atomicJson(path.join(reportDir, `${report.provider}.checkpoint.json`), report);
}

async function runProvider(provider, resources) {
  const providerStartedAt = new Date().toISOString();
  const results = [];
  const activityModels = {};
  let outcome = { state: 'running' };
  providerLoop:
  for (const fixture of selectedFixtures) {
    const route = routeFor(provider === 'local-codex' ? 'local-ollama' : 'groq', fixture);
    activityModels[fixture.activity] = route.model;
    for (let run = 1; run <= runs; run += 1) {
      const resumed = resources.resumeResults.get(`${provider}:${fixture.id}:${run}`);
      if (resumed) {
        results.push(resumed);
        writeProviderCheckpoint(providerReport({
          provider,
          providerStartedAt,
          results,
          activityModels,
          benchmarkConfigSha256: resources.benchmarkConfigSha256,
          outcome,
          governor: resources.governor
        }));
        continue;
      }
      const startedAt = Date.now();
      try {
        const complete = live
          ? provider === 'local-codex'
            ? (input) => localCompletion({ ...input, secret: resources.local.secret })
            : (input) => groqCompletion({
                ...input,
                transport: resources.groq,
                governor: resources.governor
              })
          : ({ fixture: item, route: itemRoute }) => dryCompletion(item, itemRoute);
        const response = await structuredCompletion({ fixture, route, complete });
        const result = evaluateBenchmarkResponse({
          fixture,
          provider,
          model: response.model || route.model,
          run,
          response,
          latencyMs: response.latencyMs,
          pricing: route.modelConfig.pricing,
          pricingKnown: Boolean(route.modelConfig.pricing),
          quota: response.quota
        });
        result.providerAttempts = response.providerAttempts;
        result.benchmarkConfigSha256 = resources.benchmarkConfigSha256;
        results.push(result);
      } catch (error) {
        if (error instanceof DailyQuotaWaitError || error?.code === 'BENCHMARK_WAITING_FOR_DAILY_QUOTA') {
          outcome = {
            state: 'waiting_for_daily_quota',
            reason: sanitizeMessage(error.message),
            resumeAt: new Date(error.resumeAt || nextUtcDay()).toISOString()
          };
          writeProviderCheckpoint(providerReport({
            provider,
            providerStartedAt,
            results,
            activityModels,
            benchmarkConfigSha256: resources.benchmarkConfigSha256,
            outcome,
            governor: resources.governor
          }));
          break providerLoop;
        }
        const result = benchmarkErrorResult({
          fixture,
          provider,
          model: route.model,
          run,
          latencyMs: error?.latencyMs || Date.now() - startedAt,
          error,
          pricing: route.modelConfig.pricing,
          pricingKnown: Boolean(route.modelConfig.pricing)
        });
        result.benchmarkConfigSha256 = resources.benchmarkConfigSha256;
        results.push(result);
      }
      writeProviderCheckpoint(providerReport({
        provider,
        providerStartedAt,
        results,
        activityModels,
        benchmarkConfigSha256: resources.benchmarkConfigSha256,
        outcome,
        governor: resources.governor
      }));
    }
  }
  if (outcome.state === 'running') outcome = { state: 'completed' };
  const report = providerReport({
    provider,
    providerStartedAt,
    results,
    activityModels,
    benchmarkConfigSha256: resources.benchmarkConfigSha256,
    outcome,
    governor: resources.governor
  });
  writeProviderCheckpoint(report);
  return report;
}

function markdownSummary(report) {
  const lines = [
    '# Terra vs Groq provider comparison',
    '',
    `- Run: ${report.runId}`,
    `- Mode: ${report.mode}`,
    '- Execution: strictly sequential; providers were never active at the same time',
    '- Contract: same source fixture contract with provider-native adapters',
    `- Benchmark config: ${report.benchmarkConfigSha256}`,
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
  lines.push(
    '',
    'Recommendations are advisory and never change production routing. Quality, metering, p95, and latency-variance gates are applied before speed. Exact paired coverage is required, and policy-locked CV routes cannot recommend Groq.'
  );
  return `${lines.join('\n')}\n`;
}

async function main() {
  if (!selectedFixtures.length) throw new Error('No benchmark fixtures were selected');
  if (unknownFixtureIds.length) throw new Error(`Unknown fixture ids: ${unknownFixtureIds.join(', ')}`);
  if (unknownProviders.length) throw new Error(`Unknown providers: ${unknownProviders.join(', ')}`);
  if (new Set(requestedProviders).size !== requestedProviders.length) throw new Error('Duplicate providers are not allowed');
  fs.mkdirSync(reportDir, { recursive: true });
  const benchmarkConfig = createBenchmarkConfig();
  const benchmarkConfigSha256 = stableHash(benchmarkConfig);
  const expectedResults = selectedFixtures.flatMap((fixture) => Array.from(
    { length: runs },
    (_, index) => ({ fixture: fixture.id, run: index + 1 })
  ));

  const manifest = {
    runId,
    generatedAt: new Date().toISOString(),
    mode: live ? 'live' : 'synthetic-dry-run',
    sequential: true,
    simultaneousProvidersAllowed: false,
    fixtureSource: 'recruiter/backend/tests/fixtures/aiRuntimeGoldenFixtures.js',
    productionNormalization: 'AIRuntimeService.normalizePayload',
    productionRepairAttempts: BENCHMARK_REPAIR_ATTEMPTS,
    sourceContractParity: 'same source fixture contract with provider-native adapters',
    benchmarkConfig,
    benchmarkConfigSha256,
    providers: requestedProviders,
    resumeSources: [],
    runsPerFixture: runs,
    groqQuotaSafety: quotaLimits,
    groqRetryPolicy: retryOptions,
    fixtures: selectedFixtures.map((fixture) => ({
      id: fixture.id,
      activity: fixture.activity,
      promptSha256: stableHash(fixture.messages),
      schemaSha256: fixture.schema ? stableHash(fixture.schema) : null
    }))
  };
  const resume = loadResumeResults({
    expectedConfigSha256: benchmarkConfigSha256,
    maximumRun: runs
  });
  manifest.resumeSources = resume.sources;
  atomicJson(path.join(reportDir, 'manifest.json'), manifest);

  const providerHasPendingResults = (provider) => expectedResults.some(
    (expected) => !resume.results.has(`${provider}:${expected.fixture}:${expected.run}`)
  );
  const resources = {
    local: null,
    groq: null,
    governor: null,
    resumeResults: resume.results,
    benchmarkConfigSha256
  };
  if (live && requestedProviders.includes('local-codex') && providerHasPendingResults('local-codex')) {
    resources.local = await verifyTerra();
  }
  if (live && requestedProviders.includes('groq') && providerHasPendingResults('groq')) {
    resources.groq = await loadGroqTransport();
    if (resources.groq) resources.governor = new GroqQuotaGovernor();
  }

  const runnableProviders = requestedProviders.filter((provider) => {
    if (provider === 'groq' && live && providerHasPendingResults(provider) && !resources.groq) return false;
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
        completed: report.outcome?.state === 'completed',
        outcome: report.outcome?.state,
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
      benchmarkConfigSha256,
      skipped: true,
      reason: 'No local GROQ_API_KEY or MONGO_URI-backed encrypted credential was available. No secret was read or printed.',
      outcome: { state: 'skipped_missing_credential' },
      results: [],
      summary: summarizeResults([])
    };
    providerReports.push(skipped);
    atomicJson(path.join(reportDir, `${provider}.json`), skipped);
  }
  const comparableReports = providerReports.filter((report) => !report.skipped);
  const comparisonRequested = requestedProviders.includes('local-codex')
    && requestedProviders.includes('groq');
  const lockedActivities = Object.entries(ACTIVITY_DEFINITIONS)
    .filter(([, definition]) => definition.lockedProvider === true)
    .map(([activity]) => activity);
  const liveComparison = live && comparisonRequested && comparableReports.length === 2
    ? compareProviderReports(comparableReports, { expectedResults, lockedActivities })
    : null;
  const completeComparison = Boolean(
    liveComparison?.pairedCoverage?.complete
    && comparableReports.every((provider) => provider.outcome?.state === 'completed')
    && comparableReports.every((provider) => provider.benchmarkConfigSha256 === benchmarkConfigSha256)
  );
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
    comparison: liveComparison
      ? liveComparison
      : {
          activities: [],
          advisoryOnly: true,
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
  const waitingForDailyQuota = providerReports.some(
    (provider) => provider.outcome?.state === 'waiting_for_daily_quota'
  );
  if (waitingForDailyQuota) process.exitCode = 75;
  else if (live && comparisonRequested && !report.completeComparison) process.exitCode = 2;
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${sanitizeMessage(error.stack || error.message)}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState) await mongoose.disconnect();
    });
}

module.exports = {
  DailyQuotaWaitError,
  GroqQuotaGovernor,
  atomicJson,
  createBenchmarkConfig,
  estimatePayloadInputTokens,
  executeWithRetry,
  loadResumeResults,
  providerReport,
  retryDelayMs,
  structuredCompletion
};
