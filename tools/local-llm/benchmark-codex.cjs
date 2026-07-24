const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { recordApproval } = require('./approval-store.cjs');
const { cvText: threePageCvText, pageCount, scoreCvOutput } = require('./three-page-cv-fixture.cjs');

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const manageScript = path.join(__dirname, 'manage.ps1');
const gatewayUrl = 'http://127.0.0.1:11435';
const secret = fs.readFileSync(path.join(runtimeDir, 'service-secret'), 'utf8').trim();
const catalog = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'codex-models.json'), 'utf8').replace(/^\uFEFF/, ''));
const levels = String(process.argv.find((value) => value.startsWith('--levels='))?.split('=')[1] || '1,2,4,8,16,32,64,128')
  .split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 128);
const requestedModels = String(process.argv.find((value) => value.startsWith('--models='))?.split('=')[1] || '')
  .split(',').map((value) => value.trim()).filter(Boolean);
const requestedRounds = Math.max(0, Math.min(5, Number(
  process.argv.find((value) => value.startsWith('--rounds='))?.split('=')[1] || 0
)));
const maxP95LatencyMs = Math.max(30_000, Number(
  process.argv.find((value) => value.startsWith('--max-p95-ms='))?.split('=')[1] || 180_000
));

const schema = {
  type: 'object',
  additionalProperties: true,
  required: [
    'firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience',
    'education', 'skills', 'summary', 'strengths', 'potentialFlags', 'workExperience',
    'educationHistory', 'certifications', 'languages', 'awards', 'projects', 'publications',
    'volunteerWork', 'professionalMemberships', 'portfolioLinks', 'additionalSections', 'fullCVData'
  ],
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
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    potentialFlags: { type: 'array', items: { type: 'string' } },
    workExperience: { type: 'object' },
    educationHistory: { type: 'array', items: { type: 'object' } },
    certifications: { type: 'array', items: { type: 'object' } },
    languages: { type: 'array', items: { type: 'object' } },
    awards: { type: 'array', items: { type: 'object' } },
    projects: { type: 'array', items: { type: 'object' } },
    publications: { type: 'array', items: { type: 'object' } },
    volunteerWork: { type: 'array', items: { type: 'object' } },
    professionalMemberships: { type: 'array', items: { type: 'object' } },
    portfolioLinks: { type: 'object' },
    additionalSections: { type: 'object' },
    fullCVData: { type: 'object' }
  }
};

const cvText = `ADA OKAFOR
Senior Software Engineer
London, United Kingdom | ada.okafor@example.test | +44 7700 900123

SUMMARY
Software engineer with eight years of experience building reliable recruitment and payments platforms.

SKILLS
TypeScript, Node.js, PostgreSQL, Redis, React, AWS

EXPERIENCE
Senior Software Engineer, Northstar Systems, January 2021 to Present
- Led a five-person team and reduced API latency by 38 percent.
- Built BullMQ processing workflows with idempotent retries.

Software Engineer, Harbor Labs, June 2017 to December 2020
- Developed Node.js services and React interfaces.

EDUCATION
BSc Computer Science, University of Bristol, 2017

LANGUAGES
English (fluent), Igbo (native)`;

function sign(body) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${body}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

async function manage(action, engine, model) {
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', manageScript,
    '-Action', action, '-Json'
  ];
  if (engine) args.push('-Engine', engine);
  if (model) args.push('-Model', model);
  await execFileAsync('powershell.exe', args, {
    cwd: repositoryRoot,
    timeout: 15 * 60_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
}

async function setConcurrency(concurrency) {
  const response = await fetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ concurrency, enabled: true, paused: false })
  });
  if (!response.ok) throw new Error(`Could not set concurrency ${concurrency}`);
}

