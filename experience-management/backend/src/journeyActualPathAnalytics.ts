import crypto from 'node:crypto';
import { db } from './database.js';
import { getJourneyMap, JourneyMapError } from './journeyMaps.js';
import {
  JOURNEY_PATH_ANALYTICS_VERSION,
  JourneyPathAnalyticsConfigurationError,
  calculateJourneyPathAnalytics,
  type JourneyPathAnalyticsResult,
  type JourneyStageVisit
} from './journeyPathAnalytics.js';
import { resolveKnownJourneySubjectsForAnonymousHashes } from './journeyIdentityRepository.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';

export class JourneyActualPathAnalyticsError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_ACTUAL_PATHS_INVALID') {
    super(message);
    this.name = 'JourneyActualPathAnalyticsError';
  }
}

export interface JourneyActualPathAnalyticsResultEnvelope {
  analytics: JourneyPathAnalyticsResult;
  designedVsObserved: {
    stageRows: Array<{
      stageId: string;
      stageName: string;
      designedIndex: number;
      entrantPercentage: number | null;
      completionPercentage: number | null;
      dropOffBeforeNextPercentage: number | null;
      skippedInboundTransitions: number | null;
      loopTransitions: number | null;
      status: 'unobserved' | 'at_risk' | 'aligned';
    }>;
    summary: {
      unobservedStageCount: number;
      atRiskStageCount: number;
      skippedForwardTransitionCount: number | null;
      loopTransitionCount: number | null;
    };
  };
  scope: {
    subjectKind: 'anonymous_only' | 'known_profiles';
    identityModel: 'anonymous_instance_scoped' | 'known_profile_stitched';
    designVersionSource: 'published' | 'current';
    designVersionId: string;
    stitchedSubjectSummary?: {
      stitchedKnownProfileCount: number;
      stitchedAccountCount: number;
      anonymousInstanceCount: number;
    };
    notes: string[];
  };
}

export interface JourneyActualPathSnapshot {
  id: string;
  journeyDefinitionId: string;
  journeyMapVersionId: string;
  createdByUserId: string | null;
  createdAt: string;
  period: { start: string; end: string };
  asOf: string;
  minimumCohortSize: number;
  analyticsVersion: string;
  scopeSubject: 'anonymous_only' | 'known_profiles';
  summary: {
    acceptedInstanceCount: number | null;
    acceptedVisitCount: number | null;
    unobservedStageCount: number;
    atRiskStageCount: number;
  };
  freshness: {
    status: 'current' | 'stale';
    latestObservedEventAt: string | null;
    latestReprojectionCompletedAt: string | null;
    staleReasons: Array<'newer_observed_visit' | 'newer_completed_reprojection'>;
  };
  reconciliation: {
    currentJourneyMapVersionId: string;
    currentAsOf: string;
    designVersionChanged: boolean;
    deltas: {
      acceptedInstanceCount: number | null;
      acceptedVisitCount: number | null;
      unobservedStageCount: number;
      atRiskStageCount: number;
    };
  };
  result: JourneyActualPathAnalyticsResultEnvelope;
}

export interface JourneyActualPathRollup {
  id: string;
  journeyDefinitionId: string;
  journeyMapVersionId: string;
  materializedByUserId: string | null;
  materializedAt: string;
  period: { start: string; end: string };
  lastAsOf: string;
  minimumCohortSize: number;
  analyticsVersion: string;
  scopeSubject: 'anonymous_only' | 'known_profiles';
  summary: JourneyActualPathSnapshot['summary'];
  freshness: JourneyActualPathSnapshot['freshness'];
  result: JourneyActualPathAnalyticsResultEnvelope;
}

function loadDefinition(spaceId: string, definitionId: string) {
  const row = db.prepare(`SELECT id,published_version_id,current_version_id FROM journey_definitions
    WHERE id=? AND space_id=?`).get(definitionId, spaceId) as {
      id: string;
      published_version_id: string | null;
      current_version_id: string | null;
    } | undefined;
  if (!row) throw new JourneyActualPathAnalyticsError('Journey definition not found.', 404, 'JOURNEY_NOT_FOUND');
  const designVersionId = row.published_version_id || row.current_version_id;
  if (!designVersionId) {
    throw new JourneyActualPathAnalyticsError(
      'Journey actual-path analytics requires a current or published journey version.',
      409,
      'JOURNEY_VERSION_REQUIRED'
    );
  }
  return {
    designVersionId,
    designVersionSource: row.published_version_id ? 'published' as const : 'current' as const
  };
}

