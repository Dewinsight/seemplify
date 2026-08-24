import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import {
  createJourneyEventSchema,
  createJourneyEventSchemaVersion,
  createJourneyEventSource,
  deprecateJourneyEventSchemaVersion,
  getJourneyEventSchema,
  getJourneyEventSource,
  isJourneyEventControlError,
  issueStoredJourneyEventCredential,
  journeyEventSourceQuota,
  JourneyEventControlRepositoryError,
  listJourneyEventControlAudit,
  listJourneyEventCredentials,
  listJourneyEventSchemas,
  listJourneyEventSources,
  publishJourneyEventSchemaVersion,
  revokeStoredJourneyEventCredential,
  rotateStoredJourneyEventCredential,
  updateJourneyEventSource,
  validateJourneyControlIdempotencyKey
} from './journeyEventControlPlaneRepository.js';
import { resolveRequestSpace, spaceRoleOrIdpPermission, SpaceError, type SpaceContext } from './spaces.js';
import { assertSubscriptionFeature, SubscriptionEntitlementError } from './subscriptionEntitlements.js';
import {
  JourneyEventIngestionError,
  journeyEventIngestionUsage,
  listJourneyEventDeadLetters,
  listJourneyEventDebugEvents,
  replayJourneyEventDeadLetter
} from './journeyEventIngestionRepository.js';

export const journeyEventControlPlaneRouter = express.Router();

const environments = ['development', 'staging', 'production'] as const;
const sourceStatuses = ['active', 'paused', 'revoked'] as const;
const validationModes = ['observe', 'warn', 'enforce'] as const;
const credentialKinds = ['public_write', 'server_secret'] as const;
const propertyTypes = ['string', 'number', 'boolean', 'object', 'array'] as const;
const dataClasses = ['operational', 'personal', 'sensitive', 'prohibited_content'] as const;
const ingestOutcomes = ['accepted', 'quarantined', 'duplicate', 'content_conflict', 'rejected',
  'rate_limited', 'over_quota', 'consent_denied'] as const;
const deadLetterStates = ['pending', 'replay_scheduled', 'resolved', 'terminal'] as const;

const sourceFields = {
  name: z.string().trim().min(1).max(160),
  validationMode: z.enum(validationModes).optional(),
  allowedOrigins: z.array(z.string().min(1).max(2_048)).max(100).optional(),
  allowedBundleIds: z.array(z.string().min(1).max(200)).max(100).optional(),
  eventsPerMinute: z.number().int().min(1).max(10_000_000).optional(),
  bytesPerMinute: z.number().int().min(1).max(10_000_000_000).optional()
};

const createSourceBody = z.object({
  ...sourceFields,
  name: sourceFields.name,
  environment: z.enum(environments)
}).strict();

const updateSourceBody = z.object({
  expectedRevision: z.number().int().min(1),
  name: sourceFields.name.optional(),
  status: z.enum(sourceStatuses).optional(),
  validationMode: sourceFields.validationMode,
  allowedOrigins: sourceFields.allowedOrigins,
  allowedBundleIds: sourceFields.allowedBundleIds,
  eventsPerMinute: sourceFields.eventsPerMinute,
  bytesPerMinute: sourceFields.bytesPerMinute
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRevision'), {
  message: 'At least one source field must be changed.'
});

const propertyDefinition = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(propertyTypes),
  required: z.boolean(),
  dataClass: z.enum(dataClasses),
  description: z.string().max(1_000),
  maximumLength: z.number().int().min(1).max(16_384).nullable().optional(),
  maximumItems: z.number().int().min(1).max(100).nullable().optional(),
  enumValues: z.array(z.union([z.string().max(1_000), z.number(), z.boolean()])).max(100).optional()
}).strict();

function context(request: Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  const space = resolveRequestSpace(request, user.id);
  assertSubscriptionFeature(space.id, 'journeyConnected');
  return { user, space };
}

function requireEditor(space: SpaceContext) {
  if (!spaceRoleOrIdpPermission(space, 'journeys.edit')) {
    throw new JourneyEventControlRepositoryError(
      'Space owner or admin access is required to change connected-journey sources.',
      403,
      'JOURNEY_EVENT_CONTROL_FORBIDDEN'
    );
  }
}

