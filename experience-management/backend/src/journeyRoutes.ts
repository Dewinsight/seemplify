import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { listJourneys } from './database.js';
import {
  buildJourneyMapExport, type JourneyMapExportFormat, type JourneyMapExportViewContext
} from './journeyMapExports.js';
import {
  evidenceAssessments, evidenceSourceTypes, isJourneyLaneKey, journeyCardKinds, journeyExperienceTypes, journeyLaneTypes,
  journeyMapLimits, journeyMapTypes, personaLifecycleStates
} from './journeyDomain.js';
import {
  addJourneyCard, addJourneyLane, addJourneyStage, assessEvidenceLink, attachEvidenceLink, backfillJourneyMaps,
  bulkPatchJourneyCards,
  createJourneyMap, createJourneyPersona, deleteJourneyCard, deleteJourneyMap, deleteJourneyPersona,
  deleteJourneyLane, deleteJourneyStage, detachEvidenceLink, ensureJourneyMapForLegacyJourney, getJourneyMap, getJourneyPersona,
  getEvidenceLinkSource, JourneyMapError, linkPersonaToJourney, listEvidenceLinks, listJourneyDefinitions,
  listEvidenceAuditEvents, listJourneyPersonas, moveJourneyCard, moveJourneyCardAffectedCells, moveJourneyLane, moveJourneyStage,
  personaDraftFromLegacyAudience, publishJourneyMap, refreshEvidenceLink, reconcileJourneyMap, setJourneyLaneVisibility,
  unlinkPersonaFromJourney, updateJourneyCard, updateJourneyLane, updateJourneyPersona, updateJourneyStage
} from './journeyMaps.js';
import {
  discoverableJourneyEvidenceSourceTypes, JourneyEvidenceSourceError, searchJourneyEvidenceSources
} from './journeyEvidenceSources.js';
import {
  compareJourneyPersonas, decidePersonaVersion, getPersonaVersion, JourneyPersonaVersionError,
  linkPersonaClaimEvidence, listPersonaVersions, personaUsage, submitPersonaVersion, withdrawPersonaReview
} from './journeyPersonaVersions.js';
import { getJourneyRichMapSnapshot, type JourneyRichMapSnapshot } from './journeyRichCards.js';
import { resolveRequestSpace, spaceRoleOrIdpPermission, SpaceError, type SpaceContext } from './spaces.js';
import {
  assertSubscriptionFeature, consumeSubscriptionUsage, effectiveSubscriptionForSpace, SubscriptionEntitlementError
} from './subscriptionEntitlements.js';
import {
  assertJourneyDefinitionReadAllowed, canReadJourneyDefinition, effectiveJourneyRollout,
  runJourneyV2Write
} from './journeyRollout.js';
import {
  createJourneySavedView, deleteJourneySavedView, duplicateJourneySavedView, journeySavedViewConfigurationSchema,
  journeySavedViewPlanState, JourneySavedViewError, listDeletedJourneySavedViews, listJourneySavedViewAudit,
  listJourneySavedViewEvidenceOptions,
  listJourneySavedViews, recordJourneySavedViewExport, resetDefaultJourneySavedView, resolveJourneySavedView,
  restoreJourneySavedView, selectDefaultJourneySavedView, updateJourneySavedView, updateJourneySavedViewSettings
} from './journeySavedViews.js';

export const journeyMapRouter = express.Router();
export const journeyPersonaRouter = express.Router();
export const journeyEvidenceRouter = express.Router();

/** Keep plan enforcement at the HTTP boundary as well as in the domain
 * mutations. This prevents disabled capabilities from leaking read models,
 * and protects future handlers that might not yet call a guarded service. */
function requireJourneyFeatures(...features: Parameters<typeof assertSubscriptionFeature>[1][]) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    try {
      const { space } = context(request);
      assertSubscriptionFeature(space.id, 'journeyDesign');
      for (const feature of features) assertSubscriptionFeature(space.id, feature);
      next();
    } catch (error) { sendError(response, error); }
  };
}

journeyMapRouter.use(requireJourneyFeatures());
journeyPersonaRouter.use(requireJourneyFeatures('journeyPersonas'));
journeyEvidenceRouter.use(requireJourneyFeatures('journeyEvidence'));

journeyEvidenceRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}

/** Structural edits require more than read membership. Space roles are the
 * Phase 1 capability carrier; granular journey capabilities arrive with the
 * collaboration phase without changing this call site. */
