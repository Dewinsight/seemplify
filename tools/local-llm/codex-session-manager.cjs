'use strict';

/**
 * Per-subject Codex App Server sessions.
 *
 * The shared-account Codex adapter spawns `codex exec` once per request against
 * one gateway-wide CODEX_HOME. That cannot express "this inference belongs to
 * this person's ChatGPT plan", so a subject that wants to use its own account
 * gets its own long-lived `codex app-server` process with its own CODEX_HOME.
 *
 * This module is pure transport: it owns process lifecycle, the JSON-RPC
 * conversation, and account state. Prompt shaping, schema parsing, and the
 * response envelope stay in engine-adapters.cjs so both Codex paths produce
 * identical output and there is no import cycle.
 */

const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(workspaceRoot, '.local-runtime', 'llm');
const codexInstallDir = path.join(runtimeDir, 'codex-cli');

/** Resolved per launch rather than at import so a test can point the session
 * manager at a fake app server, and so an operator can relocate either path
 * without a restart ordering constraint. */
function resolveCodexScript(source = process.env) {
  const configured = String(source.CODEX_CLI_PATH || '').trim();
  return configured
    ? path.resolve(configured)
    : path.join(codexInstallDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
}

function resolveSubjectsDir(source = process.env) {
  const configured = String(source.CODEX_SUBJECTS_DIR || '').trim();
  return configured ? path.resolve(configured) : path.join(runtimeDir, 'codex-subjects');
}

const PERMISSION_PROFILE = 'seemplify-read-only';
const MAX_SESSIONS = Math.max(1, Number(process.env.CODEX_MAX_SUBJECT_SESSIONS || 8));
const IDLE_SESSION_MS = Math.max(60_000, Number(process.env.CODEX_SUBJECT_IDLE_MS || 10 * 60_000));

/** Per-user sessions stay off until a deployment opts in, so the existing
 * shared-account Codex path is unaffected by merely shipping this module. */
function perUserSessionsEnabled(source = process.env) {
  return String(source.CODEX_PER_USER_SESSIONS || '').trim().toLowerCase() === 'true';
}

/**
 * Namespaced so one product can never address another product's session even
 * if it guesses a user id. `sourceApp` comes from the authenticated gateway
 * identity, never from the request body.
 */
function subjectKeyFor(sourceApp, subjectId) {
  const app = String(sourceApp || '').trim().toLowerCase();
  const subject = String(subjectId || '').trim();
  if (!app) throw codexError('A Codex subject requires an authenticated source application.', 'CODEX_SUBJECT_APP_REQUIRED');
  if (!subject) throw codexError('A Codex subject requires a subject identifier.', 'CODEX_SUBJECT_REQUIRED');
  return crypto.createHash('sha256').update(`${app}${subject}`).digest('hex');
}

/**
 * `sourceApp` is asserted by the caller, not proved: every product signs with
 * the same shared gateway secret, so this namespace stops two products
 * colliding on the same user id — it is not a defence against a caller that
 * already holds the secret. The allowlist keeps the namespace closed.
 */
function allowedSourceApps(source = process.env) {
  return new Set(String(source.CODEX_SUBJECT_SOURCE_APPS || 'recruiter')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
}

/** Returns `{ subjectKey }` or `{ error: { status, code } }` — never throws, so
 * a malformed request becomes a status code rather than a 500. */
function resolveSubjectRequest(claim, source = process.env) {
  const sourceApp = String(claim?.sourceApp || '').trim().toLowerCase();
  const subjectId = String(claim?.subjectId || '').trim();
  if (!allowedSourceApps(source).has(sourceApp)) {
    return { error: { status: 403, code: 'CODEX_SOURCE_APP_NOT_ALLOWED' } };
  }
  if (!subjectId || subjectId.length > 200 || /[\u0000-\u001f\u007f]/u.test(subjectId)) {
    return { error: { status: 400, code: 'CODEX_SUBJECT_INVALID' } };
  }
  return { subjectKey: subjectKeyFor(sourceApp, subjectId) };
}

/**
 * Model and effort resolution, ported from Experience Management's
 * resolveCodexConfiguration.
 *
 * The caller supplies ordered candidates with a source label rather than one
 * value, because plans differ: an administrator may legitimately choose a model
 * a given user's ChatGPT plan does not advertise. Resolution walks the
 * candidates, then degrades to the connected account's own default rather than
 * failing, and always reports which source actually won.
 */
function visibleModels(models) {
  return (Array.isArray(models) ? models : [])
    .filter((model) => model && !model.hidden && model.id && model.displayName);
}

function supportedEfforts(model) {
  const advertised = (model?.supportedReasoningEfforts || [])
    .map((item) => String(item?.reasoningEffort || '').trim())
    .filter(Boolean);
  const modelDefault = String(model?.defaultReasoningEffort || '').trim();
  return [...new Set([...advertised, ...(modelDefault ? [modelDefault] : [])])];
}

function safeConnectedModel(models) {
  const available = visibleModels(models);
  return available.find((model) => model.isDefault) || available[0] || null;
}

function orderedCandidates(candidates) {
  const result = [];
  const seen = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const value = String(candidate?.value || '').trim();
    const source = String(candidate?.source || '').trim();
    if (!value || !source || seen.has(value)) continue;
    seen.add(value);
    result.push({ value, source });
  }
  return result;
}

function resolveCodexConfiguration({ models, modelCandidates, effortCandidates }) {
  const available = visibleModels(models);
  const byId = new Map(available.map((model) => [model.id, model]));
  const orderedModels = orderedCandidates(modelCandidates);
  const orderedEfforts = orderedCandidates(effortCandidates);

  const configuredModel = orderedModels.find((candidate) => byId.has(candidate.value));
  const modelDefinition = configuredModel ? byId.get(configuredModel.value) : safeConnectedModel(available);
  if (!modelDefinition) {
    throw codexError('This ChatGPT account does not advertise an available Codex model.', 'CODEX_MODEL_UNAVAILABLE');
  }
  const model = configuredModel || { value: modelDefinition.id, source: 'connected_model_default' };

  const supported = supportedEfforts(modelDefinition);
  const configuredEffort = orderedEfforts.find((candidate) => supported.includes(candidate.value));
  const fallbackEffort = supported.includes(modelDefinition.defaultReasoningEffort || '')
    ? modelDefinition.defaultReasoningEffort
    : supported[0] || null;
  if (!configuredEffort && !fallbackEffort) {
    throw codexError(
      `${modelDefinition.displayName} does not advertise a usable reasoning effort.`,
      'CODEX_REASONING_EFFORT_UNAVAILABLE'
    );
  }
  const reasoningEffort = configuredEffort || { value: fallbackEffort, source: 'model_default' };

  return {
    model: model.value,
    modelSource: model.source,
    reasoningEffort: reasoningEffort.value,
    reasoningEffortSource: reasoningEffort.source,
    // True when the request could not use what the caller actually asked for.
    degraded: model.source === 'connected_model_default' || reasoningEffort.source === 'model_default'
  };
}

function codexError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function assertSubjectKey(subjectKey) {
  if (!/^[a-f0-9]{64}$/u.test(String(subjectKey || ''))) {
    throw codexError('A Codex subject key must be a sha256 digest.', 'CODEX_SUBJECT_KEY_INVALID');
  }
  return subjectKey;
}

/**
 * Credentials must come from the subject's own device login. The shared
 * platform API keys are stripped even though the base allowlist permits them —
 * leaving them in place would silently bill the platform account while the
 * request claims to be running on the user's plan.
 */
const SUBJECT_ENV_ALLOWLIST = new Set([
  'ALL_PROXY', 'APPDATA', 'COMSPEC', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'HTTPS_PROXY', 'HTTP_PROXY', 'LANG', 'LC_ALL', 'LOCALAPPDATA',
  'NODE_EXTRA_CA_CERTS', 'NO_PROXY', 'PATH', 'PATHEXT', 'PROGRAMDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'SSL_CERT_FILE', 'SYSTEMDRIVE',
  'SYSTEMROOT', 'TEMP', 'TMP', 'TZ', 'USERPROFILE', 'WINDIR'
]);

function subjectChildEnv(homeDir, source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (value === undefined || !SUBJECT_ENV_ALLOWLIST.has(key.toUpperCase())) continue;
    env[key] = String(value);
  }
  env.CODEX_HOME = homeDir;
  env.CODEX_NON_INTERACTIVE = '1';
  env.NO_COLOR = '1';
  return env;
}

