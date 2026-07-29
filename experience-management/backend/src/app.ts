import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { z } from 'zod';
import { aiJobRunner } from './aiJobs.js';
import { login, logout, requireAdmin, session } from './auth.js';
import { computeAnalytics } from './analytics.js';
import { config } from './config.js';
import {
  createCollector, createJob, createResponse, db, deleteSurvey, getCollectorBySlug, getJob,
  getResponse, getSurvey, listCollectors, listInsights, listJobs, listResponses, listSurveys, saveSurvey
} from './database.js';
import { attachEventStream, publishEvent } from './events.js';
import { emailStatus, listRecipients, sendInvitations } from './emailService.js';
import { getTerraStatus } from './terraClient.js';
import { templates } from './templates.js';
import { QUESTION_TYPES, type AiJobKind, type Collector, type LogicRule, type Question, type ResponseRecord, type Survey } from './types.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '3mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0, 10)}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, /^(image|audio|video)\//.test(file.mimetype) || file.mimetype === 'application/pdf')
});
app.use('/uploads', express.static(config.uploadDir, { index: false, maxAge: '1d' }));

app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/session', session);
app.use('/api', (request, response, next) => {
  const publicRoute = request.path.startsWith('/public/collectors/') || request.path === '/uploads';
  return publicRoute ? next() : requireAdmin(request, response, next);
});

const surveyInput = z.object({
  id: z.string().uuid().optional(), title: z.string().min(2).max(180), description: z.string().max(3000).optional(),
  purpose: z.enum(['customer_experience', 'employee_experience', 'market_research']).optional(),
  audience: z.string().max(500).optional(), status: z.enum(['draft', 'live', 'closed']).optional(),
  primaryMetric: z.enum(['nps', 'csat', 'ces', 'custom']).optional(), language: z.string().max(80).optional(),
  thankYouMessage: z.string().max(1000).optional(), theme: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  questions: z.array(z.object({
    id: z.string().optional(), page: z.number().int().min(1).optional(), position: z.number().int().optional(),
    type: z.enum(QUESTION_TYPES), title: z.string().min(1).max(1000), description: z.string().max(2000).optional(),
    required: z.boolean().optional(), options: z.array(z.string().max(500)).max(100).optional(),
    settings: z.record(z.string(), z.unknown()).optional(), logic: z.array(z.record(z.string(), z.unknown())).optional()
  })).max(80).optional()
});

function sendError(response: express.Response, error: unknown, status = 400) {
  if (error instanceof z.ZodError) return response.status(status).json({ error: 'Validation failed', details: error.issues });
  const message = error instanceof Error ? error.message : String(error);
  return response.status(status).json({ error: message });
}

function requireSurvey(id: string) {
  const survey = getSurvey(id);
  if (!survey) throw new Error('Survey not found.');
  return survey;
}

function hasAnswer(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.some(hasAnswer);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasAnswer);
  return true;
}

function ruleMatches(rule: LogicRule, answers: Record<string, unknown>) {
  const actual = answers[rule.sourceQuestionId];
  if (!hasAnswer(actual)) return false;
  if (rule.operator === 'contains') return Array.isArray(actual) ? actual.map(String).includes(String(rule.value)) : String(actual).toLowerCase().includes(String(rule.value).toLowerCase());
  if (rule.operator === 'not_equals') return String(actual) !== String(rule.value);
  if (rule.operator === 'less_than') return Number(actual) < Number(rule.value);
  if (rule.operator === 'greater_than') return Number(actual) > Number(rule.value);
  return String(actual) === String(rule.value);
}

function questionIsVisible(question: Question, answers: Record<string, unknown>) {
  const show = (question.logic || []).filter((rule) => rule.action === 'show');
  const hidden = (question.logic || []).filter((rule) => rule.action === 'hide').some((rule) => ruleMatches(rule, answers));
  return !hidden && (!show.length || show.every((rule) => ruleMatches(rule, answers)));
}

