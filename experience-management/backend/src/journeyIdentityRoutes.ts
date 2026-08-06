import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import type {
  ExactIdentityIdentifierKind,
  JourneyIdentityCommand,
  JourneyIdentityIdentifier
} from './journeyIdentityPolicy.js';
import {
  applyJourneyIdentityCommandAndTimeline,
  createJourneyIdentityGroup,
  createJourneyProfilePrivacyJob,
  createJourneyIdentitySegment,
  createJourneyIdentitySegmentVersion,
  getJourneyIdentityGroupDetail,
  getJourneyIdentityProfileDetail,
  getJourneyIdentitySegmentDetail,
  getJourneyIdentitySessionDetail,
  isJourneyProfileSuppressedForAnyPurpose,
  getJourneyProfilePrivacyJob,
  getJourneyProfileExportJob,
  listJourneyProfilePrivacyStates,
  listJourneyIdentityCorrectionRuns,
  createJourneyProfileExportJob,
  getJourneyAccountCustomer360,
  getJourneyProfileCustomer360,
  upsertJourneyProfilePrivacyState,
  journeyIdentityActor,
  JourneyIdentityRepositoryError,
  listJourneyIdentityAudit,
  listJourneyGroupTimeline,
  listJourneyIdentityGroups,
  listJourneyIdentityProfiles,
  listJourneyIdentitySegments,
  listJourneyProfileSessions,
  listJourneyProfileTimeline,
  resolveJourneyIdentityForSpace
} from './journeyIdentityRepository.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

export const journeyIdentityRouter = express.Router();

journeyIdentityRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  const space = resolveRequestSpace(request, user.id);
  return { user, space };
}

function editor(request: express.Request) {
  const resolved = context(request);
  if (resolved.space.role === 'member') {
    throw new JourneyIdentityRepositoryError(
      'You do not have permission to manage journey identities.',
      403,
      'JOURNEY_IDENTITY_FORBIDDEN'
    );
  }
  return resolved;
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return response.status(400).json({
      error: 'Journey identity validation failed.',
      code: 'JOURNEY_IDENTITY_INPUT_INVALID',
      details: error.issues
    });
  }
  if (error instanceof JourneyIdentityRepositoryError || error instanceof SpaceError || error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({
      error: error.message,
      code: error.code,
      ...('details' in error && error.details ? { details: error.details } : {})
    });
  }
  return response.status(500).json({ error: 'Journey identity request failed.', code: 'JOURNEY_IDENTITY_UNAVAILABLE' });
}

const id = z.string().trim().min(1).max(128);
const exactIdentifierKind = z.enum(['anonymous_id', 'authenticated_user_id', 'external_user_id'] as const satisfies ExactIdentityIdentifierKind[]);
const identifierSchema = z.object({
  kind: exactIdentifierKind,
  namespace: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(512)
}).strict();
const sourceFactSchema = z.object({
  factId: z.string().trim().min(1).max(128),
  source: z.string().trim().min(1).max(160),
  sourceRef: z.string().trim().min(1).max(400),
  occurredAt: z.string().datetime({ offset: true })
}).strict();
const groupType = z.enum(['account', 'group']);
const groupSchema = z.object({
  id,
  groupType,
  name: z.string().trim().min(1).max(200),
  externalRef: z.string().trim().min(1).max(200).optional().nullable()
}).strict();
const segmentRuleSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  clauses: z.array(z.object({
    field: z.enum(['profile.kind', 'membership.accountId', 'membership.groupId']),
    op: z.literal('eq'),
    value: z.string().trim().min(1).max(200)
  }).strict()).min(1).max(32)
}).strict();
const segmentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  rule: segmentRuleSchema
}).strict();
const segmentVersionSchema = z.object({
  rule: segmentRuleSchema
}).strict();
const customer360Purpose = z.enum(['analytics', 'personalisation', 'research_contact', 'marketing']);
const privacyStateSchema = z.object({
  purpose: customer360Purpose,
  state: z.enum(['unknown', 'granted', 'denied', 'suppressed']),
  lawfulBasis: z.string().trim().max(160).optional().nullable(),
  policyReference: z.string().trim().max(200).optional().nullable()
}).strict();
const privacyJobSchema = z.object({
  operation: z.enum(['suppress', 'erasure']),
  purpose: customer360Purpose.optional().nullable(),
  lawfulBasis: z.string().trim().max(160).optional().nullable(),
  policyReference: z.string().trim().max(200).optional().nullable(),
  reason: z.string().trim().max(400).optional().nullable()
}).strict();
const baseCommand = {
  commandId: z.string().trim().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true })
};