function stageVisits(spaceId: string, journeyDefinitionId: string, designVersionId: string,
  stageIdByKey: Map<string, string>, subjectKind: 'anonymous_only' | 'known_profiles'): JourneyStageVisit[] {
  const rows = db.prepare(`SELECT visit.id,visit.event_id,visit.instance_id,visit.stage_key,visit.event_occurred_at,
    instance.anonymous_id_hash,
    decision.rule_set_sha256,decision.processor_version
    FROM journey_anonymous_stage_visits visit
    JOIN journey_anonymous_instances instance
      ON instance.id=visit.instance_id
      AND instance.space_id=visit.space_id
      AND instance.journey_definition_id=visit.journey_definition_id
      AND instance.source_id=visit.source_id
      AND instance.environment=visit.environment
    JOIN journey_stage_rule_decisions decision
      ON decision.id=visit.decision_id
      AND decision.space_id=visit.space_id
      AND decision.journey_definition_id=visit.journey_definition_id
      AND decision.journey_map_version_id=visit.journey_map_version_id
    WHERE visit.space_id=? AND visit.journey_definition_id=? AND visit.journey_map_version_id=?
    ORDER BY visit.event_occurred_at,visit.id`).all(spaceId, journeyDefinitionId, designVersionId) as Array<{
      id: string;
      event_id: string;
      instance_id: string;
      stage_key: string;
      event_occurred_at: string;
      anonymous_id_hash: string | null;
      rule_set_sha256: string;
      processor_version: string;
    }>;
  const subjectMap = subjectKind === 'known_profiles'
    ? resolveKnownJourneySubjectsForAnonymousHashes({
      spaceId,
      anonymousHashes: rows.map((row) => row.anonymous_id_hash || '').filter(Boolean)
    })
    : null;
  return rows.map((row) => {
    const stageId = stageIdByKey.get(row.stage_key);
    if (!stageId) {
      throw new JourneyActualPathAnalyticsError(
        `Observed stage ${row.stage_key} is not present on the selected journey version.`,
        409,
        'JOURNEY_ACTUAL_PATH_STAGE_MISMATCH'
      );
    }
    const knownSubject = row.anonymous_id_hash && subjectMap ? subjectMap.get(row.anonymous_id_hash) : null;
    return {
      visitId: row.id,
      revision: 1,
      sourceEventId: row.event_id,
      journeyInstanceId: row.instance_id,
      profileId: knownSubject?.canonicalProfileId || `anonymous:${row.instance_id}`,
      accountId: knownSubject?.accountId || null,
      cohortIds: [],
      stageId,
      occurredAt: row.event_occurred_at,
      invalidReason: null,
      journeyId: journeyDefinitionId,
      journeyVersion: designVersionId,
      ruleSetVersion: row.rule_set_sha256,
      projectionVersion: row.processor_version
    } satisfies JourneyStageVisit;
  });
}

function chosenLineage(visits: JourneyStageVisit[], journeyDefinitionId: string, designVersionId: string) {
  if (!visits.length) {
    return {
      journeyId: journeyDefinitionId,
      journeyVersion: designVersionId,
      ruleSetVersion: 'anonymous-stage-rules-empty',
      projectionVersion: 'stage-rules-v1'
    };
  }
  const grouped = new Map<string, { count: number; latestAt: string; lineage: {
    journeyId: string; journeyVersion: string; ruleSetVersion: string; projectionVersion: string;
  } }>();
  for (const visit of visits) {
    const key = `${visit.journeyVersion}\u001f${visit.ruleSetVersion}\u001f${visit.projectionVersion}`;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      if (visit.occurredAt > current.latestAt) current.latestAt = visit.occurredAt;
    } else {
      grouped.set(key, {
        count: 1,
        latestAt: visit.occurredAt,
        lineage: {
          journeyId: journeyDefinitionId,
          journeyVersion: visit.journeyVersion,
          ruleSetVersion: visit.ruleSetVersion,
          projectionVersion: visit.projectionVersion
        }
      });
    }
  }
  return [...grouped.values()].sort((left, right) =>
    right.count - left.count
    || (left.latestAt < right.latestAt ? 1 : left.latestAt > right.latestAt ? -1 : 0)
    || left.lineage.ruleSetVersion.localeCompare(right.lineage.ruleSetVersion))[0]!.lineage;
}

