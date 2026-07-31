import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { aiJobRunner } from './aiJobs.js';
import {
  AssistantError, assistantEmailRequestFingerprint, assistantKnowledgeRequestFingerprint,
  assistantIntelligenceSnapshot, assistantWorkProductRequestFingerprint, consumeNylasOAuthState,
  createAssistantEmailRun, createAssistantKnowledgeRun, createAssistantWorkProductRun,
  createNylasOAuthState, getAssistantRun, listAssistantRuns, listNylasConnections,
  markNylasConnectionRevoked, ownedNylasConnection, publishAssistantChanged, replayAssistantIdempotency,
  saveNylasConnection, updateAssistantDraft, type AssistantEvidenceSnapshot
} from './assistant.js';
import {
  AssistantOperationError, createAssistantAction, createAssistantReminder, listAssistantActions,
  listAssistantAudit, listAssistantReminders, promoteAssistantAction, recordAssistantAudit,
  updateAssistantAction, updateAssistantReminder
} from './assistantOperations.js';
import { assistantDocumentType } from './assistantSchemas.js';
import { currentSessionUser } from './auth.js';
import { config } from './config.js';
import { db } from './database.js';
import { retrieveKnowledge } from './knowledgeClient.js';
import {
  KnowledgeError, resolveKnowledgeBaseRefs, saveKnowledgeQuerySnapshot
} from './knowledgeRepository.js';
import {
  createNylasAuthorizeUrl, exchangeNylasCode, getNylasCalendarEvent, getNylasThreadSnapshot,
  listNylasCalendarEvents, listNylasCalendars, listNylasFolders, listNylasThreadPage, listNylasThreads,
  NylasError, nylasConfigured, nylasRedirectUri, revokeNylasGrant
} from './nylasClient.js';
import { nylasSecretEncryptionConfigured } from './nylasSecrets.js';
import { getSpaceForUser, resolveRequestSpace, SpaceError } from './spaces.js';
import { assertCanQueueAiAction, SubscriptionEntitlementError } from './subscriptionEntitlements.js';
import { getTerraStatus } from './terraClient.js';

