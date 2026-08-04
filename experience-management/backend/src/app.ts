import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { z } from 'zod';
import { aiJobRunner } from './aiJobs.js';
import { AiJobRetryError, aiJobRetryStatus, retryFailedAiJob } from './aiJobRetry.js';
import { getAiProviderPreference, getAiProviderState } from './aiProvider.js';
import { aiProviderRouter } from './aiProviderRoutes.js';
import {
  accountProfile, completeAccountOnboarding, currentSessionUser, forgotPassword, login, logout,
  requireAdmin, resendEmailVerification, resetPassword, session, signup, updateAccountProfile, verifyEmail
} from './auth.js';
import { computeAnalytics } from './analytics.js';
import { assistantRouter, nylasCallback } from './assistantRoutes.js';
import { config } from './config.js';
import {
  createCollector, createJob, createJourney, createResponse, db, deleteJourney, deleteSurvey, findActiveJourneyOptimization, getCollectorBySlug, getJob, getJobForSpace,
  getJourney, getResponse, getSurvey, insertSocialMentions, listCollectors, listInsights, listJourneyVersionSummaries,
  listJobsForSpace, listJourneys, listResponses, listSocialMentionsByIds, listSocialMentionsByIdsForSpace, listSocialMentionsForSpace, listSurveys, restoreJourneyVersion, saveSurvey, updateJob, updateJourney
} from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import { attachEventStream, publishEvent } from './events.js';
import { EMAIL_SENDER_NAME_MAX_LENGTH, emailStatus, getRecipientUnsubscribePreview, listRecipients, markRecipientUnsubscribed, sendInvitations, sendSpaceInvitationEmail } from './emailService.js';
import {
  addCampaignContacts, campaignTemplates, createCampaign, getCampaignDetail, launchCampaign, listCampaignSummaries,
  getCampaignUnsubscribePreview, markCampaignContactResponded, pauseCampaign, replaceCampaignSteps, resumeCampaign,
  sendCampaignTest, suppressCampaignContact, suppressEmailGlobally, unsubscribeCampaignContact, updateCampaign, updateCampaignContact
} from './campaigns.js';
import { authenticateBrevoWebhook, parseBrevoWebhookPayload, processBrevoWebhookEvents } from './brevoWebhook.js';
import { parseSocialMentionImport } from './socialImport.js';
import { getTerraStatus, TerraError } from './terraClient.js';
import {
  createIntelligenceReport, createSocialIntelligenceReport, createSocialReplyDraft, getIntelligenceReport,
  IntelligenceError, listIntelligenceReports, listIntelligenceSources, listSocialIntelligenceReports,
  listSocialReplyDrafts, publishSocialIntelligenceReport, retrySocialIntelligenceReport, updateSocialReplyDraft
} from './intelligence.js';
import { templates } from './templates.js';
import { esignPublicRouter, esignRecipientRouter, esignRouter } from './esignRoutes.js';
import { getKnowledgeRuntimeStatus } from './knowledgeClient.js';
import { supportsKnowledgeContext } from './knowledgeContext.js';
import { knowledgeJobRunner } from './knowledgeJobs.js';
import { knowledgeJobRoute, knowledgeRouter, surveyKnowledgeRoutes } from './knowledgeRoutes.js';
import {
  createKnowledgeMarkdownDocument, getKnowledgeBase, getKnowledgeContext, knowledgeJobAudienceUserId,
  KnowledgeError, resolveKnowledgeBaseRefs, surveyKnowledgeBaseIds
} from './knowledgeRepository.js';
import { QUESTION_TYPES, type AiJob, type AiJobKind, type Collector, type LogicRule, type Question, type ResponseRecord, type SocialMention, type Survey } from './types.js';
import {
  clearXOAuthCookie, createXQuery, deleteXCollectedHistory, deleteXConfiguration, deleteXQuery, disconnectXAccount, enqueueXExpansion, enqueueXSync,
  estimateXExpansion, finishXOAuth, getXIntegrationStatus, listXCollectedMentions, saveXConfiguration, startXOAuth, updateXConnectionSettings, updateXQuery,
  XIntegrationError, xOAuthCookieFromHeader
} from './xIntegration.js';
import {
  acceptPendingSpaceInvitationForAccount, acceptSpaceInvitation, createSpace, createSpaceInvitation, getSpaceForUser,
  assertSpaceOperationalById, invitationPreview, listPendingSpaceInvitationsForAccount, listSpaceInvitations, listSpaceMembers, listSpacesForUser,
  removeSpaceMember, renameSpace, resolveRequestSpace, revokeSpaceInvitation, setActiveSpace, SpaceError, spaceSession,
  updateSpaceMember
} from './spaces.js';
import { tutorialProgressRouter } from './tutorialProgress.js';
import { answerResearchQuestion } from './researchChat.js';
import {
  createRecoveryTicket, getRecoveryTicket, listRecoveryTickets, recordRecoveryTicketEvent, RecoveryTicketError, updateRecoveryTicket
} from './recovery.js';
import { platformAdminRouter, subscriptionRouter } from './platformAdmin.js';
import { adminControlPlaneRouter } from './adminControlPlane.js';
import {
  assertCanQueueAiAction, assertSubscriptionQuota, SubscriptionEntitlementError
} from './subscriptionEntitlements.js';

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
  fileFilter: (_request, file, callback) => callback(null,
    /^(image\/(png|jpeg|webp|gif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i.test(file.mimetype)
      || file.mimetype === 'application/pdf')
});
const socialImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, /\.(csv|json|txt)$/i.test(file.originalname))
});
app.post('/api/auth/login', noStore, login);
app.post('/api/auth/signup', noStore, signup);
app.post('/api/auth/verify-email', noStore, verifyEmail);
app.post('/api/auth/resend-verification', noStore, resendEmailVerification);
app.post('/api/auth/forgot-password', noStore, forgotPassword);
app.post('/api/auth/reset-password', noStore, resetPassword);
app.post('/api/auth/logout', noStore, logout);
app.get('/api/auth/session', noStore, session);
app.get('/api/account/profile', noStore, accountProfile);
app.put('/api/account/profile', noStore, updateAccountProfile);
app.post('/api/account/onboarding', noStore, completeAccountOnboarding);
// Recipient document access needs a verified account, but never requires
// membership in the sender's space or completion of workspace onboarding.
app.use('/api/recipient-documents', esignRecipientRouter);
// A verified invitee may accept their invitation before completing the first-run
// profile. This preserves the invitation through the onboarding redirect while
// every workspace data route remains protected by requireAdmin below.
app.post('/api/spaces/invitations/:token/accept', noStore, (request, response) => {
  const user = currentSessionUser(request);
  if (!user) return response.status(401).json({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
  if (!user.emailVerifiedAt) {
    return response.status(403).json({ error: 'Verify your email address first.', code: 'EMAIL_VERIFICATION_REQUIRED' });
  }
  try {
    const activeSpace = acceptSpaceInvitation(user, String(request.params.token));
    return response.json({ activeSpace, spaces: listSpacesForUser(user.id) });
  } catch (error) { return sendError(response, error); }
});
app.post('/api/account/space-invitations/:invitationId/accept', noStore, (request, response) => {
  const user = currentSessionUser(request);
  if (!user) return response.status(401).json({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
  if (!user.emailVerifiedAt) {
    return response.status(403).json({ error: 'Verify your email address first.', code: 'EMAIL_VERIFICATION_REQUIRED' });
  }
  try {
    const activeSpace = acceptPendingSpaceInvitationForAccount(user, String(request.params.invitationId));
    if (!activeSpace) return response.status(404).json({ error: 'Pending invitation not found.', code: 'INVITATION_NOT_FOUND' });
    return response.json({
      activeSpace,
      spaces: listSpacesForUser(user.id),
      pendingSpaceInvitations: listPendingSpaceInvitationsForAccount(user)
    });
  } catch (error) { return sendError(response, error); }
});
app.use('/api', (request, response, next) => {
  const publicRoute = request.path.startsWith('/public/collectors/') || request.path.startsWith('/public/campaigns/unsubscribe/')
    || request.path.startsWith('/public/esign/') || request.path.startsWith('/public/spaces/invitations/') || request.path.startsWith('/public/uploads/')
    || request.path === '/webhooks/brevo/transactional' || request.path === '/integrations/x/callback'
    || request.path === '/integrations/nylas/callback';
  if (publicRoute) return next();
  response.setHeader('Cache-Control', 'private, no-store');
  response.vary('Cookie');
  response.vary('X-Seemplify-Space');
  return requireAdmin(request, response, next);
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
  if (error instanceof SpaceError) return response.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof KnowledgeError) return response.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof RecoveryTicketError) return response.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  const message = error instanceof Error ? error.message : String(error);
  return response.status(status).json({ error: message });
}

function xError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return sendError(response, error);
  if (error instanceof SpaceError || error instanceof SubscriptionEntitlementError) return sendError(response, error);
  if (error instanceof XIntegrationError) return response.status(error.status).json({ error: error.message });
  return response.status(502).json({ error: 'The X integration request could not be completed.' });
}
function intelligenceError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return sendError(response, error);
  if (error instanceof IntelligenceError) return response.status(error.status).json({ error: error.message });
  if (error instanceof KnowledgeError) return response.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof TerraError) return response.status(error.status).json({ error: error.message, code: error.code });
  return response.status(500).json({ error: error instanceof Error ? error.message : 'The intelligence request could not be completed.' });
}

function idempotencyKey(request: express.Request) {
  const value = request.get('idempotency-key');
  return value ? z.string().uuid().parse(value) : undefined;
}

function authenticatedUser(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new XIntegrationError('Authentication required.', 401);
  return user;
}

function authenticatedSpace(request: express.Request) {
  const user = authenticatedUser(request);
  return resolveRequestSpace(request, user.id);
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

function requireSurvey(id: string, spaceId: string) {
  const survey = getSurvey(id, spaceId);
  if (!survey) throw new Error('Survey not found.');
  return survey;
}

function surveySpaceId(id: string) {
  return (db.prepare('SELECT space_id FROM surveys WHERE id=?').get(id) as { space_id?: string } | undefined)?.space_id || null;
}

function removeUploadedFile(filePath: string) {
  const root = `${path.resolve(config.uploadDir)}${path.sep}`.toLowerCase();
  const target = path.resolve(filePath);
  if (`${target}${path.sep}`.toLowerCase().startsWith(root) || target.toLowerCase().startsWith(root)) {
    fs.rmSync(target, { force: true });
  }
}

function uploadResponse(row: any, publicToken?: string) {
  const url = publicToken
    ? `${config.publicUrl}/api/public/uploads/${encodeURIComponent(row.id)}/${encodeURIComponent(publicToken)}`
    : `${config.publicUrl}/api/uploads/${encodeURIComponent(row.id)}/content`;
  return {
    id: row.id,
    name: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size),
    url,
    transcriptionState: /^(audio|video)\//.test(row.mime_type) ? 'transcript_required' : 'not_applicable'
  };
}

let uploadSigningSecret: Buffer | null = null;
function publicUploadSecret() {
  if (!uploadSigningSecret) {
    const value = fs.readFileSync(config.sessionSecretFile, 'utf8').trim();
    if (value.length < 20) throw new Error('Public upload signing is not configured.');
    uploadSigningSecret = Buffer.from(value);
  }
  return uploadSigningSecret;
}

