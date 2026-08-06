import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

const project = path.resolve(import.meta.dirname, '..');
const repository = path.resolve(project, '..');
const baseUrl = process.env.EXPERIENCE_URL || 'http://127.0.0.1:5410';
const email = process.env.EXPERIENCE_ADMIN_EMAIL || 'admin@seemplify.local';
const password = fs.readFileSync(path.join(repository, '.local-runtime', 'experience-management', 'admin-password'), 'utf8').trim();
let cookie = '';
const smokeJobIds = [];
const mentionIds = [];
const journeyIds = [];
async function removeSmokeJobs(ids) {
  if (!ids.length) return;
  const healthResponse = await fetch(`${baseUrl}/health`);
  const health = healthResponse.ok ? await healthResponse.json() : null;
  if (health?.database === 'postgres') {
    const { Client } = await import('pg');
    const passwordFile = process.env.POSTGRES_PASSWORD_FILE
      || path.join(repository, '.local-runtime', 'experience-management', 'postgres-password');
    const client = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DATABASE || 'seemplify_experience',
      user: process.env.POSTGRES_USER || 'seemplify_experience_app',
      password: fs.readFileSync(passwordFile, 'utf8').trim(),
      ssl: false
    });
    await client.connect();
    try { await client.query('DELETE FROM ai_jobs WHERE id=ANY($1::text[])', [ids]); }
    finally { await client.end(); }
    return;
  }
  const databasePath = process.env.DATABASE_PATH
    || path.join(repository, '.local-runtime', 'experience-management', 'experience.sqlite');
  if (!fs.existsSync(databasePath)) return;
  const database = new Database(databasePath);
  try {
    const placeholders = ids.map(() => '?').join(',');
    database.prepare(`DELETE FROM ai_jobs WHERE id IN (${placeholders})`).run(...ids);
  } finally { database.close(); }
}
async function call(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, { ...options, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...options.headers } });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${response.status} ${data?.error || response.statusText}`);
  return data;
}
const post = (url, body = {}) => call(url, { method: 'POST', body: JSON.stringify(body) });
async function waitForJob(id, timeoutMs = 480_000) {
  const started = Date.now(); let previous = '';
  while (Date.now() - started < timeoutMs) {
    const job = await call(`/api/ai/jobs/${id}`); const marker = `${job.state}:${job.stage}:${job.progress}`;
    if (marker !== previous) { console.log(`${job.kind} ${marker}`); previous = marker; }
    if (job.state === 'completed') return job;
    if (job.state === 'failed') throw new Error(`${job.kind} failed: ${job.error}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for ${id}`);
}
function answer(question) {
  if (question.type === 'nps') return 4;
  if (['csat','ces','rating','slider','number'].includes(question.type)) return 2;
  if (question.type === 'single_choice') return question.options?.[0] || 'Other';
  if (question.type === 'multiple_choice') return [question.options?.[0] || 'Other'];
  if (question.type === 'email') return 'smoke@example.com';
  if (question.type === 'date') return '2026-07-29';
  if (question.type === 'contact') return { name: 'Test Respondent', email: 'smoke@example.com' };
  return 'The onboarding instructions were confusing and I could not finish setup. Please contact me urgently.';
}

let surveyId = '';
try {
  await post('/api/auth/login', { email, password });
  console.log('authenticated');
  const generated = await post('/api/ai/surveys', { brief: 'Create a short customer onboarding survey that measures recommendation, effort, clarity, and asks for actionable feedback.', purpose: 'customer_experience', audience: 'Customers in their first 30 days', language: 'English', numberOfQuestions: 6 });
  smokeJobIds.push(generated.jobId);
  const generation = await waitForJob(generated.jobId); surveyId = generation.result.output.survey.id;
  const detail = await call(`/api/surveys/${surveyId}`); await post(`/api/surveys/${surveyId}/publish`, { status: 'live' });
  const answers = Object.fromEntries(detail.survey.questions.filter((question) => question.type !== 'statement').map((question) => [question.id, answer(question)]));
  const submitted = await post(`/api/public/collectors/${detail.collectors[0].slug}/responses`, { answers, status: 'completed', startedAt: new Date(Date.now() - 65_000).toISOString() });
  const jobs = await call('/api/ai/jobs?limit=20'); const analysis = jobs.find((job) => job.kind === 'response.analyze' && job.responseId === submitted.responseId); if (!analysis) throw new Error('Response analysis was not queued.'); smokeJobIds.push(analysis.id); await waitForJob(analysis.id);
  for (const request of [
    ['improve', {}], ['translate', { language: 'French' }], ['insights', {}],
    ['ask', { question: 'What is the most urgent issue and which response supports it?' }], ['report', { audience: 'executive leadership' }]
  ]) { const queued = await post(`/api/surveys/${surveyId}/ai/${request[0]}`, request[1]); smokeJobIds.push(queued.jobId); await waitForJob(queued.jobId); }

  const social = await post('/api/social/mentions', { mentions: [
    { source: 'google_play', content: 'The new setup flow is clear and I reached the dashboard quickly.' },
    { source: 'review', content: 'Billing was confusing and support took two days to answer.' },
    { source: 'x', content: 'Support fixed my problem quickly, but the initial instructions were unclear.' }
  ], analyze: true });
  mentionIds.push(...social.mentions.map((mention) => mention.id)); smokeJobIds.push(social.jobId);
  const socialAnalysis = await waitForJob(social.jobId);
  const socialOutput = socialAnalysis.result.output;
  const socialCount = Object.values(socialOutput.sentiment).reduce((sum, value) => sum + Number(value), 0);
  if (socialCount !== mentionIds.length || socialOutput.mentions.length !== mentionIds.length) throw new Error('Social-listening output did not account for every supplied mention.');
  if (socialOutput.mentions.some((item) => !mentionIds.includes(item.mentionId))) throw new Error('Social-listening output invented a mention ID.');

  const journeyQueued = await post('/api/ai/journeys', {
    brief: 'Map a B2B software customer journey from discovery and evaluation through onboarding, adoption, support, renewal, and advocacy.',
    audience: 'Operations leaders at growing companies', industry: 'B2B software', objective: 'Reduce time to value and improve renewal'
  });
  smokeJobIds.push(journeyQueued.jobId);
  const journeyGenerated = await waitForJob(journeyQueued.jobId);
  const journey = journeyGenerated.result.output.journey;
  journeyIds.push(journey.id);
  if (!Array.isArray(journey.stages) || journey.stages.length < 3) throw new Error('Journey generation returned fewer than three stages.');
  const optimized = await post(`/api/journeys/${journey.id}/ai/optimize`, { focus: 'Strengthen measurable outcomes, owners, and closed-loop recovery.' });
  smokeJobIds.push(optimized.jobId);
  const optimizedJourney = await waitForJob(optimized.jobId);
  if (optimizedJourney.result.output.journey.id !== journey.id) throw new Error('Journey optimization did not preserve the journey identity.');
  console.log('LIVE_AI_SMOKE_PASS');
} finally {
  if (surveyId) await call(`/api/surveys/${surveyId}`, { method: 'DELETE' }).catch(() => null);
  for (const journeyId of journeyIds) {
    const current = await call(`/api/journeys/${journeyId}`).catch(() => null);
    if (current?.updatedAt) {
      await call(`/api/journeys/${journeyId}`, { method: 'DELETE', body: JSON.stringify({ expectedUpdatedAt: current.updatedAt }) }).catch(() => null);
    }
  }
  for (const mentionId of mentionIds) await call(`/api/social/mentions/${mentionId}`, { method: 'DELETE' }).catch(() => null);
  if (baseUrl.startsWith('http://127.0.0.1')) await removeSmokeJobs(smokeJobIds);
}