function requireEditor(space: SpaceContext) {
  if (!spaceRoleOrIdpPermission(space, 'journeys.edit')) {
    throw new JourneyMapError('You do not have permission to change journey maps in this space.', 403, 'JOURNEY_MAP_FORBIDDEN');
  }
  return space;
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed', details: error.issues });
  if (error instanceof JourneyMapError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  if (error instanceof JourneyPersonaVersionError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  if (error instanceof JourneySavedViewError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  if (error instanceof SpaceError) return response.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  if (error instanceof JourneyEvidenceSourceError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  return response.status(500).json({ error: error instanceof Error ? error.message : 'Journey map request failed.' });
}

function asyncRoute(handler: (request: express.Request, response: express.Response) => Promise<unknown>) {
  return (request: express.Request, response: express.Response) => {
    void handler(request, response).catch((error) => sendError(response, error));
  };
}

/** Idempotent lazy conversion. Reading a space's maps is the natural rollout
 * trigger: every legacy journey gains a deterministic Map 2.0 version without a
 * separate operational step, and repeats are free. */
function ensureConvertedMaps(spaceId: string) {
  const rollout = effectiveJourneyRollout(spaceId);
  if (!rollout.v2Read && !rollout.compareReads) return;
  for (const journey of listJourneys(spaceId)) {
    try { ensureJourneyMapForLegacyJourney(journey, spaceId); }
    catch { /* One unconvertible legacy row must not block the whole workspace. */ }
  }
}

function governedV2Write<T>(request: express.Request, spaceId: string, definitionId: string, operation: () => T) {
  return runJourneyV2Write({
    spaceId,
    definitionId,
    operation,
    requestId: request.get('x-request-id')
  });
}

/** Kept as a small injectable boundary so the no-charge-on-render-failure
 * guarantee is executable in tests instead of relying on route ordering. */
export async function buildMeteredJourneyMapExport(input: {
  map: NonNullable<ReturnType<typeof getJourneyMap>>;
  format: JourneyMapExportFormat;
  spaceId: string;
  userId: string;
  idempotencyKey: string;
  selectedView?: JourneyMapExportViewContext;
  richMap?: JourneyRichMapSnapshot | null;
}, renderer: typeof buildJourneyMapExport = buildJourneyMapExport) {
  const artifact = await renderer(input.map, input.format, new Date().toISOString(), input.selectedView, input.richMap);
  const receipt = consumeSubscriptionUsage({
    spaceId: input.spaceId,
    quota: 'monthlyJourneyExports',
    idempotencyKey: input.idempotencyKey,
    intent: {
      definitionId: input.map.definition.id,
      versionId: input.map.version.id,
      versionNumber: input.map.version.versionNumber,
      format: input.format,
      ...(input.selectedView ? { viewId: input.selectedView.id, viewRevision: input.selectedView.revision,
        viewChecksum: input.selectedView.checksum } : {})
    },
    sourceType: 'journey_map_export',
    sourceId: input.map.definition.id,
    actorUserId: input.userId
  });
  return { artifact, receipt };
}

const revision = z.number().int().min(1);
const title = z.string().trim().min(1).max(journeyMapLimits.titleChars);
const optionalTitle = z.string().trim().max(journeyMapLimits.titleChars);
const content = z.string().max(journeyMapLimits.contentChars);
const timestamp = z.string().datetime().nullable();
const laneKey = z.string().min(1).max(63).refine(isJourneyLaneKey, 'Invalid journey lane key.');
const savedViewName = z.string().trim().min(1).max(160);
const savedViewVisibility = z.enum(['private', 'space']);

function requiredIdempotencyKey(request: express.Request) {
  const value = request.get('Idempotency-Key');
  if (!value || value.length > 200 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new JourneySavedViewError('A valid Idempotency-Key header is required.', 400,
      'JOURNEY_SAVED_VIEW_IDEMPOTENCY_INVALID');
  }
  return value;
}

journeyMapRouter.get('/', (request, response) => {
  try {
    const { user, space } = context(request);
    ensureConvertedMaps(space.id);
    const features = effectiveSubscriptionForSpace(space.id).plan.features;
    return response.json({
      journeyMaps: listJourneyDefinitions(space.id, user.id)
        .filter((definition) => canReadJourneyDefinition(space.id, definition)),
      personas: features.journeyPersonas ? listJourneyPersonas(space.id, user.id) : [],
      limits: journeyMapLimits,
      catalog: {
        mapTypes: journeyMapTypes, experienceTypes: journeyExperienceTypes,
        laneTypes: journeyLaneTypes, cardKinds: journeyCardKinds,
        evidenceSourceTypes, evidenceAssessments, personaLifecycleStates
      }
    });
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      name: title,
      purpose: content.optional(),
      experienceType: z.enum(journeyExperienceTypes).optional(),
      mapType: z.enum(journeyMapTypes).optional(),
      objective: content.optional(),
      industry: optionalTitle.optional(),
      summary: content.optional(),
      stageNames: z.array(title).max(journeyMapLimits.stages).optional()
    }).strict().parse(request.body || {});
    return response.status(201).json(createJourneyMap(space.id, user.id, input));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/backfill', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    if (!effectiveJourneyRollout(space.id).v2Write) {
      throw new JourneyMapError('Journey Map 2.0 writes are disabled for this space.', 403, 'JOURNEY_V2_WRITE_DISABLED');
    }
    const input = z.object({
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.string().trim().min(1).max(2_000).optional()
    }).strict().parse(request.body || {});
    return response.json(backfillJourneyMaps({ spaceIds: [space.id], ...input }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId/saved-views', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(listJourneySavedViews({ spaceId: space.id, actorUserId: user.id,
      definitionId: String(request.params.definitionId) }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId/saved-views/deleted', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(listDeletedJourneySavedViews({ spaceId: space.id, actorUserId: user.id,
      definitionId: String(request.params.definitionId) }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId/saved-views/audit', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(request.query);
    return response.json(listJourneySavedViewAudit({ spaceId: space.id, actorUserId: user.id,
      definitionId: String(request.params.definitionId), limit: query.limit }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId/saved-views/evidence-options', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ versionId: z.string().trim().min(1).max(128),
      limit: z.coerce.number().int().min(1).max(200).optional() }).strict().parse(request.query);
    return response.json(listJourneySavedViewEvidenceOptions({ spaceId: space.id, actorUserId: user.id,
      definitionId: String(request.params.definitionId), versionId: query.versionId, limit: query.limit }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId/saved-views/settings', (request, response) => {
  try {
    const { space } = context(request);
    return response.json(journeySavedViewPlanState(space.id));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.patch('/:definitionId/saved-views/settings', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({
      expectedRevision: z.number().int().min(0), enabled: z.boolean(),
      retentionDays: z.number().int().min(1).max(3_650)
    }).strict().parse(request.body || {});
    return response.json(updateJourneySavedViewSettings({ spaceId: space.id, actorUserId: user.id,
      idempotencyKey: requiredIdempotencyKey(request), ...input }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/saved-views', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ name: savedViewName, visibility: savedViewVisibility,
      config: journeySavedViewConfigurationSchema }).strict().parse(request.body || {});
    return response.status(201).json(createJourneySavedView({ spaceId: space.id, actorUserId: user.id,
      definitionId: String(request.params.definitionId), idempotencyKey: requiredIdempotencyKey(request), ...input }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId/saved-views/:viewId', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ revision: z.coerce.number().int().min(1) }).strict().parse(request.query);
    return response.json(resolveJourneySavedView({ spaceId: space.id, actorUserId: user.id,
      definitionId: String(request.params.definitionId), viewId: String(request.params.viewId),
      expectedRevision: query.revision }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.patch('/:definitionId/saved-views/:viewId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: revision, name: savedViewName, visibility: savedViewVisibility,
      config: journeySavedViewConfigurationSchema }).strict().parse(request.body || {});
    return response.json(updateJourneySavedView({ spaceId: space.id, actorUserId: user.id,
      viewId: String(request.params.viewId), idempotencyKey: requiredIdempotencyKey(request), ...input }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/saved-views/:viewId/duplicate', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: revision, name: savedViewName.optional(),
      visibility: savedViewVisibility.optional() }).strict().parse(request.body || {});
    return response.status(201).json(duplicateJourneySavedView({ spaceId: space.id, actorUserId: user.id,
      viewId: String(request.params.viewId), idempotencyKey: requiredIdempotencyKey(request), ...input }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.delete('/:definitionId/saved-views/:viewId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: revision, reason: z.string().trim().min(3).max(500) })
      .strict().parse(request.body || {});
    return response.json(deleteJourneySavedView({ spaceId: space.id, actorUserId: user.id,
      viewId: String(request.params.viewId), idempotencyKey: requiredIdempotencyKey(request), ...input }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/saved-views/:viewId/restore', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(restoreJourneySavedView({ spaceId: space.id, actorUserId: user.id,
      viewId: String(request.params.viewId), idempotencyKey: requiredIdempotencyKey(request), ...input }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.put('/:definitionId/saved-views/:viewId/default', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedViewRevision: revision }).strict().parse(request.body || {});
    return response.json(selectDefaultJourneySavedView({ spaceId: space.id, actorUserId: user.id,
      definitionId: String(request.params.definitionId), viewId: String(request.params.viewId),
      idempotencyKey: requiredIdempotencyKey(request), ...input }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.delete('/:definitionId/saved-view-default', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(resetDefaultJourneySavedView({ spaceId: space.id, actorUserId: user.id,
      definitionId: String(request.params.definitionId), idempotencyKey: requiredIdempotencyKey(request) }));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId', (request, response) => {
  try {
    const { user, space } = context(request);
    const versionId = typeof request.query.versionId === 'string' ? request.query.versionId : undefined;
    const map = getJourneyMap(space.id, String(request.params.definitionId), versionId, user.id);
    if (!map) return response.status(404).json({ error: 'Journey map not found.', code: 'JOURNEY_MAP_NOT_FOUND' });
    assertJourneyDefinitionReadAllowed(space.id, map);
    return response.json(map);
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId/reconciliation', (request, response) => {
  try {
    const { user, space } = context(request);
    const map = getJourneyMap(space.id, String(request.params.definitionId), undefined, user.id);
    if (!map) return response.status(404).json({ error: 'Journey map not found.', code: 'JOURNEY_MAP_NOT_FOUND' });
    assertJourneyDefinitionReadAllowed(space.id, map);
    if (!map.definition.legacyJourneyId) {
      return response.json({ journeyId: null, definitionId: map.definition.id, matched: true, differences: [], legacy: false });
    }
    return response.json({ ...reconcileJourneyMap(space.id, map.definition.legacyJourneyId), legacy: true });
  } catch (error) { return sendError(response, error); }
});

/** Governed export. Every format is rendered from the same viewer-scoped read
 * model, so private or deleted evidence cannot reappear in a downloaded file. */
journeyMapRouter.get('/:definitionId/export.:format', asyncRoute(async (request, response) => {
  const { user, space } = context(request);
  const format = String(request.params.format).toLowerCase();
  if (!['json', 'csv', 'pdf', 'png', 'pptx'].includes(format)) {
    return response.status(400).json({ error: 'Unsupported export format.', code: 'JOURNEY_MAP_EXPORT_FORMAT' });
  }
  assertSubscriptionFeature(space.id, 'journeyExports');
  const definitionId = String(request.params.definitionId);
  const versionId = typeof request.query.versionId === 'string' ? request.query.versionId : undefined;
  const viewId = typeof request.query.viewId === 'string' ? request.query.viewId : undefined;
  const viewRevisionRaw = typeof request.query.viewRevision === 'string' ? request.query.viewRevision : undefined;
  if (Boolean(viewId) !== Boolean(viewRevisionRaw)) {
    return response.status(400).json({ error: 'viewId and viewRevision must be supplied together.',
      code: 'JOURNEY_SAVED_VIEW_EXPORT_INPUT_INVALID' });
  }
  let selectedView: JourneyMapExportViewContext | undefined;
  let selectedSavedView: ReturnType<typeof resolveJourneySavedView>['view'] | undefined;
  let map: NonNullable<ReturnType<typeof getJourneyMap>> | null;
  if (viewId && viewRevisionRaw) {
    const viewRevision = Number(viewRevisionRaw);
    if (!Number.isSafeInteger(viewRevision) || viewRevision < 1) {
      return response.status(400).json({ error: 'viewRevision must be a positive integer.',
        code: 'JOURNEY_SAVED_VIEW_EXPORT_INPUT_INVALID' });
    }
    const resolved = resolveJourneySavedView({ spaceId: space.id, actorUserId: user.id, definitionId,
      viewId, expectedRevision: viewRevision });
    map = resolved.map;
    selectedSavedView = resolved.view;
    selectedView = {
      id: resolved.view.id, name: resolved.view.name, revision: resolved.view.revision,
      visibility: resolved.view.visibility, schemaVersion: resolved.view.schemaVersion,
      checksum: resolved.view.checksum, bindingPolicy: resolved.view.config.binding.policy,
      filters: resolved.view.config.filters, comparisonTarget: resolved.view.config.comparisonTarget,
      presentation: resolved.view.config.presentation, analytics: { ...resolved.analytics }
    };
    if (versionId && versionId !== map.version.id) {
      return response.status(409).json({ error: 'versionId does not match the resolved saved-view version.',
        code: 'JOURNEY_SAVED_VIEW_EXPORT_VERSION_CONFLICT' });
    }
  } else {
    map = getJourneyMap(space.id, definitionId, versionId, user.id);
  }
  if (!map) return response.status(404).json({ error: 'Journey map not found.', code: 'JOURNEY_MAP_NOT_FOUND' });
  assertJourneyDefinitionReadAllowed(space.id, map);
  const suppliedKey = request.get('Idempotency-Key');
  if (suppliedKey !== undefined && (
    suppliedKey.length < 1 || suppliedKey.length > 200 || suppliedKey.trim() !== suppliedKey
    || /[\u0000-\u001f\u007f]/u.test(suppliedKey)
  )) {
    return response.status(400).json({ error: 'Invalid Idempotency-Key header.', code: 'SUBSCRIPTION_USAGE_INPUT_INVALID' });
  }
  const idempotencyKey = suppliedKey || crypto.randomUUID();
  const richMap = effectiveSubscriptionForSpace(space.id).plan.features.journeyRichCards
    ? getJourneyRichMapSnapshot(space.id, map.definition.id, map.version.id)
    : null;
  // Rendering precedes accounting: a renderer failure never consumes quota.
  const { artifact, receipt } = await buildMeteredJourneyMapExport({
    map, format: format as JourneyMapExportFormat, spaceId: space.id, userId: user.id, idempotencyKey,
    richMap, selectedView
  });
  if (selectedSavedView && !receipt.replayed) recordJourneySavedViewExport({
    spaceId: space.id, actorUserId: user.id, view: selectedSavedView, format
  });
  const asciiFilename = artifact.filename.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 180);
  response.setHeader('Content-Type', artifact.mimeType);
  response.setHeader('Content-Length', String(artifact.bytes.length));
  response.setHeader('Content-Disposition',
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Seemplify-Idempotency-Key', idempotencyKey);
  response.setHeader('X-Seemplify-Usage-Receipt', receipt.eventId);
  response.setHeader('X-Seemplify-Usage-Replayed', receipt.replayed ? 'true' : 'false');
  response.setHeader('X-Seemplify-Usage-Used', String(receipt.used));
  response.setHeader('X-Seemplify-Usage-Limit', String(receipt.limit));
  response.setHeader('X-Seemplify-Usage-Reset', receipt.resetAt);
  return response.status(200).send(artifact.bytes);
}));

journeyMapRouter.delete('/:definitionId', (request, response) => {
  try {
    const { space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    governedV2Write(request, space.id, String(request.params.definitionId), () =>
      deleteJourneyMap(space.id, String(request.params.definitionId), input.expectedRevision));
    return response.status(204).end();
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/publish', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    const result = governedV2Write(request, space.id, String(request.params.definitionId), () =>
      publishJourneyMap(space.id, String(request.params.definitionId), input.expectedRevision, user.id));
    return response.json({ ...result, journeyMap: getJourneyMap(space.id, String(request.params.definitionId), undefined, user.id) });
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/stages', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision, name: title, goal: optionalTitle.optional(), description: content.optional()
    }).strict().parse(request.body || {});
    const { expectedRevision, ...stage } = input;
    return response.status(201).json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      addJourneyStage(space.id, String(request.params.definitionId), expectedRevision, stage, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.patch('/:definitionId/stages/:stageKey', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision, name: title.optional(), goal: optionalTitle.optional(), description: content.optional()
    }).strict().parse(request.body || {});
    const { expectedRevision, ...stage } = input;
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      updateJourneyStage(space.id, String(request.params.definitionId), expectedRevision,
        String(request.params.stageKey), stage, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.delete('/:definitionId/stages/:stageKey', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      deleteJourneyStage(space.id, String(request.params.definitionId), input.expectedRevision,
        String(request.params.stageKey), user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/stages/:stageKey/move', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedRevision: revision, toOrdinal: z.number().int().min(0).max(journeyMapLimits.stages) })
      .strict().parse(request.body || {});
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      moveJourneyStage(space.id, String(request.params.definitionId), input.expectedRevision,
        String(request.params.stageKey), input.toOrdinal, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/lanes', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      laneKey: z.string().trim().min(8).max(63).optional(),
      title,
      description: content.optional()
    }).strict().parse(request.body || {});
    const { expectedRevision, ...lane } = input;
    return response.status(201).json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      addJourneyLane(space.id, String(request.params.definitionId), expectedRevision, lane, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.patch('/:definitionId/lanes/:laneKey', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      title: title.optional(),
      description: content.optional()
    }).strict().refine((value) => value.title !== undefined || value.description !== undefined, {
      message: 'A lane update requires a title or description.'
    }).parse(request.body || {});
    const { expectedRevision, ...lane } = input;
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      updateJourneyLane(space.id, String(request.params.definitionId), expectedRevision,
        String(request.params.laneKey), lane, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/lanes/:laneKey/move', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      toOrdinal: z.number().int().min(0).max(journeyMapLimits.lanes)
    }).strict().parse(request.body || {});
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      moveJourneyLane(space.id, String(request.params.definitionId), input.expectedRevision,
        String(request.params.laneKey), input.toOrdinal, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/lanes/:laneKey/visibility', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedRevision: revision, visible: z.boolean() }).strict().parse(request.body || {});
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      setJourneyLaneVisibility(space.id, String(request.params.definitionId), input.expectedRevision,
        String(request.params.laneKey), input.visible, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.delete('/:definitionId/lanes/:laneKey', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      deleteJourneyLane(space.id, String(request.params.definitionId), input.expectedRevision,
        String(request.params.laneKey), user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/cards', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      stageKey: z.string().trim().min(1).max(80),
      laneType: laneKey.optional(),
      kind: z.enum(journeyCardKinds),
      title,
      content: content.optional(),
      personaId: z.string().uuid().nullable().optional(),
      status: z.enum(['draft', 'active', 'retired']).optional()
    }).strict().parse(request.body || {});
    const { expectedRevision, ...card } = input;
    return response.status(201).json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      addJourneyCard(space.id, String(request.params.definitionId), expectedRevision, card, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.patch('/:definitionId/cards/:cardId', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      kind: z.enum(journeyCardKinds).optional(),
      title: title.optional(),
      content: content.optional(),
      personaId: z.string().uuid().nullable().optional(),
      status: z.enum(['draft', 'active', 'retired']).optional()
    }).strict().parse(request.body || {});
    const { expectedRevision, ...card } = input;
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      updateJourneyCard(space.id, String(request.params.definitionId), expectedRevision,
        String(request.params.cardId), card, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/cards/bulk', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      cardIds: z.array(z.string().uuid()).min(1).max(journeyMapLimits.cards),
      patch: z.object({
        status: z.enum(['draft', 'active', 'retired']).optional(),
        personaId: z.string().uuid().nullable().optional(),
        stageKey: z.string().trim().min(1).max(80).optional(),
        laneType: laneKey.optional()
      }).strict().refine((patch) => Object.keys(patch).length > 0, 'At least one card change is required.')
    }).strict().parse(request.body || {});
    const { expectedRevision, ...bulk } = input;
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      bulkPatchJourneyCards(space.id, String(request.params.definitionId), expectedRevision, bulk, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.delete('/:definitionId/cards/:cardId', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      deleteJourneyCard(space.id, String(request.params.definitionId), input.expectedRevision,
        String(request.params.cardId), user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/cards/:cardId/move', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      stageKey: z.string().trim().min(1).max(80).optional(),
      laneType: laneKey.optional(),
      ordinal: z.number().int().min(0).max(journeyMapLimits.cardsPerCell).optional(),
      responseMode: z.literal('affected_cells').optional()
    }).strict().parse(request.body || {});
    const { expectedRevision, responseMode, ...target } = input;
    return response.json(governedV2Write(request, space.id, String(request.params.definitionId), () =>
      responseMode === 'affected_cells'
        ? moveJourneyCardAffectedCells(space.id, String(request.params.definitionId), expectedRevision,
          String(request.params.cardId), target, user.id)
        : moveJourneyCard(space.id, String(request.params.definitionId), expectedRevision,
          String(request.params.cardId), target, user.id)));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/personas', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({ personaId: z.string().uuid() }).strict().parse(request.body || {});
    governedV2Write(request, space.id, String(request.params.definitionId), () =>
      linkPersonaToJourney(space.id, String(request.params.definitionId), input.personaId));
    return response.json(getJourneyMap(space.id, String(request.params.definitionId), undefined, user.id));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.post('/:definitionId/personas/from-legacy-audience', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const persona = governedV2Write(request, space.id, String(request.params.definitionId), () =>
      personaDraftFromLegacyAudience(space.id, user.id, String(request.params.definitionId)));
    return response.status(201).json({
      persona, journeyMap: getJourneyMap(space.id, String(request.params.definitionId), undefined, user.id)
    });
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.delete('/:definitionId/personas/:personaId', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    governedV2Write(request, space.id, String(request.params.definitionId), () =>
      unlinkPersonaFromJourney(space.id, String(request.params.definitionId), String(request.params.personaId)));
    return response.json(getJourneyMap(space.id, String(request.params.definitionId), undefined, user.id));
  } catch (error) { return sendError(response, error); }
});

journeyMapRouter.get('/:definitionId/persona-comparison', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({
      versionId: z.string().trim().min(1).max(128),
      personaId: z.union([z.string(), z.array(z.string())]).transform((value) => Array.isArray(value) ? value : [value])
    }).strict().parse(request.query);
    const map = getJourneyMap(space.id, String(request.params.definitionId), query.versionId, user.id);
    if (!map) return response.status(404).json({ error: 'Journey map not found.', code: 'JOURNEY_MAP_NOT_FOUND' });
    assertJourneyDefinitionReadAllowed(space.id, map);
    return response.json(compareJourneyPersonas({
      spaceId: space.id,
      definitionId: String(request.params.definitionId),
      versionId: query.versionId,
      personaIds: query.personaId.map(String)
    }));
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.get('/', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ personas: listJourneyPersonas(space.id, user.id) });
  } catch (error) { return sendError(response, error); }
});

const personaBody = {
  name: title,
  summary: content.optional(),
  lifecycleState: z.enum(personaLifecycleStates).optional(),
  attributes: z.record(z.string().trim().min(1).max(80), z.string().max(journeyMapLimits.titleChars))
    .refine((value) => Object.keys(value).length <= journeyMapLimits.personaAttributes, 'Too many persona attributes.')
    .optional(),
  goals: z.array(title).max(40).optional(),
  behaviours: z.array(title).max(40).optional(),
  needs: z.array(title).max(40).optional(),
  barriers: z.array(title).max(40).optional(),
  reviewAt: timestamp.optional()
};

journeyPersonaRouter.post('/', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object(personaBody).strict().parse(request.body || {});
    return response.status(201).json(createJourneyPersona(space.id, user.id, input));
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.get('/:personaId', (request, response) => {
  try {
    const { user, space } = context(request);
    const persona = getJourneyPersona(space.id, String(request.params.personaId));
    if (!persona) return response.status(404).json({ error: 'Persona not found.', code: 'JOURNEY_PERSONA_NOT_FOUND' });
    return response.json({
      persona,
      evidence: listEvidenceLinks(space.id, user.id, 'persona', persona.id)
    });
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.get('/:personaId/versions', (request, response) => {
  try {
    const { space } = context(request);
    return response.json({ versions: listPersonaVersions(space.id, String(request.params.personaId)) });
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.get('/:personaId/versions/:versionId', (request, response) => {
  try {
    const { user, space } = context(request);
    const version = getPersonaVersion(space.id, String(request.params.personaId), String(request.params.versionId));
    if (!version) return response.status(404).json({ error: 'Persona version not found.', code: 'JOURNEY_PERSONA_VERSION_NOT_FOUND' });
    // Re-authorise every source for the current viewer. A pinned claim may
    // remain in audit while its source becomes inaccessible, but the endpoint
    // must never return source content or imply current access in that case.
    const sourceAccess = Object.fromEntries(version.claims.flatMap((claim) => claim.evidence).map((evidence) => {
      try {
        getEvidenceLinkSource(space.id, user.id, evidence.evidenceLinkId);
        return [evidence.evidenceLinkId, 'available'];
      } catch {
        return [evidence.evidenceLinkId, 'inaccessible'];
      }
    }));
    return response.json({ version, sourceAccess });
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.get('/:personaId/usage', (request, response) => {
  try {
    const { space } = context(request);
    return response.json(personaUsage(space.id, String(request.params.personaId)));
  } catch (error) { return sendError(response, error); }
});

const personaGovernanceBody = z.object({
  expectedRevision: revision,
  comment: z.string().trim().min(3).max(2000)
}).strict();

journeyPersonaRouter.post('/:personaId/versions/:versionId/claims/:claimId/evidence', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      evidenceLinkId: z.string().trim().min(1).max(128)
    }).strict().parse(request.body || {});
    // The source must still be authorised now; linking an opaque or stale ID
    // is not accepted merely because a persona-level reference exists.
    getEvidenceLinkSource(space.id, user.id, input.evidenceLinkId);
    return response.status(201).json(linkPersonaClaimEvidence({
      spaceId: space.id,
      personaId: String(request.params.personaId),
      personaVersionId: String(request.params.versionId),
      claimId: String(request.params.claimId),
      evidenceLinkId: input.evidenceLinkId,
      expectedRevision: input.expectedRevision,
      actorUserId: user.id
    }));
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.post('/:personaId/versions/:versionId/submit', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = personaGovernanceBody.parse(request.body || {});
    const version = getPersonaVersion(space.id, String(request.params.personaId), String(request.params.versionId));
    if (!version) throw new JourneyPersonaVersionError('Persona version not found.', 404, 'JOURNEY_PERSONA_VERSION_NOT_FOUND');
    for (const evidence of version.claims.flatMap((claim) => claim.evidence)) {
      getEvidenceLinkSource(space.id, user.id, evidence.evidenceLinkId);
    }
    return response.json(submitPersonaVersion({
      spaceId: space.id,
      personaId: String(request.params.personaId),
      personaVersionId: String(request.params.versionId),
      expectedRevision: input.expectedRevision,
      actorUserId: user.id,
      comment: input.comment
    }));
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.post('/:personaId/versions/:versionId/review', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = personaGovernanceBody.extend({
      decision: z.enum(['approved', 'changes_requested'])
    }).parse(request.body || {});
    const version = getPersonaVersion(space.id, String(request.params.personaId), String(request.params.versionId));
    if (!version) throw new JourneyPersonaVersionError('Persona version not found.', 404, 'JOURNEY_PERSONA_VERSION_NOT_FOUND');
    if (input.decision === 'approved') {
      for (const evidence of version.claims.flatMap((claim) => claim.evidence)) {
        getEvidenceLinkSource(space.id, user.id, evidence.evidenceLinkId);
      }
    }
    return response.json(decidePersonaVersion({
      spaceId: space.id,
      personaId: String(request.params.personaId),
      personaVersionId: String(request.params.versionId),
      expectedRevision: input.expectedRevision,
      actorUserId: user.id,
      decision: input.decision,
      comment: input.comment
    }));
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.post('/:personaId/versions/:versionId/withdraw', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = personaGovernanceBody.parse(request.body || {});
    return response.json(withdrawPersonaReview({
      spaceId: space.id,
      personaId: String(request.params.personaId),
      personaVersionId: String(request.params.versionId),
      expectedRevision: input.expectedRevision,
      actorUserId: user.id,
      comment: input.comment
    }));
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.patch('/:personaId', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      expectedRevision: revision,
      ...personaBody,
      name: title.optional()
    }).strict().parse(request.body || {});
    const { expectedRevision, ...persona } = input;
    return response.json(updateJourneyPersona(space.id, String(request.params.personaId), expectedRevision, persona, user.id));
  } catch (error) { return sendError(response, error); }
});

journeyPersonaRouter.delete('/:personaId', (request, response) => {
  try {
    const { space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    deleteJourneyPersona(space.id, String(request.params.personaId), input.expectedRevision);
    return response.status(204).end();
  } catch (error) { return sendError(response, error); }
});

journeyEvidenceRouter.get('/', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({
      targetType: z.enum(['card', 'stage', 'persona', 'definition']),
      targetId: z.string().trim().min(1).max(200)
    }).parse(request.query);
    return response.json({ links: listEvidenceLinks(space.id, user.id, query.targetType, query.targetId) });
  } catch (error) { return sendError(response, error); }
});

/** Search remains type-specific and bounded so one drawer interaction cannot
 * become a broad export of workspace research. Returned metadata is resolved
 * from the source of record under the current viewer's permissions. */
journeyEvidenceRouter.get('/sources', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({
      sourceType: z.enum(discoverableJourneyEvidenceSourceTypes),
      query: z.string().trim().max(120).optional().default(''),
      limit: z.coerce.number().int().min(1).max(50).optional().default(20)
    }).strict().parse(request.query);
    return response.json({
      sources: searchJourneyEvidenceSources({
        spaceId: space.id, userId: user.id, sourceType: query.sourceType,
        query: query.query, limit: query.limit
      }),
      supportedSourceTypes: discoverableJourneyEvidenceSourceTypes,
      limit: query.limit
    });
  } catch (error) { return sendError(response, error); }
});

/** Resolve the source of record at read time. The evidence drawer receives
 * bounded metadata only after the current viewer passes space, plan, private
 * knowledge, and assistant-ownership checks. */
journeyEvidenceRouter.get('/:linkId/source', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ source: getEvidenceLinkSource(space.id, user.id, String(request.params.linkId)) });
  } catch (error) { return sendError(response, error); }
});

journeyEvidenceRouter.get('/:linkId/audit', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().default(50)
    }).strict().parse(request.query);
    return response.json({
      events: listEvidenceAuditEvents(space.id, String(request.params.linkId), query.limit)
    });
  } catch (error) { return sendError(response, error); }
});

journeyEvidenceRouter.post('/:linkId/refresh', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u) })
      .strict().parse(request.body || {});
    return response.json(refreshEvidenceLink(
      space.id, user.id, String(request.params.linkId), input.expectedFingerprint
    ));
  } catch (error) { return sendError(response, error); }
});

journeyEvidenceRouter.post('/', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      targetType: z.enum(['card', 'stage', 'persona', 'definition']),
      targetId: z.string().trim().min(1).max(200),
      sourceType: z.enum(evidenceSourceTypes),
      sourceRef: z.string().trim().min(1).max(400),
      sourceLabel: optionalTitle.optional(),
      excerpt: content.optional(),
      assessment: z.enum(evidenceAssessments).optional(),
      confidence: z.number().min(0).max(1).optional(),
      population: optionalTitle.optional(),
      sampleSize: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
      collectedAt: timestamp.optional(),
      windowStart: timestamp.optional(),
      windowEnd: timestamp.optional(),
      freshnessDays: z.number().int().min(1).max(3650).nullable().optional()
    }).strict().parse(request.body || {});
    return response.status(201).json(attachEvidenceLink(space.id, user.id, input));
  } catch (error) { return sendError(response, error); }
});

journeyEvidenceRouter.patch('/:linkId', (request, response) => {
  try {
    const { user, space } = context(request);
    requireEditor(space);
    const input = z.object({
      assessment: z.enum(evidenceAssessments).optional(),
      confidence: z.number().min(0).max(1).optional(),
      invalidated: z.boolean().optional(),
      reason: content.optional()
    }).strict().parse(request.body || {});
    return response.json(assessEvidenceLink(space.id, String(request.params.linkId), input, user.id));
  } catch (error) { return sendError(response, error); }
});

journeyEvidenceRouter.delete('/:linkId', (request, response) => {
  try {
    const { space } = context(request);
    requireEditor(space);
    detachEvidenceLink(space.id, String(request.params.linkId));
    return response.status(204).end();
  } catch (error) { return sendError(response, error); }
});