function idempotencyKey(request: Request) {
  return validateJourneyControlIdempotencyKey(request.get('Idempotency-Key'));
}

function sendError(response: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues });
  }
  if (isJourneyEventControlError(error)) {
    if (error instanceof JourneyEventControlRepositoryError) {
      return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
    }
    return response.status(400).json({ error: error.message, code: error.code });
  }
  if (error instanceof SpaceError) return response.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  if (error instanceof JourneyEventIngestionError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  if (isDatabaseConstraintError(error)) {
    return response.status(409).json({
      error: 'The requested change conflicts with current connected-journey state.',
      code: 'JOURNEY_EVENT_CONTROL_CONFLICT'
    });
  }
  console.error('Journey event control-plane request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'The connected-journey request could not be completed.', code: 'JOURNEY_EVENT_CONTROL_INTERNAL_ERROR' });
}

function route(handler: (request: Request, response: Response) => unknown) {
  return (request: Request, response: Response) => {
    try { return handler(request, response); }
    catch (error) { return sendError(response, error); }
  };
}

journeyEventControlPlaneRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

journeyEventControlPlaneRouter.get('/sources', route((request, response) => {
  const { space } = context(request);
  const query = z.object({ environment: z.enum(environments).optional() }).strict().parse(request.query);
  return response.json({
    sources: listJourneyEventSources(space.id, query.environment),
    quota: journeyEventSourceQuota(space.id)
  });
}));

journeyEventControlPlaneRouter.post('/sources', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  const body = createSourceBody.parse(request.body || {});
  const result = createJourneyEventSource({
    ...body,
    spaceId: space.id,
    actorUserId: user.id,
    idempotencyKey: idempotencyKey(request)
  });
  return response.status(result.replayed ? 200 : 201).json(result);
}));

journeyEventControlPlaneRouter.get('/sources/:sourceId', route((request, response) => {
  const { space } = context(request);
  return response.json({ source: getJourneyEventSource(space.id, String(request.params.sourceId)) });
}));

journeyEventControlPlaneRouter.patch('/sources/:sourceId', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  const body = updateSourceBody.parse(request.body || {});
  const source = updateJourneyEventSource({
    ...body,
    spaceId: space.id,
    actorUserId: user.id,
    sourceId: String(request.params.sourceId)
  });
  return response.json({ source });
}));

journeyEventControlPlaneRouter.get('/sources/:sourceId/credentials', route((request, response) => {
  const { space } = context(request);
  return response.json({
    credentials: listJourneyEventCredentials(space.id, String(request.params.sourceId))
  });
}));

journeyEventControlPlaneRouter.post('/sources/:sourceId/credentials', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  const body = z.object({ kind: z.enum(credentialKinds) }).strict().parse(request.body || {});
  const result = issueStoredJourneyEventCredential({
    spaceId: space.id,
    actorUserId: user.id,
    sourceId: String(request.params.sourceId),
    kind: body.kind,
    idempotencyKey: idempotencyKey(request)
  });
  return response.status(result.replayed ? 200 : 201).json(result);
}));

journeyEventControlPlaneRouter.post('/credentials/:credentialId/rotate', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  const body = z.object({ overlapSeconds: z.number().int().min(0).max(604_800) }).strict().parse(request.body || {});
  const result = rotateStoredJourneyEventCredential({
    spaceId: space.id,
    actorUserId: user.id,
    credentialId: String(request.params.credentialId),
    overlapSeconds: body.overlapSeconds,
    idempotencyKey: idempotencyKey(request)
  });
  return response.status(result.replayed ? 200 : 201).json(result);
}));

journeyEventControlPlaneRouter.post('/credentials/:credentialId/revoke', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  z.object({}).strict().parse(request.body || {});
  return response.json(revokeStoredJourneyEventCredential({
    spaceId: space.id,
    actorUserId: user.id,
    credentialId: String(request.params.credentialId)
  }));
}));

journeyEventControlPlaneRouter.get('/sources/:sourceId/schemas', route((request, response) => {
  const { space } = context(request);
  return response.json({ schemas: listJourneyEventSchemas(space.id, String(request.params.sourceId)) });
}));

