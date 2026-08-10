'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { deriveServiceSecret, signatureForServiceSecret } = require('./service-auth.cjs');

const gatewayScript = path.join(__dirname, 'gateway.cjs');

async function reservePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForGateway(url) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.status > 0) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Local gateway did not start');
}

function signedHeaders({ secret, serviceId, body, requestPath, version = '2' }) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = version === '2'
    ? signatureForServiceSecret(secret, {
      timestamp, nonce, serviceId, method: 'POST', requestPath, rawBody: body
    })
    : crypto.createHmac('sha256', secret)
      .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${body}`)
      .digest('base64url');
  return {
    'content-type': 'application/json',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature,
    ...(version === '2' ? {
      'x-seemplify-signature-version': '2',
      'x-seemplify-service': serviceId
    } : {})
  };
}

test('production gateway requires v2 and rejects cross-service namespaces before inference', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-gateway-service-auth-'));
  const master = 'production-local-gateway-master-test-secret';
  const secretFile = path.join(directory, 'service-secret');
  const stateFile = path.join(directory, 'state.json');
  fs.writeFileSync(secretFile, master);
  fs.writeFileSync(path.join(directory, 'control-secret'), 'control-secret');
  fs.writeFileSync(stateFile, JSON.stringify({
    enabled: true, ingressEnabled: true, paused: false, concurrency: 1,
    autoStart: false, selectedEngine: 'ollama', engines: { ollama: { model: 'unused' } }
  }));
  const port = await reservePort();
  const child = spawn(process.execPath, [gatewayScript], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LOCAL_LLM_GATEWAY_HOST: '127.0.0.1',
      LOCAL_LLM_GATEWAY_PORT: String(port),
      LOCAL_LLM_SECRET_FILE: secretFile,
      LOCAL_LLM_CONTROL_SECRET_FILE: path.join(directory, 'control-secret'),
      LOCAL_LLM_STATE_FILE: stateFile,
      LOCAL_LLM_LOG_FILE: path.join(directory, 'gateway.log'),
      LOCAL_LLM_NONCE_DIR: path.join(directory, 'nonces'),
      LOCAL_LLM_USAGE_OUTBOX_DIR: path.join(directory, 'usage-outbox'),
      LOCAL_LLM_EXECUTION_RECEIPT_DIR: path.join(directory, 'receipts'),
      LOCAL_LLM_TELEMETRY_DIR: path.join(directory, 'telemetry'),
      RECRUITER_BACKEND_URL: 'http://127.0.0.1:9'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  t.after(async () => {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForGateway(baseUrl).catch((error) => {
    throw new Error(`${error.message}: ${output.slice(-1000)}`);
  });

  const statusPath = '/v1/status';
  const statusBody = '{}';
  const legacy = await fetch(`${baseUrl}${statusPath}`, {
    method: 'POST',
    headers: signedHeaders({ secret: master, body: statusBody, requestPath: statusPath, version: '1' }),
    body: statusBody
  });
  assert.equal(legacy.status, 401);
  assert.equal((await legacy.json()).code, 'SERVICE_SIGNATURE_V2_REQUIRED');

  const performanceSecret = deriveServiceSecret(master, 'performance-management');
  const status = await fetch(`${baseUrl}${statusPath}`, {
    method: 'POST',
    headers: signedHeaders({
      secret: performanceSecret, serviceId: 'performance-management', body: statusBody, requestPath: statusPath
    }),
    body: statusBody
  });
  assert.equal(status.status, 200, JSON.stringify(await status.clone().json()));

  const completionPath = '/v1/complete';
  const forgedBody = JSON.stringify({
    activity: 'candidate.cv_parse',
    executionMode: 'local-only',
    requestSource: 'recruiter',
    metering: {
      record: true,
      eventId: `usage_${'a'.repeat(48)}`,
      gatewayExecutionId: `localexec_${'b'.repeat(48)}`,
      requestId: 'forged-performance-request',
      sourceApp: 'recruiter'
    },
    messages: [{ role: 'user', content: 'forged' }]
  });
  const forged = await fetch(`${baseUrl}${completionPath}`, {
    method: 'POST',
    headers: signedHeaders({
      secret: performanceSecret,
      serviceId: 'performance-management',
      body: forgedBody,
      requestPath: completionPath
    }),
    body: forgedBody
  });
  const forgedPayload = await forged.json();
  assert.equal(forged.status, 403);
  assert.equal(forgedPayload.code, 'SERVICE_ACTIVITY_MISMATCH');
});