function designedVsObservedSummary(analytics: JourneyPathAnalyticsResult, map: NonNullable<ReturnType<typeof getJourneyMap>>) {
  const skippedInbound = new Map<string, number>();
  for (const row of analytics.tables.skippedTransitions.rows) {
    skippedInbound.set(row.toStageId, (skippedInbound.get(row.toStageId) || 0) + row.occurrenceCount);
  }
  const loops = new Map<string, number>();
  for (const row of analytics.tables.loops.rows) {
    loops.set(row.toStageId, (loops.get(row.toStageId) || 0) + row.occurrenceCount);
  }
  const funnel = new Map(analytics.tables.funnel.rows.map((row) => [row.stageId, row]));
  const stageRows = map.stages.map((stage, index) => {
    const row = funnel.get(stage.id);
    const entrant = row?.entrantMeasure.percentage ?? null;
    const completion = row?.completionMeasure.percentage ?? null;
    const dropOff = row?.dropOffBeforeNextMeasure.percentage ?? null;
    const skipped = skippedInbound.get(stage.id) || 0;
    const loop = loops.get(stage.id) || 0;
    const status = completion === null || completion === 0
      ? 'unobserved'
      : ((dropOff !== null && dropOff >= 40) || skipped > 0 || loop > 0) ? 'at_risk' : 'aligned';
    return {
      stageId: stage.id,
      stageName: stage.name,
      designedIndex: index,
      entrantPercentage: entrant,
      completionPercentage: completion,
      dropOffBeforeNextPercentage: dropOff,
      skippedInboundTransitions: row?.completionMeasure.suppressed ? null : skipped,
      loopTransitions: row?.completionMeasure.suppressed ? null : loop,
      status
    } as const;
  });
  return {
    stageRows,
    summary: {
      unobservedStageCount: stageRows.filter((row) => row.status === 'unobserved').length,
      atRiskStageCount: stageRows.filter((row) => row.status === 'at_risk').length,
      skippedForwardTransitionCount: analytics.tables.skippedTransitions.suppression.applied
        ? null
        : analytics.tables.skippedTransitions.rows.reduce((total, row) => total + row.occurrenceCount, 0),
      loopTransitionCount: analytics.tables.loops.suppression.applied
        ? null
        : analytics.tables.loops.rows.reduce((total, row) => total + row.occurrenceCount, 0)
    }
  };
}