function subjectLaunchArgs(homeDir, codexScript = resolveCodexScript()) {
  const authFile = JSON.stringify(path.join(homeDir, 'auth.json'));
  return [
    codexScript,
    '--strict-config',
    '--disable', 'shell_tool',
    '--disable', 'apps',
    '--disable', 'goals',
    '--disable', 'hooks',
    '--disable', 'multi_agent',
    '--disable', 'remote_plugin',
    '--config', 'web_search="disabled"',
    '--config', 'shell_environment_policy.inherit="none"',
    '--config', 'history.persistence="none"',
    // Without a file credential store the CLI uses the OS keychain, which is
    // machine-wide: every subject on this host would share one ChatGPT login.
    '--config', 'cli_auth_credentials_store="file"',
    '--config', `default_permissions="${PERMISSION_PROFILE}"`,
    // The model is denied its own credential file as well as the wider disk.
    '--config', `permissions.${PERMISSION_PROFILE}.filesystem={":root"="deny",":minimal"="read",${authFile}="deny",":workspace_roots"={"."="read"}}`,
    '--config', `permissions.${PERMISSION_PROFILE}.network.enabled=false`,
    'app-server',
    '--listen', 'stdio://'
  ];
}

function protectSubjectDirectory(directory) {
  try { fs.chmodSync(directory, 0o700); } catch { /* Best effort on platforms without POSIX modes. */ }
  if (process.platform !== 'win32') return;
  const account = [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join('\\');
  if (!account) return;
  try {
    execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], {
      stdio: 'ignore', windowsHide: true
    });
  } catch { /* A locked-down host may already deny inherited access. */ }
}

