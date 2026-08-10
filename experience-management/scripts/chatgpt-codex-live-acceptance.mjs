import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIVE_OPT_IN = 'I_UNDERSTAND_THIS_USES_MY_REAL_CHATGPT_ACCOUNT';
export const DEVICE_FLOW_OPT_IN = 'START_REAL_CHATGPT_DEVICE_FLOW';
export const REFRESH_WAIT_MS = 25 * 60 * 60 * 1000;
export const BACKGROUND_SESSION_FREE_MIN_MS = 60_000;
const phases = new Set(['readiness','foreground','background','restart-prepare','restart-reuse',
  'refresh-prepare','refresh-checkpoint']);
const forbiddenEvidenceKeys = /(answer|authorization|body|code|content|cookie|credential|email|message|output|password|prompt|secret|token|url)/iu;

function invariant(value, message) { if (!value) throw new Error(message); }
export function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function iso(value = Date.now()) { return new Date(value).toISOString(); }
function directExecution() { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }

export function assertLiveGate(environment = process.env) {
  invariant(environment.LIVE_CHATGPT_ACCEPTANCE === LIVE_OPT_IN,
    `Refusing live execution: set LIVE_CHATGPT_ACCEPTANCE=${LIVE_OPT_IN}.`);
  invariant(!environment.CI && !environment.GITHUB_ACTIONS && !environment.TF_BUILD,
    'Refusing live ChatGPT acceptance execution in CI.');
  invariant(!String(environment.CODEX_CLI_PATH || '').trim(),
    'Refusing live execution while CODEX_CLI_PATH overrides the real installed Codex CLI.');
  const runtimeDirectory = String(environment.CODEX_RUNTIME_DIR || '').trim();
  invariant(runtimeDirectory, 'CODEX_RUNTIME_DIR must identify the persistent live runtime directory.');
  return { runtimeDirectory, runtimeDirectorySha256: digest(path.resolve(runtimeDirectory)) };
}

export function assertLiveBaseUrl(value) {
  const url = new URL(value);
  const loopback = ['127.0.0.1','localhost','::1'].includes(url.hostname);
  invariant(url.protocol === 'https:' || (loopback && url.protocol === 'http:'),
    'Live acceptance requires HTTPS, except for an explicit loopback backend.');
  invariant(!url.username && !url.password && !url.search && !url.hash,
    'The live base URL must not contain credentials, query parameters, or fragments.');
  return url.href.replace(/\/$/u, '');
}

export function selectLiveModel(state, requestedModel, requestedEffort) {
  invariant(state?.codex?.available === true, `Codex App Server is unavailable: ${String(state?.codex?.error || 'unknown')}`);
  invariant(state.codex.account?.connected === true && state.codex.account?.authMode === 'chatgpt',
    'A real ChatGPT account is not connected.');
  const models = Array.isArray(state.codex.models) ? state.codex.models.filter((model) =>
    model && !model.hidden && typeof model.id === 'string') : [];
  invariant(models.length > 0, 'The connected ChatGPT account returned no usable Codex models.');
  invariant(!models.some((model) => /(^|[-_.])(fake|fixture|mock|test)([-_.]|$)/iu.test(model.id)
    || /\b(fake|fixture|mock|test)\b/iu.test(String(model.displayName || ''))),
  'The model catalogue looks synthetic; refusing to record live proof.');
  invariant(!/\.test$/iu.test(String(state.codex.account.email || '')),
    'The connected account looks synthetic; refusing to record live proof.');
  const model = requestedModel ? models.find((item) => item.id === requestedModel)
    : models.find((item) => item.isDefault) || models[0];
  invariant(model, `Requested model ${requestedModel} is not in the live account catalogue.`);
  const efforts = [...new Set([...(model.supportedReasoningEfforts || []).map((item) => item.reasoningEffort),
    model.defaultReasoningEffort].filter(Boolean))];
  invariant(efforts.length > 0, `${model.id} advertises no usable reasoning effort.`);
  const effort = requestedEffort || model.defaultReasoningEffort || efforts[0];
  invariant(efforts.includes(effort), `${model.id} does not advertise reasoning effort ${effort}.`);
  return { model: model.id, effort, modelCount: models.length };
}

