import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { z } from 'zod';
import { aiJobRunner } from './aiJobs.js';
import { forgotPassword, login, logout, requireAdmin, resetPassword, session, signup } from './auth.js';
import { computeAnalytics } from './analytics.js';
import { config } from './config.js';
import {
  createCollector, createJob, createResponse, db, deleteJourney, deleteSurvey, getCollectorBySlug, getJob,
  getJourney, getResponse, getSurvey, insertSocialMentions, listCollectors, listInsights, listJobs,
  listJourneys, listResponses, listSocialMentions, listSocialMentionsByIds, listSurveys, saveJourney, saveSurvey
} from './database.js';
import { attachEventStream, publishEvent } from './events.js';
import { emailStatus, getRecipientUnsubscribePreview, listRecipients, markRecipientUnsubscribed, sendInvitations } from './emailService.js';
import {
  addCampaignContacts, campaignTemplates, createCampaign, getCampaignDetail, launchCampaign, listCampaignSummaries,
  getCampaignUnsubscribePreview, markCampaignContactResponded, pauseCampaign, replaceCampaignSteps, resumeCampaign,
  sendCampaignTest, suppressCampaignContact, suppressEmailGlobally, unsubscribeCampaignContact, updateCampaign
} from './campaigns.js';
import { authenticateBrevoWebhook, parseBrevoWebhookPayload, processBrevoWebhookEvents } from './brevoWebhook.js';
import { parseSocialMentionImport } from './socialImport.js';
import { getTerraStatus } from './terraClient.js';
import { templates } from './templates.js';
import { QUESTION_TYPES, type AiJobKind, type Collector, type LogicRule, type Question, type ResponseRecord, type SocialMention, type Survey } from './types.js';

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
const socialImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, /\.(csv|json|txt)$/i.test(file.originalname))
});
app.use('/uploads', express.static(config.uploadDir, { index: false, maxAge: '1d' }));

