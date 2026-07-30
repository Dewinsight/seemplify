import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { aiJobRunner } from './aiJobs.js';
import {
  AssistantError, assistantEmailRequestFingerprint, assistantKnowledgeRequestFingerprint,
  consumeNylasOAuthState, createAssistantEmailRun, createAssistantKnowledgeRun,
  createNylasOAuthState, getAssistantRun, listAssistantRuns, listNylasConnections,
  markNylasConnectionRevoked, ownedNylasConnection, publishAssistantChanged, replayAssistantIdempotency,
  saveNylasConnection, updateAssistantDraft
} from './assistant.js';
import { currentSessionUser } from './auth.js';
import { config } from './config.js';
import { db } from './database.js';
import {
  createNylasAuthorizeUrl, exchangeNylasCode, getNylasThreadSnapshot, listNylasThreads,
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
const runsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).strict();
const emailSummaryInput = z.object({ connectionId: z.string().uuid(), threadId: z.string().trim().min(1).max(300) }).strict();
const emailDraftInput = emailSummaryInput.extend({
  instructions: z.string().trim().max(2_000).optional(), tone: z.string().trim().min(1).max(80).optional()
}).strict();
const knowledgeInput = z.object({
  question: z.string().trim().min(3).max(4_000),
  sourceRefs: z.array(z.string().trim().min(1).max(300)).min(1).max(12)
}).strict();
const draftInput = z.object({
  subject: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(12_000),
  revision: z.number().int().min(1)
}).strict();
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

function assistantError(response: Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed', details: error.issues });
  if (error instanceof AssistantError || error instanceof NylasError || error instanceof SpaceError
      || error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  return response.status(500).json({ error: 'The assistant request could not be completed.', code: 'ASSISTANT_REQUEST_FAILED' });
}

function assistantWorkerStatus(userId: string, spaceId: string) {
  const service = aiJobRunner.status();
  const counts = db.prepare(`SELECT state,COUNT(*) count FROM ai_jobs
    WHERE space_id=? AND requested_by=? AND kind IN ('assistant.email_summary','assistant.email_draft','assistant.knowledge_answer')
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
    return response.json(await listNylasThreads(connection.grantId, input.limit));
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
    return response.json({ authorizeUrl: createNylasAuthorizeUrl(input.provider, state) });
  } catch (error) { return assistantError(response, error); }
});

assistantRouter.delete('/nylas/connections/:id', async (request, response) => {
  try {
    const { user, space } = identity(request); const id = z.string().uuid().parse(request.params.id);
    const connection = ownedNylasConnection(user.id, space.id, id);
    await revokeNylasGrant(connection.grantId);
    markNylasConnectionRevoked(user.id, space.id, id);
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

assistantRouter.post('/runs/knowledge-answer', (request, response) => {
  try {
    const { user, space } = identity(request); const input = knowledgeInput.parse(request.body);
    const key = idempotencyKey(request);
    const fingerprint = assistantKnowledgeRequestFingerprint(input.question, input.sourceRefs);
    const replay = replayAssistantIdempotency({
      spaceId: space.id, userId: user.id, kind: 'knowledge_answer', idempotencyKey: key, requestFingerprint: fingerprint
    });
    if (replay) { queueCreated(replay, space.id); return response.status(202).json(statusPayload(replay)); }
    assertCanQueueAiAction(space.id);
    const created = createAssistantKnowledgeRun({
      user, spaceId: space.id, question: input.question, sourceRefs: input.sourceRefs,
      idempotencyKey: key
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

function callbackRedirect(response: Response, status: 'connected' | 'cancelled' | 'error', code?: string) {
  const target = new URL('/assistant', `${config.publicUrl.replace(/\/+$/u, '')}/`);
  target.searchParams.set('nylas', status);
  if (code) target.searchParams.set('code', code);
  return response.redirect(302, target.toString());
}

export async function nylasCallback(request: Request, response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const query = callbackInput.parse(request.query);
    const authorization = consumeNylasOAuthState(query.state);
    if (!getSpaceForUser(authorization.userId, authorization.spaceId)) {
      throw new AssistantError('The Nylas connection request no longer has access to this space.', 403, 'SPACE_ACCESS_DENIED');
    }
    if (query.error || !query.code) return callbackRedirect(response, 'cancelled');
    const grant = await exchangeNylasCode(query.code, authorization.provider);
    saveNylasConnection({
      spaceId: authorization.spaceId, userId: authorization.userId, provider: authorization.provider,
      grantId: grant.grantId, email: grant.email, scopes: grant.scopes
    });
    return callbackRedirect(response, 'connected');
  } catch (error) {
    const code = error instanceof AssistantError || error instanceof NylasError || error instanceof SpaceError
      ? error.code.toLocaleLowerCase('en-US') : 'callback_failed';
    return callbackRedirect(response, 'error', code);
  }
}
