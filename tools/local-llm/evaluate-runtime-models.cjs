const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const secretFile = path.join(runtimeDir, 'service-secret');
const reportFile = path.join(runtimeDir, 'reports', 'local-runtime-model-matrix.json');
const manageScript = path.join(__dirname, 'manage.ps1');
const gatewayUrl = 'http://127.0.0.1:11435';
const requestTimeoutMs = Math.max(60_000, Number(
  process.argv.find((value) => value.startsWith('--request-timeout-ms='))?.split('=')[1] || 6 * 60_000
));
const engineTimeoutMs = Math.max(requestTimeoutMs, Number(
  process.argv.find((value) => value.startsWith('--engine-timeout-ms='))?.split('=')[1] || 20 * 60_000
));
const requestedProfileIds = new Set(
  String(process.argv.find((value) => value.startsWith('--profiles='))?.split('=')[1] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

const allProfiles = [
  { id: 'gemma-ollama', engine: 'ollama', model: 'gemma4:26b-a4b-it-qat' },
  { id: 'qwen30-ollama', engine: 'ollama', model: 'qwen3:30b' },
  { id: 'qwen14-vllm', engine: 'vllm', model: 'Qwen/Qwen3-14B-AWQ' }
];
const profiles = requestedProfileIds.size
  ? allProfiles.filter((profile) => requestedProfileIds.has(profile.id))
  : allProfiles;

const cvSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['firstName', 'lastName', 'email', 'position', 'skills', 'summary'],
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    email: { type: 'string' },
    position: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }
  }
};

const questionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'competency', 'expectedSignals'],
        properties: {
          question: { type: 'string' },
          competency: { type: 'string' },
          expectedSignals: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sign(secret, body) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  return {
    timestamp,
    nonce,
    signature: crypto.createHmac('sha256', secret)
      .update(`${timestamp}\n${nonce}\n${body}`)
      .digest('base64url')
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function manage(action, engine, model) {
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', manageScript, '-Action', action, '-Json'
  ];
  if (engine) args.push('-Engine', engine);
  if (model) args.push('-Model', model);
  await execFileAsync('powershell.exe', args, {
    cwd: repositoryRoot,
    timeout: engineTimeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
}

async function status() {
  const response = await fetch(`${gatewayUrl}/control/status`, {
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Gateway status returned ${response.status}`);
  return response.json();
}

async function updateControlState(update) {
  const response = await fetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Gateway control update returned ${response.status}`);
  return response.json();
}

async function waitForProfile(profile) {
  const deadline = Date.now() + engineTimeoutMs;
  let lastError = 'runtime not ready';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${gatewayUrl}/health`, {
        signal: AbortSignal.timeout(8_000)
      });
      const health = await response.json();
      if (
        response.ok
        && health.ok
        && health.engine?.ok
        && health.engine?.modelInstalled
        && health.engine?.engine === profile.engine
        && health.engine?.model === profile.model
      ) return health;
      lastError = health.engine?.error || `active runtime is ${health.engine?.engine || 'unknown'} / ${health.engine?.model || 'unknown'}`;
    } catch (error) {
      lastError = error.message;
    }
    await wait(3_000);
  }
  throw new Error(`${profile.id} did not become healthy: ${lastError}`);
}

async function signedRequest(secret, endpoint, input) {
  const body = JSON.stringify({ ...input, executionMode: 'local-only' });
  const signed = sign(secret, body);
  const startedAt = Date.now();
  const response = await fetch(`${gatewayUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    body,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(`${payload.code || response.status}: ${payload.message || 'local request failed'}`);
    error.payload = payload;
    throw error;
  }
  return { payload, latencyMs: Date.now() - startedAt };
}

function includesEvery(haystack, values) {
  const normalized = String(haystack || '').toLowerCase();
  return values.every((value) => normalized.includes(String(value).toLowerCase()));
}

async function runProfile(secret, profile) {
  process.stdout.write(`[${profile.id}] selecting ${profile.engine} / ${profile.model}\n`);
  await manage('select-engine', profile.engine, profile.model);
  const health = await waitForProfile(profile);
  const cases = [];

  const text = await signedRequest(secret, '/v1/complete', {
    activity: 'recruiter.general',
    messages: [
      { role: 'system', content: 'Follow the requested output exactly.' },
      { role: 'user', content: 'Reply with exactly SEEMPLIFY_LOCAL_OK and nothing else.' }
    ],
    temperature: 0,
    maxTokens: 32
  });
  cases.push({
    id: 'text',
    passed: String(text.payload.content || '').trim() === 'SEEMPLIFY_LOCAL_OK',
    latencyMs: text.latencyMs,
    output: String(text.payload.content || '').slice(0, 160)
  });

  const questions = await signedRequest(secret, '/v1/complete', {
    activity: 'interview.questions',
    messages: [
      {
        role: 'system',
        content: 'Create concise, evidence-based interview questions. Do not include protected-characteristic questions.'
      },
      {
        role: 'user',
        content: 'Create exactly three questions for a senior Node.js engineer: one architecture, one reliability, and one collaboration question.'
      }
    ],
    jsonSchema: questionSchema,
    schemaName: 'model_matrix_questions',
    temperature: 0,
    maxTokens: 1200
  });
  const questionItems = questions.payload.data?.questions || [];
  const questionText = JSON.stringify(questionItems);
  const competencyCoverage = [
    /architect|system design|scalab/i,
    /reliab|resilien|fault|failure|incident|recovery/i,
    /collabor|team|stakeholder|conflict|communication/i
  ].every((pattern) => pattern.test(questionText));
  cases.push({
    id: 'question_generation',
    passed: questionItems.length === 3
      && competencyCoverage
      && !/\bage\b|marital|religion|pregnan|ethnic/i.test(questionText),
    latencyMs: questions.latencyMs,
    count: questionItems.length,
    competencies: questionItems.map((item) => item.competency)
  });

  const tool = await signedRequest(secret, '/v1/complete', {
    activity: 'assistant.tool_selection',
    messages: [{ role: 'user', content: 'Find candidates who have Node.js and PostgreSQL skills.' }],
    tools: [{
      type: 'function',
      function: {
        name: 'find_candidates',
        description: 'Find candidates by skills',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['skills'],
          properties: {
            skills: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }],
    toolChoice: 'required',
    temperature: 0,
    maxTokens: 500
  });
  const toolCall = tool.payload.toolCalls?.[0];
  let toolArguments = {};
  try { toolArguments = JSON.parse(toolCall?.function?.arguments || '{}'); } catch {}
  cases.push({
    id: 'tool_selection',
    passed: tool.payload.finishReason === 'tool_calls'
      && toolCall?.function?.name === 'find_candidates'
      && includesEvery(JSON.stringify(toolArguments), ['Node.js', 'PostgreSQL']),
    latencyMs: tool.latencyMs,
    functionName: toolCall?.function?.name || null
  });

  const cv = await signedRequest(secret, '/v1/cv/analyze', {
    activity: 'candidate.cv_parse',
    messages: [
      { role: 'system', content: 'Extract only facts explicitly present in the CV. Never infer missing details.' },
      {
        role: 'user',
        content: [
          'ADA OKAFOR',
          'Principal Software Engineer',
          'ada.okafor@example.test',
          'Skills: TypeScript, Node.js, PostgreSQL, Kubernetes',
          'Experience: Northstar Systems, 2020 to present',
          'Education: BSc Computer Science, University of Bristol'
        ].join('\n')
      }
    ],
    jsonSchema: cvSchema,
    schemaName: 'model_matrix_cv',
    temperature: 0,
    maxTokens: 900
  });
  const cvData = cv.payload.data || {};
  cases.push({
    id: 'cv_extraction',
    passed: String(cvData.firstName || '').toLowerCase() === 'ada'
      && String(cvData.lastName || '').toLowerCase() === 'okafor'
      && String(cvData.email || '').toLowerCase() === 'ada.okafor@example.test'
      && includesEvery(JSON.stringify(cvData.skills), ['TypeScript', 'Node.js', 'PostgreSQL', 'Kubernetes'])
      && !includesEvery(JSON.stringify(cvData), ['Google']),
    latencyMs: cv.latencyMs
  });

  return {
    ...profile,
    passed: cases.every((item) => item.passed),
    checkedAt: new Date().toISOString(),
    health,
    cases,
    totalLatencyMs: cases.reduce((sum, item) => sum + item.latencyMs, 0)
  };
}

async function main() {
  if (!profiles.length) throw new Error('No matching model profiles were selected.');
  if (!fs.existsSync(secretFile)) throw new Error('Local gateway service secret is missing.');
  const secret = fs.readFileSync(secretFile, 'utf8').trim();
  const original = await status();
  const report = {
    generatedAt: new Date().toISOString(),
    original: { engine: original.engine, model: original.model },
    sequential: true,
    simultaneousEnginesAllowed: false,
    profiles: []
  };

  try {
    for (const profile of profiles) {
      try {
        report.profiles.push(await runProfile(secret, profile));
      } catch (error) {
        report.profiles.push({
          ...profile,
          passed: false,
          checkedAt: new Date().toISOString(),
          error: error.message
        });
        await updateControlState({ enabled: true, ingressEnabled: true, paused: false }).catch(() => {});
      }
    }
  } finally {
    process.stdout.write(`[restore] ${original.engine} / ${original.model}\n`);
    await manage('select-engine', original.engine, original.model);
    await updateControlState({
      enabled: original.state?.enabled !== false,
      ingressEnabled: original.state?.ingressEnabled !== false,
      paused: original.state?.paused === true,
      concurrency: Math.max(1, Number(original.state?.concurrency || 1))
    });
    await waitForProfile({ id: 'original', engine: original.engine, model: original.model });
  }

  report.completedAt = new Date().toISOString();
  report.passed = report.profiles.length === profiles.length && report.profiles.every((profile) => profile.passed);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const temporary = `${reportFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, reportFile);
  process.stdout.write(`${JSON.stringify({
    passed: report.passed,
    reportFile,
    profiles: report.profiles.map(({ id, engine, model, passed, totalLatencyMs, error, cases }) => ({
      id,
      engine,
      model,
      passed,
      totalLatencyMs,
      error,
      cases: cases?.map(({ id: caseId, passed: casePassed, latencyMs }) => ({ id: caseId, passed: casePassed, latencyMs }))
    }))
  })}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