const providerInput = z.object({ provider: z.enum(['google', 'microsoft']) }).strict();
const threadQuery = z.object({
  connectionId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(50).default(20)
}).strict();
const mailboxThreadQuery = z.object({
  connectionId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(40),
  cursor: z.string().trim().min(1).max(1_000).optional(),
  search: z.string().trim().min(1).max(500).optional(),
  folder: z.string().trim().min(1).max(300).optional(),
  unread: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  hasAttachment: z.enum(['true', 'false']).transform((value) => value === 'true').optional()
}).strict().superRefine((value, context) => {
  if (value.search && (value.unread !== undefined || value.hasAttachment !== undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'Native mailbox search cannot be combined with unread or attachment filters.',
      path: ['search']
    });
  }
});
const mailboxThreadDetailQuery = z.object({ connectionId: z.string().uuid() }).strict();
const runsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).strict();
const emailSummaryInput = z.object({ connectionId: z.string().uuid(), threadId: z.string().trim().min(1).max(300) }).strict();
const emailDraftInput = emailSummaryInput.extend({
  instructions: z.string().trim().max(2_000).optional(), tone: z.string().trim().min(1).max(80).optional()
}).strict();
const knowledgeInput = z.object({
  question: z.string().trim().min(3).max(4_000),
  sourceRefs: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  knowledgeBaseIds: z.array(z.string().uuid()).max(5).default([])
}).strict().refine((value) => value.sourceRefs.length > 0 || value.knowledgeBaseIds.length > 0, {
  message: 'Select at least one saved source or knowledge base.'
});
const draftInput = z.object({
  subject: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(24_000),
  revision: z.number().int().min(1)
}).strict();
const workProductInput = z.object({
  documentType: assistantDocumentType,
  title: z.string().trim().min(2).max(500),
  objective: z.string().trim().min(3).max(6_000),
  sourceRefs: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  knowledgeBaseIds: z.array(z.string().uuid()).max(5).default([]),
  connectionId: z.string().uuid().optional(),
  threadConnectionId: z.string().uuid().optional(),
  calendarConnectionId: z.string().uuid().optional(),
  threadId: z.string().trim().min(1).max(300).optional(),
  calendarEventId: z.string().trim().min(1).max(300).optional(),
  calendarId: z.string().trim().min(1).max(300).optional()
}).strict().superRefine((value, context) => {
  if (value.threadId && !(value.threadConnectionId || value.connectionId)) {
    context.addIssue({
      code: 'custom',
      message: 'threadConnectionId is required for mailbox evidence.',
      path: ['threadConnectionId']
    });
  }
  if (value.calendarEventId && !(value.calendarConnectionId || value.connectionId)) {
    context.addIssue({
      code: 'custom',
      message: 'calendarConnectionId is required for calendar evidence.',
      path: ['calendarConnectionId']
    });
  }
  if (value.calendarEventId && !value.calendarId) {
    context.addIssue({ code: 'custom', message: 'calendarId is required for calendar-event evidence.', path: ['calendarId'] });
  }
  if (value.threadConnectionId && !value.threadId) {
    context.addIssue({ code: 'custom', message: 'threadId is required with threadConnectionId.', path: ['threadId'] });
  }
  if (value.calendarConnectionId && !value.calendarEventId) {
    context.addIssue({
      code: 'custom',
      message: 'calendarEventId is required with calendarConnectionId.',
      path: ['calendarEventId']
    });
  }
  if (value.connectionId && value.threadConnectionId && value.connectionId !== value.threadConnectionId) {
    context.addIssue({
      code: 'custom',
      message: 'connectionId and threadConnectionId identify different mailbox connections.',
      path: ['threadConnectionId']
    });
  }
  if (value.connectionId && value.calendarConnectionId && value.connectionId !== value.calendarConnectionId) {
    context.addIssue({
      code: 'custom',
      message: 'connectionId and calendarConnectionId identify different calendar connections.',
      path: ['calendarConnectionId']
    });
  }
  if (value.documentType !== 'scheduling_proposal' && !value.sourceRefs.length
    && !value.knowledgeBaseIds.length && !value.threadId && !value.calendarEventId) {
    context.addIssue({ code: 'custom', message: 'Select at least one authorized source.' });
  }
});
const actionStatus = z.enum(['open', 'in_progress', 'completed', 'cancelled']);
const actionPriority = z.enum(['low', 'normal', 'high', 'urgent']);
const actionCreateInput = z.object({
  title: z.string().trim().min(1).max(700),
  description: z.string().trim().max(4_000).optional(),
  owner: z.string().trim().max(200).optional(),
  status: actionStatus.optional(),
  priority: actionPriority.optional(),
  dueAt: z.string().trim().max(100).nullable().optional()
}).strict();
const actionUpdateInput = actionCreateInput.partial().extend({
  id: z.string().uuid(), revision: z.number().int().min(1)
}).strict().refine((value) => Object.keys(value).some((key) => !['id', 'revision'].includes(key)), 'Include a field to update.');
const actionPromotionInput = z.object({
  runId: z.string().uuid(),
  actionIndex: z.number().int().min(0).max(29),
  owner: z.string().trim().max(200).optional(),
  priority: actionPriority.optional(),
  dueAt: z.string().trim().max(100).nullable().optional()
}).strict();
const actionsQuery = z.object({
  status: actionStatus.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
}).strict();
const reminderCreateInput = z.object({
  remindAt: z.string().trim().min(1).max(100), note: z.string().trim().max(1_000).optional()
}).strict();
const reminderUpdateInput = z.object({
  revision: z.number().int().min(1),
  remindAt: z.string().trim().min(1).max(100).optional(),
  note: z.string().trim().max(1_000).optional(),
  state: z.enum(['scheduled', 'dismissed', 'completed']).optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'revision'), 'Include a field to update.');
const calendarConnectionQuery = z.object({ connectionId: z.string().uuid() }).strict();
const calendarEventsQuery = z.object({
  connectionId: z.string().uuid(),
  calendarId: z.string().trim().min(1).max(300),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  limit: z.coerce.number().int().min(1).max(50).default(40),
  cursor: z.string().trim().min(1).max(1_000).optional()
}).strict().superRefine((value, context) => {
  const start = new Date(value.start); const end = new Date(value.end);
  if (end <= start) context.addIssue({ code: 'custom', message: 'end must be after start.', path: ['end'] });
  if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60_000) {
    context.addIssue({ code: 'custom', message: 'Calendar windows cannot exceed 366 days.', path: ['end'] });
  }
});
const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).strict();
const callbackInput = z.object({
  state: z.string().min(20).max(500), code: z.string().min(1).max(4_000).optional(),
  error: z.string().max(500).optional()
}).passthrough();