const commandSchema = z.discriminatedUnion('type', [
  z.object({
    ...baseCommand,
    type: z.literal('observe'),
    profileId: id,
    profileKind: z.enum(['anonymous', 'known']),
    identifier: identifierSchema,
    sourceFact: sourceFactSchema
  }).strict(),
  z.object({
    ...baseCommand,
    type: z.literal('identify'),
    profile: z.object({ profileId: id }).strict(),
    identifier: identifierSchema,
    sourceFact: sourceFactSchema
  }).strict(),
  z.object({
    ...baseCommand,
    type: z.literal('alias'),
    profile: z.object({ profileId: id }).strict(),
    identifier: identifierSchema,
    reason: z.string().trim().min(1).max(4000)
  }).strict(),
  z.object({
    ...baseCommand,
    type: z.literal('merge'),
    source: z.object({ profileId: id }).strict(),
    target: z.object({ profileId: id }).strict(),
    reason: z.string().trim().min(1).max(4000)
  }).strict(),
  z.object({
    ...baseCommand,
    type: z.literal('split'),
    mergeAuditId: id,
    reason: z.string().trim().min(1).max(4000)
  }).strict(),
  z.object({
    ...baseCommand,
    type: z.literal('add_membership'),
    profile: z.object({ profileId: id }).strict(),
    group: z.object({ groupType, groupId: id }).strict(),
    sourceFact: sourceFactSchema
  }).strict(),
  z.object({
    ...baseCommand,
    type: z.literal('remove_membership'),
    membershipId: id,
    reason: z.string().trim().min(1).max(4000)
  }).strict(),
  z.object({
    ...baseCommand,
    type: z.literal('delete'),
    profile: z.object({ profileId: id }).strict(),
    reason: z.string().trim().min(1).max(4000)
  }).strict()
]);

function commandForSpace(input: {
  parsed: z.infer<typeof commandSchema>;
  actorUserId: string;
  spaceId: string;
  role: 'owner' | 'admin' | 'member';
}): JourneyIdentityCommand {
  const actor = journeyIdentityActor({ actorUserId: input.actorUserId, spaceId: input.spaceId, role: input.role });
  const command = input.parsed;
  switch (command.type) {
    case 'observe':
      return {
        policyVersion: 'journey.identity-policy.v1',
        type: 'observe',
        commandId: command.commandId,
        spaceId: input.spaceId,
        occurredAt: command.occurredAt,
        actor,
        profileId: command.profileId,
        profileKind: command.profileKind,
        identifier: command.identifier,
        sourceFact: command.sourceFact
      };
    case 'identify':
      return {
        policyVersion: 'journey.identity-policy.v1',
        type: 'identify',
        commandId: command.commandId,
        spaceId: input.spaceId,
        occurredAt: command.occurredAt,
        actor,
        profile: { spaceId: input.spaceId, profileId: command.profile.profileId },
        identifier: command.identifier,
        sourceFact: command.sourceFact
      };
    case 'alias':
      return {
        policyVersion: 'journey.identity-policy.v1',
        type: 'alias',
        commandId: command.commandId,
        spaceId: input.spaceId,
        occurredAt: command.occurredAt,
        actor,
        profile: { spaceId: input.spaceId, profileId: command.profile.profileId },
        identifier: command.identifier,
        reason: command.reason
      };
    case 'merge':
      return {
        policyVersion: 'journey.identity-policy.v1',
        type: 'merge',
        commandId: command.commandId,
        spaceId: input.spaceId,
        occurredAt: command.occurredAt,
        actor,
        source: { spaceId: input.spaceId, profileId: command.source.profileId },
        target: { spaceId: input.spaceId, profileId: command.target.profileId },
        reason: command.reason
      };
    case 'split':
      return {
        policyVersion: 'journey.identity-policy.v1',
        type: 'split',
        commandId: command.commandId,
        spaceId: input.spaceId,
        occurredAt: command.occurredAt,
        actor,
        mergeAuditId: command.mergeAuditId,
        reason: command.reason
      };
    case 'add_membership':
      return {
        policyVersion: 'journey.identity-policy.v1',
        type: 'add_membership',
        commandId: command.commandId,
        spaceId: input.spaceId,
        occurredAt: command.occurredAt,
        actor,
        profile: { spaceId: input.spaceId, profileId: command.profile.profileId },
        group: { spaceId: input.spaceId, groupType: command.group.groupType, groupId: command.group.groupId },
        sourceFact: command.sourceFact
      };
    case 'remove_membership':
      return {
        policyVersion: 'journey.identity-policy.v1',
        type: 'remove_membership',
        commandId: command.commandId,
        spaceId: input.spaceId,
        occurredAt: command.occurredAt,
        actor,
        membershipId: command.membershipId,
        reason: command.reason
      };
    case 'delete':
      return {
        policyVersion: 'journey.identity-policy.v1',
        type: 'delete',
        commandId: command.commandId,
        spaceId: input.spaceId,
        occurredAt: command.occurredAt,
        actor,
        profile: { spaceId: input.spaceId, profileId: command.profile.profileId },
        reason: command.reason
      };
  }
}