export function readJourneyActualPathAnalytics(input: {
  spaceId: string;
  journeyDefinitionId: string;
  from?: string;
  to?: string;
  asOf?: string;
  minimumCohortSize: number;
  subjectKind?: 'anonymous_only' | 'known_profiles';
}): JourneyActualPathAnalyticsResultEnvelope {
  assertSubscriptionFeature(input.spaceId, 'journeyActualPaths');
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  const subjectKind = input.subjectKind || 'anonymous_only';
  const { designVersionId, designVersionSource } = loadDefinition(input.spaceId, input.journeyDefinitionId);
  const map = getJourneyMap(input.spaceId, input.journeyDefinitionId, designVersionId);
  if (!map) throw new JourneyMapError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  const stageIdByKey = new Map(map.stages.map((stage) => [stage.stageKey, stage.id]));
  const visits = stageVisits(input.spaceId, input.journeyDefinitionId, designVersionId, stageIdByKey, subjectKind);
  const stitchedProfiles = new Set<string>();
  const stitchedAccounts = new Set<string>();
  if (subjectKind === 'known_profiles') {
    for (const visit of visits) {
      if (!visit.profileId.startsWith('anonymous:')) stitchedProfiles.add(visit.profileId);
      if (visit.accountId) stitchedAccounts.add(visit.accountId);
    }
  }
  const lineage = chosenLineage(visits, input.journeyDefinitionId, designVersionId);
  try {
    const analytics = calculateJourneyPathAnalytics({
      lineage,
      designedStageOrder: map.stages.map((stage) => stage.id),
      period: {
        start: input.from || '1970-01-01T00:00:00.000Z',
        end: input.to || '9999-12-31T23:59:59.999Z',
        timezone: 'UTC'
      },
      asOf: input.asOf || new Date().toISOString(),
      cohortId: null,
      minimumCohortSize: input.minimumCohortSize,
      visits
    });
    const lineageMismatchCount = analytics.dataQuality.find((row) => row.reason === 'LINEAGE_MISMATCH')?.count || 0;
    return {
      analytics,
      designedVsObserved: designedVsObservedSummary(analytics, map),
      scope: {
        subjectKind,
        identityModel: subjectKind === 'known_profiles' ? 'known_profile_stitched' : 'anonymous_instance_scoped',
        designVersionSource,
        designVersionId,
        ...(subjectKind === 'known_profiles' ? {
          stitchedSubjectSummary: {
            stitchedKnownProfileCount: stitchedProfiles.size,
            stitchedAccountCount: stitchedAccounts.size,
            anonymousInstanceCount: new Set(visits.map((visit) => visit.journeyInstanceId)).size
          }
        } : {}),
        notes: [
          ...(subjectKind === 'known_profiles'
            ? [
              'Observed paths are stitched to known canonical profiles where existing anonymous bindings allow it.',
              'Profiles without an existing identity bridge remain isolated to their anonymous journey instances.',
              'Account attribution reflects the current active account membership for the stitched profile when one exists.'
            ]
            : ['Anonymous journey instances only. Known-profile and account stitching are not included in this surface yet.']),
          'Observed paths are descriptive only and are compared against one selected designed journey version.',
          ...(subjectKind === 'known_profiles'
            ? ['Canonical profile identifiers are used only where the existing identity model already resolves them deterministically.']
            : ['Synthetic anonymous profile identifiers are scoped to journey instances for deterministic counting only.']),
          ...(lineageMismatchCount
            ? [`${lineageMismatchCount.toLocaleString()} visit${lineageMismatchCount === 1 ? '' : 's'} from other lineage versions were excluded from this result.`]
            : [])
        ]
      }
    };
  } catch (error) {
    if (error instanceof JourneyPathAnalyticsConfigurationError) {
      throw new JourneyActualPathAnalyticsError(error.message, 400, error.code);
    }
    throw error;
  }
}

function snapshotSummary(result: JourneyActualPathAnalyticsResultEnvelope) {
  return {
    acceptedInstanceCount: result.analytics.sample.acceptedInstanceCount,
    acceptedVisitCount: result.analytics.sample.acceptedVisitCount,
    unobservedStageCount: result.designedVsObserved.summary.unobservedStageCount,
    atRiskStageCount: result.designedVsObserved.summary.atRiskStageCount
  };
}

function latestObservedEventAt(spaceId: string, journeyDefinitionId: string, journeyMapVersionId: string) {
  return (db.prepare(`SELECT MAX(event_occurred_at) latest FROM journey_anonymous_stage_visits
    WHERE space_id=? AND journey_definition_id=? AND journey_map_version_id=?`).get(
    spaceId, journeyDefinitionId, journeyMapVersionId
  ) as { latest?: string | null } | undefined)?.latest || null;
}

function latestReprojectionCompletedAt(spaceId: string, journeyDefinitionId: string, journeyMapVersionId: string) {
  return (db.prepare(`SELECT MAX(completed_at) latest FROM journey_stage_reprojection_runs
    WHERE space_id=? AND journey_definition_id=? AND journey_map_version_id=? AND state='completed'`).get(
    spaceId, journeyDefinitionId, journeyMapVersionId
  ) as { latest?: string | null } | undefined)?.latest || null;
}

function freshnessFromMarkers(asOf: string, materializedAt: string, latestObservedAt: string | null,
  latestReprojectionAt: string | null): JourneyActualPathSnapshot['freshness'] {
  const staleReasons: JourneyActualPathSnapshot['freshness']['staleReasons'] = [];
  if (latestObservedAt && latestObservedAt > asOf) staleReasons.push('newer_observed_visit');
  if (latestReprojectionAt && latestReprojectionAt > materializedAt) staleReasons.push('newer_completed_reprojection');
  return {
    status: staleReasons.length ? 'stale' : 'current',
    latestObservedEventAt: latestObservedAt,
    latestReprojectionCompletedAt: latestReprojectionAt,
    staleReasons
  };
}

function numberDelta(current: number | null, saved: number | null) {
  if (current === null || saved === null) return null;
  return current - saved;
}