function identity(request: Request) {
  const user = currentSessionUser(request);
  if (!user) throw new AssistantError('Authentication is required.', 401, 'AUTH_REQUIRED');
  const space = resolveRequestSpace(request, user.id);
  return { user, space };
}

function idempotencyKey(request: Request) {
  const value = request.get('idempotency-key');
  return value ? z.string().uuid().parse(value) : undefined;
}

function statusPayload(created: { run: any; job: any }) {
  return {
    run: created.run,
    jobId: created.job.id,
    state: created.job.state,
    statusUrl: `/api/assistant/runs/${created.run.id}`
  };
}

function queueCreated(created: { run: any; job: any }, spaceId: string) {
  publishAssistantChanged(spaceId);
  void aiJobRunner.pump();
}

export function boundedEvidence(sources: AssistantEvidenceSnapshot[], maximumBytes = 128 * 1024) {
  const usable = sources
    .map((source) => ({ ...source, content: String(source.content || '').trim() }))
    .filter((source) => source.content);
  if (!usable.length) return [];
  const headers = usable.map((source) => ({ ...source, content: '' }));
  const overhead = Buffer.byteLength(JSON.stringify(headers), 'utf8') + 512;
  const contentBudget = Math.max(0, maximumBytes - overhead);
  const lengths = usable.map((source) => Buffer.byteLength(source.content, 'utf8'));
  const allocations = new Array(usable.length).fill(0);
  const active = new Set(usable.map((_, index) => index));
  let remaining = contentBudget;
  while (active.size && remaining > 0) {
    const share = Math.floor(remaining / active.size);
    if (share < 1) break;
    const completed = [...active].filter((index) => lengths[index] <= share);
    if (!completed.length) {
      for (const index of active) allocations[index] = share;
      remaining -= share * active.size;
      break;
    }
    for (const index of completed) {
      allocations[index] = lengths[index];
      remaining -= lengths[index];
      active.delete(index);
    }
  }
  const truncate = (value: string, maximum: number) =>
    Buffer.from(value, 'utf8').subarray(0, Math.max(0, maximum)).toString('utf8').replace(/\uFFFD+$/gu, '').trim();
  const result = usable.map((source, index) => ({ ...source, content: truncate(source.content, allocations[index]) }))
    .filter((source) => source.content);
  let encodedBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  while (encodedBytes > maximumBytes && result.length) {
    const largest = result.reduce((selected, source, index) =>
      Buffer.byteLength(source.content, 'utf8') > Buffer.byteLength(result[selected].content, 'utf8') ? index : selected, 0);
    const currentBytes = Buffer.byteLength(result[largest].content, 'utf8');
    if (currentBytes <= 1) break;
    result[largest] = {
      ...result[largest],
      content: truncate(result[largest].content, Math.max(1, currentBytes - (encodedBytes - maximumBytes) - 16))
    };
    encodedBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  }
  return result;
}

function emailEvidence(snapshot: Awaited<ReturnType<typeof getNylasThreadSnapshot>>) {
  return snapshot.messages.map((message): AssistantEvidenceSnapshot => ({
    sourceRef: `email-message:${message.id}`,
    type: 'email',
    title: message.subject || snapshot.thread.subject,
    createdAt: message.sentAt || new Date().toISOString(),
    content: message.body
  }));
}

function calendarEvidence(event: Awaited<ReturnType<typeof getNylasCalendarEvent>>): AssistantEvidenceSnapshot {
  return {
    sourceRef: `calendar-event:${event.id}`,
    type: 'calendar',
    title: event.title,
    createdAt: event.startAt || new Date().toISOString(),
    content: JSON.stringify({
      title: event.title,
      description: event.description,
      location: event.location,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      status: event.status,
      busy: event.busy,
      participants: event.participants
    })
  };
}

