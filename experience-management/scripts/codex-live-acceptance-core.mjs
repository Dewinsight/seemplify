/**
 * Shared logic for the opt-in live ChatGPT / Codex acceptance harness.
 *
 * Everything that can touch the machine (network, clock, filesystem, process
 * control) is injected, so the self-tests can drive the whole harness against a
 * fake HTTP API without ever contacting OpenAI. This module therefore imports
 * no filesystem and no child-process API at all; that absence is asserted by
 * the self-tests and is what keeps "never read auth/token files" verifiable.
 *
 * The harness is fail-closed: a phase that cannot prove its property fails the
 * run. Nothing here is ever skipped, softened, or defaulted into a pass.
 */
import crypto from 'node:crypto';
import path from 'node:path';

export const HARNESS_NAME = 'codex-live-acceptance';
export const HARNESS_VERSION = 1;
export const OPT_IN_VARIABLE = 'SEEMPLIFY_CODEX_ACCEPTANCE_OPT_IN';
export const OPT_IN_VALUE = 'live-chatgpt-codex-acceptance';
export const ACCEPTANCE_ACTION_ID = 'survey.generate';

export const LIVE_PROOF_STATEMENT =
  'Live run against a real Experience backend and a real ChatGPT / Codex App Server.';
export const SELF_TEST_PROOF_STATEMENT =
  'Self-test against a fake in-process HTTP API. This run proves harness logic only and is NOT evidence of live ChatGPT / Codex acceptance.';

/** Any of these means the harness is running somewhere it must never run. */
export const CI_VARIABLES = [
  'CI', 'CONTINUOUS_INTEGRATION', 'BUILD_ID', 'BUILD_NUMBER', 'GITHUB_ACTIONS', 'GITLAB_CI',
  'JENKINS_URL', 'TEAMCITY_VERSION', 'TF_BUILD', 'BUILDKITE', 'CIRCLECI', 'APPVEYOR', 'DRONE'
];

/** Identifiers advertised by the repository's fake Codex App Server fixture. */
export const FIXTURE_MODEL_IDS = ['gpt-test-codex', 'gpt-test-codex-fast', 'gpt-test-codex-minimal'];
export const FIXTURE_IDENTIFIER_PATTERN = /(fake|mock|stub|fixture|dummy|placeholder)|test-codex/i;
/** RFC 2606 / RFC 6761 reserved names plus the fixture account domain. */
export const FIXTURE_ACCOUNT_DOMAINS = ['example.com', 'example.net', 'example.org', 'localhost'];
export const FIXTURE_ACCOUNT_TLDS = ['test', 'example', 'invalid', 'localhost', 'local'];

export const PHASE_DEFINITIONS = [
  { id: 'readiness', title: 'Backend readiness and ChatGPT runtime selection' },
  { id: 'device_status', title: 'ChatGPT device connection status' },
  { id: 'model_catalog', title: 'Live Codex model catalog' },
  { id: 'foreground_job', title: 'Foreground job runs on the chosen model and effort' },
  { id: 'signed_out_job', title: 'Queued job completes after sign-out and browser close' },
  { id: 'backend_restart', title: 'Backend restart reuses the same Codex runtime directory' }
];

export class AcceptanceError extends Error {
  constructor(message, code = 'ACCEPTANCE_FAILED') {
    super(message);
    this.name = 'AcceptanceError';
    this.code = code;
  }
}

export function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

export function utcDate(milliseconds) {
  return iso(milliseconds).slice(0, 10);
}

/**
 * One-way, salted identifier used everywhere an account, space, or directory
 * identity has to be comparable across phases without appearing in evidence.
 */
export function fingerprint(value, length = 16) {
  return crypto.createHash('sha256')
    .update(`${HARNESS_NAME}:${String(value === undefined || value === null ? '' : value)}`)
    .digest('hex').slice(0, length);
}

export function createRedactor(secrets) {
  const values = [...new Set((secrets || [])
    .filter((secret) => typeof secret === 'string')
    .map((secret) => secret.trim())
    .filter((secret) => secret.length >= 4))]
    .sort((left, right) => right.length - left.length);
  return function redact(value) {
    let text = String(value === undefined || value === null ? '' : value);
    for (const secret of values) text = text.split(secret).join('[redacted]');
    return text;
  };
}

export function summarize(redact, value, limit = 300) {
  return redact(value).replace(/\s+/gu, ' ').trim().slice(0, limit);
}