function snapshotReconciliation(input: {
  spaceId: string;
  journeyDefinitionId: string;
  periodStart: string;
  periodEnd: string;
  minimumCohortSize: number;
  savedJourneyMapVersionId: string;
  subjectKind: 'anonymous_only' | 'known_profiles';
  savedSummary: ReturnType<typeof snapshotSummary>;
}) {
  const current = readJourneyActualPathAnalytics({
    spaceId: input.spaceId,
    journeyDefinitionId: input.journeyDefinitionId,
    from: input.periodStart,
    to: input.periodEnd,
    minimumCohortSize: input.minimumCohortSize,
    subjectKind: input.subjectKind
  });
  const currentSummary = snapshotSummary(current);
  return {
    currentJourneyMapVersionId: current.scope.designVersionId,
    currentAsOf: current.analytics.lineage.asOf,
    designVersionChanged: current.scope.designVersionId !== input.savedJourneyMapVersionId,
    deltas: {
      acceptedInstanceCount: numberDelta(currentSummary.acceptedInstanceCount, input.savedSummary.acceptedInstanceCount),
      acceptedVisitCount: numberDelta(currentSummary.acceptedVisitCount, input.savedSummary.acceptedVisitCount),
      unobservedStageCount: currentSummary.unobservedStageCount - input.savedSummary.unobservedStageCount,
      atRiskStageCount: currentSummary.atRiskStageCount - input.savedSummary.atRiskStageCount
    }
  };
}

function rowToSnapshot(row: {
  id: string;
  space_id: string;
  journey_definition_id: string;
  journey_map_version_id: string;
  created_by_user_id: string | null;
  created_at: string;
  period_start: string;
  period_end: string;
  as_of: string;
  minimum_cohort_size: number | string;
  analytics_version: string;
  subject_scope: 'anonymous_only' | 'known_profiles';
  summary_json: string;
  result_json: string;
}): JourneyActualPathSnapshot {
  const result = JSON.parse(row.result_json) as JourneyActualPathAnalyticsResultEnvelope;
  const summary = JSON.parse(row.summary_json) as JourneyActualPathSnapshot['summary'];
  const observedAt = latestObservedEventAt(row.space_id, row.journey_definition_id, row.journey_map_version_id);
  const reprojectionAt = latestReprojectionCompletedAt(row.space_id, row.journey_definition_id, row.journey_map_version_id);
  const reconciliation = snapshotReconciliation({
    spaceId: row.space_id,
    journeyDefinitionId: row.journey_definition_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    minimumCohortSize: Number(row.minimum_cohort_size),
    savedJourneyMapVersionId: row.journey_map_version_id,
    subjectKind: row.subject_scope,
    savedSummary: summary
  });
  return {
    id: row.id,
    journeyDefinitionId: row.journey_definition_id,
    journeyMapVersionId: row.journey_map_version_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    period: { start: row.period_start, end: row.period_end },
    asOf: row.as_of,
    minimumCohortSize: Number(row.minimum_cohort_size),
    analyticsVersion: row.analytics_version,
    scopeSubject: row.subject_scope,
    summary,
    freshness: freshnessFromMarkers(row.as_of, row.created_at, observedAt, reprojectionAt),
    reconciliation,
    result
  };
}

function rowToRollup(row: {
  id: string;
  space_id: string;
  journey_definition_id: string;
  journey_map_version_id: string;
  subject_scope: 'anonymous_only' | 'known_profiles';
  period_start: string;
  period_end: string;
  minimum_cohort_size: number | string;
  analytics_version: string;
  last_as_of: string;
  summary_json: string;
  result_json: string;
  materialized_by_user_id: string | null;
  materialized_at: string;
}): JourneyActualPathRollup {
  const result = JSON.parse(row.result_json) as JourneyActualPathAnalyticsResultEnvelope;
  const summary = JSON.parse(row.summary_json) as JourneyActualPathRollup['summary'];
  const observedAt = latestObservedEventAt(row.space_id, row.journey_definition_id, row.journey_map_version_id);
  const reprojectionAt = latestReprojectionCompletedAt(row.space_id, row.journey_definition_id, row.journey_map_version_id);
  return {
    id: row.id,
    journeyDefinitionId: row.journey_definition_id,
    journeyMapVersionId: row.journey_map_version_id,
    materializedByUserId: row.materialized_by_user_id,
    materializedAt: row.materialized_at,
    period: { start: row.period_start, end: row.period_end },
    lastAsOf: row.last_as_of,
    minimumCohortSize: Number(row.minimum_cohort_size),
    analyticsVersion: row.analytics_version,
    scopeSubject: row.subject_scope,
    summary,
    freshness: freshnessFromMarkers(row.last_as_of, row.materialized_at, observedAt, reprojectionAt),
    result
  };
}