function issuePublicUploadGrant(collectorId: string) {
  const payload = Buffer.from(JSON.stringify({ collectorId, expiresAt: Date.now() + 2 * 60 * 60_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', publicUploadSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function validPublicUploadGrant(value: unknown, collectorId: string) {
  try {
    const [payload, supplied] = String(value || '').split('.');
    if (!payload || !supplied) return false;
    const expected = crypto.createHmac('sha256', publicUploadSecret()).update(payload).digest('base64url');
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { collectorId?: string; expiresAt?: number };
    return parsed.collectorId === collectorId && Number(parsed.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

const publicUploadWindows = new Map<string, number[]>();
function allowPublicUploadAttempt(key: string) {
  const timestamp = Date.now();
  const recent = (publicUploadWindows.get(key) || []).filter((time) => timestamp - time < 15 * 60_000);
  if (recent.length >= 20) return false;
  recent.push(timestamp);
  publicUploadWindows.set(key, recent);
  return true;
}

function purgeExpiredPublicUploads() {
  const cutoff = new Date().toISOString();
  const expired = db.prepare(`SELECT id,stored_filename FROM uploads
    WHERE response_id IS NULL AND expires_at IS NOT NULL AND expires_at<=? LIMIT 500`)
    .all(cutoff) as Array<{ id: string; stored_filename: string }>;
  const remove = db.prepare(`DELETE FROM uploads
    WHERE id=? AND response_id IS NULL AND expires_at IS NOT NULL AND expires_at<=?`);
  for (const row of expired) {
    if (remove.run(row.id, cutoff).changes) removeUploadedFile(path.resolve(config.uploadDir, row.stored_filename));
  }
}

function admitPublicUpload(request: express.Request, response: express.Response, next: express.NextFunction) {
  purgeExpiredPublicUploads();
  const collector = getCollectorBySlug(String(request.params.slug));
  const survey = collector ? getSurvey(collector.surveyId) : null;
  const spaceId = survey ? surveySpaceId(survey.id) : null;
  if (!collector || !survey || !spaceId || survey.status !== 'live' || collector.status !== 'open') {
    return response.status(410).json({ error: 'This survey is not accepting uploads.' });
  }
  try { assertSpaceOperationalById(spaceId, 'surveys'); }
  catch { return response.status(410).json({ error: 'This survey is not accepting uploads.' }); }
  const questionId = String(request.get('x-upload-question') || '').trim();
  const question = (survey.questions || []).find((item) => item.id === questionId && (item.type === 'file' || item.type === 'media'));
  if (!question) return response.status(400).json({ error: 'Choose a valid file or media question before uploading.' });
  if (!validPublicUploadGrant(request.get('x-upload-grant'), collector.id)) {
    return response.status(403).json({ error: 'Refresh this survey before uploading a file.' });
  }
  const remote = String(request.get('cf-connecting-ip') || request.ip || 'unknown').slice(0, 100);
  if (!allowPublicUploadAttempt(`${remote}:${collector.id}`)) {
    return response.status(429).json({ error: 'Too many upload attempts. Please wait before trying again.' });
  }
  const unclaimed = Number((db.prepare(`SELECT COUNT(*) count FROM uploads
    WHERE collector_id=? AND response_id IS NULL`).get(collector.id) as any)?.count || 0);
  const collectorDay = db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM uploads
    WHERE collector_id=? AND created_at>=?`).get(collector.id, new Date(Date.now() - 24 * 60 * 60_000).toISOString()) as any;
  const spaceStorage = Number((db.prepare('SELECT COALESCE(SUM(size),0) bytes FROM uploads WHERE space_id=?')
    .get(spaceId) as any)?.bytes || 0);
  if (unclaimed >= 25 || Number(collectorDay?.count || 0) >= 100 || Number(collectorDay?.bytes || 0) >= 500 * 1024 * 1024
    || spaceStorage >= 5 * 1024 * 1024 * 1024) {
    return response.status(429).json({ error: 'This survey has reached its upload allowance. Try again later or contact the survey owner.' });
  }
  try {
    const disk = fs.statfsSync(config.uploadDir);
    if (Number(disk.bavail) * Number(disk.bsize) < 512 * 1024 * 1024) {
      return response.status(503).json({ error: 'File uploads are temporarily unavailable.' });
    }
  } catch { /* Quotas above still protect platforms without statfs support. */ }
  response.locals.publicUpload = { collector, survey, spaceId, questionId };
  return next();
}

function publicAnswerUploadRows(survey: Survey, collectorId: string, spaceId: string, answers: Record<string, unknown>) {
  const rows: any[] = [];
  for (const question of (survey.questions || []).filter((item) => item.type === 'file' || item.type === 'media')) {
    const value = answers[question.id];
    if (!hasAnswer(value)) continue;
    const supplied = Array.isArray(value) ? value : [value];
    for (const item of supplied) {
      if (!item || typeof item !== 'object') throw new Error(`Upload a file for "${question.title}" again before submitting.`);
      const candidate = item as Record<string, unknown>;
      const id = String(candidate.id || '');
      let token = '';
      try {
        const parts = new URL(String(candidate.url || ''), config.publicUrl).pathname.split('/').filter(Boolean);
        if (parts[0] === 'api' && parts[1] === 'public' && parts[2] === 'uploads' && parts[3] === id) {
          token = decodeURIComponent(parts[4] || '');
        }
      } catch { /* Invalid URLs fail the bound-row check below. */ }
      const tokenHash = token ? crypto.createHash('sha256').update(token).digest('hex') : '';
      const row = db.prepare(`SELECT * FROM uploads WHERE id=? AND space_id=? AND collector_id=? AND question_id=?
        AND response_id IS NULL AND access_token_hash=? AND (expires_at IS NULL OR expires_at>?)`)
        .get(id, spaceId, collectorId, question.id, tokenHash, new Date().toISOString());
      if (!row) throw new Error(`Upload a file for "${question.title}" again before submitting.`);
      rows.push(row);
    }
  }
  return rows;
}

function sendUploadContent(response: express.Response, row: any) {
  const resolved = path.resolve(config.uploadDir, String(row.stored_filename));
  const root = `${path.resolve(config.uploadDir)}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(root) || !fs.existsSync(resolved)) return response.status(404).json({ error: 'Upload not found.' });
  const safeName = String(row.original_name || 'download').replace(/[\r\n"]/g, '_').slice(0, 180);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Security-Policy', 'sandbox');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Type', String(row.mime_type || 'application/octet-stream'));
  response.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  return response.sendFile(resolved);
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
    const ticketId = crypto.randomUUID();
    const title = `Follow up: ${source?.title || 'survey response'}`.slice(0, 160);
    const notes = `Triggered when the answer ${rule.operator.replaceAll('_', ' ')} ${String(rule.value)}.`;
    db.transaction(() => {
      db.prepare(`INSERT INTO tickets (id,survey_id,response_id,title,priority,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?,?)`).run(
        ticketId, survey.id, responseRecord.id, title, 'high', notes, now, now
      );
      recordRecoveryTicketEvent(ticketId, null, 'created', {
        source: 'survey_rule', title, priority: 'high', status: 'open', responseId: responseRecord.id,
        rule: { questionId: rule.sourceQuestionId, operator: rule.operator, value: rule.value }
      }, now);
    })();
  }
}

function queueJob(kind: AiJobKind, input: Record<string, unknown>, spaceId: string, surveyId?: string | null, responseId?: string | null, requestedBy?: string | null) {
  assertCanQueueAiAction(spaceId);
  const queuedInput = { ...input };
  delete queuedInput.knowledgeBaseRefs;
  const refs = supportsKnowledgeContext(kind)
    ? resolveKnowledgeBaseRefs(spaceId, queuedInput.knowledgeBaseIds, {
      requireTerra: true, viewerUserId: requestedBy || undefined, allowPrivate: false
    })
    : [];
  delete queuedInput.knowledgeBaseIds;
  if (refs.length) queuedInput.knowledgeBaseRefs = refs;
  const job = createJob(kind, queuedInput, spaceId, surveyId, responseId, requestedBy);
  publishEvent('ai-job', job, spaceId);
  void aiJobRunner.pump();
  return job;
}

function recordKnowledgeResolutionFailure(kind: AiJobKind, spaceId: string, surveyId: string | null,
  responseId: string | null, requestedBy: string | null, error: unknown) {
  const queued = createJob(kind, { knowledgeContextRequired: true }, spaceId, surveyId, responseId, requestedBy);
  const message = error instanceof Error ? error.message : 'The required knowledge snapshot could not be resolved.';
  const failed = updateJob(queued.id, { state: 'failed', stage: 'knowledge_unavailable', progress: 100,
    error: message, completedAt: new Date().toISOString() }) || queued;
  publishEvent('ai-job', failed, spaceId);
  return failed;
}

function spaceScopedUuid(spaceId: string, externalId: string) {
  const hash = crypto.createHash('sha256').update(`${spaceId}:${externalId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function noStore(_request: express.Request, response: express.Response, next: express.NextFunction) {
  response.setHeader('Cache-Control', 'no-store');
  next();
}

app.get('/health', (_request, response) => {
  const database = db.health();
  return response.status(database.ready ? 200 : 503).json({
    status: database.ready ? 'ok' : 'degraded', service: 'seemplify-experience',
    database: database.provider, databaseReady: database.ready,
    databaseSchemaVersion: database.schemaVersion, databaseRuntimeSchemaVersion: database.runtimeSchemaVersion,
    databaseError: database.error,
    at: new Date().toISOString()
  });
});
app.use('/api/platform-admin', platformAdminRouter);
app.use('/api/platform-admin', adminControlPlaneRouter);
app.use('/api/subscriptions', subscriptionRouter);
app.use('/api/ai-provider', aiProviderRouter);
app.use('/api/esign', esignRouter);
app.use('/api/public/esign', esignPublicRouter);
app.use('/api/assistant', assistantRouter);
app.get('/api/integrations/nylas/callback', noStore, nylasCallback);
app.use('/api/tutorials', tutorialProgressRouter);
app.use('/api/knowledge-bases', knowledgeRouter);
knowledgeJobRoute(app);
surveyKnowledgeRoutes(app);
app.get('/api/events', (request, response) => {
  const user = authenticatedUser(request);
  const space = resolveRequestSpace(request, user.id);
  return attachEventStream(request, response, space.id, () => {
    const current = currentSessionUser(request);
    return Boolean(current && current.id === user.id && getSpaceForUser(user.id, space.id));
  }, user.id);
});
app.get('/api/runtime', noStore, async (request, response) => {
  const user = authenticatedUser(request); const space = resolveRequestSpace(request, user.id);
  const preference = getAiProviderPreference(user.id, space.id);
  const [terra, knowledgeRuntime, ai] = await Promise.all([
    getTerraStatus(),
    getKnowledgeRuntimeStatus(),
    preference.provider === 'codex'
      ? getAiProviderState(user.id, space.id)
      : Promise.resolve({ preference, codex: null })
  ]);
  response.json({ terra, ai, email: emailStatus(), worker: aiJobRunner.status(space.id, user.id),
    knowledge: { runtime: knowledgeRuntime, worker: knowledgeJobRunner.status(space.id) } });
});
app.get('/api/bootstrap', noStore, (request, response) => {
  const user = authenticatedUser(request); const space = resolveRequestSpace(request, user.id);
  const surveys = listSurveys(space.id);
  const jobCounts = db.prepare(`SELECT state,COUNT(*) count FROM ai_jobs WHERE space_id=?
    AND (kind NOT LIKE 'assistant.%' OR requested_by=?) GROUP BY state`).all(space.id, user.id);
  response.json({
    surveys,
    overview: {
      surveys: surveys.length,
      liveSurveys: surveys.filter((survey) => survey.status === 'live').length,
      responses: Number((db.prepare('SELECT COUNT(*) count FROM responses r JOIN surveys s ON s.id=r.survey_id WHERE s.space_id=?').get(space.id) as any).count),
      openTickets: Number((db.prepare("SELECT COUNT(*) count FROM tickets t JOIN surveys s ON s.id=t.survey_id WHERE s.space_id=? AND t.status<>'closed'").get(space.id) as any).count),
      aiJobs: jobCounts
    },
    recentJobs: listJobsForSpace(space.id, 12, user.id), email: emailStatus(), space
  });
});

app.get('/api/spaces', noStore, (request, response) => {
  const user = authenticatedUser(request);
  return response.json(spaceSession(user.id));
});
app.post('/api/spaces', (request, response) => {
  try {
    const user = authenticatedUser(request);
    const space = createSpace(user, { name: request.body?.name });
    return response.status(201).json({ space, ...spaceSession(user.id) });
  } catch (error) { return sendError(response, error); }
});
app.post('/api/spaces/:id/select', (request, response) => {
  try {
    const user = authenticatedUser(request);
    const activeSpace = setActiveSpace(user.id, String(request.params.id));
    return response.json({ activeSpace, spaces: listSpacesForUser(user.id) });
  } catch (error) { return sendError(response, error); }
});
app.patch('/api/spaces/:id', (request, response) => {
  try {
    const user = authenticatedUser(request);
    const context = getSpaceForUser(user.id, String(request.params.id));
    if (!context) return response.status(404).json({ error: 'Space not found.' });
    return response.json(renameSpace(context, request.body?.name));
  } catch (error) { return sendError(response, error); }
});
app.get('/api/spaces/:id/members', noStore, (request, response) => {
  const user = authenticatedUser(request);
  const context = getSpaceForUser(user.id, String(request.params.id));
  return context ? response.json(listSpaceMembers(context)) : response.status(404).json({ error: 'Space not found.' });
});
app.patch('/api/spaces/:id/members/:userId', (request, response) => {
  try {
    const user = authenticatedUser(request);
    const context = getSpaceForUser(user.id, String(request.params.id));
    if (!context) return response.status(404).json({ error: 'Space not found.' });
    const role = z.enum(['admin', 'member']).parse(request.body?.role);
    return response.json(updateSpaceMember(context, String(request.params.userId), role));
  } catch (error) { return sendError(response, error); }
});
app.delete('/api/spaces/:id/members/:userId', (request, response) => {
  try {
    const user = authenticatedUser(request);
    const context = getSpaceForUser(user.id, String(request.params.id));
    if (!context) return response.status(404).json({ error: 'Space not found.' });
    removeSpaceMember(context, String(request.params.userId));
    return response.status(204).end();
  } catch (error) { return sendError(response, error); }
});
app.get('/api/spaces/:id/invitations', noStore, (request, response) => {
  try {
    const user = authenticatedUser(request);
    const context = getSpaceForUser(user.id, String(request.params.id));
    if (!context) return response.status(404).json({ error: 'Space not found.' });
    return response.json(listSpaceInvitations(context));
  } catch (error) { return sendError(response, error); }
});
app.post('/api/spaces/:id/invitations', async (request, response) => {
  try {
    const user = authenticatedUser(request);
    const context = getSpaceForUser(user.id, String(request.params.id));
    if (!context) return response.status(404).json({ error: 'Space not found.' });
    const invitation = createSpaceInvitation(context, request.body || {});
    let delivery: { state: 'sent' | 'failed'; error?: string } = { state: 'sent' };
    try {
      await sendSpaceInvitationEmail({
        invitationId: invitation.id,
        email: invitation.email,
        token: invitation.token,
        spaceName: invitation.space.name,
        invitedBy: user.name,
        role: invitation.role
      });
    } catch {
      delivery = { state: 'failed', error: 'The invitation was created, but its email could not be sent. Copy the invitation link instead.' };
    }
    return response.status(201).json({
      invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt },
      delivery,
      inviteUrl: `${config.publicUrl}/join/${invitation.token}`
    });
  } catch (error) { return sendError(response, error); }
});
app.delete('/api/spaces/:id/invitations/:invitationId', (request, response) => {
  try {
    const user = authenticatedUser(request);
    const context = getSpaceForUser(user.id, String(request.params.id));
    if (!context) return response.status(404).json({ error: 'Space not found.' });
    revokeSpaceInvitation(context, String(request.params.invitationId));
    return response.status(204).end();
  } catch (error) { return sendError(response, error); }
});
app.get('/api/public/spaces/invitations/:token', noStore, (request, response) => {
  try { return response.json(invitationPreview(String(request.params.token))); }
  catch (error) { return sendError(response, error); }
});
const xConfigurationInput = z.object({
  consumerKey: z.string().min(8).max(2000).optional(), consumerSecret: z.string().min(8).max(2000).optional(),
  clientId: z.string().min(8).max(2000).optional(), clientSecret: z.string().min(8).max(2000).optional(),
  bearerToken: z.string().min(8).max(2000).optional(), accessToken: z.string().min(8).max(2000).optional(),
  accessTokenSecret: z.string().min(8).max(2000).optional()
}).strict();
const xQueryInput = z.object({ label: z.string().trim().min(2).max(100), query: z.string().trim().min(2).max(512), enabled: z.boolean().optional() }).strict();
const xQueryUpdateInput = xQueryInput.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one change.');
const xCollectionStream = z.enum(['account_posts', 'mentions', 'searches']);
const allXCollectionStreams: Array<z.infer<typeof xCollectionStream>> = ['account_posts', 'mentions', 'searches'];
const xExpansionInput = z.object({
  limit: z.number().int().min(51).max(500).default(200),
  streams: z.array(xCollectionStream).min(1).max(3).optional(),
  planFingerprint: z.string().regex(/^xplan_[a-f0-9]{64}$/)
}).strict();

app.get('/api/integrations/x/callback', noStore, async (request, response) => {
  response.setHeader('Referrer-Policy', 'no-referrer');
  const requestToken = typeof request.query.state === 'string' ? request.query.state
    : typeof request.query.oauth_token === 'string' ? request.query.oauth_token
      : typeof request.query.denied === 'string' ? request.query.denied : undefined;
  response.setHeader('Set-Cookie', clearXOAuthCookie(requestToken));
  let outcome: 'connected' | 'denied' | 'failed' = 'failed';
  try {
    outcome = await finishXOAuth({
      oauthToken: typeof request.query.oauth_token === 'string' ? request.query.oauth_token : undefined,
      oauthVerifier: typeof request.query.oauth_verifier === 'string' ? request.query.oauth_verifier : undefined,
      denied: typeof request.query.denied === 'string' ? request.query.denied : undefined,
      code: typeof request.query.code === 'string' ? request.query.code : undefined,
      state: typeof request.query.state === 'string' ? request.query.state : undefined,
      error: typeof request.query.error === 'string' ? request.query.error : undefined,
      handshake: xOAuthCookieFromHeader(request.headers.cookie, requestToken)
    });
  } catch { outcome = 'failed'; }
  return response.redirect(303, `/social-listening?x=${outcome}`);
});
app.get('/api/integrations/x', noStore, (request, response) => {
  try { return response.json(getXIntegrationStatus(authenticatedUser(request), authenticatedSpace(request).id, typeof request.query.connectionId === 'string' ? request.query.connectionId : undefined)); } catch (error) { return xError(response, error); }
});
app.get('/api/integrations/x/mentions', noStore, (request, response) => {
  try {
    const requested = Number(request.query.limit || 500);
    return response.json(listXCollectedMentions(authenticatedUser(request), authenticatedSpace(request).id, Number.isFinite(requested) ? requested : 500,
      typeof request.query.connectionId === 'string' ? request.query.connectionId : undefined));
  } catch (error) { return xError(response, error); }
});
app.put('/api/integrations/x/app', (request, response) => {
  try { return response.json(saveXConfiguration(authenticatedUser(request), authenticatedSpace(request).id, xConfigurationInput.parse(request.body || {}))); }
  catch (error) { return xError(response, error); }
});
app.delete('/api/integrations/x/app', (request, response) => {
  try { deleteXConfiguration(authenticatedUser(request)); return response.status(204).end(); } catch (error) { return xError(response, error); }
});
app.post('/api/integrations/x/connect', async (request, response) => {
  try {
    const started = await startXOAuth(authenticatedUser(request), authenticatedSpace(request).id); response.setHeader('Set-Cookie', started.cookie);
    return response.status(201).json({ authorizeUrl: started.authorizeUrl });
  } catch (error) { return xError(response, error); }
});
app.delete('/api/integrations/x/connection', (request, response) => {
  try { disconnectXAccount(authenticatedUser(request), authenticatedSpace(request).id, typeof request.query.connectionId === 'string' ? request.query.connectionId : undefined); return response.status(204).end(); } catch (error) { return xError(response, error); }
});
app.delete('/api/integrations/x/history', (request, response) => {
  try { return response.json(deleteXCollectedHistory(authenticatedUser(request), authenticatedSpace(request).id, typeof request.query.connectionId === 'string' ? request.query.connectionId : undefined)); } catch (error) { return xError(response, error); }
});
app.patch('/api/integrations/x/connection', (request, response) => {
  try {
    const input = z.object({ autoSync: z.boolean().optional(), syncIntervalMinutes: z.number().int().optional() }).strict().parse(request.body || {});
    return response.json(updateXConnectionSettings(authenticatedUser(request), authenticatedSpace(request).id, input, typeof request.query.connectionId === 'string' ? request.query.connectionId : undefined));
  } catch (error) { return xError(response, error); }
});
app.post('/api/integrations/x/sync', (request, response) => {
  try { const queued = enqueueXSync(authenticatedUser(request), authenticatedSpace(request).id, typeof request.query.connectionId === 'string' ? request.query.connectionId : undefined); return response.status(202).json(queued); }
  catch (error) { return xError(response, error); }
});
app.post('/api/integrations/x/queries', (request, response) => {
  try {
    const parsed = xQueryInput.extend({ connectionId: z.string().uuid().optional() }).parse(request.body || {});
    const { connectionId, ...query } = parsed;
    return response.status(201).json(createXQuery(authenticatedUser(request), authenticatedSpace(request).id, query, connectionId));
  }
  catch (error) { return xError(response, error); }
});

app.post('/api/integrations/x/connections/:connectionId/sync', (request, response) => {
  try { return response.status(202).json(enqueueXSync(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.connectionId))); }
  catch (error) { return xError(response, error); }
});
app.get('/api/integrations/x/connections/:connectionId/expansion-estimate', noStore, (request, response) => {
  try {
    const limit = z.coerce.number().int().min(51).max(500).default(200).parse(request.query.limit);
    const streams = request.query.streams === undefined ? allXCollectionStreams
      : z.array(xCollectionStream).min(1).max(3).parse(String(request.query.streams).split(',').map((value) => value.trim()).filter(Boolean));
    return response.json(estimateXExpansion(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.connectionId), limit, streams));
  } catch (error) { return xError(response, error); }
});
app.post('/api/integrations/x/connections/:connectionId/expand', (request, response) => {
  try {
    const input = xExpansionInput.parse(request.body || {}); const streams = input.streams || allXCollectionStreams;
    const queued = enqueueXExpansion(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.connectionId),
      { limit: input.limit, streams, planFingerprint: input.planFingerprint, idempotencyKey: idempotencyKey(request) });
    return response.status(202).json(queued);
  } catch (error) { return xError(response, error); }
});
app.patch('/api/integrations/x/connections/:connectionId', (request, response) => {
  try {
    const input = z.object({ autoSync: z.boolean().optional(), syncIntervalMinutes: z.number().int().optional() }).strict().parse(request.body || {});
    return response.json(updateXConnectionSettings(authenticatedUser(request), authenticatedSpace(request).id, input, String(request.params.connectionId)));
  } catch (error) { return xError(response, error); }
});
app.delete('/api/integrations/x/connections/:connectionId', (request, response) => {
  try { disconnectXAccount(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.connectionId)); return response.status(204).end(); }
  catch (error) { return xError(response, error); }
});
app.delete('/api/integrations/x/connections/:connectionId/history', (request, response) => {
  try { return response.json(deleteXCollectedHistory(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.connectionId))); }
  catch (error) { return xError(response, error); }
});
app.post('/api/integrations/x/connections/:connectionId/queries', (request, response) => {
  try { return response.status(201).json(createXQuery(authenticatedUser(request), authenticatedSpace(request).id, xQueryInput.parse(request.body || {}), String(request.params.connectionId))); }
  catch (error) { return xError(response, error); }
});
app.patch('/api/integrations/x/queries/:id', (request, response) => {
  try { return response.json(updateXQuery(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.id), xQueryUpdateInput.parse(request.body || {}))); }
  catch (error) { return xError(response, error); }
});
app.delete('/api/integrations/x/queries/:id', (request, response) => {
  try { deleteXQuery(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.id)); return response.status(204).end(); }
  catch (error) { return xError(response, error); }
});

const mentionInput = z.object({
  source: z.enum(['x', 'google_play', 'app_store', 'review', 'forum', 'other']), author: z.string().max(200).optional(),
  content: z.string().min(2).max(5000), url: z.string().url().max(2000).or(z.literal('')).optional(), language: z.string().max(80).optional(),
  publishedAt: z.string().datetime().optional(), metadata: z.record(z.string(), z.unknown()).optional()
});
app.get('/api/social/mentions', noStore, (request, response) => {
  const requested = Number(request.query.limit || 500);
  return response.json(listSocialMentionsForSpace(authenticatedSpace(request).id, Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.floor(requested))) : 500));
});
app.post('/api/social/mentions', (request, response) => {
  const parsed = z.object({ mentions: z.array(mentionInput).min(1).max(200), analyze: z.boolean().optional() }).safeParse(request.body);
  if (!parsed.success) return sendError(response, parsed.error);
  const space = authenticatedSpace(request); const user = authenticatedUser(request);
  const mentions = insertSocialMentions(parsed.data.mentions as Array<Partial<SocialMention> & { content: string; source: SocialMention['source'] }>, space.id);
  const job = parsed.data.analyze === false ? null : queueJob('social.analyze', { mentionIds: mentions.map((mention) => mention.id) }, space.id, null, null, user.id);
  publishEvent('data-changed', { reason: 'social-mentions-imported', count: mentions.length }, space.id);
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
    const space = authenticatedSpace(request); const user = authenticatedUser(request);
    const validated = z.array(mentionInput.extend({ id: z.string().uuid() })).min(1).max(200).parse(parsed.mentions)
      .map((mention) => ({ ...mention, id: spaceScopedUuid(space.id, mention.id) }));
    const existingIds = new Set(listSocialMentionsByIdsForSpace(validated.map((mention) => mention.id), space.id).map((mention) => mention.id));
    const mentions = insertSocialMentions(validated as Array<Partial<SocialMention> & { content: string; source: SocialMention['source'] }>, space.id);
    const importedIds = mentions.map((mention) => mention.id).filter((id) => !existingIds.has(id));
    const job = fields.analyze === 'false' || !importedIds.length ? null : queueJob('social.analyze', { mentionIds: importedIds }, space.id, null, null, user.id);
    const summary = { ...parsed.summary, imported: importedIds.length, skipped: validated.length - importedIds.length, replayed: importedIds.length === 0 };
    publishEvent('data-changed', { reason: 'social-mentions-file-imported', count: importedIds.length, batchId: parsed.summary.batchId, replayed: summary.replayed }, space.id);
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
  const parsed = z.object({
    mentionIds: z.array(z.string().uuid()).min(1).max(50).optional(),
    knowledgeBaseIds: z.array(z.string().uuid()).max(5).optional()
  }).strict().safeParse(request.body || {});
  if (!parsed.success) return sendError(response, parsed.error);
  const user = authenticatedUser(request); const space = authenticatedSpace(request); const requested = parsed.data.mentionIds;
  const mentions = requested ? listSocialMentionsByIdsForSpace(requested, space.id) : listSocialMentionsForSpace(space.id, 50);
  if (requested && mentions.length !== new Set(requested).size) return response.status(404).json({ error: 'One or more social mentions are not available to this account.' });
  if (!mentions.length) return response.status(409).json({ error: 'Import or collect at least one social mention before running analysis.' });
  const job = queueJob('social.analyze', {
    mentionIds: mentions.map((mention) => mention.id), knowledgeBaseIds: parsed.data.knowledgeBaseIds
  }, space.id, null, null, user.id);
  return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
});
app.delete('/api/social/mentions/:id', (request, response) => {
  const id = String(request.params.id);
  const space = authenticatedSpace(request);
  if (db.prepare('SELECT 1 FROM x_connection_mentions cm JOIN x_connections c ON c.id=cm.connection_id WHERE cm.mention_id=? AND c.space_id=? LIMIT 1').get(id, space.id)) {
    return response.status(409).json({ error: 'Collected X posts are deleted from the selected account history so linked reports and jobs can be handled safely.' });
  }
  const deleted = db.prepare('DELETE FROM social_mentions WHERE id=? AND space_id=?').run(id, space.id).changes > 0;
  if (!deleted) return response.status(404).json({ error: 'Mention not found.' });
  publishEvent('data-changed', { reason: 'social-mention-deleted', id: String(request.params.id) }, space.id);
  return response.status(204).end();
});

app.get('/api/social/mentions/:id/reply-drafts', noStore, (request, response) => {
  try { return response.json(listSocialReplyDrafts(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.id))); }
  catch (error) { return intelligenceError(response, error); }
});
app.get('/api/social/reply-drafts', noStore, (request, response) => {
  try { return response.json(listSocialReplyDrafts(authenticatedUser(request), authenticatedSpace(request).id)); }
  catch (error) { return intelligenceError(response, error); }
});
app.post('/api/social/mentions/:id/reply-drafts', (request, response) => {
  try {
    const input = z.object({ tone: z.enum(['helpful', 'empathetic', 'concise', 'professional', 'warm']).default('helpful'), instructions: z.string().trim().max(1000).optional() }).strict().parse(request.body || {});
    const space = authenticatedSpace(request);
    const created = createSocialReplyDraft(authenticatedUser(request), space.id, { mentionId: String(request.params.id), ...input, idempotencyKey: idempotencyKey(request) });
    publishEvent('ai-job', created.job, space.id); void aiJobRunner.pump();
    return response.status(202).json({ draft: created.draft, jobId: created.job.id, state: created.job.state, deduplicated: !created.created, statusUrl: `/api/ai/jobs/${created.job.id}` });
  } catch (error) { return intelligenceError(response, error); }
});
app.patch('/api/social/reply-drafts/:id', (request, response) => {
  try {
    const input = z.object({ content: z.string().trim().min(1).max(280).optional(), archived: z.boolean().optional() }).strict()
      .refine((value) => value.content !== undefined || value.archived !== undefined, 'Provide a draft change.').parse(request.body || {});
    return response.json(updateSocialReplyDraft(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.id), input));
  } catch (error) { return intelligenceError(response, error); }
});
app.get('/api/social/reports', noStore, (request, response) => {
  try { return response.json(listSocialIntelligenceReports(authenticatedUser(request), authenticatedSpace(request).id, typeof request.query.connectionId === 'string' ? request.query.connectionId : undefined)); }
  catch (error) { return intelligenceError(response, error); }
});
app.post('/api/social/reports', (request, response) => {
  try {
    const input = z.object({
      connectionId: z.string().uuid(), title: z.string().trim().min(2).max(180),
      mentionIds: z.array(z.string().uuid()).max(200).optional(),
      knowledgeBaseIds: z.array(z.string().uuid()).max(5).optional()
    }).strict().parse(request.body || {});
    const space = authenticatedSpace(request); const user = authenticatedUser(request);
    const knowledgeBaseRefs = resolveKnowledgeBaseRefs(space.id, input.knowledgeBaseIds, {
      requireTerra: true, viewerUserId: user.id, allowPrivate: false
    });
    const created = createSocialIntelligenceReport(user, space.id, {
      ...input, knowledgeBaseRefs, idempotencyKey: idempotencyKey(request)
    });
    publishEvent('ai-job', created.job, space.id); void aiJobRunner.pump();
    return response.status(202).json({ report: created.report, jobId: created.job.id, state: created.job.state, deduplicated: !created.created, statusUrl: `/api/ai/jobs/${created.job.id}` });
  } catch (error) { return intelligenceError(response, error); }
});
app.post('/api/social/reports/:id/retry', (request, response) => {
  try {
    z.object({}).strict().parse(request.body || {});
    const space = authenticatedSpace(request);
    const retried = retrySocialIntelligenceReport(authenticatedUser(request), space.id, String(request.params.id));
    publishEvent('ai-job', retried.job, space.id); void aiJobRunner.pump();
    return response.status(202).json({
      report: retried.report, jobId: retried.job.id, state: retried.job.state,
      deduplicated: !retried.restarted, journalReused: retried.journalReused,
      statusUrl: `/api/ai/jobs/${retried.job.id}`
    });
  } catch (error) { return intelligenceError(response, error); }
});
app.post('/api/social/reports/:id/publish', (request, response) => {
  try {
    const input = z.object({ knowledgeBaseId: z.string().uuid(), reviewed: z.literal(true) }).strict().parse(request.body || {});
    const user = authenticatedUser(request); const space = authenticatedSpace(request);
    const published = publishSocialIntelligenceReport(user, space.id, String(request.params.id), input);
    if (published.job) {
      publishEvent('knowledge-job', published.job, space.id, knowledgeJobAudienceUserId(published.job));
      void knowledgeJobRunner.pump();
    }
    const publicJob = published.job ? {
      id: published.job.id, knowledgeBaseId: published.job.knowledgeBaseId,
      documentId: published.job.documentId, state: published.job.state,
      stage: published.job.stage, progress: published.job.progress,
      attempt: published.job.attempt, maxAttempts: published.job.maxAttempts,
      error: published.job.error, retryAt: published.job.retryAt,
      createdAt: published.job.createdAt, startedAt: published.job.startedAt,
      completedAt: published.job.completedAt, updatedAt: published.job.updatedAt
    } : null;
    return response.status(202).json({
      ...published, job: publicJob,
      statusUrl: `/api/knowledge-bases/${published.publication.knowledgeBaseId}/indexing-jobs`
    });
  } catch (error) { return intelligenceError(response, error); }
});

app.get('/api/intelligence/sources', noStore, (request, response) => {
  try { return response.json(listIntelligenceSources(authenticatedUser(request), authenticatedSpace(request).id)); }
  catch (error) { return intelligenceError(response, error); }
});
app.get('/api/intelligence/reports', noStore, (request, response) => {
  try { return response.json(listIntelligenceReports(authenticatedUser(request), authenticatedSpace(request).id)); }
  catch (error) { return intelligenceError(response, error); }
});
app.get('/api/intelligence/reports/:id', noStore, (request, response) => {
  try { return response.json(getIntelligenceReport(authenticatedUser(request), authenticatedSpace(request).id, String(request.params.id))); }
  catch (error) { return intelligenceError(response, error); }
});
app.post('/api/intelligence/reports', (request, response) => {
  try {
    const input = z.object({ title: z.string().trim().min(2).max(180), objective: z.string().trim().max(1000).optional(),
      sourceRefs: z.array(z.string().trim().min(3).max(200)).min(1).max(12),
      knowledgeBaseIds: z.array(z.string().uuid()).max(5).optional() }).strict().parse(request.body || {});
    const user = authenticatedUser(request); const space = authenticatedSpace(request);
    const knowledgeSourceIds = input.sourceRefs.flatMap((ref) => {
      const match = /^knowledge-base:([0-9a-f-]{36})$/iu.exec(ref);
      return match ? [match[1]] : [];
    });
    const historicalSourceRefs = input.sourceRefs.filter((ref) => !ref.startsWith('knowledge-base:'));
    const knowledgeBaseIds = [...new Set([...(input.knowledgeBaseIds || []), ...knowledgeSourceIds])];
    if (historicalSourceRefs.length + knowledgeBaseIds.length < 2) {
      throw new IntelligenceError('Select at least two evidence sources to synthesize.');
    }
    const knowledgeBaseRefs = resolveKnowledgeBaseRefs(space.id, knowledgeBaseIds, {
      requireTerra: true, viewerUserId: user.id, allowPrivate: false
    });
    const created = createIntelligenceReport(user, space.id, {
      title: input.title,
      objective: input.objective,
      sourceRefs: historicalSourceRefs,
      knowledgeBaseRefs,
      idempotencyKey: idempotencyKey(request)
    });
    publishEvent('ai-job', created.job, space.id); void aiJobRunner.pump();
    return response.status(202).json({ report: created.report, jobId: created.job.id, state: created.job.state, deduplicated: !created.created, statusUrl: `/api/ai/jobs/${created.job.id}` });
  } catch (error) { return intelligenceError(response, error); }
});

app.post('/api/intelligence/chat', async (request, response) => {
  try {
    const input = z.object({
      sourceRefs: z.array(z.string().trim().min(3).max(200)).max(12).default([]),
      reportId: z.string().uuid().optional(),
      question: z.string().trim().min(3).max(4000),
      history: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(12_000)
      }).strict()).max(12).optional()
    }).strict().refine((value) => value.sourceRefs.length > 0 || Boolean(value.reportId), {
      message: 'Select at least one evidence source or completed analysis.'
    }).parse(request.body || {});
    const user = authenticatedUser(request); const space = authenticatedSpace(request);
    return response.json(await answerResearchQuestion(user, space.id, input));
  } catch (error) { return intelligenceError(response, error); }
});

const journeyText = (maximum: number) => z.string().trim().min(1).max(maximum);
const journeyList = (maximumItems: number, maximumLength: number) => z.array(journeyText(maximumLength)).max(maximumItems);
const journeyStageInput = z.object({
  name: journeyText(200), goal: journeyText(1000), touchpoints: journeyList(50, 500), customerActions: journeyList(50, 500),
  emotions: journeyList(30, 200), painPoints: journeyList(50, 1000), metrics: journeyList(50, 500),
  opportunities: journeyList(50, 1000), recommendedActions: journeyList(50, 1000)
});
const journeyInput = z.object({
  id: z.string().uuid().optional(), name: journeyText(180), audience: z.string().trim().max(500).optional(),
  objective: z.string().trim().max(2000).optional(), industry: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(5000).optional(), stages: z.array(journeyStageInput).min(1).max(20)
});
const journeyUpdateInput = journeyInput.omit({ id: true }).partial().extend({ expectedUpdatedAt: z.string().datetime() })
  .refine((value) => Object.keys(value).some((key) => key !== 'expectedUpdatedAt'), { message: 'Include at least one journey field to update.' });
function journeyCsvCell(value: unknown) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const text = /^[\p{White_Space}\p{Cc}\p{Cf}]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}
function journeyExportFilename(id: string, extension: 'json' | 'csv') {
  return `journey-map-${crypto.createHash('sha256').update(id).digest('hex').slice(0, 16)}.${extension}`;
}
function normalizeJourneyFocus(value: unknown) { return String(value || '').trim().replace(/\s+/gu, ' '); }
function journeyFocusKey(value: unknown) { return normalizeJourneyFocus(value).toLocaleLowerCase('en-US'); }
function knowledgeRefsKey(value: unknown) {
  if (!Array.isArray(value)) return '[]';
  return JSON.stringify(value.map((item) => item && typeof item === 'object'
    ? `${String((item as Record<string, unknown>).id || '')}@${Number((item as Record<string, unknown>).indexVersion || 0)}`
    : '').filter(Boolean).sort());
}
function activeJourneyOptimizationConflict(job: AiJob, reason: 'different_focus' | 'different_knowledge' | 'stale_snapshot') {
  return {
    error: reason === 'stale_snapshot'
      ? 'An optimization for an older journey version is still active. Wait for it to finish before requesting another audit.'
      : reason === 'different_knowledge'
        ? 'An optimization with a different knowledge snapshot is already active for this journey. Wait for it to finish before requesting another audit.'
      : 'A different optimization is already active for this journey. Wait for it to finish before requesting another audit.',
    code: 'JOURNEY_OPTIMIZATION_ACTIVE', reason, activeJobId: job.id, activeState: job.state,
    statusUrl: `/api/ai/jobs/${job.id}`
  };
}
app.get('/api/journeys', noStore, (request, response) => response.json(listJourneys(authenticatedSpace(request).id)));
app.get('/api/journeys/:id', noStore, (request, response) => { const journey = getJourney(String(request.params.id), authenticatedSpace(request).id); return journey ? response.json(journey) : response.status(404).json({ error: 'Journey not found.' }); });
app.post('/api/journeys', (request, response) => {
  const parsed = journeyInput.safeParse(request.body); if (!parsed.success) return sendError(response, parsed.error);
  const space = authenticatedSpace(request);
  if (parsed.data.id && getJourney(parsed.data.id, space.id)) return response.status(409).json({ error: 'A journey with this ID already exists.' });
  try {
    const journey = createJourney({ ...parsed.data, provenance: {
      origin: 'workspace', lastModifiedBy: 'workspace', evidenceBasis: 'workspace_authored', evidenceLevel: 'hypothesis',
      generatedAt: null, optimizedAt: null
    } }, space.id);
    publishEvent('data-changed', { reason: 'journey-created', id: journey.id }, space.id);
    return response.status(201).json(journey);
  } catch (error: any) {
    if (isDatabaseConstraintError(error)) return response.status(409).json({ error: 'A journey with this ID already exists.' });
    throw error;
  }
});
app.patch('/api/journeys/:id', (request, response) => {
  const parsed = journeyUpdateInput.safeParse(request.body); if (!parsed.success) return sendError(response, parsed.error);
  const space = authenticatedSpace(request); const id = String(request.params.id); const current = getJourney(id, space.id);
  if (!current) return response.status(404).json({ error: 'Journey not found.' });
  const { expectedUpdatedAt, ...changes } = parsed.data;
  const journey = updateJourney(id, {
    ...changes,
    provenance: { ...current.provenance, lastModifiedBy: 'workspace', evidenceLevel: 'hypothesis' }
  }, expectedUpdatedAt, { reason: 'workspace_edit', actor: 'workspace' }, space.id);
  if (!journey) return response.status(409).json({ error: 'This journey changed since it was opened. Refresh it before saving.', current: getJourney(id, space.id) });
  publishEvent('data-changed', { reason: 'journey-updated', id: journey.id }, space.id);
  return response.json(journey);
});
app.delete('/api/journeys/:id', (request, response) => {
  const parsed = z.object({ expectedUpdatedAt: z.string().datetime() }).safeParse(request.body || {});
  if (!parsed.success) return sendError(response, parsed.error);
  const space = authenticatedSpace(request); const id = String(request.params.id); const deleted = deleteJourney(id, parsed.data.expectedUpdatedAt, space.id);
  if (deleted === 'not_found') return response.status(404).json({ error: 'Journey not found.' });
  if (deleted === 'conflict') return response.status(409).json({ error: 'This journey changed since it was opened. Refresh it before deleting.', current: getJourney(id, space.id) });
  publishEvent('data-changed', { reason: 'journey-deleted', id }, space.id);
  return response.status(204).end();
});
app.post('/api/ai/journeys', (request, response) => {
  const parsed = z.object({ brief: z.string().trim().min(10).max(8000), audience: z.string().trim().max(500).optional(), industry: z.string().trim().max(200).optional(), objective: z.string().trim().max(2000).optional(),
    knowledgeBaseIds: z.array(z.string().uuid()).max(5).optional() }).safeParse(request.body);
  if (!parsed.success) return sendError(response, parsed.error);
  try {
    const space = authenticatedSpace(request);
    const job = queueJob('journey.generate', parsed.data, space.id, null, null, authenticatedUser(request).id);
    return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
  } catch (error) { return sendError(response, error); }
});
app.post('/api/journeys/:id/ai/optimize', (request, response) => {
  const space = authenticatedSpace(request); const journey = getJourney(String(request.params.id), space.id);
  if (!journey) return response.status(404).json({ error: 'Journey not found.' });
  const parsed = z.object({ focus: z.string().trim().max(2000).optional(), knowledgeBaseIds: z.array(z.string().uuid()).max(5).optional() }).safeParse(request.body || {}); if (!parsed.success) return sendError(response, parsed.error);
  const focus = normalizeJourneyFocus(parsed.data.focus);
  let requestedKnowledgeKey = '[]';
  try {
    requestedKnowledgeKey = knowledgeRefsKey(resolveKnowledgeBaseRefs(space.id, parsed.data.knowledgeBaseIds, {
      requireTerra: true, viewerUserId: authenticatedUser(request).id, allowPrivate: false
    }));
  } catch (error) { return sendError(response, error); }
  const existing = findActiveJourneyOptimization(journey.id, space.id);
  if (existing) {
    const sameSnapshot = String(existing.input.journeyUpdatedAt || '') === journey.updatedAt;
    const sameFocus = journeyFocusKey(existing.input.focus) === journeyFocusKey(focus);
    const sameKnowledge = knowledgeRefsKey(existing.input.knowledgeBaseRefs) === requestedKnowledgeKey;
    if (sameSnapshot && sameFocus && sameKnowledge) return response.status(202).json({ jobId: existing.id, state: existing.state, statusUrl: `/api/ai/jobs/${existing.id}`, deduplicated: true });
    return response.status(409).json(activeJourneyOptimizationConflict(existing,
      !sameSnapshot ? 'stale_snapshot' : !sameFocus ? 'different_focus' : 'different_knowledge'));
  }
  try {
    const job = queueJob('journey.optimize', { journeyId: journey.id, journeyUpdatedAt: journey.updatedAt, focus,
      knowledgeBaseIds: parsed.data.knowledgeBaseIds }, space.id, null, null, authenticatedUser(request).id);
    return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}`, deduplicated: false });
  } catch (error: any) {
    const raced = isDatabaseConstraintError(error) ? findActiveJourneyOptimization(journey.id, space.id) : null;
    if (raced) {
      const sameSnapshot = String(raced.input.journeyUpdatedAt || '') === journey.updatedAt;
      const sameFocus = journeyFocusKey(raced.input.focus) === journeyFocusKey(focus);
      const sameKnowledge = knowledgeRefsKey(raced.input.knowledgeBaseRefs) === requestedKnowledgeKey;
      if (sameSnapshot && sameFocus && sameKnowledge) return response.status(202).json({ jobId: raced.id, state: raced.state, statusUrl: `/api/ai/jobs/${raced.id}`, deduplicated: true });
      return response.status(409).json(activeJourneyOptimizationConflict(raced,
        !sameSnapshot ? 'stale_snapshot' : !sameFocus ? 'different_focus' : 'different_knowledge'));
    }
    throw error;
  }
});

app.get('/api/journeys/:id/versions', noStore, (request, response) => {
  const id = String(request.params.id);
  if (!getJourney(id, authenticatedSpace(request).id)) return response.status(404).json({ error: 'Journey not found.' });
  const parsed = z.coerce.number().int().min(1).max(20).safeParse(request.query.limit ?? 10);
  if (!parsed.success) return sendError(response, parsed.error);
  return response.json(listJourneyVersionSummaries(id, parsed.data));
});
app.post('/api/journeys/:id/versions/:versionId/restore', (request, response) => {
  const parsed = z.object({ expectedUpdatedAt: z.string().datetime() }).safeParse(request.body || {});
  if (!parsed.success) return sendError(response, parsed.error);
  const id = String(request.params.id);
  const space = authenticatedSpace(request);
  const restored = restoreJourneyVersion(id, String(request.params.versionId), parsed.data.expectedUpdatedAt, space.id);
  if (restored.status === 'not_found') return response.status(404).json({ error: 'Journey not found.' });
  if (restored.status === 'version_not_found') return response.status(404).json({ error: 'Journey version not found.' });
  if (restored.status === 'conflict') return response.status(409).json({ error: 'This journey changed since it was opened. Refresh it before restoring.', current: restored.current });
  if (restored.status === 'restored') {
    publishEvent('data-changed', { reason: 'journey-version-restored', id, versionId: String(request.params.versionId) }, space.id);
    return response.json(restored.journey);
  }
  return response.status(500).json({ error: 'Journey version could not be restored.' });
});

app.get('/api/journeys/:id/export.:format', noStore, (request, response) => {
  const journey = getJourney(String(request.params.id), authenticatedSpace(request).id);
  if (!journey) return response.status(404).json({ error: 'Journey not found.' });
  const format = String(request.params.format).toLowerCase();
  if (format === 'json') {
    response.setHeader('Content-Disposition', `attachment; filename="${journeyExportFilename(journey.id, 'json')}"`);
    return response.json(journey);
  }
  if (format !== 'csv') return response.status(400).json({ error: 'Use csv or json.' });
  const categories: Array<[string, keyof Pick<typeof journey.stages[number], 'touchpoints' | 'customerActions' | 'emotions' | 'painPoints' | 'metrics' | 'opportunities' | 'recommendedActions'>]> = [
    ['touchpoint', 'touchpoints'], ['customer_action', 'customerActions'], ['emotion', 'emotions'], ['pain_point', 'painPoints'],
    ['metric', 'metrics'], ['opportunity', 'opportunities'], ['recommended_action', 'recommendedActions']
  ];
  const rows: unknown[][] = [['stage_number', 'stage_name', 'stage_goal', 'category', 'value']];
  journey.stages.forEach((stage, index) => categories.forEach(([category, key]) => stage[key].forEach((value) => rows.push([index + 1, stage.name, stage.goal, category, value]))));
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${journeyExportFilename(journey.id, 'csv')}"`);
  return response.send(`\ufeff${rows.map((row) => row.map(journeyCsvCell).join(',')).join('\n')}`);
});

app.get('/api/templates', (_request, response) => response.json(templates));
app.post('/api/templates/:templateId/create', (request, response) => {
  const template = templates.find((item) => item.id === String(request.params.templateId));
  if (!template) return response.status(404).json({ error: 'Template not found.' });
  const space = authenticatedSpace(request);
  const survey = saveSurvey({
    title: request.body?.title || template.name, description: template.description, purpose: template.purpose,
    primaryMetric: template.primaryMetric, audience: template.audience
  }, template.questions.map((question, index) => ({ ...question, page: 1, position: index, options: question.options || [], settings: question.settings || {}, logic: [] })), space.id);
  const collector = createCollector(survey.id, { name: 'Public web link', type: 'web' });
  publishEvent('data-changed', { surveyId: survey.id, reason: 'survey-created' }, space.id);
  return response.status(201).json({ survey, collector });
});

const campaignStepInput = z.object({
  id: z.string().uuid().optional(), delayMinutes: z.number().int().min(0).max(525_600),
  subject: z.string().trim().min(1).max(250), mode: z.enum(['plain', 'html']).default('plain'),
  bodyText: z.string().max(30_000).default(''), bodyHtml: z.string().max(100_000).optional(),
  embedQuestionId: z.string().max(200).nullable().optional()
}).superRefine((step, context) => {
  const body = step.mode === 'html' ? step.bodyHtml : step.bodyText;
  if (!body?.trim()) context.addIssue({ code: 'custom', path: [step.mode === 'html' ? 'bodyHtml' : 'bodyText'], message: 'Each campaign step needs message content.' });
});
const campaignCustomData = z.record(
  z.string().trim().min(1).max(64),
  z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])
).superRefine((value, context) => {
  if (Object.keys(value).length > 25) context.addIssue({ code: 'custom', message: 'A contact can have at most 25 custom fields.' });
  if (Object.keys(value).some((key) => ['__proto__', 'prototype', 'constructor'].includes(key.trim().toLowerCase()))) {
    context.addIssue({ code: 'custom', message: 'A custom field uses a reserved name.' });
  }
  const normalized = new Set<string>();
  for (const key of Object.keys(value)) {
    const token = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!token) context.addIssue({ code: 'custom', path: [key], message: 'Custom field names must contain a letter or number.' });
    else if (normalized.has(token)) context.addIssue({ code: 'custom', path: [key], message: 'Custom field names must be unique.' });
    normalized.add(token);
  }
});
const campaignContactInput = z.object({
  email: z.string().trim().email().max(320),
  firstName: z.string().trim().max(150).optional(),
  lastName: z.string().trim().max(150).optional(),
  jobTitle: z.string().trim().max(180).optional(),
  company: z.string().trim().max(250).optional(),
  customData: campaignCustomData.optional()
});
const campaignSenderNameInput = z.string().max(EMAIL_SENDER_NAME_MAX_LENGTH)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value), 'Sender name cannot contain control characters.')
  .transform((value) => value.trim());
