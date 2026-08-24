import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import {
  isJourneyMetricAnalyticsExportFormat
} from './journeyMetricAnalyticsExport.js';
import { authenticateJourneyEventCredential, JourneyEventIngestionError } from './journeyEventIngestionRepository.js';
import { JourneyMetricConfigurationError } from './journeyMetricCalculations.js';
import { JourneyOperationalMeasureError } from './journeyOperationalMeasures.js';
import {
  buildMeteredJourneyMetricAnalyticsExport,
  createJourneyMetricBinding, createJourneyMetricDefinition, createJourneyMetricDefinitionVersion,
  createJourneyMetricSegment, getJourneyMetricDefinition, getJourneyMetricObservation,
  importJourneyOperationalObservation, JourneyMetricsError, listJourneyMetricAudit, listJourneyMetricBindings,
  listJourneyMetricDefinitions, listJourneyMetricNativeSources, listJourneyMetricObservations,
  listJourneyMetricRebuilds, listJourneyMetricSegments,
  queueJourneyMetricRebuild, updateJourneyMetricBinding, updateJourneyMetricSegment,
  type JourneyMetricVersionInput
} from './journeyMetrics.js';
import { JourneyNativeMetricSourceError } from './journeyNativeMetricSources.js';
import {
  JourneyActualPathAnalyticsError, createJourneyActualPathSnapshot, listJourneyActualPathSnapshots,
  materializeJourneyActualPathRollup, readJourneyActualPathAnalytics, readJourneyActualPathSnapshot,
  readLatestJourneyActualPathRollup, readLatestJourneyActualPathSnapshot
} from './journeyActualPathAnalytics.js';
import { JourneyPathAnalyticsConfigurationError } from './journeyPathAnalytics.js';
import { resolveRequestSpace, spaceRoleOrIdpPermission, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';
import {
  createJourneyMetricAlertDefinition, createJourneyMetricAlertDefinitionVersion,
  evaluateJourneyMetricAlerts, journeyMetricAlertNotificationPreference, listJourneyMetricAlertDefinitions,
  listJourneyMetricAlertHistory, listJourneyMetricAlertNotifications,
  listJourneyMetricAlertRuns, listJourneyMetricAlerts, transitionJourneyMetricAlert,
  updateJourneyMetricAlertDefinition, updateJourneyMetricAlertNotification,
  updateJourneyMetricAlertNotificationPreference, type JourneyMetricAlertVersionInput
} from './journeyMetricAlerts.js';

export const journeyMetricRouter = express.Router();
export const journeyMetricImportRouter = express.Router();

journeyMetricRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store'); next();
});
journeyMetricImportRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); next();
});
journeyMetricImportRouter.use('/metric-imports', (request, response, next) => {
  if (request.method !== 'POST' || request.is('application/json')) return next();
  return response.status(415).json({ error: 'Metric imports require an application/json request body.',
    code: 'JOURNEY_METRIC_CONTENT_TYPE_UNSUPPORTED' });
});
journeyMetricImportRouter.use('/metric-imports', express.json({ limit: '256kb', strict: true, type: 'application/json' }));

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}
function editor(request: express.Request) {
  const resolved = context(request);
  if (!spaceRoleOrIdpPermission(resolved.space, 'journeys.edit')) throw new JourneyMetricsError('You do not have permission to manage journey metrics.', 403,
    'JOURNEY_METRICS_FORBIDDEN');
  return resolved;
}
function key(request: express.Request, bodyKey?: string) {
  const value = String(request.get('Idempotency-Key') || bodyKey || '').trim();
  if (!value || value.length > 200) throw new JourneyMetricsError('A valid Idempotency-Key header is required.', 400,
    'JOURNEY_METRIC_IDEMPOTENCY_KEY_REQUIRED');
  return value;
}
/** Matches the journey map export header contract: trimmed, bounded, and free
 * of control characters that would corrupt the usage ledger key. */