export function createJourneyActualPathSnapshot(input: {
  spaceId: string;
  actorUserId: string | null;
  journeyDefinitionId: string;
  from?: string;
  to?: string;
  asOf?: string;
  minimumCohortSize: number;
  subjectKind?: 'anonymous_only' | 'known_profiles';
}) {
  const result = readJourneyActualPathAnalytics(input);
  const subjectKind = input.subjectKind || 'anonymous_only';
  const periodStart = result.analytics.lineage.period.start;
  const periodEnd = result.analytics.lineage.period.end;
  const asOf = result.analytics.lineage.asOf;
  const journeyMapVersionId = result.scope.designVersionId;
  const existing = db.prepare(`SELECT * FROM journey_actual_path_snapshots WHERE space_id=? AND journey_definition_id=?
    AND journey_map_version_id=? AND subject_scope=? AND period_start=? AND period_end=? AND as_of=?
    AND minimum_cohort_size=? AND analytics_version=?`).get(
      input.spaceId, input.journeyDefinitionId, journeyMapVersionId, subjectKind, periodStart, periodEnd, asOf,
      input.minimumCohortSize, result.analytics.analyticsVersion
    ) as any;
  if (existing) return { snapshot: rowToSnapshot(existing), replayed: true as const };
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO journey_actual_path_snapshots
    (id,space_id,journey_definition_id,journey_map_version_id,subject_scope,period_start,period_end,as_of,
      minimum_cohort_size,analytics_version,summary_json,result_json,created_by_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.spaceId, input.journeyDefinitionId, journeyMapVersionId, subjectKind, periodStart, periodEnd, asOf,
      input.minimumCohortSize, result.analytics.analyticsVersion, JSON.stringify(snapshotSummary(result)), JSON.stringify(result),
      input.actorUserId, createdAt
    );
  const observedAt = latestObservedEventAt(input.spaceId, input.journeyDefinitionId, journeyMapVersionId);
  const reprojectionAt = latestReprojectionCompletedAt(input.spaceId, input.journeyDefinitionId, journeyMapVersionId);
  return { snapshot: {
    id,
    journeyDefinitionId: input.journeyDefinitionId,
    journeyMapVersionId,
    createdByUserId: input.actorUserId,
    createdAt,
    period: { start: periodStart, end: periodEnd },
    asOf,
    minimumCohortSize: input.minimumCohortSize,
    analyticsVersion: result.analytics.analyticsVersion,
    scopeSubject: subjectKind,
    summary: snapshotSummary(result),
    freshness: freshnessFromMarkers(asOf, createdAt, observedAt, reprojectionAt),
    reconciliation: {
      currentJourneyMapVersionId: journeyMapVersionId,
      currentAsOf: asOf,
      designVersionChanged: false,
      deltas: {
        acceptedInstanceCount: 0,
        acceptedVisitCount: 0,
        unobservedStageCount: 0,
        atRiskStageCount: 0
      }
    },
    result
  } satisfies JourneyActualPathSnapshot, replayed: false as const };
}

