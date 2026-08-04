const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config.cjs');
const { createReplayGuard, verifyRequest } = require('./auth.cjs');
const { createKnowledgeRuntime, runtimeError } = require('./runtime.cjs');

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw runtimeError('Request body is too large.', { code: 'BODY_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createRateLimiter({ limit, now = Date.now }) {
  let minute = Math.floor(now() / 60_000);
  let count = 0;
  return () => {
    const current = Math.floor(now() / 60_000);
    if (current !== minute) { minute = current; count = 0; }
    count += 1;
    return count <= limit;
  };
}

function createKnowledgeServer({ config = CONFIG, runtime = createKnowledgeRuntime({ config }), serviceSecret, now = Date.now, replayFilename = path.join(config.paths.runtime, 'replay-nonces.json') } = {}) {
  const secret = serviceSecret || fs.readFileSync(path.join(config.paths.runtime, 'service-secret'), 'utf8').trim();
  if (!secret) throw new Error('Knowledge runtime HMAC secret is unavailable.');
  const replayGuard = createReplayGuard({ ttlMs: config.limits.nonceTtlMs, now, filename: replayFilename });
  const withinRateLimit = createRateLimiter({ limit: config.limits.requestsPerMinute, now });
  const handlers = Object.freeze({
    '/v1/index': (input) => runtime.index(input),
    '/v1/backfill': (input) => runtime.backfill(input),
    '/v1/retrieve': (input) => runtime.retrieve(input),
    '/v1/scan': (input) => runtime.scan(input),
    '/v1/delete': (input) => runtime.remove(input),
    '/v1/graph': (input) => runtime.graph(input),
    '/v1/migration': (input) => runtime.migrationControl(input),
    '/v1/shutdown': (input) => {
      if (input?.source !== 'control-center' || input?.mode !== 'graceful') {
        throw runtimeError('A recognized graceful shutdown request is required.', { code: 'INVALID_REQUEST', status: 400 });
      }
      setImmediate(() => server.emit('knowledge-shutdown-request'));
      return { accepted: true, mode: 'graceful', pid: process.pid };
    },
    '/v1/test/cleanup': (input) => runtime.cleanupTestTenant(input),
    '/v1/status': (input) => {
      if (!['experience-management', 'control-center', 'knowledge-live-benchmark'].includes(input?.source)) {
        throw runtimeError('A recognized status source is required.', { code: 'INVALID_REQUEST', status: 400 });
      }
      return runtime.status();
    },
  });
  const server = http.createServer(async (request, response) => {
    const requestPath = new URL(request.url, `http://${request.headers.host || `${config.host}:${config.ports.runtime}`}`).pathname;
    const started = Date.now();
    try {
      if (request.method !== 'POST' || !handlers[requestPath]) return sendJson(response, 404, { code: 'NOT_FOUND' });
      if (!withinRateLimit()) throw runtimeError('Knowledge runtime rate limit reached.', { code: 'RATE_LIMITED', status: 429, retryable: true });
      if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        throw runtimeError('Content-Type must be application/json.', { code: 'INVALID_CONTENT_TYPE', status: 415 });
      }
      const rawBody = await readBody(request, config.limits.requestBytes);
      const verification = verifyRequest({ headers: request.headers, method: request.method, requestPath, rawBody, secret, replayGuard, now, clockSkewMs: config.limits.clockSkewMs });
      if (!verification.ok) throw runtimeError('Request authentication failed.', { code: verification.code, status: 401 });
      let input;
      try { input = JSON.parse(rawBody || '{}'); } catch { throw runtimeError('Request body is not valid JSON.', { code: 'INVALID_JSON', status: 400 }); }
      const result = await handlers[requestPath](input);
      process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level: 'info', path: requestPath, durationMs: Date.now() - started, ok: true })}\n`);
      return sendJson(response, 200, result);
    } catch (error) {
      const status = Number(error.status) || 500;
      process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), level: status >= 500 ? 'error' : 'warn', path: requestPath, durationMs: Date.now() - started, code: error.code || 'KNOWLEDGE_RUNTIME_ERROR', message: String(error.message || error).slice(0, 500) })}\n`);
      return sendJson(response, status, { code: error.code || 'KNOWLEDGE_RUNTIME_ERROR', message: error.message || 'Knowledge runtime request failed.', retryable: error.retryable === true });
    }
  });
  server.knowledgeRuntime = runtime;
  return server;
}

if (require.main === module) {
  const server = createKnowledgeServer();
  Promise.resolve(server.knowledgeRuntime.start()).then(() => {
    server.listen(CONFIG.ports.runtime, CONFIG.host, () => {
      process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level: 'info', event: 'started', host: CONFIG.host, port: CONFIG.ports.runtime, pid: process.pid })}\n`);
    });
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
  let shutdownPromise = null;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const serverClosed = new Promise((resolve) => server.close(resolve));
      const runtimeClosed = server.knowledgeRuntime.close({ timeoutMs: 30_000 });
      const graceful = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(false), 35_000);
        Promise.all([serverClosed, runtimeClosed]).then(
          () => { clearTimeout(timer); resolve(true); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });
      if (!graceful) {
        server.closeAllConnections?.();
        await server.knowledgeRuntime.close({ timeoutMs: 0, force: true }).catch(() => undefined);
        throw Object.assign(new Error('Knowledge runtime shutdown exceeded its hard deadline.'), { code: 'SHUTDOWN_TIMEOUT' });
      }
      process.exit(0);
    })().catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exit(1);
      });
    return shutdownPromise;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('knowledge-shutdown-request', shutdown);
  server.on('error', (error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { createKnowledgeServer, createRateLimiter, readBody };
