import {
  buildJourneyStageComparisons, buildJourneyStageTrends, JourneyStageIntelligenceError, journeyStageComparisonDimensions,
  journeyStagePurposes, type JourneyStageComparisonDimension, type JourneyStageIntelligenceFact,
  type JourneyStagePurpose
} from './journeyStageIntelligence.js';

export type JourneyStageIntelligencePrincipal = {
  userId: string;
  spaceId: string;
  role: 'owner' | 'admin' | 'member';
  capabilities: ReadonlySet<'journeys.read' | 'journeys.edit'>;
};

export type JourneyStageIntelligencePolicy = {
  revision: number;
  minimumSampleSize: number;
  dimensions: JourneyStageComparisonDimension[];
  maximumRows: number;
};

export type JourneyStageIntelligencePolicyUpdate = {
  expectedRevision: number;
  minimumSampleSize: number;
  dimensions: JourneyStageComparisonDimension[];
  maximumRows: number;
};

export type JourneyStageIntelligenceStorage = {
  loadFacts(input: { spaceId: string; journeyDefinitionId: string; from: string; to: string;
    asOf: string }): readonly JourneyStageIntelligenceFact[] | Promise<readonly JourneyStageIntelligenceFact[]>;
  readPolicy(spaceId: string): JourneyStageIntelligencePolicy | Promise<JourneyStageIntelligencePolicy>;
  updatePolicy(input: JourneyStageIntelligencePolicyUpdate & { spaceId: string; actorUserId: string }):
    JourneyStageIntelligencePolicy | Promise<JourneyStageIntelligencePolicy>;
  recordRead(input: { spaceId: string; actorUserId: string; action: 'comparison.read' | 'trend.read' | 'export.read';
    journeyDefinitionId: string; fingerprint: string; rowCount: number; suppressedRowCount: number }): void | Promise<void>;
};

export type JourneyStageIntelligenceQuery = {
  journeyDefinitionId: string;
  purpose: JourneyStagePurpose;
  from: string;
  to: string;
  asOf: string;
  dimensions?: JourneyStageComparisonDimension[];
};

function validatePolicy(policy: JourneyStageIntelligencePolicy) {
  if (!Number.isSafeInteger(policy.revision) || policy.revision < 1
      || !Number.isSafeInteger(policy.minimumSampleSize) || policy.minimumSampleSize < 3
      || policy.minimumSampleSize > 1_000 || !Number.isSafeInteger(policy.maximumRows)
      || policy.maximumRows < 1 || policy.maximumRows > 5_000 || !policy.dimensions.length
      || policy.dimensions.some((dimension) => !journeyStageComparisonDimensions.includes(dimension))) {
    throw new JourneyStageIntelligenceError('The server-owned stage intelligence policy is invalid.', 500,
      'JOURNEY_STAGE_INTELLIGENCE_POLICY_INVALID');
  }
  return { ...policy, dimensions: [...new Set(policy.dimensions)] };
}

export class JourneyStageIntelligenceRepository {
  constructor(private readonly storage: JourneyStageIntelligenceStorage) {}

  async readPolicy(principal: JourneyStageIntelligencePrincipal) {
    if (!principal.capabilities.has('journeys.read')) throw new JourneyStageIntelligenceError(
      'Journey read capability is required.', 403, 'JOURNEY_STAGE_INTELLIGENCE_READ_REQUIRED');
    return validatePolicy(await this.storage.readPolicy(principal.spaceId));
  }

  async updatePolicy(principal: JourneyStageIntelligencePrincipal, update: JourneyStageIntelligencePolicyUpdate) {
    if (!principal.capabilities.has('journeys.edit')) throw new JourneyStageIntelligenceError(
      'You do not have permission to configure journey stage intelligence.', 403,
      'JOURNEY_STAGE_INTELLIGENCE_EDIT_REQUIRED');
    return validatePolicy(await this.storage.updatePolicy({ ...update, spaceId: principal.spaceId,
      actorUserId: principal.userId }));
  }

  async compare(principal: JourneyStageIntelligencePrincipal, query: JourneyStageIntelligenceQuery,
    action: 'comparison.read' | 'export.read' = 'comparison.read') {
    if (!journeyStagePurposes.includes(query.purpose)) throw new JourneyStageIntelligenceError('Purpose is invalid.', 400,
      'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
    const policy = await this.readPolicy(principal);
    const requested = query.dimensions?.length ? [...new Set(query.dimensions)] : policy.dimensions;
    if (requested.some((dimension) => !policy.dimensions.includes(dimension))) {
      throw new JourneyStageIntelligenceError('A requested comparison dimension is disabled by policy.', 403,
        'JOURNEY_STAGE_INTELLIGENCE_DIMENSION_DISABLED');
    }
    const facts = await this.storage.loadFacts({ spaceId: principal.spaceId,
      journeyDefinitionId: query.journeyDefinitionId, from: query.from, to: query.to, asOf: query.asOf });
    const result = buildJourneyStageComparisons({ spaceId: principal.spaceId, actorSpaceId: principal.spaceId,
      actorRole: principal.role, purpose: query.purpose, from: query.from, to: query.to, asOf: query.asOf,
      minimumSampleSize: policy.minimumSampleSize, maximumRows: policy.maximumRows, dimensions: requested, facts });
    await this.storage.recordRead({ spaceId: principal.spaceId, actorUserId: principal.userId, action,
      journeyDefinitionId: query.journeyDefinitionId, fingerprint: result.fingerprint, rowCount: result.rows.length,
      suppressedRowCount: result.rows.filter((row) => row.suppression.suppressed).length });
    return result;
  }

  async trend(principal: JourneyStageIntelligencePrincipal, query: JourneyStageIntelligenceQuery & { bucketDays: number }) {
    if (!journeyStagePurposes.includes(query.purpose)) throw new JourneyStageIntelligenceError('Purpose is invalid.', 400,
      'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
    const policy = await this.readPolicy(principal);
    const requested = query.dimensions?.length ? [...new Set(query.dimensions)] : policy.dimensions;
    if (requested.some((dimension) => !policy.dimensions.includes(dimension))) {
      throw new JourneyStageIntelligenceError('A requested comparison dimension is disabled by policy.', 403,
        'JOURNEY_STAGE_INTELLIGENCE_DIMENSION_DISABLED');
    }
    const facts = await this.storage.loadFacts({ spaceId: principal.spaceId,
      journeyDefinitionId: query.journeyDefinitionId, from: query.from, to: query.to, asOf: query.asOf });
    const result = buildJourneyStageTrends({ spaceId: principal.spaceId, actorSpaceId: principal.spaceId,
      actorRole: principal.role, purpose: query.purpose, from: query.from, to: query.to, asOf: query.asOf,
      minimumSampleSize: policy.minimumSampleSize, maximumRows: policy.maximumRows, dimensions: requested,
      bucketDays: query.bucketDays, facts });
    const rows = result.buckets.reduce((sum, bucket) => sum + bucket.rows.length, 0);
    const suppressed = result.buckets.reduce((sum, bucket) => sum
      + bucket.rows.filter((row) => row.suppression.suppressed).length, 0);
    await this.storage.recordRead({ spaceId: principal.spaceId, actorUserId: principal.userId, action: 'trend.read',
      journeyDefinitionId: query.journeyDefinitionId, fingerprint: result.fingerprint, rowCount: rows,
      suppressedRowCount: suppressed });
    return result;
  }
}