export function readLatestJourneyActualPathSnapshot(spaceId: string, journeyDefinitionId: string,
  subjectKind: 'anonymous_only' | 'known_profiles' = 'anonymous_only') {
  const row = db.prepare(`SELECT * FROM journey_actual_path_snapshots WHERE space_id=? AND journey_definition_id=?
    AND subject_scope=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(spaceId, journeyDefinitionId, subjectKind) as any;
  return row ? rowToSnapshot(row) : null;
}

export function listJourneyActualPathSnapshots(spaceId: string, journeyDefinitionId: string,
  limit = 20, subjectKind: 'anonymous_only' | 'known_profiles' = 'anonymous_only') {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = db.prepare(`SELECT * FROM journey_actual_path_snapshots WHERE space_id=? AND journey_definition_id=?
    AND subject_scope=? ORDER BY created_at DESC,id DESC LIMIT ?`).all(spaceId, journeyDefinitionId, subjectKind, bounded) as any[];
  return rows.map((row) => rowToSnapshot(row));
}

export function readJourneyActualPathSnapshot(spaceId: string, journeyDefinitionId: string, snapshotId: string,
  subjectKind: 'anonymous_only' | 'known_profiles' = 'anonymous_only') {
  const row = db.prepare(`SELECT * FROM journey_actual_path_snapshots WHERE id=? AND space_id=? AND journey_definition_id=? AND subject_scope=?`)
    .get(snapshotId, spaceId, journeyDefinitionId, subjectKind) as any;
  if (!row) throw new JourneyActualPathAnalyticsError('Actual-path snapshot not found.', 404, 'JOURNEY_ACTUAL_PATH_SNAPSHOT_NOT_FOUND');
  return rowToSnapshot(row);
}

export function materializeJourneyActualPathRollup(input: {
  spaceId: string;
  actorUserId: string | null;
  journeyDefinitionId: string;
  from?: string;
  to?: string;
  asOf?: string;
  minimumCohortSize: number;
  subjectKind?: 'anonymous_only' | 'known_profiles';
}) {
  const result = readJourneyActualPathAnalytics(input);
  const subjectKind = input.subjectKind || 'anonymous_only';
  const periodStart = result.analytics.lineage.period.start;
  const periodEnd = result.analytics.lineage.period.end;
  const lastAsOf = result.analytics.lineage.asOf;
  const journeyMapVersionId = result.scope.designVersionId;
  const analyticsVersion = result.analytics.analyticsVersion;
  const existing = db.prepare(`SELECT id FROM journey_actual_path_rollups WHERE space_id=? AND journey_definition_id=?
    AND journey_map_version_id=? AND subject_scope=? AND period_start=? AND period_end=?
    AND minimum_cohort_size=? AND analytics_version=?`).get(
      input.spaceId, input.journeyDefinitionId, journeyMapVersionId, subjectKind, periodStart, periodEnd, input.minimumCohortSize, analyticsVersion
    ) as { id: string } | undefined;
  const id = existing?.id || crypto.randomUUID();
  const materializedAt = new Date().toISOString();
  db.prepare(`INSERT INTO journey_actual_path_rollups
    (id,space_id,journey_definition_id,journey_map_version_id,subject_scope,period_start,period_end,minimum_cohort_size,
      analytics_version,last_as_of,latest_observed_event_at,latest_reprojection_completed_at,summary_json,result_json,
      materialized_by_user_id,materialized_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(space_id,journey_definition_id,journey_map_version_id,subject_scope,period_start,period_end,minimum_cohort_size,analytics_version)
    DO UPDATE SET
      last_as_of=excluded.last_as_of,
      latest_observed_event_at=excluded.latest_observed_event_at,
      latest_reprojection_completed_at=excluded.latest_reprojection_completed_at,
      summary_json=excluded.summary_json,
      result_json=excluded.result_json,
      materialized_by_user_id=excluded.materialized_by_user_id,
      materialized_at=excluded.materialized_at`).run(
        id,
        input.spaceId,
        input.journeyDefinitionId,
        journeyMapVersionId,
        subjectKind,
        periodStart,
        periodEnd,
        input.minimumCohortSize,
        analyticsVersion,
        lastAsOf,
        latestObservedEventAt(input.spaceId, input.journeyDefinitionId, journeyMapVersionId),
        latestReprojectionCompletedAt(input.spaceId, input.journeyDefinitionId, journeyMapVersionId),
        JSON.stringify(snapshotSummary(result)),
        JSON.stringify(result),
        input.actorUserId,
        materializedAt
      );
  const row = db.prepare('SELECT * FROM journey_actual_path_rollups WHERE id=?').get(id) as any;
  return { rollup: rowToRollup(row), updated: Boolean(existing) };
}

export function readLatestJourneyActualPathRollup(spaceId: string, journeyDefinitionId: string,
  subjectKind: 'anonymous_only' | 'known_profiles' = 'anonymous_only') {
  const row = db.prepare(`SELECT * FROM journey_actual_path_rollups WHERE space_id=? AND journey_definition_id=?
    AND subject_scope=? ORDER BY materialized_at DESC,id DESC LIMIT 1`).get(spaceId, journeyDefinitionId, subjectKind) as any;
  return row ? rowToRollup(row) : null;
}

export { JOURNEY_PATH_ANALYTICS_VERSION };