// Deliberately anchored so a URL scheme such as https:// is not mistaken for a
// Windows drive letter, while "C:\..." after a JSON quote or space still is.
const WINDOWS_PATH_PATTERN = /(?:^|[^A-Za-z0-9+._-])[A-Za-z]:[\\/]/u;
const POSIX_PATH_PATTERN = /(?:^|["\s(])\/(?:home|Users|root|srv|opt|var|mnt|media|private)\//u;

export function assertRedactedEvidence(report, secrets) {
  const serialized = JSON.stringify(report);
  for (const secret of secrets || []) {
    if (typeof secret !== 'string' || secret.trim().length < 4) continue;
    if (serialized.includes(secret.trim())) {
      throw new AcceptanceError('Evidence contained a value that must never be recorded.', 'EVIDENCE_NOT_REDACTED');
    }
  }
  if (WINDOWS_PATH_PATTERN.test(serialized) || POSIX_PATH_PATTERN.test(serialized)) {
    throw new AcceptanceError('Evidence contained an absolute filesystem path.', 'EVIDENCE_NOT_REDACTED');
  }
  return true;
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  const raw = trimmed(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AcceptanceError(`${name} must be an integer between ${minimum} and ${maximum}.`, 'OPTION_INVALID');
  }
  return parsed;
}

/**
 * Resolve and validate every input. This is the opt-in gate: it refuses to
 * produce options unless the operator asked for a live run explicitly, on a
 * workstation, with every capability the run needs already supplied.
 */
export function resolveHarnessOptions(environment, input = {}) {
  const env = environment || {};
  const read = (name) => trimmed(env[name]);

  if (read(OPT_IN_VARIABLE) !== OPT_IN_VALUE) {
    throw new AcceptanceError(
      `This harness makes real ChatGPT / Codex requests and is never part of ordinary testing. Set ${OPT_IN_VARIABLE}=${OPT_IN_VALUE} to opt in.`,
      'OPT_IN_REQUIRED'
    );
  }
  const continuousIntegration = CI_VARIABLES.filter((name) => read(name));
  if (continuousIntegration.length) {
    throw new AcceptanceError(
      `This harness must never run in continuous integration (${continuousIntegration.join(', ')} present).`,
      'CI_ENVIRONMENT_REFUSED'
    );
  }
  if (read('NODE_ENV').toLowerCase() === 'test') {
    throw new AcceptanceError('This harness must not run with NODE_ENV=test.', 'TEST_ENVIRONMENT_REFUSED');
  }
  const codexCliPath = read('CODEX_CLI_PATH');
  if (codexCliPath && FIXTURE_IDENTIFIER_PATTERN.test(codexCliPath)) {
    throw new AcceptanceError(
      'CODEX_CLI_PATH points at a fake or fixture Codex CLI. A live acceptance run requires the real App Server.',
      'FIXTURE_CLI_REFUSED'
    );
  }

  const baseUrlValue = read('SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL');
  if (!baseUrlValue) {
    throw new AcceptanceError('SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL is required.', 'BASE_URL_REQUIRED');
  }
  let baseUrl;
  try { baseUrl = new URL(baseUrlValue); }
  catch { throw new AcceptanceError('SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL is not a valid URL.', 'BASE_URL_INVALID'); }
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new AcceptanceError('SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL must use http or https.', 'BASE_URL_INVALID');
  }
  if (baseUrl.username || baseUrl.password) {
    throw new AcceptanceError('SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL must not embed credentials.', 'BASE_URL_INVALID');
  }

  // Credentials come from the environment only. The harness never reads the
  // admin password file, the session secret, or any Codex auth material.
  const email = read('SEEMPLIFY_CODEX_ACCEPTANCE_EMAIL');
  const password = env.SEEMPLIFY_CODEX_ACCEPTANCE_PASSWORD === undefined
    ? '' : String(env.SEEMPLIFY_CODEX_ACCEPTANCE_PASSWORD);
  if (!email || !password) {
    throw new AcceptanceError(
      'SEEMPLIFY_CODEX_ACCEPTANCE_EMAIL and SEEMPLIFY_CODEX_ACCEPTANCE_PASSWORD are required. This harness never reads credentials from files.',
      'CREDENTIALS_REQUIRED'
    );
  }

  const runtimeDir = read('SEEMPLIFY_CODEX_ACCEPTANCE_RUNTIME_DIR');
  if (!runtimeDir) {
    throw new AcceptanceError(
      'SEEMPLIFY_CODEX_ACCEPTANCE_RUNTIME_DIR is required. It must match the backend CODEX_RUNTIME_DIR and is only ever inspected with stat, never read.',
      'RUNTIME_DIR_REQUIRED'
    );
  }

  const restartMode = read('SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_MODE').toLowerCase();
  if (restartMode !== 'command' && restartMode !== 'manual') {
    throw new AcceptanceError(
      'SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_MODE must be "command" (with SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_COMMAND) or "manual".',
      'RESTART_MODE_REQUIRED'
    );
  }
  const restartCommand = read('SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_COMMAND');
  if (restartMode === 'command' && !restartCommand) {
    throw new AcceptanceError(
      'SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_COMMAND is required when the restart mode is "command".',
      'RESTART_COMMAND_REQUIRED'
    );
  }

  const evidenceDir = read('SEEMPLIFY_CODEX_ACCEPTANCE_EVIDENCE_DIR') || input.defaultEvidenceDir || '';
  if (!evidenceDir) {
    throw new AcceptanceError('SEEMPLIFY_CODEX_ACCEPTANCE_EVIDENCE_DIR is required.', 'EVIDENCE_DIR_REQUIRED');
  }

  return {
    baseUrl: `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/u, '')}`,
    baseUrlHost: baseUrl.host,
    email,
    password,
    spaceId: read('SEEMPLIFY_CODEX_ACCEPTANCE_SPACE_ID') || null,
    runtimeDir,
    evidenceDir,
    requestedModel: read('SEEMPLIFY_CODEX_ACCEPTANCE_MODEL') || null,
    requestedEffort: read('SEEMPLIFY_CODEX_ACCEPTANCE_EFFORT') || null,
    restart: { mode: restartMode, command: restartCommand || null },
    timeouts: {
      jobMs: boundedInteger(env.SEEMPLIFY_CODEX_ACCEPTANCE_JOB_TIMEOUT_MS, 600_000, 30_000, 3_600_000,
        'SEEMPLIFY_CODEX_ACCEPTANCE_JOB_TIMEOUT_MS'),
      signedOutWindowMs: boundedInteger(env.SEEMPLIFY_CODEX_ACCEPTANCE_SIGNED_OUT_WINDOW_MS, 90_000, 30_000, 900_000,
        'SEEMPLIFY_CODEX_ACCEPTANCE_SIGNED_OUT_WINDOW_MS'),
      restartMs: boundedInteger(env.SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_TIMEOUT_MS, 300_000, 30_000, 1_800_000,
        'SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_TIMEOUT_MS'),
      pollMs: boundedInteger(env.SEEMPLIFY_CODEX_ACCEPTANCE_POLL_MS, 2_000, 100, 30_000,
        'SEEMPLIFY_CODEX_ACCEPTANCE_POLL_MS'),
      requestMs: boundedInteger(env.SEEMPLIFY_CODEX_ACCEPTANCE_REQUEST_TIMEOUT_MS, 30_000, 1_000, 120_000,
        'SEEMPLIFY_CODEX_ACCEPTANCE_REQUEST_TIMEOUT_MS')
    },
    checkpoint: {
      file: read('SEEMPLIFY_CODEX_ACCEPTANCE_CHECKPOINT_FILE') || null,
      minimumHours: boundedInteger(env.SEEMPLIFY_CODEX_ACCEPTANCE_CHECKPOINT_MIN_HOURS, 20, 20, 168,
        'SEEMPLIFY_CODEX_ACCEPTANCE_CHECKPOINT_MIN_HOURS')
    }
  };
}

export function secretsOf(options) {
  return [options.email, options.password, options.runtimeDir, options.evidenceDir]
    .filter((value) => typeof value === 'string' && value);
}

/**
 * Minimal HTTP client following the application's own conventions: a session
 * cookie jar, the optional x-seemplify-space header, and a unique x-request-id
 * on every single call so a live run can be correlated with server-side audit.
 */
export function createApiClient(input) {
  const {
    baseUrl,
    fetchImpl,
    spaceId = null,
    newRequestId = () => crypto.randomUUID(),
    defaultTimeoutMs = 30_000
  } = input;
  if (typeof fetchImpl !== 'function') throw new AcceptanceError('An HTTP implementation is required.', 'DEPENDENCY_MISSING');
  const cookies = new Map();
  const issuedRequestIds = [];

  function captureCookies(response) {
    const headers = response && response.headers;
    const raw = headers && typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers && typeof headers.get === 'function' ? headers.get('set-cookie') : null].filter(Boolean);
    for (const entry of raw) {
      const pair = String(entry).split(';')[0];
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value) cookies.set(name, value); else cookies.delete(name);
    }
  }

  async function request(pathname, options = {}) {
    const { method = 'GET', body = null, authenticated = true, timeoutMs = defaultTimeoutMs } = options;
    const requestId = newRequestId();
    issuedRequestIds.push(requestId);
    const headers = { accept: 'application/json', 'x-request-id': requestId };
    if (body !== null) headers['content-type'] = 'application/json';
    if (spaceId) headers['x-seemplify-space'] = spaceId;
    if (authenticated && cookies.size) {
      headers.cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    });
    captureCookies(response);
    const text = await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      data,
      requestId,
      errorMessage: data && typeof data.error === 'string' ? data.error : null,
      errorCode: data && typeof data.code === 'string' ? data.code : null
    };
  }

  return {
    request,
    get: (pathname, options) => request(pathname, { ...options, method: 'GET' }),
    post: (pathname, body, options) => request(pathname, { ...options, method: 'POST', body: body || {} }),
    patch: (pathname, body, options) => request(pathname, { ...options, method: 'PATCH', body: body || {} }),
    delete: (pathname, options) => request(pathname, { ...options, method: 'DELETE' }),
    clearSession() { cookies.clear(); },
    get hasSession() { return cookies.size > 0; },
    get requestIds() { return [...issuedRequestIds]; },
    async probeHealth(timeoutMs = 5_000) {
      try {
        const response = await request('/health', { authenticated: false, timeoutMs });
        return { reachable: true, ok: response.status === 200, data: response.data };
      } catch {
        return { reachable: false, ok: false, data: null };
      }
    }
  };
}