function assistantError(response: Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed', details: error.issues });
  if (error instanceof AssistantError || error instanceof AssistantOperationError || error instanceof NylasError
      || error instanceof KnowledgeError || error instanceof SpaceError
      || error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  return response.status(500).json({ error: 'The assistant request could not be completed.', code: 'ASSISTANT_REQUEST_FAILED' });
}

function assistantWorkerStatus(userId: string, spaceId: string) {
  const service = aiJobRunner.status();
  const counts = db.prepare(`SELECT state,COUNT(*) count FROM ai_jobs
    WHERE space_id=? AND requested_by=? AND kind IN ('assistant.email_summary','assistant.email_draft','assistant.knowledge_answer','assistant.work_product')
      AND state IN ('queued','processing') GROUP BY state`).all(spaceId, userId) as Array<{ state: string; count: number }>;
  const own = Object.fromEntries(counts.map((row) => [row.state, Number(row.count)]));
  return {
    running: service.running, concurrency: service.concurrency,
    active: Number(own.processing || 0), queued: Number(own.queued || 0)
  };
}

export const assistantRouter = Router();
assistantRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

assistantRouter.get('/overview', async (request, response) => {
  try {
    const { user, space } = identity(request);
    const credentialsConfigured = nylasConfigured(); const encryptionConfigured = nylasSecretEncryptionConfigured();
    const terraStatus = await getTerraStatus() as any;
    return response.json({
      configured: credentialsConfigured && encryptionConfigured,
      callbackUrl: nylasRedirectUri(),
      configurationError: !credentialsConfigured ? 'Nylas credentials are not configured.'
        : !encryptionConfigured ? 'Nylas credential encryption is not configured.' : null,
      connections: listNylasConnections(user.id, space.id),
      worker: assistantWorkerStatus(user.id, space.id),
      terra: {
        ready: terraStatus.ready === true,
        providerLabel: terraStatus.providerLabel || terraStatus.provider?.label || null,
        model: terraStatus.model || terraStatus.health?.model || null,
        error: terraStatus.error || (terraStatus.ready === true ? null : 'Terra is not ready.')
      }
    });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/threads', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = threadQuery.parse(request.query);
    const connection = ownedNylasConnection(user.id, space.id, input.connectionId);
    const threads = await listNylasThreads(connection.grantId, input.limit);
    recordAssistantAudit({
      spaceId: space.id, actorUserId: user.id, action: 'assistant.mailbox.threads_read',
      targetType: 'mailbox_connection', targetId: connection.id,
      detail: { count: threads.length, legacy: true }
    });
    return response.json(threads);
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/mailbox/threads', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = mailboxThreadQuery.parse(request.query);
    const connection = ownedNylasConnection(user.id, space.id, input.connectionId);
    const page = await listNylasThreadPage(connection.grantId, input);
    recordAssistantAudit({
      spaceId: space.id, actorUserId: user.id, action: 'assistant.mailbox.threads_read',
      targetType: 'mailbox_connection', targetId: connection.id,
      detail: {
        count: page.items.length,
        cursorUsed: Boolean(input.cursor),
        searchSha256: input.search ? crypto.createHash('sha256').update(input.search).digest('hex') : null,
        folder: input.folder || null,
        unread: input.unread ?? null,
        hasAttachment: input.hasAttachment ?? null
      }
    });
    return response.json({ items: page.items, threads: page.items, nextCursor: page.nextCursor });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/mailbox/folders', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = calendarConnectionQuery.parse(request.query);
    const connection = ownedNylasConnection(user.id, space.id, input.connectionId);
    const items = await listNylasFolders(connection.grantId);
    recordAssistantAudit({
      spaceId: space.id, actorUserId: user.id, action: 'assistant.mailbox.folders_read',
      targetType: 'mailbox_connection', targetId: connection.id, detail: { count: items.length }
    });
    return response.json({ items });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/mailbox/threads/:threadId', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = mailboxThreadDetailQuery.parse(request.query);
    const threadId = z.string().trim().min(1).max(300).parse(request.params.threadId);
    const connection = ownedNylasConnection(user.id, space.id, input.connectionId);
    const snapshot = await getNylasThreadSnapshot(connection.grantId, threadId);
    recordAssistantAudit({
      spaceId: space.id, actorUserId: user.id, action: 'assistant.mailbox.thread_read',
      targetType: 'mailbox_thread', targetId: threadId,
      detail: {
        connectionId: connection.id,
        messageCount: snapshot.messages.length,
        attachmentCount: snapshot.messages.reduce((sum, message) => sum + message.attachments.length, 0)
      }
    });
    return response.json(snapshot);
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/runs', (request, response) => {
  try {
    const { user, space } = identity(request); const input = runsQuery.parse(request.query);
    return response.json(listAssistantRuns(space.id, user.id, input.limit));
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/runs/:id', (request, response) => {
  try {
    const { user, space } = identity(request); const id = z.string().uuid().parse(request.params.id);
    const run = getAssistantRun(id, space.id, user.id);
    return run ? response.json(run) : response.status(404).json({ error: 'Assistant run not found.', code: 'ASSISTANT_RUN_NOT_FOUND' });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.post('/nylas/connect', (request, response) => {
  try {
    const { user, space } = identity(request); const input = providerInput.parse(request.body);
    if (!nylasConfigured() || !nylasSecretEncryptionConfigured()) {
      throw new AssistantError('Nylas is not configured.', 503, 'NYLAS_NOT_CONFIGURED');
    }
    const state = createNylasOAuthState(user.id, space.id, input.provider);
    recordAssistantAudit({
      spaceId: space.id, actorUserId: user.id, action: 'assistant.oauth.requested',
      targetType: 'nylas_connection', detail: { provider: input.provider }
    });
    return response.json({ authorizeUrl: createNylasAuthorizeUrl(input.provider, state) });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.delete('/nylas/connections/:id', async (request, response) => {
  try {
    const { user, space } = identity(request); const id = z.string().uuid().parse(request.params.id);
    const connection = ownedNylasConnection(user.id, space.id, id);
    await revokeNylasGrant(connection.grantId);
    markNylasConnectionRevoked(user.id, space.id, id);
    recordAssistantAudit({
      spaceId: space.id, actorUserId: user.id, action: 'assistant.oauth.revoked',
      targetType: 'nylas_connection', targetId: id, detail: { provider: connection.provider }
    });
    return response.status(204).end();
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.post('/runs/email-summary', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = emailSummaryInput.parse(request.body);
    const key = idempotencyKey(request);
    const fingerprint = assistantEmailRequestFingerprint({ kind: 'email_summary', ...input });
    const replay = replayAssistantIdempotency({
      spaceId: space.id, userId: user.id, kind: 'email_summary', idempotencyKey: key, requestFingerprint: fingerprint
    });
    if (replay) { queueCreated(replay, space.id); return response.status(202).json(statusPayload(replay)); }
    assertCanQueueAiAction(space.id);
    const connection = ownedNylasConnection(user.id, space.id, input.connectionId);
    const snapshot = await getNylasThreadSnapshot(connection.grantId, input.threadId);
    const created = createAssistantEmailRun({
      kind: 'email_summary', user, spaceId: space.id, connectionId: connection.id,
      snapshot, idempotencyKey: key
    });
    queueCreated(created, space.id);
    return response.status(202).json(statusPayload(created));
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.post('/runs/email-draft', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = emailDraftInput.parse(request.body);
    const key = idempotencyKey(request);
    const fingerprint = assistantEmailRequestFingerprint({ kind: 'email_draft', ...input });
    const replay = replayAssistantIdempotency({
      spaceId: space.id, userId: user.id, kind: 'email_draft', idempotencyKey: key, requestFingerprint: fingerprint
    });
    if (replay) { queueCreated(replay, space.id); return response.status(202).json(statusPayload(replay)); }
    assertCanQueueAiAction(space.id);
    const connection = ownedNylasConnection(user.id, space.id, input.connectionId);
    const snapshot = await getNylasThreadSnapshot(connection.grantId, input.threadId);
    const created = createAssistantEmailRun({
      kind: 'email_draft', user, spaceId: space.id, connectionId: connection.id, snapshot,
      instructions: input.instructions, tone: input.tone, idempotencyKey: key
    });
    queueCreated(created, space.id);
    return response.status(202).json(statusPayload(created));
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.post('/runs/knowledge-answer', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = knowledgeInput.parse(request.body);
    const key = idempotencyKey(request);
    const fingerprint = assistantKnowledgeRequestFingerprint(
      input.question,
      input.sourceRefs,
      input.knowledgeBaseIds
    );
    const replay = replayAssistantIdempotency({
      spaceId: space.id, userId: user.id, kind: 'knowledge_answer', idempotencyKey: key, requestFingerprint: fingerprint
    });
    if (replay) { queueCreated(replay, space.id); return response.status(202).json(statusPayload(replay)); }
    assertCanQueueAiAction(space.id);

    const sources: AssistantEvidenceSnapshot[] = input.sourceRefs.length
      ? assistantIntelligenceSnapshot(space.id, input.sourceRefs)
      : [];
    const knowledgeBases = resolveKnowledgeBaseRefs(space.id, input.knowledgeBaseIds, {
      viewerUserId: user.id,
      requireTerra: true,
      allowPrivate: true
    });
    if (knowledgeBases.length) {
      const requestId = crypto.randomUUID();
      const retrieved = await retrieveKnowledge({
        requestId,
        spaceId: space.id,
        knowledgeBases,
        query: input.question,
        topK: 20,
        graphDepth: 2
      });
      const knowledgeSources = retrieved.citations.map((citation): AssistantEvidenceSnapshot => ({
        sourceRef: citation.sourceRef,
        type: 'knowledge',
        title: citation.documentName,
        createdAt: new Date().toISOString(),
        content: citation.excerpt
      }));
      sources.push(...knowledgeSources);
      const contextText = knowledgeSources
        .map((source) => `[${source.sourceRef}] ${source.content}`)
        .join('\n\n');
      saveKnowledgeQuerySnapshot({
        requestId,
        spaceId: space.id,
        knowledgeBaseId: knowledgeBases[0].id,
        requestedBy: user.id,
        query: input.question,
        knowledgeBases,
        citations: retrieved.citations,
        contextText,
        metrics: retrieved.metrics
      });
      recordAssistantAudit({
        spaceId: space.id,
        actorUserId: user.id,
        action: 'assistant.knowledge.retrieved',
        targetType: 'knowledge_query',
        targetId: requestId,
        detail: {
          purpose: 'knowledge_answer',
          knowledgeBaseIds: knowledgeBases.map((item) => item.id),
          citationCount: retrieved.citations.length,
          querySha256: crypto.createHash('sha256').update(input.question).digest('hex')
        }
      });
    }

    const bounded = boundedEvidence(sources);
    const created = createAssistantKnowledgeRun({
      user,
      spaceId: space.id,
      question: input.question,
      sources: bounded,
      sourceRefs: bounded.map((source) => source.sourceRef),
      knowledgeBaseIds: knowledgeBases.map((item) => item.id),
      idempotencyKey: key,
      requestFingerprint: fingerprint
    });
    queueCreated(created, space.id);
    return response.status(202).json(statusPayload(created));
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.post('/runs/work-product', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = workProductInput.parse(request.body);
    const key = idempotencyKey(request);
    const threadConnectionId = input.threadId ? (input.threadConnectionId || input.connectionId) : undefined;
    const calendarConnectionId = input.calendarEventId ? (input.calendarConnectionId || input.connectionId) : undefined;
    const requestFingerprint = assistantWorkProductRequestFingerprint({
      ...input,
      connectionId: undefined,
      threadConnectionId,
      calendarConnectionId
    });
    const replay = replayAssistantIdempotency({
      spaceId: space.id, userId: user.id, kind: 'work_product', idempotencyKey: key, requestFingerprint
    });
    if (replay) { queueCreated(replay, space.id); return response.status(202).json(statusPayload(replay)); }
    assertCanQueueAiAction(space.id);

    const sources: AssistantEvidenceSnapshot[] = input.sourceRefs.length
      ? assistantIntelligenceSnapshot(space.id, input.sourceRefs) : [];
    const threadConnection = threadConnectionId
      ? ownedNylasConnection(user.id, space.id, threadConnectionId)
      : null;
    const calendarConnection = calendarConnectionId
      ? (threadConnection?.id === calendarConnectionId
        ? threadConnection
        : ownedNylasConnection(user.id, space.id, calendarConnectionId))
      : null;
    if (input.threadId && threadConnection) {
      const snapshot = await getNylasThreadSnapshot(threadConnection.grantId, input.threadId);
      sources.push(...emailEvidence(snapshot));
      recordAssistantAudit({
        spaceId: space.id, actorUserId: user.id, action: 'assistant.mailbox.thread_snapshotted',
        targetType: 'mailbox_thread', targetId: input.threadId,
        detail: {
          connectionId: threadConnection.id,
          loadedMessageCount: snapshot.loadedMessageCount,
          totalMessageCount: snapshot.totalMessageCount,
          messagesTruncated: snapshot.messagesTruncated
        }
      });
    }
    if (input.calendarEventId && calendarConnection) {
      const event = await getNylasCalendarEvent(calendarConnection.grantId, input.calendarEventId, input.calendarId!);
      sources.push(calendarEvidence(event));
      recordAssistantAudit({
        spaceId: space.id, actorUserId: user.id, action: 'assistant.calendar.event_snapshotted',
        targetType: 'calendar_event', targetId: event.id,
        detail: { connectionId: calendarConnection.id }
      });
    }

    const knowledgeBases = resolveKnowledgeBaseRefs(space.id, input.knowledgeBaseIds, {
      viewerUserId: user.id, requireTerra: true, allowPrivate: true
    });
    if (knowledgeBases.length) {
      const requestId = crypto.randomUUID();
      const retrieved = await retrieveKnowledge({
        requestId,
        spaceId: space.id,
        knowledgeBases,
        query: `${input.title}\n${input.objective}`,
        topK: 20,
        graphDepth: 2
      });
      const knowledgeSources = retrieved.citations.map((citation): AssistantEvidenceSnapshot => ({
        sourceRef: citation.sourceRef,
        type: 'knowledge',
        title: citation.documentName,
        createdAt: new Date().toISOString(),
        content: citation.excerpt
      }));
      sources.push(...knowledgeSources);
      const contextText = knowledgeSources.map((source) => `[${source.sourceRef}] ${source.content}`).join('\n\n');
      saveKnowledgeQuerySnapshot({
        requestId,
        spaceId: space.id,
        knowledgeBaseId: knowledgeBases[0].id,
        requestedBy: user.id,
        query: `${input.title}\n${input.objective}`,
        knowledgeBases,
        citations: retrieved.citations,
        contextText,
        metrics: retrieved.metrics
      });
      recordAssistantAudit({
        spaceId: space.id, actorUserId: user.id, action: 'assistant.knowledge.retrieved',
        targetType: 'knowledge_query', targetId: requestId,
        detail: {
          knowledgeBaseIds: knowledgeBases.map((item) => item.id),
          citationCount: retrieved.citations.length,
          querySha256: crypto.createHash('sha256').update(`${input.title}\n${input.objective}`).digest('hex')
        }
      });
    }

    const bounded = boundedEvidence(sources);
    const created = createAssistantWorkProductRun({
      user,
      spaceId: space.id,
      documentType: input.documentType,
      title: input.title,
      objective: input.objective,
      sources: bounded,
      sourceRefs: bounded.map((source) => source.sourceRef),
      knowledgeBaseIds: knowledgeBases.map((item) => item.id),
      connectionId: threadConnection && calendarConnection
        ? (threadConnection.id === calendarConnection.id ? threadConnection.id : null)
        : threadConnection?.id || calendarConnection?.id || null,
      subjectRef: input.threadId || input.calendarEventId || null,
      idempotencyKey: key,
      requestFingerprint
    });
    queueCreated(created, space.id);
    return response.status(202).json(statusPayload(created));
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.patch('/runs/:id/draft', (request, response) => {
  try {
    const { user, space } = identity(request); const id = z.string().uuid().parse(request.params.id);
    return response.json(updateAssistantDraft(id, space.id, user.id, draftInput.parse(request.body)));
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/actions', (request, response) => {
  try {
    const { user, space } = identity(request); const input = actionsQuery.parse(request.query);
    return response.json({ items: listAssistantActions(space.id, user.id, input) });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.post('/actions', (request, response) => {
  try {
    const { user, space } = identity(request); const input = actionCreateInput.parse(request.body);
    const action = createAssistantAction({ spaceId: space.id, userId: user.id, ...input });
    publishAssistantChanged(space.id);
    return response.status(201).json({ action });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.patch('/actions', (request, response) => {
  try {
    const { user, space } = identity(request); const input = actionUpdateInput.parse(request.body);
    const action = updateAssistantAction({ spaceId: space.id, userId: user.id, ...input });
    publishAssistantChanged(space.id);
    return response.json({ action });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.post('/actions/from-run', (request, response) => {
  try {
    const { user, space } = identity(request); const input = actionPromotionInput.parse(request.body);
    const result = promoteAssistantAction({ spaceId: space.id, userId: user.id, ...input });
    publishAssistantChanged(space.id);
    return response.status(result.created ? 201 : 200).json(result);
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/actions/:id/reminders', (request, response) => {
  try {
    const { user, space } = identity(request); const id = z.string().uuid().parse(request.params.id);
    return response.json({ items: listAssistantReminders(id, space.id, user.id) });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.post('/actions/:id/reminders', (request, response) => {
  try {
    const { user, space } = identity(request); const id = z.string().uuid().parse(request.params.id);
    const input = reminderCreateInput.parse(request.body);
    const reminder = createAssistantReminder({ actionId: id, spaceId: space.id, userId: user.id, ...input });
    publishAssistantChanged(space.id);
    return response.status(201).json({ reminder });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.patch('/actions/:id/reminders/:reminderId', (request, response) => {
  try {
    const { user, space } = identity(request);
    const actionId = z.string().uuid().parse(request.params.id);
    const id = z.string().uuid().parse(request.params.reminderId);
    const input = reminderUpdateInput.parse(request.body);
    const reminder = updateAssistantReminder({ id, actionId, spaceId: space.id, userId: user.id, ...input });
    publishAssistantChanged(space.id);
    return response.json({ reminder });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/calendar/calendars', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = calendarConnectionQuery.parse(request.query);
    const connection = ownedNylasConnection(user.id, space.id, input.connectionId);
    const items = await listNylasCalendars(connection.grantId);
    recordAssistantAudit({
      spaceId: space.id, actorUserId: user.id, action: 'assistant.calendar.calendars_read',
      targetType: 'mailbox_connection', targetId: connection.id, detail: { count: items.length }
    });
    return response.json({ items });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/calendar/events', async (request, response) => {
  try {
    const { user, space } = identity(request); const input = calendarEventsQuery.parse(request.query);
    const connection = ownedNylasConnection(user.id, space.id, input.connectionId);
    const page = await listNylasCalendarEvents(connection.grantId, {
      calendarId: input.calendarId,
      start: new Date(input.start),
      end: new Date(input.end),
      limit: input.limit,
      cursor: input.cursor
    });
    recordAssistantAudit({
      spaceId: space.id, actorUserId: user.id, action: 'assistant.calendar.events_read',
      targetType: 'calendar', targetId: input.calendarId,
      detail: {
        connectionId: connection.id,
        count: page.items.length,
        start: input.start,
        end: input.end,
        cursorUsed: Boolean(input.cursor)
      }
    });
    return response.json({ items: page.items, nextCursor: page.nextCursor });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.get('/audit', (request, response) => {
  try {
    const { user, space } = identity(request); const input = auditQuery.parse(request.query);
    return response.json({ items: listAssistantAudit(space.id, user.id, input.limit) });
  } catch (error) { return assistantError(response, error); }
});

function callbackRedirect(response: Response, status: 'connected' | 'cancelled' | 'error', code?: string) {
  const target = new URL('/assistant', `${config.publicUrl.replace(/\/+$/u, '')}/`);
  target.searchParams.set('nylas', status);
  if (code) target.searchParams.set('code', code);
  return response.redirect(302, target.toString());
}

export async function nylasCallback(request: Request, response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  let authorization: ReturnType<typeof consumeNylasOAuthState> | null = null;
  try {
    const query = callbackInput.parse(request.query);
    authorization = consumeNylasOAuthState(query.state);
    if (!getSpaceForUser(authorization.userId, authorization.spaceId)) {
      throw new AssistantError('The Nylas connection request no longer has access to this space.', 403, 'SPACE_ACCESS_DENIED');
    }
    if (query.error || !query.code) {
      recordAssistantAudit({
        spaceId: authorization.spaceId, actorUserId: authorization.userId, action: 'assistant.oauth.cancelled',
        targetType: 'nylas_connection', detail: { provider: authorization.provider }
      });
      return callbackRedirect(response, 'cancelled');
    }
    const grant = await exchangeNylasCode(query.code, authorization.provider);
    const connection = saveNylasConnection({
      spaceId: authorization.spaceId, userId: authorization.userId, provider: authorization.provider,
      grantId: grant.grantId, email: grant.email, scopes: grant.scopes
    });
    recordAssistantAudit({
      spaceId: authorization.spaceId, actorUserId: authorization.userId, action: 'assistant.oauth.connected',
      targetType: 'nylas_connection', targetId: connection.id,
      detail: { provider: authorization.provider, scopeCount: grant.scopes.length }
    });
    return callbackRedirect(response, 'connected');
  } catch (error) {
    if (authorization) {
      recordAssistantAudit({
        spaceId: authorization.spaceId, actorUserId: authorization.userId, action: 'assistant.oauth.failed',
        targetType: 'nylas_connection', detail: {
          provider: authorization.provider,
          code: error instanceof AssistantError || error instanceof NylasError || error instanceof SpaceError
            ? error.code : 'CALLBACK_FAILED'
        }
      });
    }
    const code = error instanceof AssistantError || error instanceof NylasError || error instanceof SpaceError
      ? error.code.toLocaleLowerCase('en-US') : 'callback_failed';
    return callbackRedirect(response, 'error', code);
  }
}
