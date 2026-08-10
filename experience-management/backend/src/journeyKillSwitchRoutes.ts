import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import {
  JourneyKillSwitchRepositoryError, KILL_SWITCH_LEVEL_VALUES, listKillSwitchAudit, listKillSwitchPauses,
  listKillSwitches, readPlatformKillSwitch, resolveKillSwitch, setKillSwitch
} from './journeyKillSwitchRepository.js';
import { journeyKillSwitchAdapters, journeyKillSwitchReasonCodes } from './journeyKillSwitchDomain.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const token = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const mutation = z.object({ state: z.enum(['enabled', 'disabled']),
  reasonCode: z.enum(journeyKillSwitchReasonCodes), expectedRevision: z.number().int().min(0) }).strict();

function user(request: express.Request) {
  const sessionUser = currentSessionUser(request);
  if (!sessionUser) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return sessionUser;
}

function tenantContext(request: express.Request) {
  const sessionUser = user(request);
  return { user: sessionUser, space: resolveRequestSpace(request, sessionUser.id) };
}

function idempotencyKey(request: express.Request) {
  return z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u)
    .parse(String(request.header('Idempotency-Key') || '').trim());
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed.',
    code: 'VALIDATION_FAILED', details: error.issues });
  if (error instanceof JourneyKillSwitchRepositoryError || error instanceof SpaceError
      || error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code,
      details: 'details' in error ? error.details : {} });
  }
  console.error('Journey kill-switch request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'Journey kill-switch request failed.',
    code: 'JOURNEY_KILL_SWITCH_INTERNAL_ERROR' });
}

/** Mounted only after runtime-40 registration; all tenant identity is request-derived. */
export const journeyKillSwitchRouter = express.Router();
journeyKillSwitchRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

journeyKillSwitchRouter.get('/', (request, response) => { try {
  const { user: actor, space } = tenantContext(request);
  return response.json(listKillSwitches({ actorUserId: actor.id, spaceId: space.id }));
} catch (error) { return sendError(response, error); } });

journeyKillSwitchRouter.get('/effective', (request, response) => { try {
  const { user: actor, space } = tenantContext(request);
  const query = z.object({ workflowId: token, adapter: z.enum(journeyKillSwitchAdapters),
    profileRefSha256: sha256 }).strict().parse(request.query);
  return response.json(resolveKillSwitch({ actorUserId: actor.id, spaceId: space.id, ...query }));
} catch (error) { return sendError(response, error); } });

journeyKillSwitchRouter.put('/space', (request, response) => { try {
  const { user: actor, space } = tenantContext(request);
  const body = mutation.parse(request.body ?? {});
  return response.json(setKillSwitch({ actorUserId: actor.id, level: 'space', spaceId: space.id,
    scopeKey: space.id, idempotencyKey: idempotencyKey(request), ...body }));
} catch (error) { return sendError(response, error); } });

journeyKillSwitchRouter.put('/scopes/:level/:scopeKey', (request, response) => { try {
  const { user: actor, space } = tenantContext(request);
  const level = z.enum(KILL_SWITCH_LEVEL_VALUES).exclude(['platform', 'space']).parse(request.params.level);
  const scopeKey = level === 'profile' ? sha256.parse(request.params.scopeKey) : token.parse(request.params.scopeKey);
  const body = mutation.parse(request.body ?? {});
  return response.json(setKillSwitch({ actorUserId: actor.id, level, spaceId: space.id, scopeKey,
    idempotencyKey: idempotencyKey(request), ...body }));
} catch (error) { return sendError(response, error); } });

journeyKillSwitchRouter.get('/audit', (request, response) => { try {
  const { user: actor, space } = tenantContext(request);
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(request.query);
  return response.json({ events: listKillSwitchAudit({ actorUserId: actor.id, spaceId: space.id, ...query }) });
} catch (error) { return sendError(response, error); } });

journeyKillSwitchRouter.get('/pauses', (request, response) => { try {
  const { user: actor, space } = tenantContext(request);
  const query = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).strict().parse(request.query);
  return response.json({ pauses: listKillSwitchPauses({ actorUserId: actor.id, spaceId: space.id, ...query }) });
} catch (error) { return sendError(response, error); } });

journeyKillSwitchRouter.get('/platform', (request, response) => { try {
  return response.json(readPlatformKillSwitch({ actorUserId: user(request).id }));
} catch (error) { return sendError(response, error); } });

journeyKillSwitchRouter.put('/platform', (request, response) => { try {
  const actor = user(request);
  const body = mutation.parse(request.body ?? {});
  return response.json(setKillSwitch({ actorUserId: actor.id, level: 'platform', spaceId: null,
    scopeKey: 'platform', idempotencyKey: idempotencyKey(request), ...body }));
} catch (error) { return sendError(response, error); } });