function safeIdempotencyKey(value: string) {
  if (value.length < 1 || value.length > 200 || value.trim() !== value) return false;
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 31 && code !== 127;
  });
}
function bearer(request: express.Request) {
  const match = /^Bearer ([^\s]{1,512})$/u.exec(String(request.get('Authorization') || ''));
  if (!match) throw new JourneyMetricsError('A valid Bearer server credential is required.', 401,
    'JOURNEY_METRIC_CREDENTIAL_REQUIRED');
  return match[1];
}
function sendError(response: express.Response, value: unknown) {
  if (value instanceof z.ZodError) return response.status(400).json({ error: 'Journey metric validation failed.',
    code: 'JOURNEY_METRIC_INPUT_INVALID', details: value.issues });
  if (value instanceof JourneyMetricConfigurationError || value instanceof JourneyOperationalMeasureError) {
    return response.status(400).json({ error: value.message, code: value.code });
  }
  if (value instanceof JourneyPathAnalyticsConfigurationError || value instanceof JourneyActualPathAnalyticsError) {
    return response.status('status' in value ? value.status : 400).json({ error: value.message, code: value.code });
  }
  if (value instanceof JourneyMetricsError || value instanceof SpaceError || value instanceof SubscriptionEntitlementError
      || value instanceof JourneyEventIngestionError || value instanceof JourneyNativeMetricSourceError) {
    return response.status(value.status).json({ error: value.message, code: value.code,
      ...('details' in value && value.details ? { details: value.details } : {}) });
  }
  return response.status(500).json({ error: 'Journey metric request failed.', code: 'JOURNEY_METRIC_UNAVAILABLE' });
}

const id = z.string().trim().min(1).max(128);
const targetType = z.enum(['journey', 'stage', 'touchpoint', 'persona', 'segment']);
const page = { limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0) };
const jsonRecord = z.record(z.string(), z.unknown());
const versionSchema = z.object({
  sourceKind: z.enum(['survey', 'operational_import']), bindingId: id.nullable().optional(),
  calculatorKind: z.enum(['nps', 'csat', 'ces', 'operational']),
  aggregation: z.string().trim().min(1).max(80), direction: z.enum(['higher_is_better', 'lower_is_better', 'neutral']),
  windowSeconds: z.number().int().min(60).max(315_360_000), timezone: z.string().trim().min(1).max(80),
  minimumSampleSize: z.number().int().min(1).max(100_000_000),
  freshnessMaxAgeSeconds: z.number().int().min(1).max(315_360_000),
  baselineValue: z.number().finite().nullable().optional(), targetValue: z.number().finite().nullable().optional(),
  population: jsonRecord.optional(), filters: jsonRecord.optional(), formula: jsonRecord.optional(), configuration: jsonRecord
}).strict();
const alertVersionSchema = z.object({
  ruleKind: z.enum(['falling_metric', 'stale_source', 'small_sample', 'contradictory_evidence']),
  direction: z.enum(['decrease', 'increase', 'any']),
  thresholdValue: z.number().finite().min(0).max(1_000_000_000),
  windowSeconds: z.number().int().min(60).max(315_360_000),
  cooldownSeconds: z.number().int().min(60).max(315_360_000),
  minimumSampleSize: z.number().int().min(2).max(100_000_000),
  staleAfterSeconds: z.number().int().min(60).max(315_360_000),
  contradictionMinRatio: z.number().finite().min(0.01).max(0.5)
}).strict();

