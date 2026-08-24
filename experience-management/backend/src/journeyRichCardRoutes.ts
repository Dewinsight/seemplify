import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import {
  assertJourneyDefinitionReadAllowed, effectiveJourneyRollout
} from './journeyRollout.js';
import { getJourneyMap, JourneyMapError } from './journeyMaps.js';
import {
  attachJourneyCardAsset, createJourneyChannel, createJourneyTouchpoint, deleteJourneyCardAsset,
  getJourneyCardAssetContent, getJourneyCardRichDetail, getJourneyRichMapSnapshot,
  JourneyRichCardError, journeyChannelCategories, journeyRichCardLimits, linkJourneyCardTouchpoint,
  listJourneyChannels, listJourneyRichCardAudit, listJourneyTouchpoints, restoreJourneyCardAsset,
  retireJourneyChannel, retireJourneyTouchpoint, unlinkJourneyCardTouchpoint,
  updateJourneyCardRichDetail, updateJourneyChannel, updateJourneyTouchpoint
} from './journeyRichCards.js';
import { resolveRequestSpace, spaceRoleOrIdpPermission, SpaceError } from './spaces.js';
import {
  assertSubscriptionFeature, SubscriptionEntitlementError
} from './subscriptionEntitlements.js';

export const journeyRichCardRouter = express.Router();

journeyRichCardRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  const space = resolveRequestSpace(request, user.id);
  assertSubscriptionFeature(space.id, 'journeyDesign');
  assertSubscriptionFeature(space.id, 'journeyRichCards');
  return { user, space };
}

function requireEditor(space: ReturnType<typeof resolveRequestSpace>) {
  if (!spaceRoleOrIdpPermission(space, 'journeys.edit')) {
    throw new JourneyRichCardError('You do not have permission to change rich journey cards in this space.', 403,
      'JOURNEY_RICH_CARD_FORBIDDEN');
  }
}

function requireMapRead(spaceId: string, userId: string, definitionId: string, versionId?: string) {
  const map = getJourneyMap(spaceId, definitionId, versionId, userId);
  if (!map) throw new JourneyRichCardError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  assertJourneyDefinitionReadAllowed(spaceId, map);
  return map;
}

/** Rich fields cannot be projected into the legacy JSON shape. During a
 * dual-write window they therefore fail closed rather than appearing saved in
 * V2 and then disappearing when legacy reconciliation runs. */
function requireRichWriteCutover(spaceId: string, definitionId: string) {
  const map = getJourneyMap(spaceId, definitionId);
  if (!map) throw new JourneyRichCardError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  const rollout = effectiveJourneyRollout(spaceId);
  if (!rollout.v2Write) {
    throw new JourneyRichCardError('Journey Map 2.0 writes are disabled for this space.', 403,
      'JOURNEY_V2_WRITE_DISABLED');
  }
  if (map.definition.legacyJourneyId && rollout.dualWrite) {
    throw new JourneyRichCardError(
      'Rich cards are available after this legacy journey leaves dual-write mode. No changes were saved.',
      409,
      'JOURNEY_RICH_CARD_LEGACY_CUTOVER_REQUIRED'
    );
  }
  return map;
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: 'Validation failed', code: 'JOURNEY_RICH_CARD_VALIDATION', details: error.issues });
  }
  if (error instanceof JourneyRichCardError || error instanceof JourneyMapError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  if (error instanceof SpaceError) return response.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  }
  return response.status(500).json({ error: error instanceof Error ? error.message : 'Rich journey card request failed.' });
}

const uuid = z.string().uuid();
const revision = z.number().int().min(1);
const catalogName = z.string().trim().min(1).max(journeyRichCardLimits.catalogNameCharacters);
const catalogDescription = z.string().max(journeyRichCardLimits.catalogDescriptionCharacters);

