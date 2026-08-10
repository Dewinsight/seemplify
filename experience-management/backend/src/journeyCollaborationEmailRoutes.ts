import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { config } from './config.js';
import { assertJourneyCapability, JourneyCollaborationError } from './journeyCollaboration.js';
import { JourneyCollaborationEmailError } from './journeyCollaborationEmailDomain.js';
import { journeyCollaborationEmailRepository } from './journeyCollaborationEmailRepository.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { assertSubscriptionFeature, SubscriptionEntitlementError } from './subscriptionEntitlements.js';

/**
 * Preference and status surface for runtime-56 Journey collaboration email.
 *
 * The tenant is derived from the session and the active space on every request;
 * no route accepts a space id, a user id or an email address from the caller.
 * That is what makes "a member manages only its own preference" enforceable: the
 * only principal these routes can ever write is the one that authenticated, so
 * there is no shape in which an administrator could enable mail for somebody
 * else, and no shape in which a caller could probe another tenant.
 */

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  const space = resolveRequestSpace(request, user.id);
  assertSubscriptionFeature(space.id, 'journeyCollaboration');
  // Membership and the space kill switch are both proven by the shared Journey
  // capability check rather than restated here.
  assertJourneyCapability(space.id, user.id, 'journeys.read', undefined, { allowReadOnly: true });
  return { user, space };
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({
    error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues
  });
  if (error instanceof JourneyCollaborationEmailError || error instanceof JourneyCollaborationError
    || error instanceof SpaceError || error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error('Journey collaboration email request failed:',
    error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'The notification email request could not be completed.',
    code: 'JOURNEY_COLLABORATION_EMAIL_INTERNAL_ERROR' });
}

function preferencePayload(spaceId: string, userId: string) {
  const preference = journeyCollaborationEmailRepository.getPreference(spaceId, userId);
  return {
    emailEnabled: preference.emailEnabled,
    revision: preference.revision,
    updatedAt: preference.updatedAt,
    decidedAt: preference.decidedAt,
    // Advertised so the panel can say "you are opted in but nothing is being
    // sent" instead of silently looking broken on a deployment with the worker
    // switched off.
    deliveryEnabled: config.journeyCollaborationEmailWorkerEnabled,
    available: journeyCollaborationEmailRepository.available()
  };
}

export const journeyCollaborationEmailRouter = express.Router();
journeyCollaborationEmailRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store'); next();
});

journeyCollaborationEmailRouter.get('/preference', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ preference: preferencePayload(space.id, user.id) });
  } catch (error) { return sendError(response, error); }
});

journeyCollaborationEmailRouter.put('/preference', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ enabled: z.boolean(), expectedRevision: z.number().int().nonnegative() })
      .strict().parse(request.body || {});
    journeyCollaborationEmailRepository.setPreference({
      spaceId: space.id, userId: user.id, actorUserId: user.id,
      enabled: input.enabled, expectedRevision: input.expectedRevision
    });
    return response.json({ preference: preferencePayload(space.id, user.id) });
  } catch (error) { return sendError(response, error); }
});

/** Content-free delivery counters for the caller's own tenant. There is no
 * per-recipient breakdown and no message detail: the panel needs to show that
 * delivery is healthy, not who was written to about what. */
journeyCollaborationEmailRouter.get('/status', (request, response) => {
  try {
    const { space } = context(request);
    return response.json({
      deliveryEnabled: config.journeyCollaborationEmailWorkerEnabled,
      available: journeyCollaborationEmailRepository.available(),
      counts: journeyCollaborationEmailRepository.status(space.id)
    });
  } catch (error) { return sendError(response, error); }
});