app.get('/api/campaign-templates', noStore, (_request, response) => response.json(campaignTemplates.map((template) => ({
  ...template, ...template.steps[0]
}))));
app.get('/api/campaigns', noStore, (request, response) => response.json(listCampaignSummaries(authenticatedSpace(request).id)));
app.post('/api/campaigns', (request, response) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(180), surveyId: z.string().min(1), collectorId: z.string().optional(),
      senderName: campaignSenderNameInput.optional(), stopOnResponse: z.boolean().optional(), startAt: z.string().datetime().nullable().optional(), templateId: z.string().max(100).optional()
    }).parse(request.body);
    return response.status(201).json(createCampaign(input, authenticatedSpace(request).id));
  } catch (error) { return sendError(response, error); }
});
app.get('/api/campaigns/:id', noStore, (request, response) => {
  try { return response.json(getCampaignDetail(String(request.params.id), authenticatedSpace(request).id)); }
  catch (error) { return sendError(response, error, 404); }
});
app.put('/api/campaigns/:id', (request, response) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(180).optional(), stopOnResponse: z.boolean().optional(),
      senderName: campaignSenderNameInput.optional(), startAt: z.string().datetime().nullable().optional(), surveyId: z.string().min(1).optional(), collectorId: z.string().optional(),
      settings: z.object({ stopOnResponse: z.boolean().optional() }).passthrough().optional()
    }).parse(request.body);
    return response.json(updateCampaign(String(request.params.id), { ...input, stopOnResponse: input.stopOnResponse ?? input.settings?.stopOnResponse }, authenticatedSpace(request).id));
  } catch (error) { return sendError(response, error); }
});
app.put('/api/campaigns/:id/steps', (request, response) => {
  try {
    const input = z.object({ steps: z.array(campaignStepInput).min(1).max(12) }).parse(request.body);
    return response.json(replaceCampaignSteps(String(request.params.id), input.steps as any, authenticatedSpace(request).id));
  } catch (error) { return sendError(response, error); }
});
app.post('/api/campaigns/:id/contacts', (request, response) => {
  try {
    const input = z.object({ contacts: z.array(campaignContactInput).min(1).max(1000) }).parse(request.body);
    return response.status(201).json(addCampaignContacts(String(request.params.id), input.contacts, authenticatedSpace(request).id));
  } catch (error) { return sendError(response, error); }
});
app.put('/api/campaigns/:id/contacts/:contactId', (request, response) => {
  try {
    const input = campaignContactInput.partial().refine((value) => Object.keys(value).length > 0, 'Add at least one contact field.').parse(request.body);
    return response.json(updateCampaignContact(String(request.params.id), String(request.params.contactId), input, authenticatedSpace(request).id));
  } catch (error) {
    const status = error instanceof Error && /not found/i.test(error.message) ? 404 : 400;
    return sendError(response, error, status);
  }
});
app.delete('/api/campaigns/:id/contacts/:contactId', (request, response) => {
  try {
    return suppressCampaignContact(String(request.params.id), String(request.params.contactId), authenticatedSpace(request).id)
      ? response.status(204).end() : response.status(404).json({ error: 'Campaign contact not found.' });
  } catch (error) { return sendError(response, error, 404); }
});
app.post('/api/campaigns/:id/launch', (request, response) => {
  try {
    const input = z.object({ startAt: z.string().datetime().nullable().optional() }).parse(request.body || {});
    return response.json(launchCampaign(String(request.params.id), input.startAt, authenticatedSpace(request).id));
  } catch (error) { return sendError(response, error); }
});
app.post('/api/campaigns/:id/pause', (request, response) => {
  try { return response.json(pauseCampaign(String(request.params.id), authenticatedSpace(request).id)); }
  catch (error) { return sendError(response, error); }
});
app.post('/api/campaigns/:id/resume', (request, response) => {
  try { return response.json(resumeCampaign(String(request.params.id), authenticatedSpace(request).id)); }
  catch (error) { return sendError(response, error); }
});
app.post('/api/campaigns/:id/test', async (request, response) => {
  try {
    const input = z.object({ email: z.string().email().optional(), emails: z.array(z.string().email()).max(10).optional() }).refine((value) => Boolean(value.email || value.emails?.length), 'Add at least one test email.').parse(request.body);
    const emails = [...new Set([...(input.emails || []), ...(input.email ? [input.email] : [])])];
    const result = await sendCampaignTest(String(request.params.id), emails, authenticatedSpace(request).id);
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
  suppressEmailGlobally({ spaceId: recipient.spaceId, email: recipient.email, reason: 'Recipient unsubscribed', source: 'collector', contactStatus: 'unsubscribed' });
  return response.type('html').send(unsubscribePage({ title: 'You are unsubscribed', message: `${recipient.maskedEmail} will not receive future survey emails.`, confirmed: true }));
});

app.get('/api/surveys', noStore, (request, response) => response.json(listSurveys(authenticatedSpace(request).id)));
app.post('/api/surveys', (request, response) => {
  try {
    const space = authenticatedSpace(request);
    const input = surveyInput.parse(request.body);
    const existing = input.id ? getSurvey(input.id, space.id) : null;
    if (!existing) {
      const active = Number((db.prepare("SELECT COUNT(*) count FROM surveys WHERE space_id=? AND status<>'closed'")
        .get(space.id) as { count?: number } | undefined)?.count || 0);
      assertSubscriptionQuota(space.id, 'activeSurveys', active, 1);
    }
    const survey = saveSurvey(input as any, input.questions as any, space.id);
    publishEvent('data-changed', { surveyId: survey.id, reason: 'survey-created' }, space.id);
    return response.status(201).json(survey);
  } catch (error) { return sendError(response, error); }
});
app.post('/api/ai/surveys', (request, response) => {
  const brief = z.object({ brief: z.string().min(10).max(8000), purpose: z.string().optional(), audience: z.string().optional(), language: z.string().optional(), numberOfQuestions: z.number().int().min(2).max(40).optional(),
    knowledgeBaseIds: z.array(z.string().uuid()).max(5).optional() }).safeParse(request.body);
  if (!brief.success) return sendError(response, brief.error);
  try {
    const space = authenticatedSpace(request);
    const active = Number((db.prepare("SELECT COUNT(*) count FROM surveys WHERE space_id=? AND status<>'closed'")
      .get(space.id) as { count?: number } | undefined)?.count || 0);
    assertSubscriptionQuota(space.id, 'activeSurveys', active, 1);
    const job = queueJob('survey.generate', brief.data, space.id, null, null, authenticatedUser(request).id);
    return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
  } catch (error) { return sendError(response, error); }
});
app.get('/api/surveys/:id', noStore, (request, response) => {
  const survey = getSurvey(String(request.params.id), authenticatedSpace(request).id);
  if (!survey) return response.status(404).json({ error: 'Survey not found.' });
  return response.json({ survey, collectors: listCollectors(survey.id), insights: listInsights(survey.id) });
});
app.put('/api/surveys/:id', (request, response) => {
  try {
    const space = authenticatedSpace(request);
    const current = requireSurvey(String(request.params.id), space.id);
    const input = surveyInput.parse({ ...current, ...request.body, id: current.id });
    const survey = saveSurvey(input as any, input.questions as any, space.id);
    publishEvent('data-changed', { surveyId: survey.id, reason: 'survey-updated' }, space.id);
    return response.json(survey);
  } catch (error) { return sendError(response, error); }
});
app.delete('/api/surveys/:id', (request, response) => {
  const id = String(request.params.id);
  const space = authenticatedSpace(request);
  const files = db.prepare(`SELECT u.stored_filename FROM uploads u JOIN collectors c ON c.id=u.collector_id
    WHERE c.survey_id=? AND u.space_id=?`).all(id, space.id) as Array<{ stored_filename: string }>;
  if (!deleteSurvey(id, space.id)) return response.status(404).json({ error: 'Survey not found.' });
  for (const file of files) removeUploadedFile(path.resolve(config.uploadDir, file.stored_filename));
  return response.status(204).end();
});
app.post('/api/surveys/:id/publish', (request, response) => {
  try {
    const space = authenticatedSpace(request);
    const survey = requireSurvey(String(request.params.id), space.id);
    const nextStatus: Survey['status'] = request.body?.status === 'closed' ? 'closed' : 'live';
    const updated = saveSurvey({ ...survey, status: nextStatus, publishedAt: nextStatus === 'live' ? (survey.publishedAt || new Date().toISOString()) : survey.publishedAt }, survey.questions, space.id);
    publishEvent('data-changed', { surveyId: survey.id, reason: 'survey-status' }, space.id);
    return response.json(updated);
  } catch (error) { return sendError(response, error, 404); }
});

app.get('/api/surveys/:id/collectors', noStore, (request, response) => {
  const survey = getSurvey(String(request.params.id), authenticatedSpace(request).id);
  return survey ? response.json(listCollectors(survey.id)) : response.status(404).json({ error: 'Survey not found.' });
});
app.post('/api/surveys/:id/collectors', (request, response) => {
  try {
    const space = authenticatedSpace(request);
    requireSurvey(String(request.params.id), space.id);
    const input = z.object({ name: z.string().min(2), type: z.enum(['web', 'email', 'api', 'qr', 'manual', 'kiosk']), slug: z.string().regex(/^[a-z0-9-]+$/).optional(), settings: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
    const collector = createCollector(String(request.params.id), input as Partial<Collector>);
    publishEvent('data-changed', { surveyId: String(request.params.id), reason: 'collector-created' }, space.id);
    return response.status(201).json(collector);
  } catch (error) { return sendError(response, error); }
});
app.get('/api/collectors/:id/recipients', noStore, (request, response) => {
  const space = authenticatedSpace(request);
  const collector = db.prepare('SELECT c.id FROM collectors c JOIN surveys s ON s.id=c.survey_id WHERE c.id=? AND s.space_id=?').get(String(request.params.id), space.id);
  return collector ? response.json(listRecipients(String(request.params.id))) : response.status(404).json({ error: 'Collector not found.' });
});
app.post('/api/collectors/:id/invitations', async (request, response) => {
  const space = authenticatedSpace(request);
  const collectorRow = db.prepare('SELECT c.* FROM collectors c JOIN surveys s ON s.id=c.survey_id WHERE c.id=? AND s.space_id=?').get(String(request.params.id), space.id) as any;
  if (!collectorRow) return response.status(404).json({ error: 'Collector not found.' });
  const collector = getCollectorBySlug(collectorRow.slug)!;
  const survey = requireSurvey(collector.surveyId, space.id);
  const input = z.object({ recipients: z.array(z.object({ email: z.string().email(), name: z.string().max(150).optional() })).min(1).max(250), message: z.string().max(3000).optional() }).safeParse(request.body);
  if (!input.success) return sendError(response, input.error);
  const outcomes = await sendInvitations(survey, collector, input.data.recipients, input.data.message);
  publishEvent('data-changed', { surveyId: survey.id, reason: 'invitations-sent' }, space.id);
  return response.status(outcomes.some((item) => item.status === 'failed') ? 207 : 200).json({ outcomes, email: emailStatus() });
});

app.get('/api/public/collectors/:slug', noStore, (request, response) => {
  const collector = getCollectorBySlug(String(request.params.slug));
  if (!collector) return response.status(404).json({ error: 'Survey link not found.' });
  const survey = getSurvey(collector.surveyId);
  if (!survey || survey.status !== 'live' || collector.status !== 'open') return response.status(410).json({ error: 'This survey is not accepting responses.' });
  const owningSpaceId = surveySpaceId(survey.id);
  if (!owningSpaceId) return response.status(410).json({ error: 'This survey is not accepting responses.' });
  try { assertSpaceOperationalById(owningSpaceId, 'surveys'); }
  catch { return response.status(410).json({ error: 'This survey is not accepting responses.' }); }
  return response.json({ survey, collector, uploadGrant: issuePublicUploadGrant(collector.id) });
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
  const owningSpaceId = surveySpaceId(survey.id);
  if (!owningSpaceId) return response.status(410).json({ error: 'This survey is not accepting responses.' });
  try { assertSpaceOperationalById(owningSpaceId, 'surveys'); }
  catch { return response.status(410).json({ error: 'This survey is not accepting responses.' }); }
  const remote = String(request.ip || 'unknown');
  if (!allowSubmission(`${remote}:${collector.id}`)) return response.status(429).json({ error: 'Too many submissions. Please wait before trying again.' });
  const input = z.object({ answers: z.record(z.string(), z.unknown()), startedAt: z.string().datetime().optional(), respondentToken: z.string().max(200).optional(), status: z.enum(['partial', 'completed']).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).safeParse(request.body);
  if (!input.success) return sendError(response, input.error);
  const answers = input.data.answers;
  const omittedPages = skippedPages(survey, answers);
  const missing = (survey.questions || []).filter((question) => question.required && question.type !== 'statement' && !omittedPages.has(question.page) && questionIsVisible(question, answers) && !hasAnswer(answers[question.id]));
  if (missing.length && input.data.status !== 'partial') return response.status(400).json({ error: 'Required questions are incomplete.', questionIds: missing.map((question) => question.id) });
  let stored: ResponseRecord;
  try {
    stored = db.transaction(() => {
      const answerUploads = publicAnswerUploadRows(survey, collector.id, owningSpaceId, answers);
      const created = createResponse({
        surveyId: survey.id, collectorId: collector.id, respondentToken: input.data.respondentToken,
        answers, startedAt: input.data.startedAt, status: input.data.status,
        metadata: { ...(input.data.metadata || {}), userAgent: request.get('user-agent')?.slice(0, 300), ipHash: crypto.createHash('sha256').update(remote).digest('hex').slice(0, 16) }
      });
      const claim = db.prepare(`UPDATE uploads SET response_id=?,claimed_at=?,expires_at=NULL
        WHERE id=? AND response_id IS NULL`);
      for (const uploadRow of answerUploads) {
        if (!claim.run(created.id, new Date().toISOString(), uploadRow.id).changes) {
          throw new Error('A supplied upload was already attached to another response.');
        }
      }
      return created;
    })();
  } catch (error) {
    return sendError(response, error);
  }
  if (stored.status === 'completed') {
    const recipient = request.query.recipient || input.data.respondentToken;
    if (recipient) {
      db.prepare(`UPDATE recipients SET status='responded',responded_at=? WHERE token=? AND collector_id=?`)
        .run(new Date().toISOString(), String(recipient), collector.id);
      markCampaignContactResponded(String(recipient), survey.id);
    }
    createRuleTickets(survey, stored);
    try {
      queueJob('response.analyze', { knowledgeBaseIds: surveyKnowledgeBaseIds(survey.id, owningSpaceId, 'response.analyze') }, owningSpaceId, survey.id, stored.id);
    } catch (error) {
      // The response is authoritative and must not be rolled back because an
      // attached knowledge base was revoked between publish and submit. Keep
      // the analysis failure visible and never run the response without the
      // knowledge snapshot the survey owner selected.
      if (!(error instanceof SubscriptionEntitlementError)) {
        recordKnowledgeResolutionFailure('response.analyze', owningSpaceId, survey.id, stored.id, null, error);
      }
    }
  }
  publishEvent('response', { surveyId: survey.id, responseId: stored.id, status: stored.status }, owningSpaceId);
  return response.status(201).json({ responseId: stored.id, status: stored.status, thankYouMessage: survey.thankYouMessage });
});

app.post('/api/public/collectors/:slug/uploads', admitPublicUpload, upload.single('file'), (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'No supported file was uploaded.' });
  const { collector, spaceId, questionId } = response.locals.publicUpload as { collector: Collector; spaceId: string; questionId: string };
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const timestamp = new Date();
  try {
    db.prepare(`INSERT INTO uploads
      (id,space_id,collector_id,created_by_user_id,question_id,response_id,stored_filename,original_name,mime_type,size,access_token_hash,expires_at,claimed_at,created_at)
      VALUES (?,?,?,NULL,?,NULL,?,?,?,?,?,?,NULL,?)`).run(
      id, spaceId, collector.id, questionId, request.file.filename, path.basename(request.file.originalname).slice(0, 255),
      request.file.mimetype, request.file.size, crypto.createHash('sha256').update(token).digest('hex'),
      new Date(timestamp.getTime() + 24 * 60 * 60_000).toISOString(), timestamp.toISOString()
    );
    const row = db.prepare('SELECT * FROM uploads WHERE id=?').get(id);
    return response.status(201).json(uploadResponse(row, token));
  } catch (error) {
    removeUploadedFile(request.file.path);
    return sendError(response, error, 500);
  }
});

app.get('/api/public/uploads/:id/:token', noStore, (request, response) => {
  const tokenHash = crypto.createHash('sha256').update(String(request.params.token || '')).digest('hex');
  const row = db.prepare(`SELECT * FROM uploads WHERE id=? AND access_token_hash=?
    AND (response_id IS NOT NULL OR expires_at IS NULL OR expires_at>?)`)
    .get(String(request.params.id), tokenHash, new Date().toISOString());
  return row ? sendUploadContent(response, row) : response.status(404).json({ error: 'Upload not found.' });
});

app.post('/api/uploads', upload.single('file'), (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'No supported file was uploaded.' });
  const space = authenticatedSpace(request);
  const user = authenticatedUser(request);
  const id = crypto.randomUUID();
  try {
    db.prepare(`INSERT INTO uploads
      (id,space_id,collector_id,created_by_user_id,stored_filename,original_name,mime_type,size,access_token_hash,created_at)
      VALUES (?,?,NULL,?,?,?,?,?,NULL,?)`).run(
      id, space.id, user.id, request.file.filename, path.basename(request.file.originalname).slice(0, 255),
      request.file.mimetype, request.file.size, new Date().toISOString()
    );
    const row = db.prepare('SELECT * FROM uploads WHERE id=?').get(id);
    return response.status(201).json(uploadResponse(row));
  } catch (error) {
    removeUploadedFile(request.file.path);
    return sendError(response, error, 500);
  }
});