function skippedPages(survey: Survey, answers: Record<string, unknown>) {
  const questions = survey.questions || [];
  const pages = new Set<number>();
  for (const rule of questions.flatMap((question) => question.logic || []).filter((item) => item.action === 'skip_to' && item.targetQuestionId && ruleMatches(item, answers))) {
    const source = questions.find((question) => question.id === rule.sourceQuestionId);
    const target = questions.find((question) => question.id === rule.targetQuestionId);
    if (!source || !target || target.page <= source.page) continue;
    for (let page = source.page + 1; page < target.page; page += 1) pages.add(page);
  }
  return pages;
}

function createRuleTickets(survey: Survey, responseRecord: ResponseRecord) {
  const questions = survey.questions || [];
  for (const rule of questions.flatMap((question) => question.logic || []).filter((item) => item.action === 'create_ticket' && ruleMatches(item, responseRecord.answers))) {
    const existing = db.prepare("SELECT id FROM tickets WHERE response_id=? AND status<>'closed'").get(responseRecord.id);
    if (existing) return;
    const source = questions.find((question) => question.id === rule.sourceQuestionId);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO tickets (id,survey_id,response_id,title,priority,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?,?)`).run(
      crypto.randomUUID(), survey.id, responseRecord.id, `Follow up: ${source?.title || 'survey response'}`.slice(0, 160), 'high',
      `Triggered when the answer ${rule.operator.replaceAll('_', ' ')} ${String(rule.value)}.`, now, now
    );
  }
}

function queueJob(kind: AiJobKind, input: Record<string, unknown>, surveyId?: string | null, responseId?: string | null) {
  const job = createJob(kind, input, surveyId, responseId);
  publishEvent('ai-job', job);
  void aiJobRunner.pump();
  return job;
}

function noStore(_request: express.Request, response: express.Response, next: express.NextFunction) {
  response.setHeader('Cache-Control', 'no-store');
  next();
}

app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'seemplify-experience', database: 'sqlite', at: new Date().toISOString() }));
app.get('/api/events', attachEventStream);
app.get('/api/runtime', noStore, async (_request, response) => response.json({ terra: await getTerraStatus(), email: emailStatus(), worker: aiJobRunner.status() }));
app.get('/api/bootstrap', noStore, (_request, response) => {
  const surveys = listSurveys();
  const jobCounts = db.prepare(`SELECT state,COUNT(*) count FROM ai_jobs GROUP BY state`).all();
  response.json({
    surveys,
    overview: {
      surveys: surveys.length,
      liveSurveys: surveys.filter((survey) => survey.status === 'live').length,
      responses: Number((db.prepare('SELECT COUNT(*) count FROM responses').get() as any).count),
      openTickets: Number((db.prepare("SELECT COUNT(*) count FROM tickets WHERE status<>'closed'").get() as any).count),
      aiJobs: jobCounts
    },
    recentJobs: listJobs(12), email: emailStatus()
  });
});

app.get('/api/templates', (_request, response) => response.json(templates));
app.post('/api/templates/:templateId/create', (request, response) => {
  const template = templates.find((item) => item.id === String(request.params.templateId));
  if (!template) return response.status(404).json({ error: 'Template not found.' });
  const survey = saveSurvey({
    title: request.body?.title || template.name, description: template.description, purpose: template.purpose,
    primaryMetric: template.primaryMetric, audience: template.audience
  }, template.questions.map((question, index) => ({ ...question, page: 1, position: index, options: question.options || [], settings: question.settings || {}, logic: [] })));
  const collector = createCollector(survey.id, { name: 'Public web link', type: 'web' });
  publishEvent('data-changed', { surveyId: survey.id, reason: 'survey-created' });
  return response.status(201).json({ survey, collector });
});

app.get('/api/surveys', noStore, (_request, response) => response.json(listSurveys()));
app.post('/api/surveys', (request, response) => {
  try {
    const input = surveyInput.parse(request.body);
    const survey = saveSurvey(input as any, input.questions as any);
    publishEvent('data-changed', { surveyId: survey.id, reason: 'survey-created' });
    return response.status(201).json(survey);
  } catch (error) { return sendError(response, error); }
});
app.post('/api/ai/surveys', (request, response) => {
  const brief = z.object({ brief: z.string().min(10).max(8000), purpose: z.string().optional(), audience: z.string().optional(), language: z.string().optional(), numberOfQuestions: z.number().int().min(2).max(40).optional() }).safeParse(request.body);
  if (!brief.success) return sendError(response, brief.error);
  const job = queueJob('survey.generate', brief.data);
  return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
});
app.get('/api/surveys/:id', noStore, (request, response) => {
  const survey = getSurvey(String(request.params.id));
  if (!survey) return response.status(404).json({ error: 'Survey not found.' });
  return response.json({ survey, collectors: listCollectors(survey.id), insights: listInsights(survey.id) });
});
app.put('/api/surveys/:id', (request, response) => {
  try {
    const current = requireSurvey(String(request.params.id));
    const input = surveyInput.parse({ ...current, ...request.body, id: current.id });
    const survey = saveSurvey(input as any, input.questions as any);
    publishEvent('data-changed', { surveyId: survey.id, reason: 'survey-updated' });
    return response.json(survey);
  } catch (error) { return sendError(response, error); }
});
app.delete('/api/surveys/:id', (request, response) => deleteSurvey(String(request.params.id)) ? response.status(204).end() : response.status(404).json({ error: 'Survey not found.' }));
app.post('/api/surveys/:id/publish', (request, response) => {
  try {
    const survey = requireSurvey(String(request.params.id));
    const nextStatus: Survey['status'] = request.body?.status === 'closed' ? 'closed' : 'live';
    const updated = saveSurvey({ ...survey, status: nextStatus, publishedAt: nextStatus === 'live' ? (survey.publishedAt || new Date().toISOString()) : survey.publishedAt }, survey.questions);
    publishEvent('data-changed', { surveyId: survey.id, reason: 'survey-status' });
    return response.json(updated);
  } catch (error) { return sendError(response, error, 404); }
});

app.get('/api/surveys/:id/collectors', noStore, (request, response) => response.json(listCollectors(String(request.params.id))));
app.post('/api/surveys/:id/collectors', (request, response) => {
  try {
    requireSurvey(String(request.params.id));
    const input = z.object({ name: z.string().min(2), type: z.enum(['web', 'email', 'api', 'qr', 'manual', 'kiosk']), slug: z.string().regex(/^[a-z0-9-]+$/).optional(), settings: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
    const collector = createCollector(String(request.params.id), input as Partial<Collector>);
    publishEvent('data-changed', { surveyId: String(request.params.id), reason: 'collector-created' });
    return response.status(201).json(collector);
  } catch (error) { return sendError(response, error); }
});
app.get('/api/collectors/:id/recipients', noStore, (request, response) => response.json(listRecipients(String(request.params.id))));
app.post('/api/collectors/:id/invitations', async (request, response) => {
  const collectorRow = db.prepare('SELECT * FROM collectors WHERE id=?').get(String(request.params.id)) as any;
  if (!collectorRow) return response.status(404).json({ error: 'Collector not found.' });
  const collector = getCollectorBySlug(collectorRow.slug)!;
  const survey = requireSurvey(collector.surveyId);
  const input = z.object({ recipients: z.array(z.object({ email: z.string().email(), name: z.string().max(150).optional() })).min(1).max(250), message: z.string().max(3000).optional() }).safeParse(request.body);
  if (!input.success) return sendError(response, input.error);
  const outcomes = await sendInvitations(survey, collector, input.data.recipients, input.data.message);
  publishEvent('data-changed', { surveyId: survey.id, reason: 'invitations-sent' });
  return response.status(outcomes.some((item) => item.status === 'failed') ? 207 : 200).json({ outcomes, email: emailStatus() });
});

app.get('/api/public/collectors/:slug', noStore, (request, response) => {
  const collector = getCollectorBySlug(String(request.params.slug));
  if (!collector) return response.status(404).json({ error: 'Survey link not found.' });
  const survey = getSurvey(collector.surveyId);
  if (!survey || survey.status !== 'live' || collector.status !== 'open') return response.status(410).json({ error: 'This survey is not accepting responses.' });
  return response.json({ survey, collector });
});

const submissionWindows = new Map<string, number[]>();
function allowSubmission(key: string) {
  const now = Date.now();
  const recent = (submissionWindows.get(key) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  submissionWindows.set(key, recent);
  return true;
}

app.post('/api/public/collectors/:slug/responses', (request, response) => {
  const collector = getCollectorBySlug(String(request.params.slug));
  if (!collector) return response.status(404).json({ error: 'Survey link not found.' });
  const survey = getSurvey(collector.surveyId);
  if (!survey || survey.status !== 'live' || collector.status !== 'open') return response.status(410).json({ error: 'This survey is not accepting responses.' });
  const remote = String(request.ip || 'unknown');
  if (!allowSubmission(`${remote}:${collector.id}`)) return response.status(429).json({ error: 'Too many submissions. Please wait before trying again.' });
  const input = z.object({ answers: z.record(z.string(), z.unknown()), startedAt: z.string().datetime().optional(), respondentToken: z.string().max(200).optional(), status: z.enum(['partial', 'completed']).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).safeParse(request.body);
  if (!input.success) return sendError(response, input.error);
  const answers = input.data.answers;
  const omittedPages = skippedPages(survey, answers);
  const missing = (survey.questions || []).filter((question) => question.required && question.type !== 'statement' && !omittedPages.has(question.page) && questionIsVisible(question, answers) && !hasAnswer(answers[question.id]));
  if (missing.length && input.data.status !== 'partial') return response.status(400).json({ error: 'Required questions are incomplete.', questionIds: missing.map((question) => question.id) });
  const stored = createResponse({
    surveyId: survey.id, collectorId: collector.id, respondentToken: input.data.respondentToken,
    answers, startedAt: input.data.startedAt, status: input.data.status,
    metadata: { ...(input.data.metadata || {}), userAgent: request.get('user-agent')?.slice(0, 300), ipHash: crypto.createHash('sha256').update(remote).digest('hex').slice(0, 16) }
  });
  if (stored.status === 'completed') {
    const recipient = request.query.recipient || input.data.respondentToken;
    if (recipient) db.prepare(`UPDATE recipients SET status='responded',responded_at=? WHERE token=?`).run(new Date().toISOString(), String(recipient));
    createRuleTickets(survey, stored);
    queueJob('response.analyze', {}, survey.id, stored.id);
  }
  publishEvent('response', { surveyId: survey.id, responseId: stored.id, status: stored.status });
  return response.status(201).json({ responseId: stored.id, status: stored.status, thankYouMessage: survey.thankYouMessage });
});

app.post('/api/uploads', upload.single('file'), (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'No supported file was uploaded.' });
  return response.status(201).json({
    id: path.parse(request.file.filename).name, name: request.file.originalname, mimeType: request.file.mimetype,
    size: request.file.size, url: `${config.publicUrl}/uploads/${encodeURIComponent(request.file.filename)}`,
    transcriptionState: /^(audio|video)\//.test(request.file.mimetype) ? 'transcript_required' : 'not_applicable'
  });
});

app.get('/api/surveys/:id/responses', noStore, (request, response) => response.json(listResponses(String(request.params.id), Math.min(1000, Number(request.query.limit || 500)))));
app.get('/api/responses/:id', noStore, (request, response) => {
  const item = getResponse(String(request.params.id));
  return item ? response.json(item) : response.status(404).json({ error: 'Response not found.' });
});
app.post('/api/responses/:id/analyze', (request, response) => {
  const item = getResponse(String(request.params.id));
  if (!item) return response.status(404).json({ error: 'Response not found.' });
  const job = queueJob('response.analyze', {}, item.surveyId, item.id);
  return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
});
app.get('/api/surveys/:id/analytics', noStore, (request, response) => {
  try {
    const survey = requireSurvey(String(request.params.id));
    return response.json(computeAnalytics(survey, listResponses(survey.id, 2000)));
  } catch (error) { return sendError(response, error, 404); }
});

for (const route of [
  { path: 'improve', kind: 'survey.improve' as const },
  { path: 'translate', kind: 'survey.translate' as const },
  { path: 'insights', kind: 'insights.generate' as const },
  { path: 'ask', kind: 'analyst.chat' as const },
  { path: 'report', kind: 'report.generate' as const }
]) {
  app.post(`/api/surveys/:id/ai/${route.path}`, (request, response) => {
    try {
      requireSurvey(String(request.params.id));
      const job = queueJob(route.kind, request.body || {}, String(request.params.id));
      return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
    } catch (error) { return sendError(response, error, 404); }
  });
}

app.get('/api/ai/jobs', noStore, (request, response) => response.json(listJobs(Math.min(500, Number(request.query.limit || 100)))));
app.get('/api/ai/jobs/:id', noStore, (request, response) => {
  const job = getJob(String(request.params.id));
  return job ? response.json(job) : response.status(404).json({ error: 'AI job not found.' });
});

app.get('/api/surveys/:id/insights', noStore, (request, response) => response.json(listInsights(String(request.params.id))));
app.get('/api/surveys/:id/tickets', noStore, (request, response) => response.json(db.prepare('SELECT * FROM tickets WHERE survey_id=? ORDER BY created_at DESC').all(String(request.params.id))));
app.patch('/api/tickets/:id', (request, response) => {
  const current = db.prepare('SELECT * FROM tickets WHERE id=?').get(String(request.params.id)) as any;
  if (!current) return response.status(404).json({ error: 'Ticket not found.' });
  const input = z.object({ status: z.enum(['open', 'in_progress', 'closed']).optional(), owner: z.string().max(150).optional(), notes: z.string().max(5000).optional(), priority: z.enum(['normal', 'high', 'urgent']).optional() }).parse(request.body);
  db.prepare('UPDATE tickets SET status=?,owner=?,notes=?,priority=?,updated_at=? WHERE id=?').run(input.status || current.status, input.owner ?? current.owner, input.notes ?? current.notes, input.priority || current.priority, new Date().toISOString(), current.id);
  publishEvent('data-changed', { surveyId: current.survey_id, reason: 'ticket-updated' });
  return response.json(db.prepare('SELECT * FROM tickets WHERE id=?').get(current.id));
});

function csvCell(value: unknown) { const text = typeof value === 'string' ? value : JSON.stringify(value ?? ''); return `"${text.replace(/"/g, '""')}"`; }
app.get('/api/surveys/:id/export.:format', (request, response) => {
  const survey = getSurvey(String(request.params.id));
  if (!survey) return response.status(404).json({ error: 'Survey not found.' });
  const responses = listResponses(survey.id, 10_000);
  if (String(request.params.format) === 'json') {
    response.setHeader('Content-Disposition', `attachment; filename="${survey.id}-responses.json"`);
    return response.json({ survey: compactExportSurvey(survey), responses });
  }
  if (String(request.params.format) !== 'csv') return response.status(400).json({ error: 'Use csv or json.' });
  const questions = survey.questions || [];
  const header = ['response_id', 'status', 'completed_at', ...questions.map((question) => question.title)];
  const lines = [header.map(csvCell).join(','), ...responses.map((item) => [item.id, item.status, item.completedAt, ...questions.map((question) => item.answers[question.id])].map(csvCell).join(','))];
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${survey.id}-responses.csv"`);
  return response.send(`\ufeff${lines.join('\n')}`);
});
function compactExportSurvey(survey: Survey) { return { id: survey.id, title: survey.title, purpose: survey.purpose, primaryMetric: survey.primaryMetric, questions: survey.questions }; }

if (fs.existsSync(config.frontendDist)) {
  app.use(express.static(config.frontendDist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api|\/health|\/uploads).*/, (_request, response) => response.sendFile('index.html', { root: config.frontendDist, dotfiles: 'allow' }));
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) return response.status(400).json({ error: error.message, code: error.code });
  return sendError(response, error, 500);
});

export { app };