journeyIdentityRouter.get('/profiles', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({
      kind: z.enum(['anonymous', 'known']).optional(),
      status: z.enum(['active', 'deleted']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).strict().parse(request.query);
    return response.json({ profiles: listJourneyIdentityProfiles({ spaceId: space.id, ...query }) });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/profiles/:profileId', (request, response) => {
  try {
    const { space } = context(request);
    const profileId = id.parse(request.params.profileId);
    if (isJourneyProfileSuppressedForAnyPurpose({ spaceId: space.id, profileId })) {
      return response.status(404).json({ error: 'Journey profile not found.', code: 'JOURNEY_PROFILE_NOT_FOUND' });
    }
    return response.json(getJourneyIdentityProfileDetail({ spaceId: space.id, profileId }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/profiles/:profileId/timeline', (request, response) => {
  try {
    const { space } = context(request);
    const profileId = id.parse(request.params.profileId);
    if (isJourneyProfileSuppressedForAnyPurpose({ spaceId: space.id, profileId })) {
      return response.json({ events: [] });
    }
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).strict().parse(request.query);
    return response.json({
      events: listJourneyProfileTimeline({ spaceId: space.id, profileId, ...query })
    });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/profiles/:profileId/sessions', (request, response) => {
  try {
    const { space } = context(request);
    const profileId = id.parse(request.params.profileId);
    if (isJourneyProfileSuppressedForAnyPurpose({ spaceId: space.id, profileId })) {
      return response.json({ sessions: [] });
    }
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).strict().parse(request.query);
    return response.json({
      sessions: listJourneyProfileSessions({ spaceId: space.id, profileId, ...query })
    });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/profiles/:profileId/customer-360', (request, response) => {
  try {
    const { space } = editor(request);
    const query = z.object({ purpose: customer360Purpose }).strict().parse(request.query);
    return response.json(getJourneyProfileCustomer360({
      spaceId: space.id,
      profileId: id.parse(request.params.profileId),
      purpose: query.purpose
    }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/profiles/:profileId/privacy', (request, response) => {
  try {
    const { space } = editor(request);
    return response.json({
      states: listJourneyProfilePrivacyStates({ spaceId: space.id, profileId: id.parse(request.params.profileId) })
    });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/profiles/:profileId/corrections', (request, response) => {
  try {
    const { space } = editor(request);
    const profileId = id.parse(request.params.profileId);
    if (isJourneyProfileSuppressedForAnyPurpose({ spaceId: space.id, profileId })) {
      return response.json({ runs: [] });
    }
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).strict().parse(request.query);
    return response.json({
      runs: listJourneyIdentityCorrectionRuns({
        spaceId: space.id,
        profileId,
        limit: query.limit,
        offset: query.offset
      })
    });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.put('/profiles/:profileId/privacy', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = privacyStateSchema.parse(request.body || {});
    return response.json({
      state: upsertJourneyProfilePrivacyState({
        spaceId: space.id,
        actorUserId: user.id,
        profileId: id.parse(request.params.profileId),
        purpose: body.purpose,
        state: body.state,
        lawfulBasis: body.lawfulBasis || null,
        policyReference: body.policyReference || null
      })
    });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.post('/profiles/:profileId/export', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ purpose: customer360Purpose }).strict().parse(request.body || {});
    const result = createJourneyProfileExportJob({
      spaceId: space.id,
      actorUserId: user.id,
      profileId: id.parse(request.params.profileId),
      purpose: body.purpose
    });
    return response.status(201).json(result);
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.post('/profiles/:profileId/privacy-jobs', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = privacyJobSchema.parse(request.body || {});
    const result = createJourneyProfilePrivacyJob({
      spaceId: space.id,
      actorUserId: user.id,
      profileId: id.parse(request.params.profileId),
      operation: body.operation,
      purpose: body.purpose || null,
      lawfulBasis: body.lawfulBasis || null,
      policyReference: body.policyReference || null,
      reason: body.reason || null
    });
    return response.status(result.job.state === 'queued' ? 202 : 201).json(result);
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/privacy-jobs/:jobId', (request, response) => {
  try {
    const { space } = editor(request);
    return response.json(getJourneyProfilePrivacyJob({ spaceId: space.id, jobId: id.parse(request.params.jobId) }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/exports/:jobId', (request, response) => {
  try {
    const { space } = editor(request);
    return response.json(getJourneyProfileExportJob({ spaceId: space.id, jobId: id.parse(request.params.jobId) }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/groups', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({
      groupType: groupType.optional(),
      status: z.enum(['active', 'archived']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).strict().parse(request.query);
    return response.json({ groups: listJourneyIdentityGroups({ spaceId: space.id, ...query }) });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.post('/groups', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = groupSchema.parse(request.body || {});
    const result = createJourneyIdentityGroup({
      spaceId: space.id,
      actorUserId: user.id,
      groupType: body.groupType,
      id: body.id,
      name: body.name,
      externalRef: body.externalRef || null
    });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/groups/:groupId', (request, response) => {
  try {
    const { space } = context(request);
    return response.json(getJourneyIdentityGroupDetail({ spaceId: space.id, groupId: id.parse(request.params.groupId) }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/groups/:groupId/timeline', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({
      groupType,
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).strict().parse(request.query);
    return response.json({
      events: listJourneyGroupTimeline({ spaceId: space.id, groupId: id.parse(request.params.groupId), ...query })
    });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/accounts/:accountId/customer-360', (request, response) => {
  try {
    const { space } = editor(request);
    const query = z.object({ purpose: customer360Purpose }).strict().parse(request.query);
    return response.json(getJourneyAccountCustomer360({
      spaceId: space.id,
      accountId: id.parse(request.params.accountId),
      purpose: query.purpose
    }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/segments', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({
      state: z.enum(['active', 'retired']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).strict().parse(request.query);
    return response.json({ segments: listJourneyIdentitySegments({ spaceId: space.id, ...query }) });
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.post('/segments', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = segmentSchema.parse(request.body || {});
    return response.status(201).json(createJourneyIdentitySegment({
      spaceId: space.id,
      actorUserId: user.id,
      name: body.name,
      description: body.description,
      rule: body.rule
    }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/segments/:segmentId', (request, response) => {
  try {
    const { space } = context(request);
    return response.json(getJourneyIdentitySegmentDetail({ spaceId: space.id, segmentId: id.parse(request.params.segmentId) }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.post('/segments/:segmentId/versions', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = segmentVersionSchema.parse(request.body || {});
    return response.status(201).json(createJourneyIdentitySegmentVersion({
      spaceId: space.id,
      actorUserId: user.id,
      segmentId: id.parse(request.params.segmentId),
      rule: body.rule
    }));
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/sessions/:sessionId', (request, response) => {
  try {
    const { space } = context(request);
    const detail = getJourneyIdentitySessionDetail({
      spaceId: space.id,
      sessionId: z.string().trim().min(1).max(128).parse(request.params.sessionId)
    });
    if (isJourneyProfileSuppressedForAnyPurpose({ spaceId: space.id, profileId: detail.session.profileId })) {
      return response.status(404).json({ error: 'Journey session not found.', code: 'JOURNEY_SESSION_NOT_FOUND' });
    }
    return response.json(detail);
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.post('/resolve', (request, response) => {
  try {
    const { space } = context(request);
    const body = z.object({ identifier: identifierSchema }).strict().parse(request.body || {});
    const resolved = resolveJourneyIdentityForSpace({ spaceId: space.id, identifier: body.identifier as JourneyIdentityIdentifier });
    if (resolved.status === 'resolved' && resolved.boundProfileId
        && isJourneyProfileSuppressedForAnyPurpose({ spaceId: space.id, profileId: resolved.boundProfileId })) {
      return response.json({
        status: 'not_found',
        code: 'profile_suppressed',
        explanation: 'The exact binding is not available from this surface.'
      });
    }
    return response.json(resolved);
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.post('/commands', (request, response) => {
  try {
    const { user, space } = editor(request);
    const parsed = commandSchema.parse(request.body || {});
    const transition = applyJourneyIdentityCommandAndTimeline({
      spaceId: space.id,
      command: commandForSpace({ parsed, actorUserId: user.id, spaceId: space.id, role: space.role })
    });
    return response.status(transition.result.status === 'accepted' ? 201 : 200).json(transition);
  } catch (error) { return sendError(response, error); }
});

journeyIdentityRouter.get('/audit', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).strict().parse(request.query);
    return response.json({ audit: listJourneyIdentityAudit({ spaceId: space.id, ...query }) });
  } catch (error) { return sendError(response, error); }
});