app.get('/api/uploads/:id/content', noStore, (request, response) => {
  const row = db.prepare('SELECT * FROM uploads WHERE id=? AND space_id=?').get(String(request.params.id), authenticatedSpace(request).id);
  return row ? sendUploadContent(response, row) : response.status(404).json({ error: 'Upload not found.' });
});

app.get('/api/surveys/:id/responses', noStore, (request, response) => {
  const survey = getSurvey(String(request.params.id), authenticatedSpace(request).id);
  return survey ? response.json(listResponses(survey.id, Math.min(1000, Number(request.query.limit || 500)))) : response.status(404).json({ error: 'Survey not found.' });
});
app.get('/api/responses/:id', noStore, (request, response) => {
  const item = getResponse(String(request.params.id));
  if (!item || !getSurvey(item.surveyId, authenticatedSpace(request).id)) return response.status(404).json({ error: 'Response not found.' });
  return response.json(item);
});
app.post('/api/responses/:id/analyze', (request, response) => {
  const item = getResponse(String(request.params.id));
  const space = authenticatedSpace(request);
  if (!item || !getSurvey(item.surveyId, space.id)) return response.status(404).json({ error: 'Response not found.' });
  try {
    const job = queueJob('response.analyze', { knowledgeBaseIds: surveyKnowledgeBaseIds(item.surveyId, space.id, 'response.analyze') },
      space.id, item.surveyId, item.id, authenticatedUser(request).id);
    return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
  } catch (error) { return sendError(response, error); }
});
app.get('/api/surveys/:id/analytics', noStore, (request, response) => {
  try {
    const survey = requireSurvey(String(request.params.id), authenticatedSpace(request).id);
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
      const space = authenticatedSpace(request);
      requireSurvey(String(request.params.id), space.id);
      const requested = request.body && Array.isArray(request.body.knowledgeBaseIds)
        ? request.body.knowledgeBaseIds
        : surveyKnowledgeBaseIds(String(request.params.id), space.id, route.kind);
      const job = queueJob(route.kind, { ...(request.body || {}), knowledgeBaseIds: requested }, space.id,
        String(request.params.id), null, authenticatedUser(request).id);
      return response.status(202).json({ jobId: job.id, state: job.state, statusUrl: `/api/ai/jobs/${job.id}` });
    } catch (error) { return sendError(response, error, 404); }
  });
}