export function supportedEffortsFor(model) {
  const advertised = (model && Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [])
    .map((item) => trimmed(item && item.reasoningEffort))
    .filter(Boolean);
  const fallback = trimmed(model && model.defaultReasoningEffort);
  return [...new Set([...advertised, ...(fallback ? [fallback] : [])])];
}

/**
 * Prefer a model and effort that are not the account defaults, so a passing
 * assertion cannot be explained by the App Server simply ignoring the choice.
 */
export function chooseModelAndEffort(models, requested = {}) {
  const available = (models || []).filter((model) => model && trimmed(model.id) && !model.hidden);
  if (!available.length) throw new AcceptanceError('The connected account advertises no Codex model.', 'CODEX_MODEL_UNAVAILABLE');
  const requestedModel = trimmed(requested.requestedModel);
  const requestedEffort = trimmed(requested.requestedEffort);
  if (requestedModel) {
    const definition = available.find((model) => model.id === requestedModel);
    if (!definition) {
      throw new AcceptanceError(`The requested model ${requestedModel} is not in the live catalog.`, 'CODEX_MODEL_UNAVAILABLE');
    }
    const efforts = supportedEffortsFor(definition);
    const effort = requestedEffort || efforts[0] || '';
    if (!effort || !efforts.includes(effort)) {
      throw new AcceptanceError(
        `The requested reasoning effort ${requestedEffort || '(none)'} is not advertised by ${definition.id}.`,
        'CODEX_REASONING_EFFORT_UNAVAILABLE'
      );
    }
    return { model: definition.id, reasoningEffort: effort, selection: 'requested' };
  }

  const accountDefault = available.find((model) => model.isDefault) || available[0];
  const accountDefaultEfforts = supportedEffortsFor(accountDefault);
  const defaultEffort = accountDefaultEfforts.includes(trimmed(accountDefault.defaultReasoningEffort))
    ? trimmed(accountDefault.defaultReasoningEffort)
    : accountDefaultEfforts[0] || '';
  for (const model of available) {
    for (const effort of supportedEffortsFor(model)) {
      if (model.id === accountDefault.id && effort === defaultEffort) continue;
      return { model: model.id, reasoningEffort: effort, selection: 'non_default' };
    }
  }
  if (!defaultEffort) {
    throw new AcceptanceError(
      `${accountDefault.id} does not advertise a usable reasoning effort.`,
      'CODEX_REASONING_EFFORT_UNAVAILABLE'
    );
  }
  return { model: accountDefault.id, reasoningEffort: defaultEffort, selection: 'account_default' };
}

export function assertLiveAccount(account) {
  const email = trimmed(account && account.email).toLowerCase();
  if (!email || !email.includes('@')) {
    throw new AcceptanceError('The connected ChatGPT account has no usable identity.', 'CHATGPT_NOT_CONNECTED');
  }
  const domain = email.split('@').pop();
  const topLevel = domain.split('.').pop();
  if (FIXTURE_ACCOUNT_DOMAINS.includes(domain) || FIXTURE_ACCOUNT_TLDS.includes(topLevel)
    || FIXTURE_IDENTIFIER_PATTERN.test(domain)) {
    throw new AcceptanceError(
      'The connected account looks like a test fixture, not a real ChatGPT account.',
      'FAKE_APP_SERVER_DETECTED'
    );
  }
  return true;
}

export function assertLiveModelCatalog(models) {
  for (const model of models || []) {
    const id = trimmed(model && model.id);
    const displayName = trimmed(model && model.displayName);
    if (FIXTURE_MODEL_IDS.includes(id) || FIXTURE_IDENTIFIER_PATTERN.test(id)
      || FIXTURE_IDENTIFIER_PATTERN.test(displayName)) {
      throw new AcceptanceError(
        'The Codex model catalog advertises a fixture model. The backend is not talking to a real App Server.',
        'FAKE_APP_SERVER_DETECTED'
      );
    }
  }
  return true;
}

/** A Terra (local runtime) result is a hard failure: there is no fallback path. */
export function assertCodexRuntime(job, expected) {
  const runtime = (job && job.runtime) || {};
  const raw = (job && job.result && job.result.runtime) || {};
  if (runtime.provider !== 'codex' || trimmed(raw.provider) !== 'openai-codex') {
    throw new AcceptanceError(
      `AI job ${job && job.id} did not run on ChatGPT / Codex (provider ${runtime.provider || 'unknown'}).`,
      'CODEX_RUNTIME_REQUIRED'
    );
  }
  if (runtime.status !== 'actual' || !['provider_result', 'job_result'].includes(runtime.source)) {
    throw new AcceptanceError(
      `AI job ${job && job.id} only recorded a planned runtime (${runtime.source}/${runtime.status}).`,
      'CODEX_RUNTIME_NOT_ACTUAL'
    );
  }
  if (trimmed(raw.engine) !== 'codex-app-server') {
    throw new AcceptanceError(
      `AI job ${job && job.id} did not record the Codex App Server engine.`,
      'CODEX_ENGINE_UNEXPECTED'
    );
  }
  if (trimmed(raw.requestId) !== trimmed(job && job.id)) {
    throw new AcceptanceError(
      `AI job ${job && job.id} did not carry its own unique request id into the App Server.`,
      'CODEX_REQUEST_ID_MISMATCH'
    );
  }
  if (expected && expected.model && runtime.model !== expected.model) {
    throw new AcceptanceError(
      `AI job ${job && job.id} ran on ${runtime.model || 'an unknown model'} instead of the chosen ${expected.model}.`,
      'CODEX_MODEL_MISMATCH'
    );
  }
  if (expected && expected.reasoningEffort && runtime.reasoningEffort !== expected.reasoningEffort) {
    throw new AcceptanceError(
      `AI job ${job && job.id} ran at ${runtime.reasoningEffort || 'an unknown effort'} instead of the chosen ${expected.reasoningEffort}.`,
      'CODEX_EFFORT_MISMATCH'
    );
  }
  return true;
}

function check(record, id, ok, code, message) {
  record.checks.push({ id, ok: Boolean(ok) });
  if (!ok) throw new AcceptanceError(message, code);
  return true;
}

function note(record, key, value) {
  record.data[key] = value;
}