journeyRichCardRouter.get('/catalog', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({ includeRetired: z.enum(['true', 'false']).optional() }).strict().parse(request.query);
    const includeRetired = query.includeRetired === 'true';
    return response.json({
      channels: listJourneyChannels(space.id, includeRetired),
      touchpoints: listJourneyTouchpoints(space.id, includeRetired),
      categories: journeyChannelCategories,
      limits: journeyRichCardLimits
    });
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.post('/channels', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const input = z.object({ name: catalogName, description: catalogDescription.optional(),
      category: z.enum(journeyChannelCategories) }).strict().parse(request.body || {});
    return response.status(201).json(createJourneyChannel(space.id, user.id, input));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.patch('/channels/:channelId', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const input = z.object({ expectedRevision: revision, name: catalogName.optional(),
      description: catalogDescription.optional(), category: z.enum(journeyChannelCategories).optional() })
      .strict().refine((value) => value.name !== undefined || value.description !== undefined || value.category !== undefined,
        'A channel update requires at least one field.').parse(request.body || {});
    const { expectedRevision, ...patch } = input;
    return response.json(updateJourneyChannel(space.id, user.id, String(request.params.channelId), expectedRevision, patch));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.post('/channels/:channelId/retire', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(retireJourneyChannel(space.id, user.id, String(request.params.channelId), input.expectedRevision));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.post('/touchpoints', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const input = z.object({ name: catalogName, description: catalogDescription.optional(), channelId: uuid })
      .strict().parse(request.body || {});
    return response.status(201).json(createJourneyTouchpoint(space.id, user.id, input));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.patch('/touchpoints/:touchpointId', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const input = z.object({ expectedRevision: revision, name: catalogName.optional(),
      description: catalogDescription.optional(), channelId: uuid.optional() }).strict()
      .refine((value) => value.name !== undefined || value.description !== undefined || value.channelId !== undefined,
        'A touchpoint update requires at least one field.').parse(request.body || {});
    const { expectedRevision, ...patch } = input;
    return response.json(updateJourneyTouchpoint(space.id, user.id, String(request.params.touchpointId),
      expectedRevision, patch));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.post('/touchpoints/:touchpointId/retire', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(retireJourneyTouchpoint(space.id, user.id, String(request.params.touchpointId), input.expectedRevision));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.get('/maps/:definitionId', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ versionId: z.string().trim().min(1).max(128).optional() }).strict().parse(request.query);
    requireMapRead(space.id, user.id, String(request.params.definitionId), query.versionId);
    return response.json(getJourneyRichMapSnapshot(space.id, String(request.params.definitionId), query.versionId));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.get('/maps/:definitionId/cards/:cardId', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ includeDeletedAssets: z.enum(['true', 'false']).optional() }).strict().parse(request.query);
    requireMapRead(space.id, user.id, String(request.params.definitionId));
    return response.json(getJourneyCardRichDetail(space.id, String(request.params.definitionId),
      String(request.params.cardId), query.includeDeletedAssets === 'true'));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.put('/maps/:definitionId/cards/:cardId', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const definitionId = String(request.params.definitionId); requireRichWriteCutover(space.id, definitionId);
    const input = z.object({ expectedRevision: revision, expectedDetailRevision: z.number().int().min(0),
      richText: z.unknown(), emotion: z.unknown().optional() }).strict().parse(request.body || {});
    return response.json(updateJourneyCardRichDetail(space.id, user.id, definitionId,
      String(request.params.cardId), input));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.post('/maps/:definitionId/cards/:cardId/touchpoints', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const definitionId = String(request.params.definitionId); requireRichWriteCutover(space.id, definitionId);
    const input = z.object({ expectedRevision: revision, touchpointId: uuid }).strict().parse(request.body || {});
    return response.status(201).json(linkJourneyCardTouchpoint(space.id, user.id, definitionId,
      String(request.params.cardId), input));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.delete('/maps/:definitionId/cards/:cardId/touchpoints/:touchpointId', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const definitionId = String(request.params.definitionId); requireRichWriteCutover(space.id, definitionId);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(unlinkJourneyCardTouchpoint(space.id, user.id, definitionId,
      String(request.params.cardId), String(request.params.touchpointId), input.expectedRevision));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.post('/maps/:definitionId/cards/:cardId/assets', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const definitionId = String(request.params.definitionId); requireRichWriteCutover(space.id, definitionId);
    const input = z.object({
      expectedRevision: revision,
      kind: z.enum(['image', 'attachment']),
      uploadId: uuid.optional(),
      externalUrl: z.string().max(journeyRichCardLimits.externalUrlCharacters).optional(),
      displayName: z.string().max(journeyRichCardLimits.assetNameCharacters).optional(),
      mimeType: z.string().max(160).optional(),
      altText: z.string().max(journeyRichCardLimits.altTextCharacters).optional(),
      caption: z.string().max(journeyRichCardLimits.captionCharacters).optional()
    }).strict().refine((value) => Boolean(value.uploadId) !== Boolean(value.externalUrl),
      'Choose exactly one upload or external URL.').parse(request.body || {});
    return response.status(201).json(attachJourneyCardAsset(space.id, user.id, definitionId,
      String(request.params.cardId), { ...input, canClaimSpaceUploads: space.role === 'owner' }));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.delete('/maps/:definitionId/cards/:cardId/assets/:assetId', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const definitionId = String(request.params.definitionId); requireRichWriteCutover(space.id, definitionId);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(deleteJourneyCardAsset(space.id, user.id, definitionId,
      String(request.params.cardId), String(request.params.assetId), input.expectedRevision));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.post('/maps/:definitionId/cards/:cardId/assets/:assetId/restore', (request, response) => {
  try {
    const { user, space } = context(request); requireEditor(space);
    const definitionId = String(request.params.definitionId); requireRichWriteCutover(space.id, definitionId);
    const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
    return response.json(restoreJourneyCardAsset(space.id, user.id, definitionId,
      String(request.params.cardId), String(request.params.assetId), input.expectedRevision));
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.get('/assets/:assetId/content', (request, response) => {
  try {
    const { user, space } = context(request);
    const artifact = getJourneyCardAssetContent(space.id, String(request.params.assetId));
    requireMapRead(space.id, user.id, artifact.definitionId);
    const asciiFilename = artifact.displayName.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 180) || 'asset';
    response.setHeader('Content-Type', artifact.mimeType);
    response.setHeader('Content-Length', String(artifact.bytes.length));
    response.setHeader('Content-Disposition', `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(artifact.displayName)}`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('ETag', `"sha256-${artifact.sha256}"`);
    return response.send(artifact.bytes);
  } catch (error) { return sendError(response, error); }
});

journeyRichCardRouter.get('/audit', (request, response) => {
  try {
    const { space } = context(request); requireEditor(space);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional() }).strict().parse(request.query);
    return response.json({ events: listJourneyRichCardAudit(space.id, query.limit, query.offset) });
  } catch (error) { return sendError(response, error); }
});