app.get('/api/ai/jobs', noStore, (request, response) => {
  const user = authenticatedUser(request); const space = resolveRequestSpace(request, user.id);
  return response.json(listJobsForSpace(space.id, Math.min(500, Number(request.query.limit || 100)), user.id)
    .map((job) => ({ ...job, retry: aiJobRetryStatus(job, user.id) })));
});
app.get('/api/ai/jobs/:id', noStore, (request, response) => {
  const user = authenticatedUser(request); const space = resolveRequestSpace(request, user.id);
  const job = getJobForSpace(String(request.params.id), space.id, user.id);
  if (!job) return response.status(404).json({ error: 'AI job not found.' });
  const context = getKnowledgeContext(job.id, space.id);
  return response.json({ ...job, knowledgeContext: context ? {
    query: context.query, knowledgeBases: context.knowledgeBases, citations: context.citations,
    metrics: context.metrics, createdAt: context.createdAt
  } : null, retry: aiJobRetryStatus(job, user.id) });
});
app.post('/api/ai/jobs/:id/retry', (request, response) => {
  try {
    z.object({}).strict().parse(request.body || {});
    const user = authenticatedUser(request); const space = resolveRequestSpace(request, user.id);
    // A retry reuses the existing durable row for idempotency and quota history,
    // but it can consume another provider execution, so normal AI admission
    // still applies before the failed row is requeued.
    assertCanQueueAiAction(space.id);
    const retried = retryFailedAiJob(String(request.params.id), space.id, user.id);
    void aiJobRunner.pump();
    return response.status(202).json({
      job: { ...retried.job, retry: aiJobRetryStatus(retried.job, user.id) },
      jobId: retried.job.id,
      state: retried.job.state,
      restarted: retried.restarted,
      journalReused: retried.journalReused,
      statusUrl: `/api/ai/jobs/${retried.job.id}`
    });
  } catch (error) {
    if (error instanceof AiJobRetryError) return response.status(error.status).json({ error: error.message, code: error.code });
    return sendError(response, error);
  }
});

