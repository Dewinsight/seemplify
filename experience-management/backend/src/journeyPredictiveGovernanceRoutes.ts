import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import {
  approvePredictiveModel, evaluatePersistedPrediction, JourneyPredictiveRepositoryError,
  listPredictionRuns, listPredictiveGovernance, readPredictiveModel, recordDriftEvaluation,
  retirePredictiveModel, updatePredictionPolicy
} from './journeyPredictiveGovernanceRepository.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const token = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const iso = z.string().datetime({ offset: true });
const windowSchema = z.object({ from: iso, to: iso }).strict().refine(
  (value) => Date.parse(value.from) < Date.parse(value.to), { message: 'Window start must precede its end.' });
const targetSchema = z.enum(['churn', 'conversion']);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedRecord = z.record(token, z.number().finite().min(-1e12).max(1e12).nullable()).refine(
  (value) => Object.keys(value).length <= 100, 'At most 100 feature values are allowed.');
const contributionRecord = z.record(token, z.number().finite().min(-1e12).max(1e12)).refine(
  (value) => Object.keys(value).length <= 100, 'At most 100 feature contributions are allowed.');

const policySchema = z.object({
  enabled: z.boolean(), purpose: z.string().trim().min(1).max(500),
  minimumTrainingSamples: z.number().int().min(1).max(1_000_000_000),
  minimumClassSamples: z.number().int().min(1).max(1_000_000_000),
  minimumValidationSamples: z.number().int().min(1).max(1_000_000_000),
  minimumAreaUnderRoc: z.number().min(0).max(1), maximumBrierScore: z.number().min(0).max(1),
  maximumPopulationStabilityIndex: z.number().min(0).max(10),
  maximumMissingFeatureRatio: z.number().min(0).max(1),
  maximumOutOfDistributionScore: z.number().min(0).max(100)
}).strict();

const modelSchema = z.object({
  id: token, target: targetSchema, version: token, trainingWindow: windowSchema, validationWindow: windowSchema,
  trainingSamples: z.number().int().min(0).max(1_000_000_000), positiveSamples: z.number().int().min(0).max(1_000_000_000),
  negativeSamples: z.number().int().min(0).max(1_000_000_000), validationSamples: z.number().int().min(0).max(1_000_000_000),
  areaUnderRoc: z.number().min(0).max(1), brierScore: z.number().min(0).max(1),
  featureNames: z.array(token).min(1).max(100), trainedByUserId: token
}).strict().superRefine((value, context) => {
  if (Date.parse(value.validationWindow.from) < Date.parse(value.trainingWindow.to)) context.addIssue({
    code: 'custom', path: ['validationWindow'], message: 'Validation must follow the training window.' });
  if (value.positiveSamples + value.negativeSamples !== value.trainingSamples) context.addIssue({
    code: 'custom', path: ['trainingSamples'], message: 'Class samples must equal training samples.' });
  if (new Set(value.featureNames).size !== value.featureNames.length) context.addIssue({
    code: 'custom', path: ['featureNames'], message: 'Feature names must be unique.' });
});

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}
function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues });
  if (error instanceof JourneyPredictiveRepositoryError || error instanceof SpaceError || error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: 'details' in error ? error.details : {} });
  }
  console.error('Journey predictive governance request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'Journey predictive governance request failed.', code: 'JOURNEY_PREDICTIVE_INTERNAL_ERROR' });
}

export const journeyPredictiveGovernanceRouter = express.Router();
journeyPredictiveGovernanceRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store'); next();
});

journeyPredictiveGovernanceRouter.get('/', (request, response) => { try {
  const { user, space } = context(request);
  return response.json(listPredictiveGovernance({ spaceId: space.id, actorUserId: user.id }));
} catch (error) { return sendError(response, error); } });

journeyPredictiveGovernanceRouter.get('/models/:modelId', (request, response) => { try {
  const { user, space } = context(request);
  return response.json(readPredictiveModel({ spaceId: space.id, actorUserId: user.id, modelId: token.parse(request.params.modelId) }));
} catch (error) { return sendError(response, error); } });

journeyPredictiveGovernanceRouter.post('/models', (request, response) => { try {
  const { user, space } = context(request);
  const body = z.object({ name: z.string().trim().min(1).max(160), model: modelSchema }).strict().parse(request.body ?? {});
  return response.status(201).json(approvePredictiveModel({ spaceId: space.id, actorUserId: user.id, ...body }));
} catch (error) { return sendError(response, error); } });

journeyPredictiveGovernanceRouter.post('/models/:modelId/retire', (request, response) => { try {
  const { user, space } = context(request);
  const body = z.object({ expectedRevision: z.number().int().min(1) }).strict().parse(request.body ?? {});
  return response.json(retirePredictiveModel({ spaceId: space.id, actorUserId: user.id,
    modelId: token.parse(request.params.modelId), ...body }));
} catch (error) { return sendError(response, error); } });

journeyPredictiveGovernanceRouter.put('/policies/:target', (request, response) => { try {
  const { user, space } = context(request);
  const body = z.object({ expectedRevision: z.number().int().min(0), policy: policySchema }).strict().parse(request.body ?? {});
  return response.json(updatePredictionPolicy({ spaceId: space.id, actorUserId: user.id,
    target: targetSchema.parse(request.params.target), ...body }));
} catch (error) { return sendError(response, error); } });

journeyPredictiveGovernanceRouter.post('/models/:modelId/versions/:modelVersionId/drift-evaluations', (request, response) => { try {
  const { user, space } = context(request);
  const body = z.object({ populationStabilityIndex: z.number().min(0).max(10).nullable(),
    missingFeatureRatio: z.number().min(0).max(1), outOfDistributionScore: z.number().min(0).max(100).nullable() }).strict().parse(request.body ?? {});
  const modelId = token.parse(request.params.modelId);
  const result = recordDriftEvaluation({ spaceId: space.id, actorUserId: user.id, modelId,
    modelVersionId: token.parse(request.params.modelVersionId), ...body });
  return response.status(201).json(result);
} catch (error) { return sendError(response, error); } });

journeyPredictiveGovernanceRouter.post('/evaluations', (request, response) => { try {
  const { user, space } = context(request);
  const body = z.object({ modelVersionId: token, evaluatorKind: z.literal('governed_fixture'),
    request: z.object({ subjectId: token, purpose: z.string().trim().min(1).max(500), optedIn: z.boolean(),
      consentAllowed: z.boolean(), sourceWindow: windowSchema, score: z.number().min(0).max(1).nullable(),
      confidence: z.number().min(0).max(1).nullable(), featureValues: boundedRecord,
      featureContributions: contributionRecord }).strict() }).strict().parse(request.body ?? {});
  return response.status(201).json(evaluatePersistedPrediction({ spaceId: space.id, actorUserId: user.id,
    ...body }));
} catch (error) { return sendError(response, error); } });

journeyPredictiveGovernanceRouter.get('/runs', (request, response) => { try {
  const { user, space } = context(request);
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(request.query);
  return response.json({ runs: listPredictionRuns({ spaceId: space.id, actorUserId: user.id, ...query }) });
} catch (error) { return sendError(response, error); } });
