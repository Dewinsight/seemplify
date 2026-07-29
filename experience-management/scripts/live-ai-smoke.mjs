import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const project = path.resolve(import.meta.dirname, '..');
const repository = path.resolve(project, '..');
const baseUrl = process.env.EXPERIENCE_URL || 'http://127.0.0.1:5410';
const email = process.env.EXPERIENCE_ADMIN_EMAIL || 'admin@seemplify.local';
const password = fs.readFileSync(path.join(repository, '.local-runtime', 'experience-management', 'admin-password'), 'utf8').trim();
let cookie = '';
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
  const generation = await waitForJob(generated.jobId); surveyId = generation.result.output.survey.id;
  const detail = await call(`/api/surveys/${surveyId}`); await post(`/api/surveys/${surveyId}/publish`, { status: 'live' });
  const answers = Object.fromEntries(detail.survey.questions.filter((question) => question.type !== 'statement').map((question) => [question.id, answer(question)]));
  const submitted = await post(`/api/public/collectors/${detail.collectors[0].slug}/responses`, { answers, status: 'completed', startedAt: new Date(Date.now() - 65_000).toISOString() });
  const jobs = await call('/api/ai/jobs?limit=20'); const analysis = jobs.find((job) => job.kind === 'response.analyze' && job.responseId === submitted.responseId); if (!analysis) throw new Error('Response analysis was not queued.'); await waitForJob(analysis.id);
  for (const request of [
    ['improve', {}], ['translate', { language: 'French' }], ['insights', {}],
    ['ask', { question: 'What is the most urgent issue and which response supports it?' }], ['report', { audience: 'executive leadership' }]
  ]) { const queued = await post(`/api/surveys/${surveyId}/ai/${request[0]}`, request[1]); await waitForJob(queued.jobId); }
  console.log('LIVE_AI_SMOKE_PASS');
} finally {
  if (surveyId) await call(`/api/surveys/${surveyId}`, { method: 'DELETE' }).catch(() => null);
}