async function analyze(requestId) {
  const body = JSON.stringify({
    activity: 'candidate.cv_parse',
    model: 'selected-runtime-model',
    messages: [
      {
        role: 'system',
        content: `Extract every explicit CV fact into the supplied schema. Do not infer or invent information. Internal request id: ${requestId}.`
      },
      { role: 'user', content: `CV text:\n\n${threePageCvText}` }
    ],
    jsonSchema: schema,
    temperature: 0,
    timeoutMs: 300_000
  });
  const signed = sign(body);
  const startedAt = Date.now();
  try {
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
    if (!response.ok) throw new Error(`${payload.code || response.status}: ${payload.message || 'request failed'}`);
    const quality = scoreCvOutput(payload.data);
    return {
      ok: quality.passed,
      transportOk: true,
      qualityOk: quality.passed,
      quality,
      observed: {
        firstName: payload.data.firstName,
        lastName: payload.data.lastName,
        email: payload.data.email,
        skills: payload.data.skills
      },
      engine: payload.engine,
      model: payload.model,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      transportOk: false,
      qualityOk: false,
      latencyMs: Date.now() - startedAt,
      timeout: /abort|timeout/i.test(error.message),
      rateLimited: /429|rate.?limit/i.test(error.message),
      error: error.message
    };
  }
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function benchmarkModel(model) {
  await manage('select-engine', 'codex', model);
  const runs = [];
  for (const concurrency of levels) {
    await setConcurrency(concurrency);
    const rounds = requestedRounds || (concurrency <= 8 ? 2 : 1);
    const startedAt = Date.now();
    const results = [];
    for (let round = 0; round < rounds; round += 1) {
      results.push(...await Promise.all(
        Array.from({ length: concurrency }, (_, index) => analyze(`${model}-${concurrency}-${round}-${index}`))
      ));
    }
    const elapsedMs = Date.now() - startedAt;
    const latencies = results.filter((result) => result.transportOk).map((result) => result.latencyMs);
    runs.push({
      concurrency,
      rounds,
      requests: results.length,
      successful: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      transportSuccessful: results.filter((result) => result.transportOk).length,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      throughputPerMinute: Number((results.filter((result) => result.ok).length / (elapsedMs / 60_000)).toFixed(2)),
      elapsedMs,
      stable: results.every((result) => result.transportOk),
      qualityPassed: results.every((result) => result.qualityOk),
      results
    });
    const run = runs.at(-1);
    run.qualityPassRate = run.requests ? run.successful / run.requests : 0;
    run.acceptable = run.stable
      && run.qualityPassRate >= 0.95
      && run.p95LatencyMs != null
      && run.p95LatencyMs <= maxP95LatencyMs;
    if (!run.acceptable) break;
  }
  let maxAcceptableConcurrency = 0;
  for (const run of runs) {
    if (!run.acceptable) break;
    maxAcceptableConcurrency = run.concurrency;
  }
  return {
    model,
    supportedInApi: Boolean(catalog.models.find((item) => item.id === model)?.supportedInApi),
    passed: runs.every((run) => run.acceptable),
    maxTestedStableConcurrency: maxAcceptableConcurrency,
    firstUnacceptableConcurrency: runs.find((run) => !run.acceptable)?.concurrency || null,
    runs
  };
}

async function main() {
  const original = await (await fetch(`${gatewayUrl}/control/status`)).json();
  const catalogModels = catalog.models.map((model) => model.id);
  const models = requestedModels.length
    ? requestedModels.filter((model) => catalogModels.includes(model))
    : catalogModels;
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: 'three-page A4 synthetic Ada Okafor CV using the Seemplify CV contract',
    fixturePages: pageCount,
    fixtureCharacters: threePageCvText.length,
    levels,
    rounds: requestedRounds || '2 through concurrency 8; 1 above 8',
    acceptance: {
      transportSuccessRate: 1,
      qualityPassRate: 0.95,
      maxP95LatencyMs
    },
    models: []
  };
  try {
    for (const model of models) {
      process.stdout.write(`Testing ${model} at concurrency ${levels.join(', ')}...\n`);
      const result = await benchmarkModel(model);
      report.models.push(result);
      process.stdout.write(`${JSON.stringify({
        model,
        passed: result.passed,
        maxTestedStableConcurrency: result.maxTestedStableConcurrency,
        p95LatencyMs: result.runs.at(-1)?.p95LatencyMs
      })}\n`);
    }
  } finally {
    await manage('select-engine', 'codex', 'gpt-5.6-terra');
    if (original.engine !== 'codex') {
      await manage('select-engine', original.engine, original.model);
    }
  }
  report.passed = report.models.every((model) => model.passed);
  const reportFile = path.join(runtimeDir, 'codex-model-benchmark.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  for (const model of report.models) {
    recordApproval({
      engine: 'codex',
      model: model.model,
      concurrency: model.maxTestedStableConcurrency || 1,
      measuredAt: report.generatedAt,
      reportFile
    });
  }
  process.stdout.write(`${JSON.stringify({ passed: report.passed, reportFile })}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