class CodexSubjectSession {
  constructor(subjectKey) {
    this.subjectKey = assertSubjectKey(subjectKey);
    this.homeDir = path.join(resolveSubjectsDir(), this.subjectKey);
    this.workDir = path.join(this.homeDir, 'workspace');
    this.process = null;
    this.ready = null;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.waiters = new Set();
    this.recent = [];
    this.stderr = [];
    this.loginState = null;
    this.stopped = false;
    this.turnTail = Promise.resolve();
    this.activeTurns = 0;
    this.lastUsedAt = Date.now();
    this.lastFailure = null;
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = this.startProcess();
    try { await this.ready; }
    catch (error) { this.ready = null; throw error; }
    return this.ready;
  }

  async startProcess() {
    const codexScript = resolveCodexScript();
    if (!fs.existsSync(codexScript)) {
      throw codexError('The Codex CLI is not installed on this gateway host.', 'CODEX_NOT_INSTALLED');
    }
    fs.mkdirSync(this.workDir, { recursive: true });
    protectSubjectDirectory(this.homeDir);
    this.stopped = false;
    this.lastFailure = null;
    const child = spawn(process.execPath, subjectLaunchArgs(this.homeDir, codexScript), {
      cwd: this.workDir,
      env: subjectChildEnv(this.homeDir),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.process = child;
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      this.stderr.push(text.slice(0, 2000));
      this.stderr = this.stderr.slice(-12);
    });
    child.once('error', (error) => {
      if (this.process === child) { this.process = null; this.ready = null; }
      this.failAll(error);
    });
    child.once('exit', (code, signal) => {
      if (this.process === child) { this.process = null; this.ready = null; }
      if (this.stopped) return;
      const detail = this.stderr.at(-1);
      this.failAll(codexError(
        `The Codex App Server stopped unexpectedly (${signal || `exit ${String(code)}`})${detail ? `: ${detail}` : ''}`,
        'CODEX_SESSION_EXITED'
      ));
    });
    await this.rawRequest('initialize', {
      clientInfo: { name: 'seemplify_gateway', title: 'Seemplify local AI gateway', version: '1.0.0' },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: ['item/agentMessage/delta']
      }
    }, 30_000);
    this.send({ method: 'initialized', params: {} });
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); }
    catch { return; }
    if (typeof message.id === 'number' && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(codexError(message.error.message || 'The Codex App Server rejected a request.', 'CODEX_REQUEST_REJECTED'));
      } else pending.resolve(message.result);
      return;
    }
    if (typeof message.id === 'number' && message.method) {
      this.handleServerRequest(message);
      return;
    }
    this.recent.push(message);
    this.recent = this.recent.slice(-200);
    const loginState = this.loginState;
    if (message.method === 'account/login/completed' && loginState && loginState.loginId === message.params?.loginId) {
      this.loginState = {
        loginId: loginState.loginId,
        pending: false,
        error: message.params?.success ? null : String(message.params?.error || 'ChatGPT sign-in failed.')
      };
    }
    for (const listener of this.listeners) listener(message);
  }

  /** The model gets nothing. Command execution and file changes are declined
   * outright, and an unrecognised capability is refused rather than allowed. */
  handleServerRequest(message) {
    if (message.method === 'item/permissions/requestApproval') {
      this.send({ id: message.id, result: { permissions: {} } });
      return;
    }
    if (message.method === 'item/commandExecution/requestApproval'
      || message.method === 'item/fileChange/requestApproval') {
      this.send({ id: message.id, result: { decision: 'decline' } });
      return;
    }
    this.send({ id: message.id, error: { code: -32601, message: `Unsupported server request: ${String(message.method)}` } });
  }

  send(message) {
    const child = this.process;
    if (!child || child.killed || !child.stdin.writable) {
      throw codexError('The Codex App Server is not running.', 'CODEX_SESSION_UNAVAILABLE');
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  rawRequest(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(codexError(`The Codex App Server timed out running ${method}.`, 'CODEX_REQUEST_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ method, id, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async request(method, params = {}, timeoutMs = 30_000) {
    this.lastUsedAt = Date.now();
    await this.start();
    try { return await this.rawRequest(method, params, timeoutMs); }
    finally { this.lastUsedAt = Date.now(); }
  }

  waitForNotification(predicate, timeoutMs) {
    const existing = [...this.recent].reverse().find(predicate);
    if (existing) return Promise.resolve(existing);
    if (!this.process) {
      return Promise.reject(this.lastFailure || codexError('The Codex App Server is not running.', 'CODEX_SESSION_UNAVAILABLE'));
    }
    return new Promise((resolve, reject) => {
      let waiter;
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        this.waiters.delete(waiter);
        reject(codexError('The Codex App Server timed out waiting for the turn to complete.', 'CODEX_TURN_TIMEOUT'));
      }, timeoutMs);
      const listener = (message) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        this.waiters.delete(waiter);
        resolve(message);
      };
      waiter = { listener, reject, timer };
      this.listeners.add(listener);
      this.waiters.add(waiter);
    });
  }

  async accountStatus() {
    const result = await this.request('account/read', { refreshToken: false });
    const account = result?.account;
    return {
      connected: account?.type === 'chatgpt',
      email: typeof account?.email === 'string' ? account.email : null,
      planType: typeof account?.planType === 'string' ? account.planType : null,
      authMode: account?.type === 'chatgpt' ? 'chatgpt' : account?.type || null,
      pendingLogin: this.loginState?.pending === true,
      loginError: this.loginState?.error || null
    };
  }

  async startDeviceLogin() {
    const status = await this.accountStatus();
    if (status.connected) return { connected: true };
    // A pending sign-in is resumable: the person still has to type this code on
    // OpenAI's site, so handing back the one already issued is what they need.
    // Refusing here used to strand them with an error and no way forward.
    if (this.loginState?.pending) {
      if (this.loginState.verificationUrl && this.loginState.userCode) {
        return {
          connected: false,
          loginId: this.loginState.loginId,
          verificationUrl: this.loginState.verificationUrl,
          userCode: this.loginState.userCode,
          resumed: true
        };
      }
      throw codexError('A ChatGPT sign-in is already waiting for completion.', 'CODEX_LOGIN_PENDING');
    }
    const result = await this.request('account/login/start', { type: 'chatgptDeviceCode' }, 30_000);
    if (!result?.loginId || !result?.verificationUrl || !result?.userCode) {
      throw codexError('Codex did not return a valid ChatGPT device sign-in request.', 'CODEX_LOGIN_INVALID');
    }
    this.loginState = {
      loginId: String(result.loginId),
      pending: true,
      error: null,
      verificationUrl: String(result.verificationUrl),
      userCode: String(result.userCode)
    };
    return {
      connected: false,
      loginId: String(result.loginId),
      verificationUrl: String(result.verificationUrl),
      userCode: String(result.userCode)
    };
  }

  async cancelDeviceLogin() {
    if (!this.loginState?.pending) return { cancelled: false };
    const loginId = this.loginState.loginId;
    await this.request('account/login/cancel', { loginId }, 30_000);
    this.loginState = null;
    return { cancelled: true };
  }

  async logout() {
    await this.request('account/logout', {}, 30_000);
    this.loginState = null;
  }

  /** Paginated, with a seen-cursor guard so a misbehaving server cannot spin
   * this loop forever. */
  async models() {
    const models = [];
    const seenCursors = new Set();
    let cursor = null;
    do {
      const result = await this.request('model/list', {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {})
      }, 30_000);
      if (Array.isArray(result?.data)) models.push(...result.data);
      const nextCursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);
    return models.filter((model) => model && !model.hidden && model.id && model.displayName);
  }

  /** One turn at a time per subject: a session is a single process, so
   * overlapping turns would interleave on the same stdio stream. */
  turn(input) {
    const run = this.turnTail.then(async () => {
      this.activeTurns += 1;
      try { return await this.runTurn(input); }
      finally { this.activeTurns -= 1; this.lastUsedAt = Date.now(); }
    });
    this.turnTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async runTurn(input) {
    const account = await this.accountStatus();
    if (!account.connected) {
      throw codexError('This subject has no connected ChatGPT account.', 'CODEX_NOT_CONNECTED');
    }
    // Resolved against this account's own catalogue, so an administrator's
    // per-activity choice degrades for a smaller plan instead of failing.
    const resolved = resolveCodexConfiguration({
      models: await this.models(),
      modelCandidates: input.modelCandidates,
      effortCandidates: input.effortCandidates
    });
    const threadResult = await this.request('thread/start', {
      model: resolved.model,
      cwd: this.workDir,
      runtimeWorkspaceRoots: [this.workDir],
      approvalPolicy: 'never',
      permissions: PERMISSION_PROFILE,
      serviceName: 'seemplify_gateway'
    }, 30_000);
    const threadId = String(threadResult?.thread?.id || '');
    if (!threadId) throw codexError('Codex could not create a thread.', 'CODEX_THREAD_FAILED');
    const threadProcess = this.process;
    let finalText = '';
    const listener = (message) => {
      if (message.method !== 'item/completed') return;
      const item = message.params?.item;
      if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.phase !== 'commentary') {
        finalText = item.text;
      }
    };
    this.listeners.add(listener);
    try {
      const started = await this.request('turn/start', {
        threadId,
        ...(input.requestId ? { clientUserMessageId: input.requestId } : {}),
        input: [{ type: 'text', text: input.prompt }],
        model: resolved.model,
        effort: resolved.reasoningEffort,
        approvalPolicy: 'never',
        ...(input.jsonSchema ? { outputSchema: input.jsonSchema } : {})
      }, 30_000);
      const turnId = String(started?.turn?.id || '');
      if (!turnId) throw codexError('Codex could not start a turn.', 'CODEX_TURN_FAILED');
      const completed = await this.waitForNotification(
        (message) => message.method === 'turn/completed' && message.params?.turn?.id === turnId,
        Number(input.timeoutMs || 240_000)
      );
      const turn = completed.params?.turn;
      if (turn?.status !== 'completed') {
        throw codexError(
          turn?.error?.message || `Codex turn ended with ${String(turn?.status || 'an error')}.`,
          'CODEX_TURN_FAILED'
        );
      }
      if (!finalText) {
        const read = await this.request('thread/read', { threadId, includeTurns: true }, 30_000);
        const turns = Array.isArray(read?.thread?.turns) ? read.thread.turns : [];
        const items = Array.isArray(turns.at(-1)?.items) ? turns.at(-1).items : [];
        finalText = String(items.filter((item) => item?.type === 'agentMessage').at(-1)?.text || '');
      }
      return {
        content: finalText,
        rawUsage: turn?.usage || null,
        // What was actually used, with the precedence source that won, so the
        // caller can record actual rather than intended configuration.
        model: resolved.model,
        modelSource: resolved.modelSource,
        reasoningEffort: resolved.reasoningEffort,
        reasoningEffortSource: resolved.reasoningEffortSource,
        degraded: resolved.degraded,
        planType: account.planType,
        threadId,
        turnId
      };
    } finally {
      this.listeners.delete(listener);
      if (this.process && this.process === threadProcess) {
        await this.rawRequest('thread/delete', { threadId }, 30_000).catch(() => undefined);
      }
    }
  }

  stop() {
    this.stopped = true;
    const child = this.process;
    this.process = null;
    this.ready = null;
    this.failAll(codexError('The Codex App Server was stopped.', 'CODEX_SESSION_STOPPED'));
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const finish = () => { clearTimeout(timer); resolve(); };
      child.once('exit', finish);
      child.once('error', finish);
      child.kill();
      timer = setTimeout(finish, 2_000);
    });
  }

  failAll(error) {
    this.lastFailure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      this.listeners.delete(waiter.listener);
      waiter.reject(error);
    }
    this.waiters.clear();
    if (this.loginState?.pending) {
      this.loginState = { ...this.loginState, pending: false, error: error.message };
    }
  }

  get idleSince() { return this.lastUsedAt; }

  get busy() {
    return this.pending.size > 0 || this.activeTurns > 0 || this.loginState?.pending === true;
  }
}