async function signIn(context, label) {
  const { client, options } = context;
  const response = await client.post('/api/auth/login',
    { email: options.email, password: options.password }, { authenticated: false });
  if (response.status !== 200) {
    throw new AcceptanceError(
      `Sign-in failed during ${label} (HTTP ${response.status}${response.errorCode ? ` ${response.errorCode}` : ''}).`,
      'SIGN_IN_FAILED'
    );
  }
  const session = await client.get('/api/auth/session');
  if (!session.data || session.data.authenticated !== true) {
    throw new AcceptanceError(`The session was not established during ${label}.`, 'SESSION_NOT_ESTABLISHED');
  }
  return session.data;
}

async function readProviderState(context) {
  const response = await context.client.get('/api/ai-provider');
  if (response.status !== 200 || !response.data) {
    throw new AcceptanceError(
      `The AI provider state could not be read (HTTP ${response.status}).`,
      'AI_PROVIDER_UNREADABLE'
    );
  }
  return response.data;
}

async function queueAcceptanceJob(context, label) {
  const { client, report } = context;
  const response = await client.post('/api/ai/surveys', {
    brief: `Design a short customer onboarding experience survey covering recommendation, effort, and clarity. Live ChatGPT and Codex acceptance run ${report.runId}, phase ${label}.`,
    purpose: 'customer_experience',
    audience: 'Customers in their first 30 days',
    language: 'English',
    numberOfQuestions: 4
  });
  if (response.status !== 202 || !response.data || !response.data.jobId) {
    throw new AcceptanceError(
      `The ${label} AI job could not be queued (HTTP ${response.status}${response.errorCode ? ` ${response.errorCode}` : ''}).`,
      'AI_JOB_NOT_QUEUED'
    );
  }
  context.state.queuedRequestIds.push(response.requestId);
  return { jobId: String(response.data.jobId), queueRequestId: response.requestId };
}

async function readJob(context, jobId, label) {
  const response = await context.client.get(`/api/ai/jobs/${jobId}`);
  if (response.status !== 200 || !response.data) {
    throw new AcceptanceError(`The ${label} AI job could not be read (HTTP ${response.status}).`, 'AI_JOB_UNREADABLE');
  }
  return response.data;
}

async function pollJob(context, jobId, until, label, timeoutMs) {
  const { deps, options } = context;
  const deadline = deps.now() + (timeoutMs || options.timeouts.jobMs);
  let last = null;
  while (deps.now() <= deadline) {
    last = await readJob(context, jobId, label);
    if (last.state === 'failed' || last.state === 'cancelled') {
      throw new AcceptanceError(
        `The ${label} AI job ${last.state}: ${summarize(context.redact, last.error, 200) || 'no reason recorded'}.`,
        'AI_JOB_FAILED'
      );
    }
    if (until(last)) return last;
    await deps.sleep(options.timeouts.pollMs);
  }
  throw new AcceptanceError(
    `The ${label} AI job stayed in state ${last ? last.state : 'unknown'} past the ${timeoutMs || options.timeouts.jobMs} ms budget.`,
    'AI_JOB_TIMEOUT'
  );
}

function surveyIdOf(job) {
  const output = job && job.result && job.result.output;
  const survey = output && output.survey;
  return survey && typeof survey.id === 'string' ? survey.id : null;
}

