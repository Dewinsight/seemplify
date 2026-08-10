import { db } from './database.js';
import { effectiveJourneyRole } from './journeyCollaboration.js';
import { readJourneyActionOperatorStatus } from './journeyActionRuntimeRepository.js';
import { reviewedWorkerAdapters } from './journeyReviewedAdapterWorker.js';
import { config } from './config.js';
import { effectiveSubscriptionForSpace } from './subscriptionEntitlements.js';

const MAX_ITEMS = 20;

type SectionAvailability = 'available' | 'feature_disabled' | 'capability_required' | 'store_unavailable';
type Count = { state: string; count: number };
const safeCode = (value: unknown) => {
  if (!value) return null;
  const code = String(value);
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(code) ? code : 'UNCLASSIFIED';
};

function tableAvailable(name: string) {
  try {
    if (db.provider === 'sqlite') return Boolean(db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    return Boolean(db.prepare(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=?").get(name));
  } catch { return false; }
}

function counts(table: string, spaceId: string): Count[] {
  return (db.prepare(`SELECT state,COUNT(*) count FROM ${table} WHERE space_id=? GROUP BY state ORDER BY state`)
    .all(spaceId) as any[]).map((row) => ({ state: String(row.state), count: Number(row.count) }));
}

function oldest(table: string, spaceId: string, states: readonly string[]) {
  if (!states.length) return null;
  const placeholders = states.map(() => '?').join(',');
  const row = db.prepare(`SELECT created_at FROM ${table} WHERE space_id=? AND state IN (${placeholders})
    ORDER BY created_at,id LIMIT 1`).get(spaceId, ...states) as { created_at?: string } | undefined;
  return row?.created_at ? String(row.created_at) : null;
}

function unavailable(availability: Exclude<SectionAvailability, 'available'>) {
  return { availability, counts: [] as Count[], oldestPendingAt: null, staleLeaseCount: 0, items: [] as any[] };
}

function stageSurvey(spaceId: string, now: string, entitled: boolean) {
  if (!entitled) return unavailable('feature_disabled');
  if (!tableAvailable('journey_stage_survey_outbox')) return unavailable('store_unavailable');
  const rows = db.prepare(`SELECT id,operation,state,available_at,lease_expires_at,attempt_count,last_error_code,created_at,updated_at
    FROM journey_stage_survey_outbox WHERE space_id=? AND state IN ('pending','retry_wait','leased','dead_letter')
    ORDER BY created_at,id LIMIT ?`).all(spaceId, MAX_ITEMS) as any[];
  const stale = db.prepare(`SELECT COUNT(*) count FROM journey_stage_survey_outbox
    WHERE space_id=? AND state='leased' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?`).get(spaceId, now) as any;
  return {
    availability: 'available' as const,
    counts: counts('journey_stage_survey_outbox', spaceId),
    oldestPendingAt: oldest('journey_stage_survey_outbox', spaceId, ['pending', 'retry_wait', 'leased']),
    staleLeaseCount: Number(stale?.count || 0),
    items: rows.map((row) => ({
      id: String(row.id), operation: String(row.operation), state: String(row.state),
      availableAt: String(row.available_at), leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
      attemptCount: Number(row.attempt_count), lastErrorCode: safeCode(row.last_error_code),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    }))
  };
}

function eventIntelligence(spaceId: string, entitled: boolean) {
  if (!entitled) return unavailable('feature_disabled');
  if (!tableAvailable('journey_event_intelligence_outbox')) return unavailable('store_unavailable');
  const rows = db.prepare(`SELECT id,state,block_reason,created_at,retention_expires_at
    FROM journey_event_intelligence_outbox WHERE space_id=? AND state IN ('ready','blocked')
    ORDER BY created_at,id LIMIT ?`).all(spaceId, MAX_ITEMS) as any[];
  return {
    availability: 'available' as const,
    counts: counts('journey_event_intelligence_outbox', spaceId),
    oldestPendingAt: oldest('journey_event_intelligence_outbox', spaceId, ['ready']),
    staleLeaseCount: 0,
    items: rows.map((row) => ({
      id: String(row.id), state: String(row.state),
      blockReason: safeCode(row.block_reason),
      retentionExpiresAt: String(row.retention_expires_at), createdAt: String(row.created_at)
    }))
  };
}

function connectors(spaceId: string, entitled: boolean) {
  if (!entitled) return unavailable('feature_disabled');
  if (!tableAvailable('journey_connector_import_runs')) return unavailable('store_unavailable');
  const rows = db.prepare(`SELECT id,connector_id,state,attempt_count,retry_at,accepted_count,rejected_count,tombstone_count,
    last_error_code,created_at,updated_at FROM journey_connector_import_runs
    WHERE space_id=? AND state IN ('open','retry_wait','failed') ORDER BY created_at,id LIMIT ?`)
    .all(spaceId, MAX_ITEMS) as any[];
  return {
    availability: 'available' as const,
    counts: counts('journey_connector_import_runs', spaceId),
    oldestPendingAt: oldest('journey_connector_import_runs', spaceId, ['open', 'retry_wait']),
    staleLeaseCount: 0,
    items: rows.map((row) => ({
      id: String(row.id), connectorId: String(row.connector_id), state: String(row.state),
      attemptCount: Number(row.attempt_count), retryAt: row.retry_at ? String(row.retry_at) : null,
      acceptedCount: Number(row.accepted_count), rejectedCount: Number(row.rejected_count),
      tombstoneCount: Number(row.tombstone_count), lastErrorCode: safeCode(row.last_error_code),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    }))
  };
}

function privacy(spaceId: string, entitled: boolean) {
  if (!entitled) return unavailable('feature_disabled');
  if (!tableAvailable('journey_profile_privacy_jobs')) return unavailable('store_unavailable');
  const queued = db.prepare(`SELECT COUNT(*) count,MIN(created_at) oldest FROM journey_profile_privacy_jobs
    WHERE space_id=? AND state='queued'`).get(spaceId) as any;
  return {
    availability: 'available' as const,
    counts: counts('journey_profile_privacy_jobs', spaceId),
    oldestPendingAt: queued?.oldest ? String(queued.oldest) : null,
    staleLeaseCount: 0,
    items: [] as any[]
  };
}

function actionQueue(spaceId: string, now: string) {
  if (!tableAvailable('journey_action_queue')) return unavailable('store_unavailable');
  const stale = db.prepare(`SELECT COUNT(*) count FROM journey_action_queue
    WHERE space_id=? AND state='leased' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?`).get(spaceId, now) as any;
  return {
    availability: 'available' as const,
    counts: counts('journey_action_queue', spaceId),
    oldestPendingAt: oldest('journey_action_queue', spaceId, ['held', 'ready', 'leased', 'retry_scheduled']),
    staleLeaseCount: Number(stale?.count || 0),
    items: [] as any[]
  };
}

function killSwitches(spaceId: string, canRead: boolean) {
  if (!canRead) return { availability: 'capability_required' as const, disabledCount: 0, activePauses: 0 };
  if (!tableAvailable('journey_kill_switch_states')) {
    return { availability: 'store_unavailable' as const, disabledCount: 0, activePauses: 0 };
  }
  const disabled = db.prepare(`SELECT COUNT(*) count FROM journey_kill_switch_states
    WHERE (space_id=? OR (scope_level='platform' AND space_id IS NULL)) AND state='disabled'`).get(spaceId) as any;
  const pauses = tableAvailable('journey_kill_switch_pauses') ? db.prepare(`SELECT COUNT(*) count FROM journey_kill_switch_pauses pause
    LEFT JOIN journey_kill_switch_resumptions resume ON resume.pause_id=pause.id
    WHERE pause.space_id=? AND resume.pause_id IS NULL`).get(spaceId) as any : null;
  return { availability: 'available' as const, disabledCount: Number(disabled?.count || 0), activePauses: Number(pauses?.count || 0) };
}

export function readJourneyOperationsConsole(input: { spaceId: string; actorUserId: string; at?: string }) {
  const generatedAt = new Date(input.at || Date.now()).toISOString();
  const operator = readJourneyActionOperatorStatus({
    spaceId: input.spaceId, actorUserId: input.actorUserId,
    workerEnabled: config.journeyActionWorkerEnabled,
    configuredSpaceIds: config.journeyActionWorkerSpaceIds,
    configuredAdapters: config.journeyActionWorkerAdapters,
    supportedAdapters: reviewedWorkerAdapters
  });
  const features = effectiveSubscriptionForSpace(input.spaceId).plan.features;
  const capabilities = effectiveJourneyRole(input.spaceId, input.actorUserId).capabilities;
  return {
    generatedAt,
    operator,
    actionQueue: actionQueue(input.spaceId, generatedAt),
    stageSurvey: stageSurvey(input.spaceId, generatedAt, features.journeyMetrics),
    eventIntelligence: eventIntelligence(input.spaceId, features.journeyMetrics),
    connectors: connectors(input.spaceId, features.journeyConnectors),
    privacy: privacy(input.spaceId, features.journeyConnected && features.journeyProfiles),
    killSwitches: killSwitches(input.spaceId, capabilities.has('journeys.read'))
  };
}