const sessions = new Map();

const idleSweep = setInterval(() => {
  const cutoff = Date.now() - IDLE_SESSION_MS;
  for (const [subjectKey, session] of sessions) {
    if (session.busy || session.idleSince > cutoff) continue;
    void session.stop();
    sessions.delete(subjectKey);
  }
}, 60_000);
idleSweep.unref();

function sessionForSubject(subjectKey) {
  assertSubjectKey(subjectKey);
  let session = sessions.get(subjectKey);
  if (session) return session;
  if (sessions.size >= MAX_SESSIONS) {
    const idle = [...sessions.entries()]
      .filter(([, candidate]) => !candidate.busy)
      .sort((left, right) => left[1].idleSince - right[1].idleSince)[0];
    if (!idle) {
      throw codexError('All Codex session slots on this host are busy. Try again shortly.', 'CODEX_SESSIONS_EXHAUSTED');
    }
    void idle[1].stop();
    sessions.delete(idle[0]);
  }
  session = new CodexSubjectSession(subjectKey);
  sessions.set(subjectKey, session);
  return session;
}

async function stopAllSessions() {
  const stopping = [...sessions.values()].map((session) => session.stop());
  sessions.clear();
  await Promise.allSettled(stopping);
}

/** Removing the home directory is what actually revokes access: the refresh
 * token lives there and nowhere else. */