journeyEventControlPlaneRouter.post('/sources/:sourceId/schemas', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  const body = z.object({ eventName: z.string().min(1).max(128) }).strict().parse(request.body || {});
  const result = createJourneyEventSchema({
    spaceId: space.id,
    actorUserId: user.id,
    sourceId: String(request.params.sourceId),
    eventName: body.eventName,
    idempotencyKey: idempotencyKey(request)
  });
  return response.status(result.replayed ? 200 : 201).json(result);
}));

journeyEventControlPlaneRouter.get('/schemas/:schemaId', route((request, response) => {
  const { space } = context(request);
  return response.json({ schema: getJourneyEventSchema(space.id, String(request.params.schemaId)) });
}));

journeyEventControlPlaneRouter.post('/schemas/:schemaId/versions', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  const body = z.object({
    version: z.string().regex(/^\d+\.\d+$/u).max(41),
    properties: z.array(propertyDefinition).max(100)
  }).strict().parse(request.body || {});
  const result = createJourneyEventSchemaVersion({
    spaceId: space.id,
    actorUserId: user.id,
    schemaId: String(request.params.schemaId),
    version: body.version,
    properties: body.properties,
    idempotencyKey: idempotencyKey(request)
  });
  return response.status(result.replayed ? 200 : 201).json(result);
}));

journeyEventControlPlaneRouter.post('/schema-versions/:versionId/publish', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  z.object({}).strict().parse(request.body || {});
  return response.json(publishJourneyEventSchemaVersion({
    spaceId: space.id,
    actorUserId: user.id,
    versionId: String(request.params.versionId)
  }));
}));

journeyEventControlPlaneRouter.post('/schema-versions/:versionId/deprecate', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  z.object({}).strict().parse(request.body || {});
  return response.json(deprecateJourneyEventSchemaVersion({
    spaceId: space.id,
    actorUserId: user.id,
    versionId: String(request.params.versionId)
  }));
}));

journeyEventControlPlaneRouter.get('/sources/:sourceId/audit', route((request, response) => {
  const { space } = context(request);
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.string().datetime().optional(),
    cursor: z.string().min(1).max(500).optional()
  }).strict().parse(request.query);
  return response.json(listJourneyEventControlAudit({
    spaceId: space.id,
    sourceId: String(request.params.sourceId),
    limit: query.limit,
    before: query.before,
    cursor: query.cursor
  }));
}));

journeyEventControlPlaneRouter.get('/sources/:sourceId/debug-events', route((request, response) => {
  const { user, space } = context(request);
  const query = z.object({
    cursor: z.string().max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    outcome: z.enum(ingestOutcomes).optional()
  }).strict().parse(request.query);
  return response.json(listJourneyEventDebugEvents({
    spaceId: space.id, sourceId: String(request.params.sourceId), actorUserId: user.id, ...query
  }));
}));

journeyEventControlPlaneRouter.get('/sources/:sourceId/dead-letters', route((request, response) => {
  const { user, space } = context(request);
  const query = z.object({
    cursor: z.string().max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    state: z.enum(deadLetterStates).optional()
  }).strict().parse(request.query);
  return response.json(listJourneyEventDeadLetters({
    spaceId: space.id, sourceId: String(request.params.sourceId), actorUserId: user.id, ...query
  }));
}));

journeyEventControlPlaneRouter.get('/sources/:sourceId/ingestion-usage', route((request, response) => {
  const { space } = context(request);
  // The source lookup prevents a caller from using another tenant's identifier
  // as a usage oracle even though usage itself is space-wide.
  getJourneyEventSource(space.id, String(request.params.sourceId));
  return response.json(journeyEventIngestionUsage(space.id));
}));

journeyEventControlPlaneRouter.post('/dead-letters/:deadLetterId/replay', route((request, response) => {
  const { user, space } = context(request);
  requireEditor(space);
  z.object({ confirmation: z.literal(true) }).strict().parse(request.body || {});
  return response.json(replayJourneyEventDeadLetter({
    spaceId: space.id, deadLetterId: String(request.params.deadLetterId), actorUserId: user.id
  }));
}));