export function safeEvidence(record) {
  const visit = (value, location) => {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${location}[${index}]`));
    if (!value || typeof value !== 'object') {
      invariant(value === null || ['string','number','boolean'].includes(typeof value),
        `Evidence ${location} contains an unsupported value.`);
      return value;
    }
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      invariant(!forbiddenEvidenceKeys.test(key), `Evidence field ${location}.${key} is forbidden.`);
      next[key] = visit(item, `${location}.${key}`);
    }
    return next;
  };
  return visit(record, 'record');
}

export function appendEvidence(file, record) {
  const safe = safeEvidence(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Best effort on Windows. */ }
  return safe;
}

export function readEvidence(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => safeEvidence(JSON.parse(line)));
}

export class AcceptanceApi {
  constructor(baseUrl, fetchImpl = fetch) { this.baseUrl = assertLiveBaseUrl(baseUrl); this.fetchImpl = fetchImpl; this.cookie = ''; }
  async request(resource, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.cookie) headers.set('cookie', this.cookie);
    if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await this.fetchImpl(`${this.baseUrl}${resource}`, { ...options, headers,
      body: options.body === undefined || typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
      redirect: 'error' });
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
    if (setCookies.length) this.cookie = setCookies.map((entry) => entry.split(';', 1)[0]).join('; ');
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Live API ${options.method || 'GET'} ${resource} failed (${response.status}): ${String(data?.code || data?.error || 'unknown')}`);
    return { data, receivedAt: Date.now() };
  }
  async login(email, password) {
    invariant(email && password,
      'LIVE_APP_EMAIL and LIVE_APP_PASSWORD are required Seemplify application credentials for this phase; never provide ChatGPT credentials.');
    return this.request('/api/auth/login', { method: 'POST', body: { email, password } });
  }
  async logout() { const result = await this.request('/api/auth/logout', { method: 'POST' }); this.cookie = ''; return result; }
}

function findCodexRuntime(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (value.provider === 'openai-codex' && value.engine === 'codex-app-server') return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findCodexRuntime(child, seen); if (found) return found;
  }
  return null;
}

async function providerState(api) { return (await api.request('/api/ai-provider')).data; }
async function configureProvider(api, selection) {
  const result = await api.request('/api/ai-provider', { method: 'PATCH', body: {
    provider: 'codex', codexModel: selection.model, codexReasoningEffort: selection.effort,
    codexDataSharingAcknowledged: true
  } });
  invariant(result.data?.preference?.effectiveProvider === 'codex'
    || result.data?.preference?.provider === 'codex', 'The live API did not select Codex.');
  return result.data;
}

async function queueJob(api, surveyId, marker) {
  invariant(surveyId, 'LIVE_CHATGPT_SURVEY_ID is required for completion phases.');
  const response = await api.request(`/api/surveys/${encodeURIComponent(surveyId)}/ai/ask`, {
    method: 'POST', body: { question: `Live Codex acceptance ${marker}. Return a concise evidence-grounded answer.`, knowledgeBaseIds: [] }
  });
  invariant(typeof response.data?.jobId === 'string' && response.data.jobId,
    'The real API did not return a durable job ID.');
  return { jobId: response.data.jobId, queuedAt: response.receivedAt };
}