app.post('/api/auth/login', login);
app.post('/api/auth/signup', signup);
app.post('/api/auth/forgot-password', forgotPassword);
app.post('/api/auth/reset-password', resetPassword);
app.post('/api/auth/logout', logout);
app.get('/api/auth/session', session);
app.use('/api', (request, response, next) => {
  const publicRoute = request.path.startsWith('/public/collectors/') || request.path.startsWith('/public/campaigns/unsubscribe/')
    || request.path === '/webhooks/brevo/transactional' || request.path === '/uploads';
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

function publicHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function unsubscribePage(input: { title: string; message: string; action?: string; confirmed?: boolean }) {
  const form = input.action && !input.confirmed
    ? `<form method="post" action="${publicHtml(input.action)}"><button type="submit">Unsubscribe</button></form>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${publicHtml(input.title)}</title><style>body{margin:0;background:#f5f6f4;color:#20211f;font:16px/1.55 system-ui,sans-serif}.card{max-width:560px;margin:10vh auto;padding:32px;background:#fff;border:1px solid #dfe2dd}h1{font-size:24px;margin:0 0 12px}p{color:#59605b;margin:0 0 24px}button{border:0;background:#26352e;color:#fff;padding:11px 18px;font:600 14px system-ui,sans-serif;cursor:pointer}</style></head><body><main class="card"><h1>${publicHtml(input.title)}</h1><p>${publicHtml(input.message)}</p>${form}</main></body></html>`;
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

const mentionInput = z.object({
  source: z.enum(['x', 'google_play', 'app_store', 'review', 'forum', 'other']), author: z.string().max(200).optional(),
  content: z.string().min(2).max(5000), url: z.string().url().max(2000).or(z.literal('')).optional(), language: z.string().max(80).optional(),
  publishedAt: z.string().datetime().optional(), metadata: z.record(z.string(), z.unknown()).optional()
});
app.get('/api/social/mentions', noStore, (request, response) => {
  const requested = Number(request.query.limit || 500);
  return response.json(listSocialMentions(Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.floor(requested))) : 500));
});
app.post('/api/social/mentions', (request, response) => {
  const parsed = z.object({ mentions: z.array(mentionInput).min(1).max(200), analyze: z.boolean().optional() }).safeParse(request.body);
  if (!parsed.success) return sendError(response, parsed.error);
  const mentions = insertSocialMentions(parsed.data.mentions as Array<Partial<SocialMention> & { content: string; source: SocialMention['source'] }>);
  const job = parsed.data.analyze === false ? null : queueJob('social.analyze', { mentionIds: mentions.map((mention) => mention.id) });
  publishEvent('data-changed', { reason: 'social-mentions-imported', count: mentions.length });
  return response.status(job ? 202 : 201).json({ mentions, jobId: job?.id || null, state: job?.state || null });
});
app.post('/api/social/mentions/import', socialImportUpload.single('file'), (request, response) => {
  try {
    if (!request.file) return response.status(400).json({ error: 'Attach one UTF-8 CSV, JSON, or TXT file.' });
    const fields = z.object({
      defaultSource: z.enum(['x', 'google_play', 'app_store', 'review', 'forum', 'other']).default('other'),
      analyze: z.enum(['true', 'false']).optional(), mapping: z.string().max(5000).optional()
    }).parse(request.body || {});
    let mapping: Record<string, string> = {};
    if (fields.mapping) {
      const value = JSON.parse(fields.mapping);
      mapping = z.record(z.string(), z.string()).parse(value);
    }
    const parsed = parseSocialMentionImport({ buffer: request.file.buffer, fileName: request.file.originalname, defaultSource: fields.defaultSource, mapping });
    const validated = z.array(mentionInput.extend({ id: z.string().uuid() })).min(1).max(200).parse(parsed.mentions);
    const existingIds = new Set(listSocialMentionsByIds(validated.map((mention) => mention.id)).map((mention) => mention.id));
    const mentions = insertSocialMentions(validated as Array<Partial<SocialMention> & { content: string; source: SocialMention['source'] }>);
    const importedIds = mentions.map((mention) => mention.id).filter((id) => !existingIds.has(id));
    const job = fields.analyze === 'false' || !importedIds.length ? null : queueJob('social.analyze', { mentionIds: importedIds });
    const summary = { ...parsed.summary, imported: importedIds.length, skipped: validated.length - importedIds.length, replayed: importedIds.length === 0 };
    publishEvent('data-changed', { reason: 'social-mentions-file-imported', count: importedIds.length, batchId: parsed.summary.batchId, replayed: summary.replayed });
    return response.status(job ? 202 : 201).json({ mentions, jobId: job?.id || null, state: job?.state || null, summary });
  } catch (error) { return sendError(response, error); }
});

app.post('/api/webhooks/brevo/transactional', (request, response) => {
  const authentication = authenticateBrevoWebhook(request.get('authorization'));
  if (!authentication.configured) return response.status(503).json({ error: 'Webhook authentication is not configured.' });
  if (!authentication.authorized) return response.status(401).json({ error: 'Unauthorized.' });
  let events;
  try {
    events = parseBrevoWebhookPayload(request.body);
  } catch { return response.status(400).json({ error: 'Invalid transactional webhook payload.' }); }
  try { processBrevoWebhookEvents(events); return response.status(204).end(); }
  catch { return response.status(500).json({ error: 'Transactional webhook processing failed.' }); }
});
app.post('/api/social/analyze', (request, response) => {
  const parsed = z.object({ mentionIds: z.array(z.string()).min(1).max(500).optional() }).safeParse(request.body || {});
  if (!parsed.success) return sendError(response, parsed.error);
  const job = queueJob('social.analyze', { mentionIds: parsed.data.mentionIds || undefined });
  return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
});
app.delete('/api/social/mentions/:id', (request, response) => {
  const deleted = db.prepare('DELETE FROM social_mentions WHERE id=?').run(String(request.params.id)).changes > 0;
  if (!deleted) return response.status(404).json({ error: 'Mention not found.' });
  publishEvent('data-changed', { reason: 'social-mention-deleted', id: String(request.params.id) });
  return response.status(204).end();
});

const journeyInput = z.object({
  id: z.string().optional(), name: z.string().min(2).max(180), audience: z.string().max(500).optional(), objective: z.string().max(2000).optional(),
  industry: z.string().max(200).optional(), summary: z.string().max(5000).optional(), stages: z.array(z.object({
    name: z.string().min(1).max(200), goal: z.string().max(1000), touchpoints: z.array(z.string().max(500)).max(50), customerActions: z.array(z.string().max(500)).max(50),
    emotions: z.array(z.string().max(200)).max(30), painPoints: z.array(z.string().max(1000)).max(50), metrics: z.array(z.string().max(500)).max(50),
    opportunities: z.array(z.string().max(1000)).max(50), recommendedActions: z.array(z.string().max(1000)).max(50)
  })).max(20).optional()
});
app.get('/api/journeys', noStore, (_request, response) => response.json(listJourneys()));
app.get('/api/journeys/:id', noStore, (request, response) => { const journey = getJourney(String(request.params.id)); return journey ? response.json(journey) : response.status(404).json({ error: 'Journey not found.' }); });
app.post('/api/journeys', (request, response) => {
  const parsed = journeyInput.safeParse(request.body); if (!parsed.success) return sendError(response, parsed.error);
  const journey = saveJourney(parsed.data as any); publishEvent('data-changed', { reason: 'journey-saved', id: journey.id });
  return response.status(201).json(journey);
});
app.delete('/api/journeys/:id', (request, response) => {
  if (!deleteJourney(String(request.params.id))) return response.status(404).json({ error: 'Journey not found.' });
  publishEvent('data-changed', { reason: 'journey-deleted', id: String(request.params.id) });
  return response.status(204).end();
});
app.post('/api/ai/journeys', (request, response) => {
  const parsed = z.object({ brief: z.string().min(10).max(8000), audience: z.string().max(500).optional(), industry: z.string().max(200).optional(), objective: z.string().max(2000).optional() }).safeParse(request.body);
  if (!parsed.success) return sendError(response, parsed.error);
  const job = queueJob('journey.generate', parsed.data);
  return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
});
app.post('/api/journeys/:id/ai/optimize', (request, response) => {
  if (!getJourney(String(request.params.id))) return response.status(404).json({ error: 'Journey not found.' });
  const parsed = z.object({ focus: z.string().max(2000).optional() }).safeParse(request.body || {}); if (!parsed.success) return sendError(response, parsed.error);
  const job = queueJob('journey.optimize', { journeyId: String(request.params.id), focus: parsed.data.focus || '' });
  return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
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

const campaignStepInput = z.object({
  id: z.string().uuid().optional(), delayMinutes: z.number().int().min(0).max(525_600),
  subject: z.string().min(1).max(250), mode: z.enum(['plain', 'html']).default('plain'),
  bodyText: z.string().max(30_000).default(''), bodyHtml: z.string().max(100_000).optional(),
  embedQuestionId: z.string().max(200).nullable().optional()
});
app.get('/api/campaign-templates', noStore, (_request, response) => response.json(campaignTemplates.map((template) => ({
  ...template, ...template.steps[0]
}))));
app.get('/api/campaigns', noStore, (_request, response) => response.json(listCampaignSummaries()));
app.post('/api/campaigns', (request, response) => {
  try {
    const input = z.object({
      name: z.string().min(2).max(180), surveyId: z.string().min(1), collectorId: z.string().optional(),
      stopOnResponse: z.boolean().optional(), startAt: z.string().datetime().nullable().optional(), templateId: z.string().max(100).optional()
    }).parse(request.body);
    return response.status(201).json(createCampaign(input));
  } catch (error) { return sendError(response, error); }
});
app.get('/api/campaigns/:id', noStore, (request, response) => {
  try { return response.json(getCampaignDetail(String(request.params.id))); }
  catch (error) { return sendError(response, error, 404); }
});
app.put('/api/campaigns/:id', (request, response) => {
  try {
    const input = z.object({
      name: z.string().min(2).max(180).optional(), stopOnResponse: z.boolean().optional(),
      startAt: z.string().datetime().nullable().optional(), surveyId: z.string().optional(), collectorId: z.string().optional(),
      settings: z.object({ stopOnResponse: z.boolean().optional() }).passthrough().optional()
    }).parse(request.body);
    return response.json(updateCampaign(String(request.params.id), { ...input, stopOnResponse: input.stopOnResponse ?? input.settings?.stopOnResponse }));
  } catch (error) { return sendError(response, error); }
});
app.put('/api/campaigns/:id/steps', (request, response) => {
  try {
    const input = z.object({ steps: z.array(campaignStepInput).min(1).max(12) }).parse(request.body);
    return response.json(replaceCampaignSteps(String(request.params.id), input.steps as any));
  } catch (error) { return sendError(response, error); }
});
app.post('/api/campaigns/:id/contacts', (request, response) => {
  try {
    const input = z.object({ contacts: z.array(z.object({
      email: z.string().email().max(320), firstName: z.string().max(150).optional(), lastName: z.string().max(150).optional(),
      company: z.string().max(250).optional(), customData: z.record(z.string(), z.unknown()).optional()
    })).min(1).max(1000) }).parse(request.body);
    return response.status(201).json(addCampaignContacts(String(request.params.id), input.contacts));
  } catch (error) { return sendError(response, error); }
});
app.delete('/api/campaigns/:id/contacts/:contactId', (request, response) => {
  try {
    return suppressCampaignContact(String(request.params.id), String(request.params.contactId))
      ? response.status(204).end() : response.status(404).json({ error: 'Campaign contact not found.' });
  } catch (error) { return sendError(response, error, 404); }
});
app.post('/api/campaigns/:id/launch', (request, response) => {
  try {
    const input = z.object({ startAt: z.string().datetime().nullable().optional() }).parse(request.body || {});
    if (input.startAt !== undefined) updateCampaign(String(request.params.id), { startAt: input.startAt });
    return response.json(launchCampaign(String(request.params.id)));
  } catch (error) { return sendError(response, error); }
});
app.post('/api/campaigns/:id/pause', (request, response) => {
  try { return response.json(pauseCampaign(String(request.params.id))); }
  catch (error) { return sendError(response, error); }
});
app.post('/api/campaigns/:id/resume', (request, response) => {
  try { return response.json(resumeCampaign(String(request.params.id))); }
  catch (error) { return sendError(response, error); }
});
app.post('/api/campaigns/:id/test', async (request, response) => {
  try {
    const input = z.object({ email: z.string().email().optional(), emails: z.array(z.string().email()).max(10).optional() }).refine((value) => Boolean(value.email || value.emails?.length), 'Add at least one test email.').parse(request.body);
    const emails = [...new Set([...(input.emails || []), ...(input.email ? [input.email] : [])])];
    const result = await sendCampaignTest(String(request.params.id), emails);
    const failures = result.outcomes.filter((outcome) => outcome.status === 'failed').length;
    return response.status(failures === result.outcomes.length ? 502 : failures ? 207 : 200).json(result);
  } catch (error) { return sendError(response, error); }
});

app.get('/api/public/campaigns/unsubscribe/:token', noStore, (request, response) => {
  const token = String(request.params.token || ''); const preview = getCampaignUnsubscribePreview(token);
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (!preview) return response.status(404).type('html').send(unsubscribePage({ title: 'Link unavailable', message: 'This unsubscribe link is invalid or no longer available.' }));
  if (preview.alreadyUnsubscribed) return response.type('html').send(unsubscribePage({ title: 'Already unsubscribed', message: `${preview.email} will not receive future survey campaign messages.`, confirmed: true }));
  return response.type('html').send(unsubscribePage({
    title: 'Unsubscribe from survey emails',
    message: `Confirm that ${preview.email} should stop receiving survey campaign messages, including future campaigns.`,
    action: `/api/public/campaigns/unsubscribe/${encodeURIComponent(token)}`
  }));
});

app.post('/api/public/campaigns/unsubscribe/:token', (request, response) => {
  const result = unsubscribeCampaignContact(String(request.params.token || ''));
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
  if (!result) return response.status(404).type('html').send(unsubscribePage({ title: 'Link unavailable', message: 'This unsubscribe link is invalid or no longer available.' }));
  return response.type('html').send(unsubscribePage({ title: 'You are unsubscribed', message: `${result.email} will not receive future survey campaign messages.`, confirmed: true }));
});

app.get('/api/public/collectors/unsubscribe/:token', noStore, (request, response) => {
  const token = String(request.params.token || ''); const preview = getRecipientUnsubscribePreview(token);
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (!preview) return response.status(404).type('html').send(unsubscribePage({ title: 'Link unavailable', message: 'This unsubscribe link is invalid or no longer available.' }));
  if (preview.alreadyUnsubscribed) return response.type('html').send(unsubscribePage({ title: 'Already unsubscribed', message: `${preview.email} will not receive future survey emails.`, confirmed: true }));
  return response.type('html').send(unsubscribePage({
    title: 'Unsubscribe from survey emails', message: `Confirm that ${preview.email} should stop receiving survey emails, including future campaigns.`,
    action: `/api/public/collectors/unsubscribe/${encodeURIComponent(token)}`
  }));
});

app.post('/api/public/collectors/unsubscribe/:token', (request, response) => {
  const recipient = markRecipientUnsubscribed(String(request.params.token || ''));
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
  if (!recipient) return response.status(404).type('html').send(unsubscribePage({ title: 'Link unavailable', message: 'This unsubscribe link is invalid or no longer available.' }));
  suppressEmailGlobally({ email: recipient.email, reason: 'Recipient unsubscribed', source: 'collector', contactStatus: 'unsubscribed' });
  return response.type('html').send(unsubscribePage({ title: 'You are unsubscribed', message: `${recipient.maskedEmail} will not receive future survey emails.`, confirmed: true }));
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
    if (recipient) {
      db.prepare(`UPDATE recipients SET status='responded',responded_at=? WHERE token=?`).run(new Date().toISOString(), String(recipient));
      markCampaignContactResponded(String(recipient));
    }
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
  const frontendAssets = path.join(config.frontendDist, 'assets');
  app.use('/assets', express.static(frontendAssets, {
    immutable: true,
    index: false,
    maxAge: '1y',
    redirect: false
  }));
  app.use('/assets', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(404).type('text/plain').send('Frontend asset not found.');
  });
  app.use(express.static(config.frontendDist, {
    index: false,
    maxAge: 0,
    redirect: false,
    setHeaders: (response, filePath) => {
      if (path.basename(filePath).toLowerCase() === 'index.html') response.setHeader('Cache-Control', 'no-store');
    }
  }));
  app.get(/^(?!\/api|\/health|\/uploads).*/, (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    return response.sendFile('index.html', { root: config.frontendDist, dotfiles: 'allow' });
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) return response.status(400).json({ error: error.message, code: error.code });
  return sendError(response, error, 500);
});

export { app };
