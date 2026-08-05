import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import {
  createJourneyStageRule, journeyStageDecisionExplain, JourneyStageRuleRepositoryError,
  listJourneyStageRules, publishJourneyStageRule, retireJourneyStageRule, simulateJourneyStageRules,
  updateJourneyStageRuleDraft
} from './journeyStageRuleRepository.js';
import {
  getJourneyAnonymousInstance, journeyAnonymousInstanceAggregates, JourneyStageProcessingError,
  listJourneyAnonymousInstances
} from './journeyStageProcessing.js';
import { journeyStagePredicateOperators, journeyStageRuleRoles } from './journeyStageRules.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

export const journeyStageRuleRouter = express.Router();

journeyStageRuleRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}

function editor(request: express.Request) {
  const resolved = context(request);
  if (resolved.space.role === 'member') throw new JourneyStageRuleRepositoryError(
    'You do not have permission to manage journey stage rules.', 403, 'JOURNEY_STAGE_RULE_FORBIDDEN'
  );
  return resolved;
}

function error(response: express.Response, value: unknown) {
  if (value instanceof z.ZodError) return response.status(400).json({
    error: 'Stage-rule validation failed.', code: 'JOURNEY_STAGE_RULE_INPUT_INVALID', details: value.issues
  });
  if (value instanceof JourneyStageRuleRepositoryError) return response.status(value.status).json({ error: value.message, code: value.code });
  if (value instanceof JourneyStageProcessingError) return response.status(value.status).json({ error: value.message, code: value.code });
  if (value instanceof SpaceError) return response.status(value.status).json({ error: value.message, code: value.code });
  if (value instanceof SubscriptionEntitlementError) return response.status(value.status).json({ error: value.message, code: value.code });
  return response.status(500).json({ error: 'Journey stage-rule request failed.', code: 'JOURNEY_STAGE_RULE_UNAVAILABLE' });
}

const scalar = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
const predicate = z.object({
  path: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/u), operator: z.enum(journeyStagePredicateOperators),
  value: z.union([scalar, z.array(scalar).max(100)]).optional()
}).strict();
const priorEvent = z.object({
  eventName: z.string().trim().min(1).max(128),
  withinSeconds: z.number().int().min(0).max(366 * 24 * 60 * 60).nullable().optional()
}).strict();
const draft = z.object({
  name: z.string().trim().min(1).max(160),
  journeyMapVersionId: z.string().trim().min(1).max(128),
  stageKey: z.string().trim().min(1).max(128),
  role: z.enum(journeyStageRuleRoles),
  priority: z.number().int().min(-1_000_000).max(1_000_000),
  eventName: z.string().trim().min(1).max(128),
  sourceIds: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  environments: z.array(z.enum(['development', 'staging', 'production'])).max(3).optional(),
  predicates: z.array(predicate).max(20).optional(),
  requiredPriorEvents: z.array(priorEvent).max(20).optional(),
  excludedEventNames: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  effectiveAt: z.string().datetime({ offset: true }).nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional()
}).strict().superRefine((value, issue) => {
  if (value.effectiveAt && value.expiresAt && Date.parse(value.expiresAt) <= Date.parse(value.effectiveAt)) {
    issue.addIssue({ code: 'custom', path: ['expiresAt'], message: 'expiresAt must be later than effectiveAt.' });
  }
});
const revision = z.object({ expectedRevision: z.number().int().min(1) }).strict();
const ruleEvent = z.object({
  messageId: z.string().trim().min(1).max(200), eventName: z.string().trim().min(1).max(128),
  timestamp: z.string().datetime({ offset: true }), subjectId: z.string().trim().min(1).max(200),
  sourceId: z.string().trim().min(1).max(128), environment: z.enum(['development', 'staging', 'production']),
  properties: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 65_536,
    'Simulation properties exceed 64 KiB.')
}).strict();

journeyStageRuleRouter.get('/:journeyDefinitionId', (request, response) => {
  try {
    const { space } = context(request);
    return response.json(listJourneyStageRules(space.id, String(request.params.journeyDefinitionId)));
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.post('/:journeyDefinitionId/rules', (request, response) => {
  try {
    const { user, space } = editor(request);
    const parsed = draft.parse(request.body || {});
    return response.status(201).json({ rule: createJourneyStageRule({ spaceId: space.id,
      journeyDefinitionId: String(request.params.journeyDefinitionId), actorUserId: user.id, draft: parsed }) });
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.put('/:journeyDefinitionId/rules/:ruleDefinitionId/draft', (request, response) => {
  try {
    const { user, space } = editor(request);
    const parsed = z.object({ expectedRevision: z.number().int().min(1), draft }).strict().parse(request.body || {});
    return response.json({ rule: updateJourneyStageRuleDraft({ spaceId: space.id,
      journeyDefinitionId: String(request.params.journeyDefinitionId),
      ruleDefinitionId: String(request.params.ruleDefinitionId), actorUserId: user.id,
      expectedRevision: parsed.expectedRevision, draft: parsed.draft }) });
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.post('/:journeyDefinitionId/rules/:ruleDefinitionId/publish', (request, response) => {
  try {
    const { user, space } = editor(request); const parsed = revision.parse(request.body || {});
    return response.json(publishJourneyStageRule({ spaceId: space.id,
      journeyDefinitionId: String(request.params.journeyDefinitionId),
      ruleDefinitionId: String(request.params.ruleDefinitionId), actorUserId: user.id,
      expectedRevision: parsed.expectedRevision }));
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.post('/:journeyDefinitionId/rules/:ruleDefinitionId/retire', (request, response) => {
  try {
    const { user, space } = editor(request); const parsed = revision.parse(request.body || {});
    return response.json(retireJourneyStageRule({ spaceId: space.id,
      journeyDefinitionId: String(request.params.journeyDefinitionId),
      ruleDefinitionId: String(request.params.ruleDefinitionId), actorUserId: user.id,
      expectedRevision: parsed.expectedRevision }));
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.post('/:journeyDefinitionId/simulate', (request, response) => {
  try {
    const { user, space } = editor(request);
    const parsed = z.object({ useDrafts: z.boolean().default(true), event: ruleEvent,
      history: z.array(ruleEvent).max(1000).optional() }).strict().parse(request.body || {});
    return response.json(simulateJourneyStageRules({ spaceId: space.id,
      journeyDefinitionId: String(request.params.journeyDefinitionId), actorUserId: user.id,
      useDrafts: parsed.useDrafts, event: parsed.event, history: parsed.history }));
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.get('/:journeyDefinitionId/decisions/:decisionId', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ decision: journeyStageDecisionExplain({ spaceId: space.id,
      journeyDefinitionId: String(request.params.journeyDefinitionId), decisionId: String(request.params.decisionId),
      actorUserId: user.id }) });
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.get('/:journeyDefinitionId/aggregates', (request, response) => {
  try {
    const { space } = context(request);
    return response.json(journeyAnonymousInstanceAggregates(space.id, String(request.params.journeyDefinitionId)));
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.get('/:journeyDefinitionId/instances', (request, response) => {
  try {
    const { space } = context(request);
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(request.query.limit);
    return response.json({ instances: listJourneyAnonymousInstances(space.id,
      String(request.params.journeyDefinitionId), limit) });
  } catch (value) { return error(response, value); }
});

journeyStageRuleRouter.get('/:journeyDefinitionId/instances/:instanceId', (request, response) => {
  try {
    const { space } = context(request);
    return response.json(getJourneyAnonymousInstance(space.id, String(request.params.journeyDefinitionId),
      String(request.params.instanceId)));
  } catch (value) { return error(response, value); }
});