async function readJob(api, jobId) { return (await api.request(`/api/ai/jobs/${encodeURIComponent(jobId)}`)).data; }
async function waitForJob(api, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await readJob(api, jobId);
    if (job.state === 'completed') return job;
    if (job.state === 'failed') throw new Error(`Live Codex job failed at ${String(job.stage || 'unknown')}: ${String(job.error || 'redacted')}`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Live Codex job did not complete within the acceptance timeout.');
}

function verifiedJob(job, selection) {
  const runtime = findCodexRuntime(job);
  invariant(runtime, 'The completed job has no real openai-codex/codex-app-server runtime receipt.');
  invariant(runtime.model === selection.model && runtime.reasoningEffort === selection.effort,
    'The completed job did not use the selected live model and effort.');
  invariant(job.state === 'completed' && job.completedAt, 'The job is not durably completed.');
  return { completedAt: Date.parse(job.completedAt), runtime };
}

function evidenceFile(environment, runtimeDirectory) {
  const configured = String(environment.LIVE_CHATGPT_EVIDENCE_FILE || '').trim();
  const file = path.resolve(configured || path.join(path.dirname(path.resolve(runtimeDirectory)),
    'live-acceptance', 'chatgpt-codex-evidence.jsonl'));
  const runtime = path.resolve(runtimeDirectory).toLowerCase();
  invariant(!(file.toLowerCase() === runtime || file.toLowerCase().startsWith(`${runtime}${path.sep}`)),
    'Evidence must not be written inside CODEX_RUNTIME_DIR.');
  return file;
}

function baseRecord(context, phase, requestId) { return { schema: 'seemplify.chatgpt-codex-live-acceptance/v1',
  proofClass: context.proofClass,
  phase, status: 'passed', observedAt: iso(), requestSha256: digest(requestId),
  runtimeDirectorySha256: context.runtimeDirectorySha256, instanceSha256: digest(context.instanceId) }; }

export async function runPhase(phase, environment = process.env, dependencies = {}) {
  invariant(phases.has(phase), `Unknown phase ${phase}.`);
  const gate = dependencies.testMode ? { runtimeDirectory: environment.CODEX_RUNTIME_DIR || 'test-runtime',
    runtimeDirectorySha256: digest(path.resolve(environment.CODEX_RUNTIME_DIR || 'test-runtime')) } : assertLiveGate(environment);
  const instanceId = String(environment.LIVE_BACKEND_INSTANCE_ID || '').trim();
  invariant(instanceId, 'LIVE_BACKEND_INSTANCE_ID must uniquely identify this backend process start.');
  const context = { ...gate, instanceId, proofClass: dependencies.testMode ? 'self_test_logic_only' : 'live' };
  const file = evidenceFile(environment, gate.runtimeDirectory);
  const api = new AcceptanceApi(environment.LIVE_CHATGPT_BASE_URL || 'http://127.0.0.1:5410', dependencies.fetchImpl);
  // These authenticate the Seemplify app session only. ChatGPT authorization remains in the Codex device flow.
  const email = environment.LIVE_APP_EMAIL; const password = environment.LIVE_APP_PASSWORD;
  const requestId = crypto.randomUUID();
  await api.login(email, password);
  let state = await providerState(api);
  if (!state?.codex?.account?.connected) {
    if (phase === 'readiness' && environment.LIVE_CHATGPT_START_DEVICE_FLOW === DEVICE_FLOW_OPT_IN) {
      const started = (await api.request('/api/ai-provider/codex/device-login', { method: 'POST', body: {} })).data;
      invariant(started?.connected === false && started?.verificationUrl && started?.userCode,
        'The real App Server did not return a complete device authorization request.');
      process.stdout.write(`Open ${started.verificationUrl}\nEnter code: ${started.userCode}\n`);
      appendEvidence(file, { ...baseRecord(context, phase, requestId), status: 'device_authorization_required' });
      await api.logout(); return { status: 'device_authorization_required', evidenceFile: file };
    }
    throw new Error('ChatGPT is not connected. Run readiness with the separate device-flow opt-in.');
  }
  const selection = selectLiveModel(state, environment.LIVE_CHATGPT_MODEL, environment.LIVE_CHATGPT_EFFORT);
  if (phase === 'readiness') {
    await api.logout(); appendEvidence(file, { ...baseRecord(context, phase, requestId), model: selection.model,
      effort: selection.effort, modelCount: selection.modelCount, authMode: 'chatgpt' });
    return { status: 'passed', evidenceFile: file, selection };
  }
  if (phase === 'restart-prepare' || phase === 'refresh-prepare') {
    const refreshPreparation = phase === 'refresh-prepare';
    await api.logout(); const record = { ...baseRecord(context, phase, requestId),
      status: refreshPreparation ? 'checkpoint_prepared' : 'passed', model: selection.model,
      effort: selection.effort, modelCount: selection.modelCount,
      ...(refreshPreparation ? { claim: 'long_lived_credential_reuse',
        notBefore: iso(Date.now() + REFRESH_WAIT_MS), preparedDate: iso().slice(0, 10) } : {}) };
    appendEvidence(file, record); return { status: record.status, evidenceFile: file, selection,
      ...(refreshPreparation ? { claim: record.claim } : {}) };
  }
  const prior = readEvidence(file);
  if (phase === 'restart-reuse' || phase === 'refresh-checkpoint') {
    const preparePhase = phase === 'restart-reuse' ? 'restart-prepare' : 'refresh-prepare';
    const prepareStatus = phase === 'restart-reuse' ? 'passed' : 'checkpoint_prepared';
    const prepared = [...prior].reverse().find((item) => item.phase === preparePhase && item.status === prepareStatus);
    invariant(prepared, `No ${prepareStatus} ${preparePhase} evidence exists.`);
    invariant(prepared.runtimeDirectorySha256 === context.runtimeDirectorySha256,
      'The runtime directory changed between checkpoint phases.');
    invariant(prepared.instanceSha256 !== digest(instanceId),
      'The backend instance marker did not change; restart reuse cannot be claimed.');
    if (phase === 'refresh-checkpoint') {
      invariant(prepared.claim === 'long_lived_credential_reuse', 'The long-lived reuse preparation claim is missing.');
      invariant(Date.now() >= Date.parse(prepared.notBefore), 'The 25-hour long-lived reuse checkpoint has not matured.');
      invariant(prepared.preparedDate !== iso().slice(0, 10),
        'A long-lived reuse checkpoint cannot run on its preparation date.');
    }
  }
  await configureProvider(api, selection);
  const queued = await queueJob(api, environment.LIVE_CHATGPT_SURVEY_ID, `${phase}-${requestId}`);
  if (phase === 'background') {
    const logout = await api.logout();
    const requestedClosedMs = Number(environment.LIVE_BACKGROUND_CLOSED_MS || BACKGROUND_SESSION_FREE_MIN_MS);
    invariant(Number.isFinite(requestedClosedMs), 'LIVE_BACKGROUND_CLOSED_MS must be a finite number of milliseconds.');
    const closedMs = Math.max(BACKGROUND_SESSION_FREE_MIN_MS, requestedClosedMs);
    await new Promise((resolve) => setTimeout(resolve, closedMs));
    const loginStarted = Date.now(); await api.login(email, password);
    const job = await readJob(api, queued.jobId); const proof = verifiedJob(job, selection);
    invariant(proof.completedAt >= logout.receivedAt && proof.completedAt <= loginStarted,
      'The job did not durably complete inside the app-session-free interval.');
    await api.logout(); appendEvidence(file, { ...baseRecord(context, phase, requestId),
      jobSha256: digest(queued.jobId), model: proof.runtime.model, effort: proof.runtime.reasoningEffort,
      engine: proof.runtime.engine, sessionFreeMs: loginStarted - logout.receivedAt });
    return { status: 'passed', evidenceFile: file };
  }
  const job = await waitForJob(api, queued.jobId, Math.max(30_000, Number(environment.LIVE_CHATGPT_TIMEOUT_MS || 360_000)));
  const proof = verifiedJob(job, selection); await api.logout();
  const refreshCandidate = phase === 'refresh-checkpoint';
  const status = refreshCandidate ? 'refresh_candidate' : 'passed';
  appendEvidence(file, { ...baseRecord(context, phase, requestId), status,
    ...(refreshCandidate ? { claim: 'long_lived_credential_reuse' } : {}), jobSha256: digest(queued.jobId),
    model: proof.runtime.model, effort: proof.runtime.reasoningEffort, engine: proof.runtime.engine });
  return { status, ...(refreshCandidate ? { claim: 'long_lived_credential_reuse' } : {}), evidenceFile: file };
}

if (directExecution()) {
  const phase = process.argv[2] || '';
  runPhase(phase).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`), (error) => {
    process.stderr.write(`ChatGPT/Codex live acceptance FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
