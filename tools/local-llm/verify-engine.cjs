const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const secret = fs.readFileSync(path.join(runtimeDir, 'service-secret'), 'utf8').trim();
const verificationFile = path.join(runtimeDir, 'verification.json');
const gatewayUrl = 'http://127.0.0.1:11435';
const timeoutMs = Math.max(30_000, Number(
  process.argv.find((value) => value.startsWith('--timeout-ms='))?.split('=')[1] || 45 * 60_000
));

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

function sign(body) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${body}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHealth() {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'engine is not ready';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(6_000) });
      const payload = await response.json();
      if (response.ok && payload.ok) return payload;
      lastError = payload?.engine?.error || `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await wait(3_000);
  }
  throw new Error(`Engine did not become healthy within ${Math.round(timeoutMs / 1000)} seconds: ${lastError}`);
}

async function verify() {
  const health = await waitForHealth();
  const status = await (await fetch(`${gatewayUrl}/control/status`)).json();
  const body = JSON.stringify({
    activity: 'candidate.cv_parse',
    model: 'selected-runtime-model',
    messages: [
      { role: 'system', content: 'Extract only explicit CV facts. Return JSON matching the supplied schema.' },
      {
        role: 'user',
        content: 'CV text:\nADA OKAFOR\nSenior Software Engineer\nLondon | ada.okafor@example.test\nSkills: TypeScript, Node.js, PostgreSQL\nEducation: BSc Computer Science, University of Bristol, 2017'
      }
    ],
    jsonSchema: schema,
    temperature: 0,
    timeoutMs: 300_000
  });
  const signed = sign(body);
  const startedAt = Date.now();
  const response = await fetch(`${gatewayUrl}/v1/cv/analyze`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    body,
    signal: AbortSignal.timeout(330_000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${payload.code || response.status}: ${payload.message || 'verification failed'}`);
  const skills = Array.isArray(payload.data?.skills) ? payload.data.skills.map((value) => String(value).toLowerCase()) : [];
  const checks = {
    firstName: String(payload.data?.firstName || '').toLowerCase() === 'ada',
    lastName: String(payload.data?.lastName || '').toLowerCase() === 'okafor',
    email: String(payload.data?.email || '').toLowerCase() === 'ada.okafor@example.test',
    skills: ['typescript', 'node.js', 'postgresql'].every((expected) => skills.some((skill) => skill.includes(expected)))
  };
  const result = {
    ok: Object.values(checks).every(Boolean),
    engine: payload.engine || status.engine,
    model: payload.model || status.model,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    checks,
    health
  };
  if (!result.ok) throw new Error(`CV verification checks failed: ${JSON.stringify(checks)}`);
  let stored = { byEngineModel: {} };
  try { stored = JSON.parse(fs.readFileSync(verificationFile, 'utf8')); } catch {}
  stored.byEngineModel ||= {};
  stored.byEngineModel[`${result.engine}:${result.model}`] = result;
  const temporary = `${verificationFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, verificationFile);
  return result;
}

verify().then((result) => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
