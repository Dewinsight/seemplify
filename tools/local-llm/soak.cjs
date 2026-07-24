const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { controlFetch } = require('./control-auth.cjs');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const gatewayUrl = String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
const secret = fs.readFileSync(path.join(runtimeDir, 'service-secret'), 'utf8').trim();
const requestCount = Math.max(4, Number(process.argv.find((value) => value.startsWith('--requests='))?.split('=')[1] || 40));

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

const cvText = `ADA OKAFOR
Senior Software Engineer
London | ada.okafor@example.test | +44 7700 900123
Eight years of experience with TypeScript, Node.js, PostgreSQL, Redis, React and AWS.
Senior Software Engineer, Northstar Systems, January 2021 to Present.
Software Engineer, Harbor Labs, June 2017 to December 2020.
BSc Computer Science, University of Bristol, 2017.`;

function signedHeaders(body) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${body}`)
    .digest('base64url');
  return {
    'content-type': 'application/json',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature
  };
}

async function analyze(index) {
  const body = JSON.stringify({
    activity: 'candidate.cv_parse',
    model: 'selected-runtime-model',
    messages: [
      { role: 'system', content: 'Extract only explicit CV facts and return the supplied JSON schema.' },
      { role: 'user', content: `${cvText}\nSoak sequence ${index}.` }
    ],
    jsonSchema: schema,
    temperature: 0,
    timeoutMs: 300_000
  });
  const startedAt = Date.now();
  try {
    const response = await fetch(`${gatewayUrl}/v1/cv/analyze`, {
      method: 'POST',
      headers: signedHeaders(body),
      body,
      signal: AbortSignal.timeout(330_000)
    });
    const payload = await response.json();
    const valid = response.ok
      && payload.data
      && schema.required.every((key) => Object.hasOwn(payload.data, key));
    return {
      ok: Boolean(valid),
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: valid ? undefined : payload.code || payload.message || 'invalid response'
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: error.message };
  }
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] || null;
}

async function main() {
  const runtime = await (await controlFetch(`${gatewayUrl}/control/status`)).json();
  const configuredConcurrency = Math.max(1, Number(runtime.state?.concurrency || 1));
  const stateResponse = await controlFetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, ingressEnabled: true, paused: false })
  });
  if (!stateResponse.ok) throw new Error('Could not enable the approved runtime before soak testing.');

  const samples = [];
  const sampler = setInterval(() => {
    void controlFetch(`${gatewayUrl}/control/status`)
      .then((response) => response.json())
      .then((status) => samples.push({
        at: new Date().toISOString(),
        active: status.active,
        waiting: status.waiting
      }))
      .catch(() => {});
  }, 250);
  const startedAt = Date.now();
  let results;
  try {
    results = await Promise.all(Array.from({ length: requestCount }, (_, index) => analyze(index + 1)));
  } finally {
    clearInterval(sampler);
  }

  const successful = results.filter((result) => result.ok);
  const elapsedMs = Date.now() - startedAt;
  const report = {
    generatedAt: new Date().toISOString(),
    engine: runtime.engine,
    model: runtime.model,
    configuredConcurrency,
    requestCount,
    successful: successful.length,
    failed: requestCount - successful.length,
    maxActive: Math.max(0, ...samples.map((sample) => sample.active)),
    maxWaiting: Math.max(0, ...samples.map((sample) => sample.waiting)),
    p50LatencyMs: percentile(successful.map((result) => result.latencyMs), 0.5),
    p95LatencyMs: percentile(successful.map((result) => result.latencyMs), 0.95),
    elapsedMs,
    throughputPerMinute: Number((successful.length / (elapsedMs / 60_000)).toFixed(2)),
    results,
    passed: successful.length === requestCount
      && Math.max(0, ...samples.map((sample) => sample.active)) <= configuredConcurrency
      && (
        requestCount <= configuredConcurrency
        || Math.max(0, ...samples.map((sample) => sample.waiting)) >= requestCount - configuredConcurrency
      )
  };
  const modelSlug = `${runtime.engine}-${runtime.model}`.replace(/[^a-z0-9_-]+/gi, '-');
  fs.writeFileSync(path.join(runtimeDir, `soak-${modelSlug}-${report.generatedAt.replaceAll(':', '-')}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(runtimeDir, 'soak.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