app.get('/api/surveys/:id/insights', noStore, (request, response) => {
  const survey = getSurvey(String(request.params.id), authenticatedSpace(request).id);
  return survey ? response.json(listInsights(survey.id)) : response.status(404).json({ error: 'Survey not found.' });
});
app.post('/api/surveys/:id/insights/:insightId/knowledge', (request, response) => {
  try {
    const user = authenticatedUser(request); const space = resolveRequestSpace(request, user.id);
    const survey = requireSurvey(String(request.params.id), space.id);
    const input = z.object({
      knowledgeBaseIds: z.array(z.string().uuid()).min(1).max(5),
      title: z.string().trim().min(3).max(180).optional(), reviewed: z.literal(true)
    }).strict().parse(request.body || {});
    const source = db.prepare(`SELECT i.* FROM insights i JOIN surveys s ON s.id=i.survey_id
      WHERE i.id=? AND i.survey_id=? AND s.space_id=? AND i.kind='research_answer'`)
      .get(String(request.params.insightId), survey.id, space.id) as any;
    if (!source) return response.status(404).json({ error: 'Saved research answer not found.' });
    const payload = JSON.parse(source.payload_json || '{}') as Record<string, any>;
    const title = input.title || String(payload.question || 'Survey research answer').slice(0, 180);
    const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
    const caveats = Array.isArray(payload.caveats) ? payload.caveats : [];
    const markdown = [
      `# ${title}`, '', `Survey: ${survey.title}`, '', '## Question', '', String(payload.question || ''), '',
      '## Answer', '', String(payload.answer || ''), '', '## Evidence', '',
      ...(evidence.length ? evidence.map((item: any) => `- ${String(item.responseId || 'response')}: ${String(item.excerpt || '')}`) : ['- No respondent excerpt was supplied.']),
      '', '## Caveats', '', ...(caveats.length ? caveats.map((item: unknown) => `- ${String(item)}`) : ['- None supplied.']), '',
      '## Provenance', '', `- Survey ID: ${survey.id}`, `- Saved research answer ID: ${source.id}`,
      `- Generated at: ${source.created_at}`, `- Reviewed and published by: ${user.id}`, ''
    ].join('\n');
    const uniqueBaseIds = [...new Set(input.knowledgeBaseIds)];
    const bases = uniqueBaseIds.map((id) => getKnowledgeBase(id, space.id, false, user.id));
    if (bases.some((base) => !base)) return response.status(404).json({ error: 'Knowledge base not found in this space.' });
    const publications = bases.map((base) => {
      const created = createKnowledgeMarkdownDocument({
        spaceId: space.id, knowledgeBaseId: base!.id, userId: user.id,
        originalName: `Survey research ${source.id}.md`, markdown,
        metadata: { artifactType: 'survey_research_answer', trustStatus: 'human_reviewed_derived',
          surveyId: survey.id, sourceInsightId: source.id, reviewedBy: user.id }
      });
      return { knowledgeBaseId: base!.id, document: created.document, job: created.job, deduplicated: created.deduplicated };
    });
    publishEvent('data-changed', { reason: 'survey-research-published', surveyId: survey.id,
      insightId: source.id, knowledgeBaseIds: uniqueBaseIds }, space.id);
    return response.status(202).json({ insightId: source.id, publications });
  } catch (error) { return sendError(response, error, 400); }
});
app.get('/api/surveys/:id/tickets', noStore, (request, response) => {
  const survey = getSurvey(String(request.params.id), authenticatedSpace(request).id);
  return survey ? response.json(db.prepare('SELECT * FROM tickets WHERE survey_id=? ORDER BY created_at DESC').all(survey.id)) : response.status(404).json({ error: 'Survey not found.' });
});
const recoveryTicketCreateInput = z.object({
  surveyId: z.string().uuid(), responseId: z.string().uuid().nullable().optional(), title: z.string().trim().min(2).max(160),
  priority: z.enum(['normal', 'high', 'urgent']).optional(), owner: z.string().trim().max(150).optional(),
  notes: z.string().trim().max(5000).optional()
});
const recoveryTicketUpdateInput = z.object({
  title: z.string().trim().min(2).max(160).optional(), status: z.enum(['open', 'in_progress', 'closed']).optional(),
  priority: z.enum(['normal', 'high', 'urgent']).optional(), owner: z.string().trim().max(150).optional(),
  notes: z.string().trim().max(5000).optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one recovery case field is required.' });
const recoveryTicketFilterInput = z.object({
  status: z.enum(['open', 'in_progress', 'closed']).optional(), priority: z.enum(['normal', 'high', 'urgent']).optional(),
  owner: z.string().trim().max(150).optional(), q: z.string().trim().max(200).optional()
});
app.get('/api/tickets', noStore, (request, response) => {
  try {
    const space = authenticatedSpace(request); const input = recoveryTicketFilterInput.parse(request.query);
    return response.json(listRecoveryTickets(space.id, {
      status: input.status, priority: input.priority, owner: input.owner, query: input.q
    }));
  } catch (error) { return sendError(response, error); }
});
app.post('/api/tickets', (request, response) => {
  try {
    const space = authenticatedSpace(request); const user = authenticatedUser(request);
    const ticket = createRecoveryTicket(space.id, user.id, recoveryTicketCreateInput.parse(request.body));
    publishEvent('data-changed', { ticketId: ticket.id, surveyId: ticket.surveyId, reason: 'ticket-created' }, space.id);
    return response.status(201).json(ticket);
  } catch (error) { return sendError(response, error); }
});
app.get('/api/tickets/:id', noStore, (request, response) => {
  const ticket = getRecoveryTicket(String(request.params.id), authenticatedSpace(request).id);
  return ticket ? response.json(ticket) : response.status(404).json({ error: 'Recovery case not found.', code: 'RECOVERY_TICKET_NOT_FOUND' });
});
app.patch('/api/tickets/:id', (request, response) => {
  try {
    const space = authenticatedSpace(request); const user = authenticatedUser(request);
    const ticket = updateRecoveryTicket(String(request.params.id), space.id, user.id, recoveryTicketUpdateInput.parse(request.body));
    publishEvent('data-changed', { ticketId: ticket.id, surveyId: ticket.surveyId, reason: 'ticket-updated' }, space.id);
    return response.json(ticket);
  } catch (error) { return sendError(response, error); }
});

function csvCell(value: unknown) { const text = typeof value === 'string' ? value : JSON.stringify(value ?? ''); return `"${text.replace(/"/g, '""')}"`; }
app.get('/api/surveys/:id/export.:format', (request, response) => {
  const survey = getSurvey(String(request.params.id), authenticatedSpace(request).id);
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
