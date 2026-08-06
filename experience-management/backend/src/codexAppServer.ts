import crypto from 'node:crypto';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { config } from './config.js';

type JsonObject = Record<string, any>;
type NotificationListener = (message: JsonObject) => void;

type NotificationWaiter = {
  listener: NotificationListener;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[];
  inputModalities?: string[];
};

export type CodexAccountStatus = {
  connected: boolean;
  email: string | null;
  planType: string | null;
  authMode: string | null;
  pendingLogin: boolean;
  loginError: string | null;
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

type LoginState = {
  loginId: string;
  pending: boolean;
  error: string | null;
};

const require = createRequire(import.meta.url);
const codexPermissionProfile = 'experience-read-only';

function safeRuntimeKey(userId: string) {
  return crypto.createHash('sha256').update(`experience-codex:${userId}`).digest('hex');
}

function codexLaunch(homeDir: string) {
  const configured = String(process.env.CODEX_CLI_PATH || '').trim();
  const entry = configured || require.resolve('@openai/codex/bin/codex.js');
  const authFile = JSON.stringify(path.join(homeDir, 'auth.json'));
  const args = [
    'app-server', '--listen', 'stdio://',
    '-c', 'cli_auth_credentials_store="file"',
    '-c', 'history.persistence="none"',
    '-c', 'shell_environment_policy.inherit="none"',
    '-c', `default_permissions="${codexPermissionProfile}"`,
    '-c', `permissions.${codexPermissionProfile}.filesystem={":root"="deny",":minimal"="read",${authFile}="deny",":workspace_roots"={"."="read"}}`,
    '-c', `permissions.${codexPermissionProfile}.network.enabled=false`
  ];
  return entry.toLowerCase().endsWith('.js')
    ? { command: process.execPath, args: [entry, ...args] }
    : { command: entry, args };
}

function codexProcessEnvironment(homeDir: string): NodeJS.ProcessEnv {
  // Never pass application secrets (database credentials, session keys, API keys,
  // and similar values) into the model-facing process. These are the minimum OS
  // values needed to launch Codex and complete HTTPS device authentication.
  const allowed = [
    'PATH', 'Path', 'PATHEXT',
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'ComSpec',
    'TEMP', 'TMP', 'TMPDIR',
    'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'USERNAME', 'USERDOMAIN',
    'HOMEDRIVE', 'HOMEPATH', 'HOME',
    'LANG', 'LC_ALL',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'
  ];
  const environment: NodeJS.ProcessEnv = {
    CODEX_HOME: homeDir,
    NO_COLOR: '1'
  };
  for (const key of allowed) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

function protectRuntimeDirectory(directory: string) {
  try { fs.chmodSync(directory, 0o700); } catch { /* Best effort on platforms without POSIX modes. */ }
  if (process.platform !== 'win32') return;
  const account = [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join('\\');
  if (!account) return;
  try {
    execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], {
      stdio: 'ignore', windowsHide: true
    });
  } catch { /* Local development can still rely on the enclosing profile ACL. */ }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown Codex App Server error.');
}

function parseStructuredText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Codex returned an empty response.');
  try { return JSON.parse(trimmed); } catch { /* Continue with guarded extraction. */ }
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return JSON.parse(fenced[1]);
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error('Codex did not return valid structured JSON.');
}

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private sequence = 0;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Set<NotificationListener>();
  private notificationWaiters = new Set<NotificationWaiter>();
  private recent: JsonObject[] = [];
  private stderr: string[] = [];
  private loginState: LoginState | null = null;
  private stopped = false;
  private completionTail: Promise<void> = Promise.resolve();
  private activeCompletions = 0;
  private lastUsedAt = Date.now();
  private lastFailure: Error | null = null;
  readonly homeDir: string;
  readonly workDir: string;

  constructor(readonly userId: string) {
    this.homeDir = path.join(config.codexRuntimeDir, 'users', safeRuntimeKey(userId));
    this.workDir = path.join(this.homeDir, 'workspace');
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = this.startProcess();
    try { await this.ready; }
    catch (error) { this.ready = null; throw error; }
  }

  private async startProcess() {
    fs.mkdirSync(this.workDir, { recursive: true });
    protectRuntimeDirectory(this.homeDir);
    const launch = codexLaunch(this.homeDir);
    this.stopped = false;
    this.lastFailure = null;
    const child = spawn(launch.command, launch.args, {
      cwd: this.workDir,
      env: codexProcessEnvironment(this.homeDir),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.process = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleLine(line));
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
      this.failAll(new Error(`Codex App Server stopped unexpectedly (${signal || `exit ${String(code)}`})${detail ? `: ${detail}` : ''}`));
    });
    await this.rawRequest('initialize', {
      clientInfo: { name: 'seemplify_experience', title: 'Seemplify Experience', version: '0.1.0' },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: ['item/agentMessage/delta']
      }
    }, 30_000);
    this.send({ method: 'initialized', params: {} });
  }

  private handleLine(line: string) {
    let message: JsonObject;
    try { message = JSON.parse(line); }
    catch { return; }
    if (typeof message.id === 'number' && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Codex App Server request failed.'));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.id === 'number' && message.method) {
      this.handleServerRequest(message);
      return;
    }
    this.recent.push(message);
    this.recent = this.recent.slice(-200);
    const loginState = this.loginState;
    if (message.method === 'account/login/completed' && loginState
      && loginState.loginId === message.params?.loginId) {
      const loginId = loginState.loginId;
      this.loginState = {
        loginId,
        pending: false,
        error: message.params?.success ? null : String(message.params?.error || 'ChatGPT sign-in failed.')
      };
    }
    for (const listener of this.listeners) listener(message);
  }

  private handleServerRequest(message: JsonObject) {
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

  private send(message: JsonObject) {
    const child = this.process;
    if (!child || child.killed || !child.stdin.writable) {
      throw new Error('Codex App Server is not running.');
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rawRequest(method: string, params: JsonObject = {}, timeoutMs = 30_000) {
    const id = ++this.sequence;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server timed out while running ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ method, id, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async request(method: string, params: JsonObject = {}, timeoutMs = 30_000) {
    this.lastUsedAt = Date.now();
    await this.start();
    try { return await this.rawRequest(method, params, timeoutMs); }
    finally { this.lastUsedAt = Date.now(); }
  }

  private waitForNotification(predicate: (message: JsonObject) => boolean, timeoutMs: number) {
    const existing = [...this.recent].reverse().find(predicate);
    if (existing) return Promise.resolve(existing);
    if (!this.process) {
      return Promise.reject(this.lastFailure || new Error('Codex App Server is not running.'));
    }
    return new Promise<JsonObject>((resolve, reject) => {
      let waiter: NotificationWaiter;
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        this.notificationWaiters.delete(waiter);
        reject(new Error('Codex App Server timed out waiting for completion.'));
      }, timeoutMs);
      const listener = (message: JsonObject) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        this.notificationWaiters.delete(waiter);
        resolve(message);
      };
      waiter = { listener, reject, timer };
      this.listeners.add(listener);
      this.notificationWaiters.add(waiter);
    });
  }

  async accountStatus(): Promise<CodexAccountStatus> {
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
    if (status.connected) return { connected: true as const };
    if (this.loginState?.pending) {
      throw new Error('A ChatGPT sign-in is already waiting for completion.');
    }
    const result = await this.request('account/login/start', { type: 'chatgptDeviceCode' }, 30_000);
    if (!result?.loginId || !result?.verificationUrl || !result?.userCode) {
      throw new Error('Codex did not return a valid ChatGPT device sign-in request.');
    }
    this.loginState = { loginId: String(result.loginId), pending: true, error: null };
    return {
      connected: false as const,
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

  async models(): Promise<CodexModel[]> {
    const models: CodexModel[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
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
    return models;
  }

  async complete(input: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    jsonSchema?: Record<string, unknown>;
    model: string;
    reasoningEffort: string;
    action?: string;
    requestId?: string;
    timeoutMs: number;
  }) {
    const run = this.completionTail.then(async () => {
      this.activeCompletions += 1;
      try { return await this.completeNow(input); }
      finally { this.activeCompletions -= 1; this.lastUsedAt = Date.now(); }
    });
    this.completionTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async completeNow(input: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    jsonSchema?: Record<string, unknown>;
    model: string;
    reasoningEffort: string;
    action?: string;
    requestId?: string;
    timeoutMs: number;
  }) {
    const account = await this.accountStatus();
    if (!account.connected) throw new Error('Connect a ChatGPT account before using Codex.');
    const threadResult = await this.request('thread/start', {
      model: input.model,
      cwd: this.workDir,
      runtimeWorkspaceRoots: [this.workDir],
      approvalPolicy: 'never',
      permissions: codexPermissionProfile,
      serviceName: 'seemplify_experience'
    }, 30_000);
    const threadId = String(threadResult?.thread?.id || '');
    if (!threadId) throw new Error('Codex could not create a thread.');
    const threadProcess = this.process;
    let finalText = '';
    const listener = (message: JsonObject) => {
      if (message.method !== 'item/completed') return;
      const item = message.params?.item;
      if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.phase !== 'commentary') {
        finalText = item.text;
      }
    };
    this.listeners.add(listener);
    try {
      const prompt = input.messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n');
      const started = await this.request('turn/start', {
        threadId,
        ...(input.requestId ? { clientUserMessageId: input.requestId } : {}),
        input: [{ type: 'text', text: prompt }],
        model: input.model,
        effort: input.reasoningEffort,
        approvalPolicy: 'never',
        ...(input.jsonSchema ? { outputSchema: input.jsonSchema } : {})
      }, 30_000);
      const turnId = String(started?.turn?.id || '');
      if (!turnId) throw new Error('Codex could not start a turn.');
      const completed = await this.waitForNotification(
        (message) => message.method === 'turn/completed'
          && message.params?.turn?.id === turnId,
        input.timeoutMs
      );
      if (completed.params?.turn?.status !== 'completed') {
        throw new Error(completed.params?.turn?.error?.message || `Codex turn ended with ${String(completed.params?.turn?.status || 'an error')}.`);
      }
      if (!finalText) {
        const read = await this.request('thread/read', { threadId, includeTurns: true }, 30_000);
        const turns = Array.isArray(read?.thread?.turns) ? read.thread.turns : [];
        const items = Array.isArray(turns.at(-1)?.items) ? turns.at(-1).items : [];
        finalText = String(items.filter((item: any) => item?.type === 'agentMessage').at(-1)?.text || '');
      }
      const data = input.jsonSchema ? parseStructuredText(finalText) : undefined;
      return {
        data,
        content: finalText,
        runtime: {
          provider: 'openai-codex',
          providerLabel: 'ChatGPT / Codex',
          engine: 'codex-app-server',
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          action: input.action || null,
          requestId: input.requestId || null,
          planType: account.planType
        }
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
    this.failAll(new Error('Codex App Server stopped.'));
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout;
      const finish = () => { clearTimeout(timer); resolve(); };
      child.once('exit', finish);
      child.once('error', finish);
      child.kill();
      timer = setTimeout(finish, 2_000);
    });
  }

  private failAll(error: Error) {
    this.lastFailure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer);
      this.listeners.delete(waiter.listener);
      waiter.reject(error);
    }
    this.notificationWaiters.clear();
    if (this.loginState?.pending) {
      this.loginState = { ...this.loginState, pending: false, error: error.message };
    }
  }

  get idleSince() { return this.lastUsedAt; }

  get busy() {
    return this.pending.size > 0 || this.listeners.size > 0 || this.activeCompletions > 0
      || this.loginState?.pending === true;
  }
}

const clients = new Map<string, CodexAppServerClient>();
const maximumClients = 8;
const idleClientMs = 10 * 60_000;

const idleSweep = setInterval(() => {
  const cutoff = Date.now() - idleClientMs;
  for (const [userId, client] of clients) {
    if (client.busy || client.idleSince > cutoff) continue;
    void client.stop();
    clients.delete(userId);
  }
}, 60_000);
idleSweep.unref();

export function codexClientForUser(userId: string) {
  let client = clients.get(userId);
  if (!client) {
    if (clients.size >= maximumClients) {
      const idle = [...clients.entries()]
        .filter(([, candidate]) => !candidate.busy)
        .sort((left, right) => left[1].idleSince - right[1].idleSince)[0];
      if (!idle) throw new Error('All local Codex App Server slots are currently busy. Try again shortly.');
      void idle[1].stop();
      clients.delete(idle[0]);
    }
    client = new CodexAppServerClient(userId);
    clients.set(userId, client);
  }
  return client;
}

export async function stopCodexClients() {
  const stopping = [...clients.values()].map((client) => client.stop());
  clients.clear();
  await Promise.allSettled(stopping);
}

export function codexRuntimeError(error: unknown) {
  return errorMessage(error);
}