async function forgetSubject(subjectKey) {
  assertSubjectKey(subjectKey);
  const session = sessions.get(subjectKey);
  if (session) {
    try { await session.logout(); } catch { /* A dead session is already signed out. */ }
    await session.stop();
    sessions.delete(subjectKey);
  }
  await fs.promises.rm(path.join(resolveSubjectsDir(), subjectKey), {
    recursive: true, force: true, maxRetries: 10, retryDelay: 100
  }).catch(() => undefined);
  return { forgotten: true };
}

const accountStatusForSubject = (subjectKey) => sessionForSubject(subjectKey).accountStatus();
const startDeviceLogin = (subjectKey) => sessionForSubject(subjectKey).startDeviceLogin();
const cancelDeviceLogin = (subjectKey) => sessionForSubject(subjectKey).cancelDeviceLogin();
const modelsForSubject = (subjectKey) => sessionForSubject(subjectKey).models();
const runSubjectTurn = (subjectKey, input) => sessionForSubject(subjectKey).turn(input);

module.exports = {
  CodexSubjectSession,
  PERMISSION_PROFILE,
  allowedSourceApps,
  resolveSubjectRequest,
  accountStatusForSubject,
  cancelDeviceLogin,
  codexError,
  forgetSubject,
  modelsForSubject,
  perUserSessionsEnabled,
  resolveCodexConfiguration,
  runSubjectTurn,
  safeConnectedModel,
  supportedEfforts,
  sessionForSubject,
  startDeviceLogin,
  stopAllSessions,
  subjectChildEnv,
  resolveCodexScript,
  resolveSubjectsDir,
  subjectKeyFor,
  subjectLaunchArgs
};