journeyMetricRouter.get('/alert-definitions', (request, response) => {
  try { const { space } = context(request); const query = z.object({ journeyDefinitionId: id.optional(), ...page })
    .strict().parse(request.query);
    return response.json({ definitions: listJourneyMetricAlertDefinitions({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/alert-definitions', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ journeyDefinitionId: id,
    metricDefinitionId: id, name: z.string().trim().min(1).max(160), version: alertVersionSchema,
    versionIdempotencyKey: z.string().trim().min(1).max(200), idempotencyKey: z.string().trim().max(200).optional()
  }).strict().parse(request.body || {});
  const result = createJourneyMetricAlertDefinition({ spaceId: space.id, actorUserId: user.id, ...body,
    version: body.version as JourneyMetricAlertVersionInput, idempotencyKey: key(request, body.idempotencyKey) });
  return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/alert-definitions/:definitionId/versions', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ expectedRevision: z.number().int().min(1),
    version: alertVersionSchema, idempotencyKey: z.string().trim().max(200).optional() }).strict().parse(request.body || {});
    const result = createJourneyMetricAlertDefinitionVersion({ spaceId: space.id, actorUserId: user.id,
      definitionId: id.parse(request.params.definitionId), expectedRevision: body.expectedRevision,
      version: body.version as JourneyMetricAlertVersionInput, idempotencyKey: key(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.patch('/alert-definitions/:definitionId', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ expectedRevision: z.number().int().min(1),
    name: z.string().trim().min(1).max(160).optional(), state: z.enum(['active', 'disabled', 'retired']).optional() })
    .strict().refine((value) => value.name !== undefined || value.state !== undefined,
      'At least one alert definition change is required.').parse(request.body || {});
    return response.json({ definition: updateJourneyMetricAlertDefinition({ spaceId: space.id, actorUserId: user.id,
      definitionId: id.parse(request.params.definitionId), ...body }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/alerts', (request, response) => {
  try { const { space } = context(request); const query = z.object({ journeyDefinitionId: id.optional(),
    state: z.enum(['open', 'acknowledged', 'snoozed', 'resolved']).optional(), ...page }).strict().parse(request.query);
    return response.json({ alerts: listJourneyMetricAlerts({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/alerts/:alertId/history', (request, response) => {
  try { const { space } = context(request); return response.json(listJourneyMetricAlertHistory({ spaceId: space.id,
    alertId: id.parse(request.params.alertId) }));
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/alerts/:alertId/actions', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ expectedRevision: z.number().int().min(1),
    action: z.enum(['acknowledge', 'snooze', 'resolve']), snoozedUntil: z.string().datetime({ offset: true }).optional() })
    .strict().superRefine((value, issue) => { if (value.action === 'snooze' && !value.snoozedUntil) issue.addIssue({
      code: z.ZodIssueCode.custom, path: ['snoozedUntil'], message: 'Snoozed until is required.' }); }).parse(request.body || {});
    return response.json({ alert: transitionJourneyMetricAlert({ spaceId: space.id, actorUserId: user.id,
      alertId: id.parse(request.params.alertId), ...body }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/alert-evaluations', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ journeyDefinitionId: id,
    asOf: z.string().datetime({ offset: true }).optional(), idempotencyKey: z.string().trim().max(200).optional() })
    .strict().parse(request.body || {});
    const result = evaluateJourneyMetricAlerts({ spaceId: space.id, actorUserId: user.id, ...body,
      idempotencyKey: key(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/alert-runs', (request, response) => {
  try { const { space } = context(request); const query = z.object({ journeyDefinitionId: id.optional(), ...page })
    .strict().parse(request.query);
    return response.json({ runs: listJourneyMetricAlertRuns({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/alert-notifications', (request, response) => {
  try { const { user, space } = context(request); const query = z.object({
    state: z.enum(['unread', 'read', 'dismissed']).optional(), ...page }).strict().parse(request.query);
    return response.json({ notifications: listJourneyMetricAlertNotifications({ spaceId: space.id, userId: user.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.patch('/alert-notifications/:notificationId', (request, response) => {
  try { const { user, space } = context(request); const body = z.object({ expectedRevision: z.number().int().min(1),
    state: z.enum(['read', 'dismissed']) }).strict().parse(request.body || {});
    return response.json({ notification: updateJourneyMetricAlertNotification({ spaceId: space.id, userId: user.id,
      notificationId: id.parse(request.params.notificationId), ...body }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/alert-notification-preference', (request, response) => {
  try { const { user, space } = context(request); return response.json({ preference:
    journeyMetricAlertNotificationPreference({ spaceId: space.id, userId: user.id }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.patch('/alert-notification-preference', (request, response) => {
  try { const { user, space } = context(request); const body = z.object({ enabled: z.boolean(),
    expectedRevision: z.number().int().min(0) }).strict().parse(request.body || {});
    return response.json({ preference: updateJourneyMetricAlertNotificationPreference({ spaceId: space.id,
      userId: user.id, ...body }) });
  } catch (value) { return sendError(response, value); }
});

journeyMetricRouter.get('/segments', (request, response) => {
  try { const { space } = context(request); const query = z.object({ journeyDefinitionId: id.optional(), ...page }).parse(request.query);
    return response.json({ segments: listJourneyMetricSegments({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/segments', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ journeyDefinitionId: id,
    name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).optional(), rule: jsonRecord.optional(),
    idempotencyKey: z.string().trim().max(200).optional() }).strict().parse(request.body || {});
    const result = createJourneyMetricSegment({ spaceId: space.id, actorUserId: user.id, ...body,
      idempotencyKey: key(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.patch('/segments/:segmentId', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ expectedRevision: z.number().int().min(1),
    name: z.string().trim().min(1).max(160).optional(), description: z.string().trim().max(2000).optional(),
    rule: jsonRecord.optional(), state: z.enum(['active', 'retired']).optional() }).strict().parse(request.body || {});
    return response.json({ segment: updateJourneyMetricSegment({ spaceId: space.id, actorUserId: user.id,
      segmentId: id.parse(request.params.segmentId), ...body }) });
  } catch (value) { return sendError(response, value); }
});

journeyMetricRouter.get('/bindings', (request, response) => {
  try { const { space } = context(request); const query = z.object({ journeyDefinitionId: id.optional(), ...page }).parse(request.query);
    return response.json({ bindings: listJourneyMetricBindings({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/bindings', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ journeyDefinitionId: id, targetType, targetId: id,
    surveyId: id, collectorId: id.nullable().optional(), questionId: id.nullable().optional(),
    idempotencyKey: z.string().trim().max(200).optional() }).strict().parse(request.body || {});
    const result = createJourneyMetricBinding({ spaceId: space.id, actorUserId: user.id, ...body,
      idempotencyKey: key(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.patch('/bindings/:bindingId', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ expectedRevision: z.number().int().min(1),
    state: z.enum(['active', 'retired']) }).strict().parse(request.body || {});
    return response.json({ binding: updateJourneyMetricBinding({ spaceId: space.id, actorUserId: user.id,
      bindingId: id.parse(request.params.bindingId), ...body }) });
  } catch (value) { return sendError(response, value); }
});

/** Exact authorised native source choices for the configuration dialog. Gated
 * to editors because it is a management affordance, and it returns identities
 * and display names only — never ticket or mention content. */
journeyMetricRouter.get('/native-sources', (request, response) => {
  try { const { space } = editor(request);
    return response.json(listJourneyMetricNativeSources({ spaceId: space.id }));
  } catch (value) { return sendError(response, value); }
});

journeyMetricRouter.get('/definitions', (request, response) => {
  try { const { space } = context(request); const query = z.object({ journeyDefinitionId: id.optional(), ...page }).parse(request.query);
    return response.json({ definitions: listJourneyMetricDefinitions({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/definitions/:definitionId', (request, response) => {
  try { const { space } = context(request); return response.json(getJourneyMetricDefinition({ spaceId: space.id,
    definitionId: id.parse(request.params.definitionId) }));
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/definitions', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ journeyDefinitionId: id, targetType, targetId: id,
    name: z.string().trim().min(1).max(160), version: versionSchema,
    idempotencyKey: z.string().trim().max(200).optional(), versionIdempotencyKey: z.string().trim().min(1).max(200)
  }).strict().parse(request.body || {});
    const result = createJourneyMetricDefinition({ spaceId: space.id, actorUserId: user.id, ...body,
      version: body.version as JourneyMetricVersionInput, idempotencyKey: key(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/definitions/:definitionId/versions', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ expectedRevision: z.number().int().min(1),
    version: versionSchema, idempotencyKey: z.string().trim().max(200).optional() }).strict().parse(request.body || {});
    const result = createJourneyMetricDefinitionVersion({ spaceId: space.id, actorUserId: user.id,
      definitionId: id.parse(request.params.definitionId), expectedRevision: body.expectedRevision,
      version: body.version as JourneyMetricVersionInput, idempotencyKey: key(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});

journeyMetricRouter.get('/rebuilds', (request, response) => {
  try { const { space } = context(request); const query = z.object({ definitionId: id.optional(),
    journeyDefinitionId: id.optional(), ...page }).strict().parse(request.query);
    return response.json({ rebuilds: listJourneyMetricRebuilds({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/rebuilds', (request, response) => {
  try { const { user, space } = editor(request); const body = z.object({ definitionId: id,
    reason: z.enum(['manual', 'source_created', 'source_corrected', 'source_deleted', 'reconcile', 'scheduled']).default('manual'),
    asOf: z.string().datetime({ offset: true }).optional(), idempotencyKey: z.string().trim().max(200).optional() })
    .strict().parse(request.body || {});
    const result = queueJourneyMetricRebuild({ spaceId: space.id, actorUserId: user.id, ...body,
      idempotencyKey: key(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 202).json(result);
  } catch (value) { return sendError(response, value); }
});

/** Facets arrive either repeated (`?personaIds=a&personaIds=b`) or
 * comma-separated. They are resolved against tenant-scoped catalogues in the
 * domain layer, so an unknown or foreign identifier is a 404 rather than an
 * empty list that reads as "no data". */
const idList = z.preprocess((value) => (value === undefined ? undefined
  : (Array.isArray(value) ? value : String(value).split(',')).map((item) => String(item).trim()).filter(Boolean)),
z.array(id).max(50)).optional();
const observationFilterSchema = {
  definitionId: id.optional(), journeyDefinitionId: id.optional(),
  from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
  targetTypes: z.preprocess((value) => (value === undefined ? undefined
    : (Array.isArray(value) ? value : String(value).split(',')).map((item) => String(item).trim()).filter(Boolean)),
  z.array(targetType).max(5)).optional(),
  personaIds: idList, segmentIds: idList, channelIds: idList, cohortIds: idList
};

journeyMetricRouter.get('/observations', (request, response) => {
  try { const { space } = context(request);
    const query = z.object({ ...observationFilterSchema, ...page }).strict().parse(request.query);
    return response.json(listJourneyMetricObservations({ spaceId: space.id, ...query }));
  } catch (value) { return sendError(response, value); }
});

journeyMetricRouter.get('/actual-paths', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({
      journeyDefinitionId: id,
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      asOf: z.string().datetime({ offset: true }).optional(),
      subjectKind: z.enum(['anonymous_only', 'known_profiles']).optional(),
      minimumCohortSize: z.coerce.number().int().min(1).max(1_000).default(5)
    }).strict().parse(request.query);
    return response.json(readJourneyActualPathAnalytics({ spaceId: space.id, ...query }));
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/actual-path-rollups/latest', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({ journeyDefinitionId: id, subjectKind: z.enum(['anonymous_only', 'known_profiles']).optional() }).strict().parse(request.query);
    return response.json({ rollup: readLatestJourneyActualPathRollup(space.id, query.journeyDefinitionId, query.subjectKind) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/actual-path-rollups/materialize', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({
      journeyDefinitionId: id,
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      asOf: z.string().datetime({ offset: true }).optional(),
      subjectKind: z.enum(['anonymous_only', 'known_profiles']).optional(),
      minimumCohortSize: z.number().int().min(1).max(1_000).default(5)
    }).strict().parse(request.body || {});
    const result = materializeJourneyActualPathRollup({ spaceId: space.id, actorUserId: user.id, ...body });
    return response.status(result.updated ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/actual-path-snapshots/latest', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({ journeyDefinitionId: id, subjectKind: z.enum(['anonymous_only', 'known_profiles']).optional() }).strict().parse(request.query);
    return response.json({ snapshot: readLatestJourneyActualPathSnapshot(space.id, query.journeyDefinitionId, query.subjectKind) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/actual-path-snapshots', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({ journeyDefinitionId: id, subjectKind: z.enum(['anonymous_only', 'known_profiles']).optional(), ...page }).strict().parse(request.query);
    return response.json({ snapshots: listJourneyActualPathSnapshots(space.id, query.journeyDefinitionId, query.limit, query.subjectKind) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/actual-path-snapshots/:snapshotId', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({ journeyDefinitionId: id, subjectKind: z.enum(['anonymous_only', 'known_profiles']).optional() }).strict().parse(request.query);
    return response.json({ snapshot: readJourneyActualPathSnapshot(space.id, query.journeyDefinitionId, id.parse(request.params.snapshotId), query.subjectKind) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.post('/actual-path-snapshots', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({
      journeyDefinitionId: id,
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      asOf: z.string().datetime({ offset: true }).optional(),
      subjectKind: z.enum(['anonymous_only', 'known_profiles']).optional(),
      minimumCohortSize: z.number().int().min(1).max(1_000).default(5)
    }).strict().parse(request.body || {});
    const result = createJourneyActualPathSnapshot({ spaceId: space.id, actorUserId: user.id, ...body });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});

/** Governed analytics export. Reads use `context()` so any space member may
 * export exactly what they can already see; the render-then-meter ordering and
 * usage headers mirror the journey map export. */
journeyMetricRouter.get('/analytics-export.:format', (request, response) => {
  try {
    const { user, space } = context(request);
    const format = String(request.params.format).toLowerCase();
    if (!isJourneyMetricAnalyticsExportFormat(format)) {
      return response.status(400).json({ error: 'Unsupported analytics export format. Use csv or json.',
        code: 'JOURNEY_METRIC_EXPORT_FORMAT_UNSUPPORTED' });
    }
    const query = z.object({ ...observationFilterSchema, journeyDefinitionId: id, ...page })
      .strict().parse(request.query);
    const supplied = request.get('Idempotency-Key');
    if (supplied !== undefined && !safeIdempotencyKey(supplied)) {
      return response.status(400).json({ error: 'Invalid Idempotency-Key header.',
        code: 'SUBSCRIPTION_USAGE_INPUT_INVALID' });
    }
    const idempotencyKey = supplied || crypto.randomUUID();
    const { journeyDefinitionId, limit, offset, ...filters } = query;
    const { artifact, receipt } = buildMeteredJourneyMetricAnalyticsExport({ spaceId: space.id,
      actorUserId: user.id, journeyDefinitionId, idempotencyKey, format, filters, limit, offset });
    const asciiFilename = artifact.filename.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 180);
    response.setHeader('Content-Type', artifact.mimeType);
    response.setHeader('Content-Length', String(artifact.bytes.length));
    response.setHeader('Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Seemplify-Idempotency-Key', idempotencyKey);
    response.setHeader('X-Seemplify-Usage-Receipt', receipt.eventId);
    response.setHeader('X-Seemplify-Usage-Replayed', receipt.replayed ? 'true' : 'false');
    response.setHeader('X-Seemplify-Usage-Used', String(receipt.used));
    response.setHeader('X-Seemplify-Usage-Limit', String(receipt.limit));
    response.setHeader('X-Seemplify-Usage-Reset', receipt.resetAt);
    return response.status(200).send(artifact.bytes);
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/observations/:observationId', (request, response) => {
  try { const { user, space } = context(request); return response.json({ observation: getJourneyMetricObservation({
    spaceId: space.id, observationId: id.parse(request.params.observationId), actorUserId: user.id }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/observations/:observationId/lineage', (request, response) => {
  try { const { user, space } = context(request); return response.json({ observation: getJourneyMetricObservation({
    spaceId: space.id, observationId: id.parse(request.params.observationId), actorUserId: user.id, includeLineage: true }) });
  } catch (value) { return sendError(response, value); }
});
journeyMetricRouter.get('/audit', (request, response) => {
  try { const { space } = editor(request); const query = z.object(page).parse(request.query);
    return response.json({ events: listJourneyMetricAudit({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});

const sourceLineage = z.object({ sourceRef: z.string().trim().min(1).max(500), sourceVersion: z.string().trim().min(1).max(128),
  schemaVersion: z.string().trim().min(1).max(128), projectionVersion: z.string().trim().min(1).max(128),
  journeyId: id.nullable(), journeyVersion: z.string().trim().max(128).nullable(), ruleSetVersion: z.string().trim().max(128).nullable() }).strict();
journeyMetricImportRouter.post('/metric-imports', (request, response) => {
  try {
    const principal = authenticateJourneyEventCredential(bearer(request));
    const body = z.object({ definitionId: id, schemaVersionId: id, externalRecordId: z.string().trim().min(1).max(500),
      revision: z.number().int().min(1).max(1_000_000), operation: z.enum(['upsert', 'delete']),
      subjectId: z.string().trim().min(1).max(500), subjectType: z.enum(['journey_instance', 'profile', 'ticket', 'social_post', 'custom']),
      eventType: z.string().trim().min(1).max(128), occurredAt: z.string().datetime({ offset: true }),
      stageId: id.nullable().optional(), sentiment: z.enum(['positive', 'neutral', 'negative', 'unknown']).nullable().optional(),
      sourceLineage, properties: jsonRecord.default({}), idempotencyKey: z.string().trim().max(200).optional() }).strict()
      .parse(request.body || {});
    const result = importJourneyOperationalObservation({ principal, payload: { ...body,
      idempotencyKey: key(request, body.idempotencyKey) } });
    return response.status(result.replayed ? 200 : 202).json(result);
  } catch (value) { return sendError(response, value); }
});

journeyMetricImportRouter.use((error: unknown, _request: express.Request, response: express.Response,
  _next: express.NextFunction) => {
  const tooLarge = Boolean(error && typeof error === 'object' && (error as { type?: string }).type === 'entity.too.large');
  const invalidJson = error instanceof SyntaxError;
  if (tooLarge || invalidJson) return response.status(tooLarge ? 413 : 400).json({
    error: tooLarge ? 'The metric import body exceeds the 256 KiB limit.' : 'The metric import body must be valid JSON.',
    code: tooLarge ? 'JOURNEY_METRIC_BODY_TOO_LARGE' : 'JOURNEY_METRIC_JSON_INVALID'
  });
  return sendError(response, error);
});
