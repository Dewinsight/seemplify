const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const hostname = 'cv-llm.aiinnigeria.com';
const managedEngines = new Set(['ollama', 'vllm', 'codex']);
const secret = fs.readFileSync(path.join(runtimeDir, 'service-secret'), 'utf8').trim();

function request(ip, requestPath, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const outgoing = https.request({
      hostname: ip,
      port: 443,
      path: requestPath,
      method,
      servername: hostname,
      headers: { host: hostname, ...headers },
      timeout: 330_000
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        resolve({ status: response.statusCode, data, latencyMs: Date.now() - startedAt });
      });
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('External request timed out')));
    outgoing.on('error', reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

function signedHeaders(body) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  return {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': crypto.createHmac('sha256', secret)
      .update(`${timestamp}\n${nonce}\nPOST\n/v1/cv/analyze\n${body}`)
      .digest('base64url')
  };
}

async function main() {
  const resolver = new dns.Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const addresses = await resolver.resolve4(hostname);
  if (!addresses.length) throw new Error('Public DNS did not return a Cloudflare edge address.');
  const ip = addresses[0];
  const health = await request(ip, '/health');
  const publicControlStatus = await request(ip, '/control/status');
  const publicQueueHistory = await request(ip, '/control/queue-history?page=1&limit=10');
  const publicControlMutation = await request(ip, '/control/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'content-length': 2 },
    body: '{}'
  });
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience', 'education', 'skills', 'summary'],
    properties: {
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      location: { type: 'string' },
      position: { type: 'string' },
      experience: { type: 'string' },
      education: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' }
    }
  };
  const body = JSON.stringify({
    activity: 'candidate.cv_parse',
    requestSource: 'local-external-smoke',
    metering: { record: false, exclusion: 'harness' },
    model: 'selected-runtime-model',
    executionMode: 'local-only',
    messages: [
      { role: 'system', content: 'Extract only facts explicitly present in this CV.' },
      { role: 'user', content: 'Grace Hopper\nEmail: grace.hopper@example.test\nComputer scientist with COBOL and compiler engineering experience.' }
    ],
    jsonSchema: schema,
    temperature: 0,
    timeoutMs: 300_000
  });
  const unsigned = await request(ip, '/v1/cv/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    body
  });
  const signed = await request(ip, '/v1/cv/analyze', {
    method: 'POST',
    headers: signedHeaders(body),
    body
  });
  const report = {
    generatedAt: new Date().toISOString(),
    hostname,
    edgeVerified: true,
    healthStatus: health.status,
    publicControlStatus: publicControlStatus.status,
    publicQueueHistoryStatus: publicQueueHistory.status,
    publicControlMutationStatus: publicControlMutation.status,
    publicControlBlocked: [publicControlStatus, publicQueueHistory, publicControlMutation]
      .every((result) => result.status === 403 || result.status === 404),
    unsignedStatus: unsigned.status,
    unsignedRejected: unsigned.status === 401,
    signedStatus: signed.status,
    signedAccepted: signed.status === 200 && Boolean(signed.data?.data),
    executedEngine: signed.data?.engine || null,
    executedModel: signed.data?.model || null,
    localExecutionVerified: managedEngines.has(signed.data?.engine),
    executionMode: signed.data?.engine === 'codex' ? 'local-cloud' : 'local',
    signedLatencyMs: signed.latencyMs,
    passed: health.status === 200
      && [publicControlStatus, publicQueueHistory, publicControlMutation]
        .every((result) => result.status === 403 || result.status === 404)
      && unsigned.status === 401
      && signed.status === 200
      && managedEngines.has(signed.data?.engine)
      && Boolean(signed.data?.data)
  };
  fs.writeFileSync(path.join(runtimeDir, 'external-smoke.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