async function cleanUpGeneratedSurvey(context, job) {
  const surveyId = surveyIdOf(job);
  if (!surveyId) return null;
  try {
    const response = await context.client.delete(`/api/surveys/${surveyId}`);
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}

export async function readinessPhase(context, record) {
  const { client, deps, options } = context;

  const runtimeDirectory = deps.statDirectory(options.runtimeDir);
  check(record, 'runtime_directory_present', Boolean(runtimeDirectory && runtimeDirectory.isDirectory),
    'RUNTIME_DIR_UNAVAILABLE',
    'The configured Codex runtime directory does not exist. It must match the backend CODEX_RUNTIME_DIR.');
  context.state.runtimeIdentityBefore = fingerprint(`${runtimeDirectory.ino}:${runtimeDirectory.birthtimeMs}`);
  note(record, 'runtimeDirectoryIdentity', context.state.runtimeIdentityBefore);

  const health = await client.probeHealth(options.timeouts.requestMs);
  check(record, 'health_ok', health.reachable && health.ok && health.data && health.data.databaseReady === true,
    'BACKEND_NOT_READY', 'The backend did not report a ready database on /health.');
  note(record, 'databaseProvider', health.data && health.data.database ? String(health.data.database) : null);

  const anonymous = await client.get('/api/ai-provider', { authenticated: false });
  check(record, 'anonymous_access_rejected', anonymous.status === 401,
    'AUTHENTICATION_NOT_ENFORCED', `An unauthenticated AI provider read returned HTTP ${anonymous.status}.`);

  const session = await signIn(context, 'readiness');
  check(record, 'session_established', true, 'SESSION_NOT_ESTABLISHED', '');
  check(record, 'session_identity_matches',
    trimmed(session.email).toLowerCase() === options.email.toLowerCase(),
    'SESSION_IDENTITY_MISMATCH', 'The established session belongs to a different account.');
  const activeSpaceId = options.spaceId || (session.activeSpace && session.activeSpace.id) || null;
  check(record, 'active_space_resolved', Boolean(activeSpaceId), 'SPACE_UNRESOLVED',
    'No active workspace could be resolved for this account.');
  context.state.spaceId = activeSpaceId;
  note(record, 'accountFingerprint', fingerprint(trimmed(session.email).toLowerCase()));
  note(record, 'spaceFingerprint', fingerprint(activeSpaceId));

  const runtime = await client.get('/api/runtime');
  check(record, 'runtime_readable', runtime.status === 200 && Boolean(runtime.data),
    'RUNTIME_UNREADABLE', `The runtime status could not be read (HTTP ${runtime.status}).`);
  check(record, 'ai_worker_running', Boolean(runtime.data.worker && runtime.data.worker.running),
    'AI_WORKER_STOPPED', 'The backend AI job worker is not running.');
  note(record, 'aiWorkerConcurrency', runtime.data.worker ? runtime.data.worker.concurrency : null);

  const provider = await readProviderState(context);
  context.state.providerState = provider;
  check(record, 'codex_available', provider.codex && provider.codex.available === true && !provider.codex.error,
    'CODEX_UNAVAILABLE',
    `ChatGPT / Codex is unavailable: ${summarize(context.redact, provider.codex && provider.codex.error, 200) || 'no detail reported'}.`);
  check(record, 'chatgpt_runtime_enabled', Boolean(provider.runtimePolicy && provider.runtimePolicy.chatgptEnabled),
    'CHATGPT_RUNTIME_DISABLED', 'A platform administrator has disabled the ChatGPT runtime.');
  check(record, 'chatgpt_runtime_selected',
    provider.preference && provider.preference.effectiveProvider === 'codex'
    && provider.preference.provider === 'codex' && provider.preference.runtimeChoice === 'chatgpt',
    'CHATGPT_RUNTIME_NOT_SELECTED',
    'This workspace is not consistently set to ChatGPT / Codex. Select it in workspace AI settings before running the harness; the harness never falls back to the local runtime.');
  check(record, 'data_sharing_acknowledged',
    Boolean(provider.preference.codexDataSharingAcknowledgedAt),
    'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED',
    'The workspace has not acknowledged ChatGPT data sharing.');
  note(record, 'runtimePolicy', {
    localEnabled: Boolean(provider.runtimePolicy.localEnabled),
    chatgptEnabled: Boolean(provider.runtimePolicy.chatgptEnabled),
    defaultRuntime: provider.runtimePolicy.defaultRuntime || null
  });
}

export async function deviceStatusPhase(context, record) {
  const provider = context.state.providerState || await readProviderState(context);
  const account = (provider.codex && provider.codex.account) || {};
  check(record, 'device_connected', account.connected === true, 'CHATGPT_NOT_CONNECTED',
    'No ChatGPT account is connected. Complete the device sign-in in the product first; this harness never starts a login.');
  check(record, 'device_auth_mode', trimmed(account.authMode) === 'chatgpt', 'CHATGPT_AUTH_MODE_UNEXPECTED',
    `The connected account uses auth mode ${trimmed(account.authMode) || 'none'} instead of chatgpt.`);
  check(record, 'device_login_not_pending', account.pendingLogin !== true, 'CHATGPT_LOGIN_PENDING',
    'A ChatGPT device sign-in is still waiting for completion.');
  check(record, 'device_login_error_absent', !account.loginError, 'CHATGPT_LOGIN_ERROR',
    'The connected account reports a sign-in error.');
  check(record, 'device_plan_present', Boolean(trimmed(account.planType)), 'CHATGPT_PLAN_UNKNOWN',
    'The connected account did not report a ChatGPT plan.');

  assertLiveAccount(account);
  check(record, 'fixture_account_rejected', true, 'FAKE_APP_SERVER_DETECTED', '');

  const accountFingerprint = fingerprint(trimmed(account.email).toLowerCase());
  context.state.accountFingerprint = accountFingerprint;
  note(record, 'accountFingerprint', accountFingerprint);
  note(record, 'planType', trimmed(account.planType));
  // The harness has no code path that starts, cancels, or completes a login.
  note(record, 'deviceLoginStartedByHarness', false);
  note(record, 'browserOpenedByHarness', false);
}

export async function modelCatalogPhase(context, record) {
  const provider = context.state.providerState || await readProviderState(context);
  const models = (provider.codex && Array.isArray(provider.codex.models) ? provider.codex.models : [])
    .filter((model) => model && trimmed(model.id));
  check(record, 'catalog_present', models.length > 0, 'CODEX_MODEL_UNAVAILABLE',
    'The connected ChatGPT account advertises no Codex model.');
  check(record, 'catalog_named', models.every((model) => trimmed(model.displayName)),
    'CODEX_MODEL_CATALOG_INVALID', 'A catalog entry is missing its display name.');
  check(record, 'catalog_efforts_advertised', models.some((model) => supportedEffortsFor(model).length > 0),
    'CODEX_REASONING_EFFORT_UNAVAILABLE', 'No catalog model advertises a reasoning effort.');

  assertLiveModelCatalog(models);
  check(record, 'fixture_catalog_rejected', true, 'FAKE_APP_SERVER_DETECTED', '');

  const effective = (provider.codex && provider.codex.effectiveConfiguration) || {};
  const effectiveModel = effective.default && effective.default.model ? effective.default.model.value : null;
  check(record, 'effective_model_in_catalog',
    Boolean(effectiveModel) && models.some((model) => model.id === effectiveModel),
    'CODEX_MODEL_UNAVAILABLE', 'The effective default model is not in the live catalog.');

  context.state.models = models;
  note(record, 'modelCount', models.length);
  note(record, 'modelIds', models.map((model) => model.id));
  note(record, 'defaultModelId', (models.find((model) => model.isDefault) || models[0]).id);
  note(record, 'reasoningEfforts', Object.fromEntries(models.map((model) => [model.id, supportedEffortsFor(model)])));
  note(record, 'actionCount', Array.isArray(provider.codex.actions) ? provider.codex.actions.length : 0);
}

export async function foregroundJobPhase(context, record) {
  const { client, options } = context;
  const provider = context.state.providerState || await readProviderState(context);
  const previous = provider.preference;
  context.state.previousPreference = {
    provider: previous.provider,
    codexModel: previous.codexModel,
    codexReasoningEffort: previous.codexReasoningEffort,
    codexActionOverrides: previous.codexActionOverrides || {}
  };

  const chosen = chooseModelAndEffort(context.state.models, {
    requestedModel: options.requestedModel,
    requestedEffort: options.requestedEffort
  });
  context.state.chosen = chosen;
  note(record, 'chosenModel', chosen.model);
  note(record, 'chosenReasoningEffort', chosen.reasoningEffort);
  note(record, 'chosenSelection', chosen.selection);
  note(record, 'actionId', ACCEPTANCE_ACTION_ID);

  const applied = await client.patch('/api/ai-provider', {
    provider: 'codex',
    codexModel: context.state.previousPreference.codexModel,
    codexReasoningEffort: context.state.previousPreference.codexReasoningEffort,
    codexActionOverrides: {
      ...context.state.previousPreference.codexActionOverrides,
      [ACCEPTANCE_ACTION_ID]: { model: chosen.model, reasoningEffort: chosen.reasoningEffort }
    }
  });
  check(record, 'choice_accepted', applied.status === 200 && Boolean(applied.data),
    'CODEX_CHOICE_REJECTED',
    `The chosen model and effort were rejected (HTTP ${applied.status}${applied.errorCode ? ` ${applied.errorCode}` : ''}).`);
  context.state.preferenceModified = true;
  context.state.providerState = applied.data;
  const resolved = applied.data.codex.effectiveConfiguration.actions[ACCEPTANCE_ACTION_ID];
  check(record, 'choice_resolved',
    resolved && resolved.model.value === chosen.model && resolved.reasoningEffort.value === chosen.reasoningEffort,
    'CODEX_CHOICE_NOT_EFFECTIVE', 'The backend did not resolve the chosen model and effort for this action.');
  check(record, 'choice_is_explicit',
    resolved.model.source === 'user_action' && resolved.reasoningEffort.source === 'user_action',
    'CODEX_CHOICE_NOT_EXPLICIT', 'The chosen model and effort were not recorded as an explicit action override.');

  const queued = await queueAcceptanceJob(context, 'foreground');
  const started = context.deps.now();
  const job = await pollJob(context, queued.jobId, (candidate) => candidate.state === 'completed', 'foreground');
  context.state.foregroundJob = job;

  assertCodexRuntime(job, chosen);
  check(record, 'ran_on_chatgpt_codex', true, 'CODEX_RUNTIME_REQUIRED', '');
  check(record, 'action_recorded', job.runtime.actionId === ACCEPTANCE_ACTION_ID,
    'CODEX_ACTION_MISMATCH', `The job recorded action ${job.runtime.actionId} instead of ${ACCEPTANCE_ACTION_ID}.`);
  check(record, 'output_produced', Boolean(surveyIdOf(job)),
    'AI_JOB_OUTPUT_MISSING', 'The completed job produced no applied survey output.');

  note(record, 'jobIdFingerprint', fingerprint(job.id));
  note(record, 'queueRequestIdFingerprint', fingerprint(queued.queueRequestId));
  note(record, 'runtime', {
    provider: job.runtime.provider,
    source: job.runtime.source,
    status: job.runtime.status,
    model: job.runtime.model,
    reasoningEffort: job.runtime.reasoningEffort,
    engine: job.result.runtime.engine,
    requestIdMatchesJobId: job.result.runtime.requestId === job.id
  });
  note(record, 'elapsedMs', context.deps.now() - started);
  note(record, 'generatedSurveyRemoved', await cleanUpGeneratedSurvey(context, job));
}

export async function signedOutJobPhase(context, record) {
  const { client, deps, options } = context;
  const queued = await queueAcceptanceJob(context, 'signed-out');
  const beforeLogout = await readJob(context, queued.jobId, 'signed-out');
  check(record, 'job_still_running', ['queued', 'processing'].includes(beforeLogout.state),
    'JOB_COMPLETED_BEFORE_LOGOUT',
    `The job reached ${beforeLogout.state} before sign-out, so nothing about signed-out execution was proven. Re-run the harness.`);

  const logout = await client.post('/api/auth/logout');
  check(record, 'logout_accepted', logout.status === 204 || logout.status === 200,
    'LOGOUT_FAILED', `Sign-out returned HTTP ${logout.status}.`);
  // Dropping the cookie jar is what closing the browser does to the session.
  client.clearSession();
  const loggedOutAt = deps.now();
  note(record, 'signedOutWindowMs', options.timeouts.signedOutWindowMs);

  let probes = 0;
  const until = loggedOutAt + options.timeouts.signedOutWindowMs;
  while (deps.now() < until) {
    const probe = await client.get(`/api/ai/jobs/${queued.jobId}`, { authenticated: false });
    probes += 1;
    if (probe.status !== 401) {
      check(record, 'signed_out_access_rejected', false, 'SIGNED_OUT_ACCESS_NOT_REJECTED',
        `A signed-out read of the job returned HTTP ${probe.status} instead of 401.`);
    }
    await deps.sleep(options.timeouts.pollMs);
  }
  check(record, 'signed_out_access_rejected', probes > 0, 'SIGNED_OUT_WINDOW_EMPTY',
    'No signed-out probe was made during the offline window.');
  note(record, 'signedOutProbes', probes);

  await signIn(context, 'signed-out recovery');
  const resumed = await readJob(context, queued.jobId, 'signed-out');
  check(record, 'progressed_while_signed_out', Date.parse(resumed.updatedAt) > loggedOutAt,
    'NO_PROGRESS_WHILE_SIGNED_OUT',
    'The queued job did not advance while no application session existed.');
  note(record, 'stateAtReturn', resumed.state);

  const job = await pollJob(context, queued.jobId, (candidate) => candidate.state === 'completed', 'signed-out');
  check(record, 'completed_after_logout', Date.parse(job.completedAt) > loggedOutAt,
    'JOB_NOT_COMPLETED_AFTER_LOGOUT', 'The job completion time did not follow sign-out.');

  assertCodexRuntime(job, context.state.chosen);
  check(record, 'ran_on_chatgpt_codex', true, 'CODEX_RUNTIME_REQUIRED', '');
  note(record, 'jobIdFingerprint', fingerprint(job.id));
  note(record, 'completedAfterLogoutMs', Date.parse(job.completedAt) - loggedOutAt);
  note(record, 'generatedSurveyRemoved', await cleanUpGeneratedSurvey(context, job));
}

export async function restartPhase(context, record) {
  const { client, deps, options } = context;
  const queued = await queueAcceptanceJob(context, 'restart');
  const running = await pollJob(context, queued.jobId,
    (candidate) => candidate.state === 'processing' || candidate.state === 'completed',
    'restart', Math.min(options.timeouts.jobMs, 120_000));
  check(record, 'job_in_flight', running.state === 'processing', 'RESTART_JOB_NOT_PROCESSING',
    `The job reached ${running.state} before the restart, so no in-flight work would have been interrupted. Re-run the harness.`);

  const before = deps.statDirectory(options.runtimeDir);
  const identityBefore = fingerprint(`${before.ino}:${before.birthtimeMs}`);

  const triggered = await deps.restart(options.restart);
  note(record, 'restartMode', options.restart.mode);
  note(record, 'restartTrigger', triggered && triggered.triggered ? triggered.triggered : options.restart.mode);

  const wentDown = await waitForBackend(context, false, options.timeouts.restartMs);
  check(record, 'backend_observed_down', wentDown, 'RESTART_NOT_OBSERVED',
    'The backend never became unreachable, so no restart was observed.');
  const cameBack = await waitForBackend(context, true, options.timeouts.restartMs);
  check(record, 'backend_recovered', cameBack, 'RESTART_NOT_RECOVERED',
    'The backend did not become ready again within the restart budget.');

  const after = deps.statDirectory(options.runtimeDir);
  const identityAfter = fingerprint(`${after.ino}:${after.birthtimeMs}`);
  check(record, 'runtime_directory_unchanged',
    Boolean(after && after.isDirectory) && identityAfter === identityBefore
    && identityBefore === context.state.runtimeIdentityBefore,
    'RUNTIME_DIR_CHANGED', 'The Codex runtime directory was replaced across the restart.');
  note(record, 'runtimeDirectoryIdentity', identityAfter);

  client.clearSession();
  await signIn(context, 'restart recovery');
  const provider = await readProviderState(context);
  context.state.providerState = provider;
  const account = (provider.codex && provider.codex.account) || {};
  check(record, 'still_connected_after_restart', account.connected === true && account.pendingLogin !== true,
    'CHATGPT_NOT_CONNECTED_AFTER_RESTART',
    'The ChatGPT account was not still connected after the restart.');
  check(record, 'same_account_after_restart',
    fingerprint(trimmed(account.email).toLowerCase()) === context.state.accountFingerprint,
    'CHATGPT_ACCOUNT_CHANGED', 'A different ChatGPT account was connected after the restart.');
  check(record, 'no_new_login_required', !account.loginError, 'CHATGPT_LOGIN_ERROR',
    'The account reported a sign-in error after the restart.');
  note(record, 'deviceLoginStartedByHarness', false);

  const resumed = await readJob(context, queued.jobId, 'restart');
  note(record, 'stageAfterRestart', trimmed(resumed.stage));
  note(record, 'recoveredAfterRestartObserved', trimmed(resumed.stage) === 'recovered_after_restart');

  const job = await pollJob(context, queued.jobId, (candidate) => candidate.state === 'completed', 'restart');
  assertCodexRuntime(job, context.state.chosen);
  check(record, 'completed_after_restart', true, 'CODEX_RUNTIME_REQUIRED', '');
  note(record, 'jobIdFingerprint', fingerprint(job.id));
  note(record, 'attempts', job.attempt);
  note(record, 'generatedSurveyRemoved', await cleanUpGeneratedSurvey(context, job));
}

/**
 * Probes far more often than the job poll interval: a fast restart must still
 * be observed, because an unobserved restart fails the phase.
 */
async function waitForBackend(context, wantReady, timeoutMs) {
  const { client, deps, options } = context;
  const deadline = deps.now() + timeoutMs;
  const interval = Math.min(options.timeouts.pollMs, 250);
  while (deps.now() <= deadline) {
    const probe = await client.probeHealth(Math.min(5_000, options.timeouts.requestMs));
    const ready = probe.reachable && probe.ok && Boolean(probe.data && probe.data.databaseReady);
    if (ready === wantReady) return true;
    await deps.sleep(interval);
  }
  return false;
}

async function restorePreference(context) {
  const previous = context.state.previousPreference;
  if (!previous || !context.state.preferenceModified) return null;
  try {
    const response = await context.client.patch('/api/ai-provider', {
      provider: previous.provider,
      codexModel: previous.codexModel,
      codexReasoningEffort: previous.codexReasoningEffort,
      codexActionOverrides: previous.codexActionOverrides
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

function resolveDeps(deps) {
  const resolved = {
    fetchImpl: deps && deps.fetchImpl,
    statDirectory: deps && deps.statDirectory,
    restart: deps && deps.restart,
    log: (deps && deps.log) || (() => {}),
    now: (deps && deps.now) || (() => Date.now()),
    sleep: (deps && deps.sleep) || ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); })),
    newId: (deps && deps.newId) || (() => crypto.randomUUID())
  };
  for (const name of ['fetchImpl', 'statDirectory', 'restart']) {
    if (typeof resolved[name] !== 'function') {
      throw new AcceptanceError(`The ${name} dependency is required.`, 'DEPENDENCY_MISSING');
    }
  }
  return resolved;
}

/**
 * Run every phase in order. `mode` defaults to 'self-test' so that a caller can
 * never accidentally produce evidence that claims to be a live run.
 */
export async function runAcceptance(input) {
  const options = input.options;
  const mode = input.mode === 'live' ? 'live' : 'self-test';
  const deps = resolveDeps(input.deps);
  const redact = createRedactor(secretsOf(options));
  const runId = deps.newId();
  const client = input.client || createApiClient({
    baseUrl: options.baseUrl,
    fetchImpl: deps.fetchImpl,
    spaceId: options.spaceId,
    newRequestId: deps.newId,
    defaultTimeoutMs: options.timeouts.requestMs
  });

  const report = {
    harness: HARNESS_NAME,
    version: HARNESS_VERSION,
    mode,
    live: mode === 'live',
    proves: mode === 'live' ? LIVE_PROOF_STATEMENT : SELF_TEST_PROOF_STATEMENT,
    runId,
    target: { host: options.baseUrlHost },
    startedAt: iso(deps.now()),
    finishedAt: null,
    durationMs: 0,
    status: 'failed',
    failure: null,
    phases: [],
    requestIds: { issued: 0, unique: 0, allUnique: false }
  };

  const context = {
    options, deps, client, report, redact,
    state: { queuedRequestIds: [], preferenceModified: false }
  };

  const phases = [
    ['readiness', readinessPhase],
    ['device_status', deviceStatusPhase],
    ['model_catalog', modelCatalogPhase],
    ['foreground_job', foregroundJobPhase],
    ['signed_out_job', signedOutJobPhase],
    ['backend_restart', restartPhase]
  ];

  const startedAt = deps.now();
  try {
    for (const [id, body] of phases) {
      const definition = PHASE_DEFINITIONS.find((entry) => entry.id === id);
      const record = {
        id, title: definition.title, status: 'running',
        startedAt: iso(deps.now()), durationMs: 0, checks: [], data: {}
      };
      report.phases.push(record);
      const phaseStartedAt = deps.now();
      deps.log(`phase ${id}: ${definition.title}`);
      try {
        await body(context, record);
        record.status = 'passed';
      } catch (error) {
        record.status = 'failed';
        record.failure = {
          code: error && error.code ? error.code : 'UNEXPECTED_ERROR',
          message: summarize(redact, error && error.message ? error.message : error, 400)
        };
        throw error;
      } finally {
        record.durationMs = deps.now() - phaseStartedAt;
      }
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    const failedPhase = report.phases.find((phase) => phase.status === 'failed');
    report.failure = {
      phase: failedPhase ? failedPhase.id : null,
      code: error && error.code ? error.code : 'UNEXPECTED_ERROR',
      message: summarize(redact, error && error.message ? error.message : error, 400)
    };
  } finally {
    report.restoredPreference = await restorePreference(context);
    report.finishedAt = iso(deps.now());
    report.durationMs = deps.now() - startedAt;
    const issued = client.requestIds;
    report.requestIds = {
      issued: issued.length,
      unique: new Set(issued).size,
      allUnique: issued.length === new Set(issued).size
    };
    if (!report.requestIds.allUnique && report.status === 'passed') {
      report.status = 'failed';
      report.failure = { phase: null, code: 'REQUEST_ID_NOT_UNIQUE', message: 'The harness reused an HTTP request id.' };
    }
    assertRedactedEvidence(report, secretsOf(options));
  }
  return report;
}

export function evidenceFilename(report) {
  const stamp = String(report.startedAt).replace(/[:.]/gu, '-');
  return `${HARNESS_NAME}-${report.mode}-${stamp}-${String(report.runId).slice(0, 8)}.json`;
}

/* ------------------------------------------------------------------------- */
/* Expiry and refresh checkpoint                                             */
/* ------------------------------------------------------------------------- */

export const CHECKPOINT_NAME = 'codex-live-expiry-checkpoint';
export const CHECKPOINT_VERSION = 1;
export const CHECKPOINT_ABSOLUTE_MINIMUM_HOURS = 20;

const UNSAFE_STATE_BASENAME = /auth|token|secret|password|credential|cookie|session|\.env/iu;

/**
 * Every file this harness writes (evidence and checkpoint state) must live
 * outside the Codex runtime directory and must never be mistakable for
 * credential material.
 */
export function assertHarnessFilePath(file, options) {
  const resolved = path.resolve(file);
  if (UNSAFE_STATE_BASENAME.test(path.basename(resolved))) {
    throw new AcceptanceError('That file name is reserved for credential material.', 'HARNESS_PATH_REFUSED');
  }
  const runtimeDir = options && options.runtimeDir ? path.resolve(options.runtimeDir) : null;
  if (runtimeDir) {
    const relative = path.relative(runtimeDir, resolved);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new AcceptanceError('The harness must not write inside the Codex runtime directory.', 'HARNESS_PATH_REFUSED');
    }
  }
  return resolved;
}

export function createCheckpointState(input) {
  const minimumHours = Math.max(CHECKPOINT_ABSOLUTE_MINIMUM_HOURS, Number(input.minimumHours) || 0);
  const armedAtMs = input.now;
  return {
    harness: CHECKPOINT_NAME,
    version: CHECKPOINT_VERSION,
    runId: input.runId,
    host: input.host,
    accountFingerprint: input.accountFingerprint,
    minimumHours,
    armedAt: iso(armedAtMs),
    armedAtMs,
    armedDateUtc: utcDate(armedAtMs),
    notBeforeMs: armedAtMs + minimumHours * 3_600_000,
    notBefore: iso(armedAtMs + minimumHours * 3_600_000),
    verifications: []
  };
}

/**
 * Decide whether the refresh checkpoint may be verified yet. Two independent
 * rules make a same-day pass impossible: a minimum elapsed time of at least
 * twenty hours, and a different UTC calendar day from the arming run.
 */
export function evaluateExpiryCheckpoint(state, now) {
  const reasons = [];
  if (!state || state.harness !== CHECKPOINT_NAME || state.version !== CHECKPOINT_VERSION
    || !Number.isFinite(Number(state.armedAtMs)) || !Number.isFinite(Number(state.notBeforeMs))
    || !state.armedDateUtc) {
    return { due: false, reasons: ['CHECKPOINT_STATE_INVALID'], elapsedHours: 0, armedDateUtc: null, nowDateUtc: utcDate(now) };
  }
  const armedAtMs = Number(state.armedAtMs);
  const elapsedHours = (now - armedAtMs) / 3_600_000;
  if (now < armedAtMs) reasons.push('CLOCK_MOVED_BACKWARDS');
  if (now < Number(state.notBeforeMs)) reasons.push('MINIMUM_WAIT_NOT_ELAPSED');
  if (elapsedHours < CHECKPOINT_ABSOLUTE_MINIMUM_HOURS) reasons.push('MINIMUM_WAIT_NOT_ELAPSED');
  if (utcDate(now) === state.armedDateUtc) reasons.push('SAME_UTC_DAY_AS_ARMING');
  return {
    due: reasons.length === 0,
    reasons: [...new Set(reasons)],
    elapsedHours: Math.round(elapsedHours * 100) / 100,
    armedDateUtc: state.armedDateUtc,
    nowDateUtc: utcDate(now)
  };
}

/**
 * Arm the checkpoint: prove the account is connected now, and record the
 * instant that a later run has to measure the silent token refresh against.
 */
export async function armExpiryCheckpoint(input) {
  const { options } = input;
  const deps = resolveDeps(input.deps);
  const redact = createRedactor(secretsOf(options));
  const client = input.client || createApiClient({
    baseUrl: options.baseUrl,
    fetchImpl: deps.fetchImpl,
    spaceId: options.spaceId,
    newRequestId: deps.newId,
    defaultTimeoutMs: options.timeouts.requestMs
  });
  const runId = deps.newId();
  const report = {
    harness: CHECKPOINT_NAME,
    version: CHECKPOINT_VERSION,
    mode: input.mode === 'live' ? 'live' : 'self-test',
    live: input.mode === 'live',
    proves: input.mode === 'live'
      ? 'Live ChatGPT / Codex expiry and refresh checkpoint. Arming alone is never a pass.'
      : SELF_TEST_PROOF_STATEMENT,
    action: 'arm',
    runId,
    target: { host: options.baseUrlHost },
    startedAt: iso(deps.now()),
    status: 'armed',
    passed: false,
    checks: [],
    data: {}
  };
  const record = { checks: report.checks, data: report.data };
  const context = { options, deps, client, report, redact, state: { queuedRequestIds: [] } };

  await readinessPhase(context, record);
  await deviceStatusPhase(context, record);
  const state = createCheckpointState({
    now: deps.now(),
    runId,
    host: options.baseUrlHost,
    accountFingerprint: context.state.accountFingerprint,
    minimumHours: options.checkpoint.minimumHours
  });
  report.data.armedAt = state.armedAt;
  report.data.notBefore = state.notBefore;
  report.data.minimumHours = state.minimumHours;
  report.finishedAt = iso(deps.now());
  assertRedactedEvidence(report, secretsOf(options));
  return { report, state };
}

/**
 * Verify the checkpoint. Refuses on the same UTC day or before the minimum
 * wait, then requires the account to still be usable with no new sign-in and a
 * real job to complete on ChatGPT / Codex.
 */
export async function verifyExpiryCheckpoint(input) {
  const { options, state } = input;
  const deps = resolveDeps(input.deps);
  const redact = createRedactor(secretsOf(options));
  const client = input.client || createApiClient({
    baseUrl: options.baseUrl,
    fetchImpl: deps.fetchImpl,
    spaceId: options.spaceId,
    newRequestId: deps.newId,
    defaultTimeoutMs: options.timeouts.requestMs
  });
  const runId = deps.newId();
  const report = {
    harness: CHECKPOINT_NAME,
    version: CHECKPOINT_VERSION,
    mode: input.mode === 'live' ? 'live' : 'self-test',
    live: input.mode === 'live',
    proves: input.mode === 'live'
      ? 'Live ChatGPT / Codex expiry and refresh checkpoint verified across a calendar day boundary.'
      : SELF_TEST_PROOF_STATEMENT,
    action: 'verify',
    runId,
    target: { host: options.baseUrlHost },
    startedAt: iso(deps.now()),
    status: 'failed',
    passed: false,
    checks: [],
    data: {},
    failure: null
  };
  const record = { checks: report.checks, data: report.data };
  const context = { options, deps, client, report, redact, state: { queuedRequestIds: [], preferenceModified: false } };

  try {
    const due = evaluateExpiryCheckpoint(state, deps.now());
    report.data.elapsedHours = due.elapsedHours;
    report.data.armedDateUtc = due.armedDateUtc;
    report.data.nowDateUtc = due.nowDateUtc;
    report.data.notDueReasons = due.reasons;
    check(record, 'checkpoint_due', due.due, 'EXPIRY_CHECKPOINT_NOT_DUE',
      `The expiry and refresh checkpoint cannot be verified yet (${due.reasons.join(', ')}). It can never pass on the day it was armed.`);

    await readinessPhase(context, record);
    await deviceStatusPhase(context, record);
    check(record, 'same_account_as_armed',
      context.state.accountFingerprint === state.accountFingerprint,
      'CHATGPT_ACCOUNT_CHANGED', 'A different ChatGPT account is connected than the one the checkpoint was armed with.');
    check(record, 'same_target_as_armed', options.baseUrlHost === state.host,
      'CHECKPOINT_TARGET_CHANGED', 'The checkpoint was armed against a different backend.');
    await modelCatalogPhase(context, record);

    // A live model catalog read and a completed job both require a currently
    // valid access token, so reaching here after the boundary is the refresh.
    const queued = await queueAcceptanceJob(context, 'expiry-checkpoint');
    const job = await pollJob(context, queued.jobId, (candidate) => candidate.state === 'completed', 'expiry-checkpoint');
    assertCodexRuntime(job, null);
    check(record, 'job_completed_after_expiry_window', true, 'CODEX_RUNTIME_REQUIRED', '');
    record.data.generatedSurveyRemoved = await cleanUpGeneratedSurvey(context, job);
    record.data.jobIdFingerprint = fingerprint(job.id);
    report.status = 'passed';
    report.passed = true;
  } catch (error) {
    report.status = 'failed';
    report.passed = false;
    report.failure = {
      code: error && error.code ? error.code : 'UNEXPECTED_ERROR',
      message: summarize(redact, error && error.message ? error.message : error, 400)
    };
  } finally {
    report.finishedAt = iso(deps.now());
    const issued = client.requestIds;
    report.requestIds = { issued: issued.length, unique: new Set(issued).size, allUnique: issued.length === new Set(issued).size };
    assertRedactedEvidence(report, secretsOf(options));
  }
  return report;
}
