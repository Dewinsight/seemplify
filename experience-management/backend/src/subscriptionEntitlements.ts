import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './database.js';

export type SubscriptionFeature = 'surveys' | 'campaigns' | 'agreements' | 'serviceRecovery'
  | 'socialListening' | 'knowledgeBases' | 'terra'
  | 'journeyDesign' | 'journeyAi' | 'journeyPersonas' | 'journeyEvidence' | 'journeyTemplates'
  | 'journeyExports' | 'journeyMetrics' | 'journeyRichCards' | 'journeySavedViews'
  | 'journeyPortfolio' | 'journeyCollaboration' | 'journeyHierarchy' | 'journeyBlueprints'
  | 'journeyConnected' | 'journeyProfiles' | 'journeyActualPaths'
  | 'journeyOrchestration' | 'mobileSdks' | 'journeyConnectors';
export type SubscriptionQuota = 'seats' | 'activeSurveys' | 'monthlyAiActions' | 'knowledgeStorageBytes'
  | 'journeyMaps' | 'journeyPersonas' | 'journeyTemplates' | 'journeyShares'
  | 'eventSources' | 'monthlyTrackedEvents' | 'retainedProfiles' | 'eventRetentionDays'
  | 'activeJourneyRuleSets' | 'activeJourneyOrchestrations' | 'monthlyOrchestrationActions'
  | 'schemaDefinitions' | 'webhookDestinations' | 'monthlyJourneyExports'
  | 'journeyMetricDefinitions' | 'journeyMetricBindings' | 'journeyMetricSegments'
  | 'journeyMetricAlertDefinitions' | 'monthlyJourneyMetricImports' | 'journeyChannels' | 'journeyTouchpoints'
  | 'journeyCardAssets' | 'journeyCardAssetBytes' | 'journeySavedViews';
export const meteredSubscriptionQuotas = [
  'monthlyAiActions', 'monthlyTrackedEvents', 'monthlyOrchestrationActions', 'monthlyJourneyExports',
  'monthlyJourneyMetricImports'
] as const satisfies readonly SubscriptionQuota[];
export type MeteredSubscriptionQuota = typeof meteredSubscriptionQuotas[number];
export type SubscriptionPlanCode = 'starter' | 'team' | 'enterprise';

export const subscriptionCatalogVersion = '2026-08-05.2';

/** Journey design is deliberately decoupled from the AI-runtime feature so a
 * space with AI disabled can still build and own maps by hand. AI journey
 * actions continue to require the runtime feature and the AI allowance. */
export const journeyFeatures = ['journeyDesign', 'journeyPersonas', 'journeyEvidence'] as const;
export const connectedJourneyFeatures = [
  'journeyAi', 'journeyTemplates', 'journeyExports', 'journeyMetrics', 'journeyRichCards', 'journeySavedViews', 'journeyPortfolio',
  'journeyCollaboration', 'journeyHierarchy', 'journeyBlueprints', 'journeyConnected',
  'journeyProfiles', 'journeyActualPaths',
  'journeyOrchestration', 'mobileSdks', 'journeyConnectors'
] as const satisfies readonly SubscriptionFeature[];

export type SubscriptionPlan = {
  code: SubscriptionPlanCode;
  name: string;
  description: string;
  requestable: boolean;
  features: Record<SubscriptionFeature, boolean>;
  limits: Record<SubscriptionQuota, number>;
};

export const defaultSubscriptionPlanCatalog: readonly SubscriptionPlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'Core experience management for a small team.',
    requestable: true,
    features: {
      surveys: true, campaigns: true, agreements: true, serviceRecovery: true,
      socialListening: false, knowledgeBases: false, terra: true,
      journeyDesign: true, journeyAi: true, journeyPersonas: false, journeyEvidence: false,
      journeyTemplates: false, journeyExports: true, journeyMetrics: false, journeyRichCards: false, journeySavedViews: false,
      journeyPortfolio: false, journeyCollaboration: false,
      journeyHierarchy: false, journeyBlueprints: false, journeyConnected: false,
      journeyProfiles: false, journeyActualPaths: false, journeyOrchestration: false,
      mobileSdks: false, journeyConnectors: false
    },
    limits: {
      seats: 3, activeSurveys: 10, monthlyAiActions: 100, knowledgeStorageBytes: 0,
      journeyMaps: 3, journeyPersonas: 0, journeyTemplates: 0, journeyShares: 0,
      eventSources: 0, monthlyTrackedEvents: 0, retainedProfiles: 0, eventRetentionDays: 0,
      activeJourneyRuleSets: 0, activeJourneyOrchestrations: 0, monthlyOrchestrationActions: 0,
      schemaDefinitions: 0, webhookDestinations: 0, monthlyJourneyExports: 5,
      journeyMetricDefinitions: 0, journeyMetricBindings: 0, journeyMetricSegments: 0, journeyMetricAlertDefinitions: 0,
      monthlyJourneyMetricImports: 0, journeyChannels: 0, journeyTouchpoints: 0,
      journeyCardAssets: 0, journeyCardAssetBytes: 0, journeySavedViews: 0
    }
  },
  {
    code: 'team',
    name: 'Team',
    description: 'Collaboration, intelligence, listening, and knowledge workflows.',
    requestable: true,
    features: {
      surveys: true, campaigns: true, agreements: true, serviceRecovery: true,
      socialListening: true, knowledgeBases: true, terra: true,
      journeyDesign: true, journeyAi: true, journeyPersonas: true, journeyEvidence: true,
      journeyTemplates: true, journeyExports: true, journeyMetrics: true, journeyRichCards: true, journeySavedViews: true,
      journeyPortfolio: true, journeyCollaboration: true,
      journeyHierarchy: true, journeyBlueprints: true, journeyConnected: false,
      journeyProfiles: false, journeyActualPaths: false, journeyOrchestration: false,
      mobileSdks: false, journeyConnectors: false
    },
    limits: {
      seats: 25, activeSurveys: 250, monthlyAiActions: 5_000, knowledgeStorageBytes: 20 * 1024 * 1024 * 1024,
      journeyMaps: 50, journeyPersonas: 50, journeyTemplates: 20, journeyShares: 50,
      eventSources: 0, monthlyTrackedEvents: 0, retainedProfiles: 0, eventRetentionDays: 0,
      activeJourneyRuleSets: 0, activeJourneyOrchestrations: 0, monthlyOrchestrationActions: 0,
      schemaDefinitions: 0, webhookDestinations: 0, monthlyJourneyExports: 250,
      journeyMetricDefinitions: 100, journeyMetricBindings: 250, journeyMetricSegments: 100, journeyMetricAlertDefinitions: 100,
      monthlyJourneyMetricImports: 50_000, journeyChannels: 100, journeyTouchpoints: 500,
      journeyCardAssets: 2_000, journeyCardAssetBytes: 2 * 1024 * 1024 * 1024, journeySavedViews: 100
    }
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Managed limits and governance for larger organisations.',
    requestable: true,
    features: {
      surveys: true, campaigns: true, agreements: true, serviceRecovery: true,
      socialListening: true, knowledgeBases: true, terra: true,
      journeyDesign: true, journeyAi: true, journeyPersonas: true, journeyEvidence: true,
      journeyTemplates: true, journeyExports: true, journeyMetrics: true, journeyRichCards: true, journeySavedViews: true,
      journeyPortfolio: true, journeyCollaboration: true,
      journeyHierarchy: true, journeyBlueprints: true, journeyConnected: true,
      journeyProfiles: true, journeyActualPaths: true, journeyOrchestration: true,
      mobileSdks: true, journeyConnectors: true
    },
    limits: {
      seats: 250, activeSurveys: 5_000, monthlyAiActions: 100_000, knowledgeStorageBytes: 200 * 1024 * 1024 * 1024,
      journeyMaps: 1_000, journeyPersonas: 1_000, journeyTemplates: 500, journeyShares: 2_000,
      eventSources: 100, monthlyTrackedEvents: 10_000_000, retainedProfiles: 2_000_000,
      eventRetentionDays: 365, activeJourneyRuleSets: 500, activeJourneyOrchestrations: 250,
      monthlyOrchestrationActions: 1_000_000, schemaDefinitions: 2_000,
      webhookDestinations: 250, monthlyJourneyExports: 10_000,
      journeyMetricDefinitions: 10_000, journeyMetricBindings: 50_000, journeyMetricSegments: 5_000,
      journeyMetricAlertDefinitions: 10_000,
      monthlyJourneyMetricImports: 10_000_000, journeyChannels: 2_000, journeyTouchpoints: 20_000,
      journeyCardAssets: 100_000, journeyCardAssetBytes: 200 * 1024 * 1024 * 1024, journeySavedViews: 5_000
    }
  }
] as const;

export const subscriptionPlanCodes = ['starter', 'team', 'enterprise'] as const;

export class SubscriptionEntitlementError extends Error {
  constructor(
    message: string,
    public status = 403,
    public code = 'SUBSCRIPTION_ENTITLEMENT_REQUIRED',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'SubscriptionEntitlementError';
  }
}

function defaultPlan(code: string): SubscriptionPlan | null {
  return defaultSubscriptionPlanCatalog.find((plan) => plan.code === code) || null;
}

function planTableReady() {
  try { db.prepare('SELECT 1 FROM platform_subscription_plans LIMIT 1').get(); return true; }
  catch { return false; }
}

function planFromRow(row: any): SubscriptionPlan | null {
  const fallback = defaultPlan(String(row?.code || ''));
  if (!fallback) return null;
  let features: unknown; let limits: unknown;
  try { features = JSON.parse(String(row.features_json)); limits = JSON.parse(String(row.limits_json)); }
  catch { return null; }
  if (!features || typeof features !== 'object' || !limits || typeof limits !== 'object') return null;
  const featureValues = features as Record<string, unknown>;
  const limitValues = limits as Record<string, unknown>;
  if (Object.keys(fallback.features).some((key) => featureValues[key] !== undefined && typeof featureValues[key] !== 'boolean')) {
    return null;
  }
  const normalizedFeatures = Object.fromEntries(Object.keys(fallback.features).map((key) => [
    key, featureValues[key] === undefined ? fallback.features[key as SubscriptionFeature] : featureValues[key] === true
  ])) as
    Record<SubscriptionFeature, boolean>;
  const normalizedLimits = Object.fromEntries(Object.keys(fallback.limits).map((key) => [
    key, limitValues[key] === undefined ? fallback.limits[key as SubscriptionQuota] : Number(limitValues[key])
  ])) as
    Record<SubscriptionQuota, number>;
  if (Object.values(normalizedLimits).some((value) => !Number.isSafeInteger(value) || value < 0)) return null;
  return {
    code: fallback.code,
    name: String(row.name || '').trim(),
    description: String(row.description || '').trim(),
    requestable: Boolean(row.requestable),
    features: normalizedFeatures,
    limits: normalizedLimits
  };
}

export function listSubscriptionPlans(): SubscriptionPlan[] {
  if (!planTableReady()) return defaultSubscriptionPlanCatalog.map((plan) => structuredClone(plan));
  const rows = db.prepare(`SELECT code,name,description,requestable,features_json,limits_json
    FROM platform_subscription_plans ORDER BY display_order,code`).all() as any[];
  const plans = rows.map(planFromRow).filter((plan): plan is SubscriptionPlan => Boolean(plan));
  return plans.length === subscriptionPlanCodes.length
    ? plans
    : defaultSubscriptionPlanCatalog.map((plan) => structuredClone(plan));
}

export function publicSubscriptionPlan(code: string): SubscriptionPlan | null {
  return listSubscriptionPlans().find((plan) => plan.code === code) || null;
}

export function subscriptionPlanSnapshot(plan: SubscriptionPlan) {
  return { catalogVersion: subscriptionCatalogVersion, plan };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

export function validatedSubscriptionPlanSnapshot(value: unknown, expectedCode: string): SubscriptionPlan | null {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const snapshot = parsed as { catalogVersion?: unknown; plan?: unknown };
  if (snapshot.catalogVersion !== subscriptionCatalogVersion || !snapshot.plan || typeof snapshot.plan !== 'object') return null;
  const current = publicSubscriptionPlan(expectedCode);
  if (!current || stableJson(snapshot.plan) !== stableJson(current)) return null;
  return current;
}

function subscriptionTablesReady() {
  try { db.prepare('SELECT 1 FROM platform_subscriptions LIMIT 1').get(); return true; }
  catch { return false; }
}

function provisionSubscription(spaceId: string, plan: SubscriptionPlan, source: 'starter' | 'grandfathered', actorUserId: string | null) {
  if (!subscriptionTablesReady()) return false;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const inserted = db.prepare(`INSERT INTO platform_subscriptions
    (id,space_id,plan_code,status,features_json,limits_json,source_request_id,approved_by_user_id,
      effective_at,expires_at,version,created_at,updated_at)
    VALUES (?,?,?,'active',?,?,NULL,?,?,NULL,1,?,?) ON CONFLICT(space_id) DO NOTHING`).run(
      id, spaceId, plan.code, JSON.stringify(plan.features), JSON.stringify(plan.limits), actorUserId, now, now, now
    ).changes === 1;
  if (inserted) {
    db.prepare(`INSERT INTO platform_subscription_events
      (id,space_id,subscription_id,request_id,event_type,actor_user_id,metadata_json,created_at)
      VALUES (?,?,?,NULL,?,?,?,?)`).run(
        crypto.randomUUID(), spaceId, id, `subscription.${source}`, actorUserId,
        JSON.stringify({ planCode: plan.code, catalogVersion: subscriptionCatalogVersion }), now
      );
  }
  return inserted;
}

/** New spaces receive an explicit Starter entitlement. During initial SQLite
 * schema construction the platform tables do not exist yet, so legacy spaces
 * are intentionally handled by the bootstrap grandfathering pass below. */
export function ensureDefaultSubscriptionForSpace(spaceId: string, actorUserId: string | null = null) {
  const planCode = config.subscriptionEnforcementEnabled ? 'starter' : 'enterprise';
  return provisionSubscription(
    spaceId,
    publicSubscriptionPlan(planCode)!,
    planCode === 'starter' ? 'starter' : 'grandfathered',
    actorUserId
  );
}

/** Run after the platform schema exists. Missing subscriptions at this point
 * pre-date entitlement enforcement and retain Enterprise-equivalent access. */
export function ensureExistingSubscriptionsGrandfathered() {
  if (!subscriptionTablesReady()) return 0;
  const spaces = db.prepare(`SELECT s.id FROM spaces s LEFT JOIN platform_subscriptions p ON p.space_id=s.id
    WHERE p.id IS NULL ORDER BY s.created_at,s.id`).all() as Array<{ id: string }>;
  let inserted = 0;
  for (const space of spaces) {
    if (provisionSubscription(space.id, publicSubscriptionPlan('enterprise')!, 'grandfathered', null)) inserted += 1;
  }
  return inserted;
}

/** The configured recovery administrator is also the installation's seeded
 * demonstration workspace. Keep that bootstrap workspace feature-complete,
 * while ordinary spaces created after rollout still begin on Starter. An
 * explicitly approved plan (source_request_id present) is never overwritten. */
export function ensureConfiguredAdministratorEnterprise(userId: string) {
  if (!subscriptionTablesReady()) return 0;
  const plan = publicSubscriptionPlan('enterprise')!;
  return db.prepare(`UPDATE platform_subscriptions SET plan_code=?,status='active',features_json=?,limits_json=?,updated_at=?
    WHERE source_request_id IS NULL AND plan_code='starter' AND space_id IN (
      SELECT membership.space_id FROM space_memberships membership
      JOIN spaces space ON space.id=membership.space_id
      WHERE membership.user_id=? AND membership.role='owner' AND space.personal_for_user_id=?
    )`).run(plan.code, JSON.stringify(plan.features), JSON.stringify(plan.limits), new Date().toISOString(), userId, userId).changes;
}

export type EffectiveSubscription = {
  plan: SubscriptionPlan;
  source: 'managed' | 'managed_fallback' | 'legacy_grandfathered';
  subscriptionId: string | null;
  subscriptionStatus: 'active' | 'suspended' | 'cancelled' | null;
  catalogVersion: string;
};

export function effectiveSubscriptionForSpace(spaceId: string): EffectiveSubscription {
  if (!subscriptionTablesReady()) {
    return {
      plan: publicSubscriptionPlan('enterprise')!, source: 'legacy_grandfathered',
      subscriptionId: null, subscriptionStatus: null, catalogVersion: subscriptionCatalogVersion
    };
  }
  const row = db.prepare('SELECT id,plan_code,status FROM platform_subscriptions WHERE space_id=?').get(spaceId) as
    { id: string; plan_code: string; status: 'active' | 'suspended' | 'cancelled' } | undefined;
  if (!row) {
    return {
      plan: publicSubscriptionPlan('enterprise')!, source: 'legacy_grandfathered',
      subscriptionId: null, subscriptionStatus: null, catalogVersion: subscriptionCatalogVersion
    };
  }
  if (row.status !== 'active') {
    return {
      plan: publicSubscriptionPlan('starter')!, source: 'managed_fallback',
      subscriptionId: row.id, subscriptionStatus: row.status, catalogVersion: subscriptionCatalogVersion
    };
  }
  const plan = publicSubscriptionPlan(row.plan_code);
  if (!plan) {
    throw new SubscriptionEntitlementError('The managed subscription plan is unavailable.', 503, 'SUBSCRIPTION_PLAN_INVALID');
  }
  return {
    plan, source: 'managed', subscriptionId: row.id, subscriptionStatus: row.status,
    catalogVersion: subscriptionCatalogVersion
  };
}

export function assertSubscriptionFeature(spaceId: string, feature: SubscriptionFeature) {
  const effective = effectiveSubscriptionForSpace(spaceId);
  if (!effective.plan.features[feature]) {
    throw new SubscriptionEntitlementError(
      `${effective.plan.name} does not include this feature. Request a plan change from Space settings.`,
      403,
      'SUBSCRIPTION_FEATURE_REQUIRED',
      { feature, effectivePlan: effective.plan.code, source: effective.source }
    );
  }
  return effective;
}

export function assertSubscriptionQuota(spaceId: string, quota: SubscriptionQuota, current: number, additional = 1) {
  const effective = effectiveSubscriptionForSpace(spaceId);
  const limit = Number(effective.plan.limits[quota]);
  if (current + additional > limit) {
    throw new SubscriptionEntitlementError(
      `${effective.plan.name} has reached its ${quota} allowance. Request a plan change from Space settings.`,
      409,
      'SUBSCRIPTION_QUOTA_EXCEEDED',
      { quota, current, additional, limit, effectivePlan: effective.plan.code, source: effective.source }
    );
  }
  return effective;
}

export function isMeteredSubscriptionQuota(quota: SubscriptionQuota): quota is MeteredSubscriptionQuota {
  return (meteredSubscriptionQuotas as readonly string[]).includes(quota);
}

export function subscriptionQuotaKind(quota: SubscriptionQuota): 'metered' | 'resource' {
  return isMeteredSubscriptionQuota(quota) ? 'metered' : 'resource';
}

export type UsagePeriod = { start: string; end: string };
export type UsageWarningLevel = 'normal' | 'approaching' | 'warning' | 'exhausted';
export type MeteredUsageSnapshot = {
  quota: MeteredSubscriptionQuota;
  kind: 'metered';
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  projectedPeriodEnd: number;
  warningLevel: UsageWarningLevel;
};
export type UsageReceipt = MeteredUsageSnapshot & {
  eventId: string;
  quantity: number;
  replayed: boolean;
};

function validDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new TypeError('Usage accounting requires a valid date.');
  return value;
}

/** UTC calendar-month accounting is independent of the server locale and DST. */
export function usagePeriodAt(value: Date | string = new Date()): UsagePeriod {
  const date = validDate(value instanceof Date ? new Date(value.getTime()) : new Date(value));
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function legacyDurableMonthlyAiActions(spaceId: string, period: UsagePeriod) {
  // Runtime-15 installations can contain durable jobs created before atomic
  // ledger admission shipped. Keep only those unadmitted rows in the temporary
  // compatibility count; every current production job is represented by an
  // immutable durable_ai_job_attempt ledger event instead.
  return Number((db.prepare(`SELECT COALESCE(SUM(CASE WHEN attempt > 0 THEN attempt ELSE 1 END),0) count
    FROM ai_jobs job WHERE job.space_id=? AND job.created_at>=? AND job.created_at<?
      AND NOT EXISTS (
        SELECT 1 FROM platform_usage_events usage
        WHERE usage.space_id=job.space_id AND usage.meter='monthlyAiActions'
          AND usage.source_type='durable_ai_job_attempt' AND usage.source_id=job.id
      )`).get(spaceId, period.start, period.end) as
      { count?: number } | undefined)?.count || 0);
}

function bucketQuantity(spaceId: string, quota: MeteredSubscriptionQuota, period: UsagePeriod) {
  return Number((db.prepare(`SELECT quantity FROM platform_usage_buckets
    WHERE space_id=? AND meter=? AND period_start=?`).get(spaceId, quota, period.start) as
      { quantity?: number } | undefined)?.quantity || 0);
}

function accountingQuantity(spaceId: string, quota: MeteredSubscriptionQuota, period: UsagePeriod) {
  const materialized = bucketQuantity(spaceId, quota, period);
  return quota === 'monthlyAiActions' ? materialized + legacyDurableMonthlyAiActions(spaceId, period) : materialized;
}

function warningLevel(used: number, limit: number): UsageWarningLevel {
  if (limit <= 0 || used >= limit) return 'exhausted';
  const ratio = used / limit;
  if (ratio >= 0.9) return 'warning';
  if (ratio >= 0.75) return 'approaching';
  return 'normal';
}

export function meteredUsageSnapshot(
  spaceId: string,
  quota: MeteredSubscriptionQuota,
  now: Date | string = new Date()
): MeteredUsageSnapshot {
  const instant = validDate(now instanceof Date ? new Date(now.getTime()) : new Date(now));
  const period = usagePeriodAt(instant);
  const used = accountingQuantity(spaceId, quota, period);
  const limit = Number(effectiveSubscriptionForSpace(spaceId).plan.limits[quota]);
  const periodMs = new Date(period.end).getTime() - new Date(period.start).getTime();
  const elapsedMs = Math.max(24 * 60 * 60_000,
    Math.min(periodMs, instant.getTime() - new Date(period.start).getTime()));
  const projectedPeriodEnd = used === 0 ? 0 : Math.max(used, Math.ceil((used * periodMs) / elapsedMs));
  return {
    quota, kind: 'metered', periodStart: period.start, periodEnd: period.end, resetAt: period.end,
    used, limit, remaining: Math.max(0, limit - used),
    percentUsed: limit > 0 ? Math.min(100, Math.round((used / limit) * 10_000) / 100) : 100,
    projectedPeriodEnd, warningLevel: warningLevel(used, limit)
  };
}

export function currentMeteredUsage(spaceId: string, now: Date | string = new Date()) {
  return meteredSubscriptionQuotas.map((quota) => meteredUsageSnapshot(spaceId, quota, now));
}

export function currentMonthlyAiActions(spaceId: string, now: Date | string = new Date()) {
  return meteredUsageSnapshot(spaceId, 'monthlyAiActions', now).used;
}

export function assertCanQueueAiAction(spaceId: string) {
  return assertSubscriptionQuota(spaceId, 'monthlyAiActions', currentMonthlyAiActions(spaceId), 1);
}

function usageToken(label: string, value: string, maximum: number) {
  if (!value || value.length > maximum || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new SubscriptionEntitlementError(`Invalid ${label}.`, 400, 'SUBSCRIPTION_USAGE_INPUT_INVALID', { field: label });
  }
  return value;
}

function usageIntentHash(intent: unknown) {
  return crypto.createHash('sha256').update(stableJson(intent)).digest('hex');
}

type UsageEventRow = {
  id: string;
  quantity: number;
  intent_hash: string;
};

export function consumeSubscriptionUsage(input: {
  spaceId: string;
  quota: MeteredSubscriptionQuota;
  quantity?: number;
  idempotencyKey: string;
  intent: unknown;
  sourceType: string;
  sourceId?: string | null;
  actorUserId?: string | null;
  now?: Date | string;
}): UsageReceipt {
  if (!isMeteredSubscriptionQuota(input.quota)) {
    throw new SubscriptionEntitlementError('That allowance is not a metered monthly quota.', 400,
      'SUBSCRIPTION_USAGE_METER_INVALID', { quota: input.quota });
  }
  const quantity = input.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new SubscriptionEntitlementError('Usage quantity must be a positive integer.', 400,
      'SUBSCRIPTION_USAGE_QUANTITY_INVALID');
  }
  const idempotencyKey = usageToken('idempotencyKey', input.idempotencyKey, 200);
  const sourceType = usageToken('sourceType', input.sourceType, 80);
  const sourceId = input.sourceId === null || input.sourceId === undefined
    ? null : usageToken('sourceId', input.sourceId, 200);
  const instant = validDate(input.now instanceof Date ? new Date(input.now.getTime()) : new Date(input.now || Date.now()));
  const period = usagePeriodAt(instant);
  const intentHash = usageIntentHash(input.intent);

  return db.transaction(() => {
    // PostgreSQL requires an explicit per-space mutex. SQLite write
    // transactions already serialize the same decision and increment.
    if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
    const replay = db.prepare(`SELECT id,quantity,intent_hash FROM platform_usage_events
      WHERE space_id=? AND meter=? AND period_start=? AND idempotency_key=?`)
      .get(input.spaceId, input.quota, period.start, idempotencyKey) as UsageEventRow | undefined;
    if (replay) {
      if (replay.intent_hash !== intentHash || Number(replay.quantity) !== quantity) {
        throw new SubscriptionEntitlementError(
          'This idempotency key was already used for a different usage intent.', 409,
          'SUBSCRIPTION_USAGE_IDEMPOTENCY_CONFLICT', { quota: input.quota }
        );
      }
      return { ...meteredUsageSnapshot(input.spaceId, input.quota, instant), eventId: replay.id, quantity, replayed: true };
    }

    const current = accountingQuantity(input.spaceId, input.quota, period);
    const effective = assertSubscriptionQuota(input.spaceId, input.quota, current, quantity);
    const id = crypto.randomUUID();
    const createdAt = instant.toISOString();
    db.prepare(`INSERT INTO platform_usage_events
      (id,space_id,subscription_id,meter,quantity,period_start,period_end,idempotency_key,intent_hash,
        source_type,source_id,actor_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, input.spaceId, effective.subscriptionId, input.quota, quantity, period.start, period.end,
        idempotencyKey, intentHash, sourceType, sourceId, input.actorUserId || null, createdAt
      );
    db.prepare(`INSERT INTO platform_usage_buckets(space_id,meter,period_start,period_end,quantity,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(space_id,meter,period_start) DO UPDATE SET
        period_end=excluded.period_end,quantity=platform_usage_buckets.quantity+excluded.quantity,updated_at=excluded.updated_at`)
      .run(input.spaceId, input.quota, period.start, period.end, quantity, createdAt);
    return { ...meteredUsageSnapshot(input.spaceId, input.quota, instant), eventId: id, quantity, replayed: false };
  })();
}

type DurableAiJobUsageIdentity = {
  jobId: string;
  spaceId: string;
  kind: string;
  requestedBy: string | null;
  generation: number;
  attempt: number;
  now?: Date | string;
};

function durableAiJobUsageIntent(input: Pick<DurableAiJobUsageIdentity, 'jobId' | 'kind' | 'generation' | 'attempt'>) {
  return { jobId: input.jobId, kind: input.kind, generation: input.generation, attempt: input.attempt };
}

function durableAiJobUsageKey(input: Pick<DurableAiJobUsageIdentity, 'jobId' | 'generation' | 'attempt'>) {
  return `durable-ai-job:${input.jobId}:generation:${input.generation}:attempt:${input.attempt}`;
}

function durableAiJobUsageReplay(input: DurableAiJobUsageIdentity): UsageReceipt | null {
  const idempotencyKey = durableAiJobUsageKey(input);
  const intentHash = usageIntentHash(durableAiJobUsageIntent(input));
  const row = db.prepare(`SELECT id,quantity,intent_hash,created_at FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyAiActions' AND source_type='durable_ai_job_attempt'
      AND source_id=? AND idempotency_key=? ORDER BY created_at,id LIMIT 1`)
    .get(input.spaceId, input.jobId, idempotencyKey) as
      (UsageEventRow & { created_at: string }) | undefined;
  if (!row) return null;
  if (Number(row.quantity) !== 1 || row.intent_hash !== intentHash) {
    throw new SubscriptionEntitlementError(
      'This durable AI execution identity was already used for a different usage intent.', 409,
      'SUBSCRIPTION_USAGE_IDEMPOTENCY_CONFLICT', { quota: 'monthlyAiActions' }
    );
  }
  return {
    ...meteredUsageSnapshot(input.spaceId, 'monthlyAiActions', row.created_at),
    eventId: row.id,
    quantity: 1,
    replayed: true
  };
}

function validExecutionOrdinal(label: string, value: number, minimum: number) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new SubscriptionEntitlementError(`Invalid durable AI ${label}.`, 400,
      'SUBSCRIPTION_USAGE_INPUT_INVALID', { field: label });
  }
  return value;
}

/** Reserve the first execution before inserting a new durable AI row. The
 * caller wraps this and the insert in one database transaction. */
export function reserveNewDurableAiJob(input: DurableAiJobUsageIdentity) {
  validExecutionOrdinal('generation', input.generation, 0);
  validExecutionOrdinal('attempt', input.attempt, 1);
  return consumeSubscriptionUsage({
    spaceId: input.spaceId,
    quota: 'monthlyAiActions',
    idempotencyKey: durableAiJobUsageKey(input),
    intent: durableAiJobUsageIntent(input),
    sourceType: 'durable_ai_job_attempt',
    sourceId: input.jobId,
    actorUserId: input.requestedBy,
    now: input.now
  });
}

/** Convert a pre-admission job's compatibility count into immutable events
 * without changing its already-consumed allowance. This runs under the same
 * per-space mutex and is used only before a legacy job can retry. */
function materializeLegacyDurableAiJob(row: {
  id: string;
  space_id: string;
  kind: string;
  requested_by: string | null;
  attempt: number;
  input_json: string;
  created_at: string;
}) {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(row.input_json || '{}') as Record<string, unknown>; } catch { parsed = {}; }
  const recordedGeneration = Number(parsed.terraExecutionGeneration ?? 0);
  const generation = Number.isSafeInteger(recordedGeneration) && recordedGeneration >= 0 ? recordedGeneration : 0;
  const reservedAttempts = Math.max(1, Number.isSafeInteger(Number(row.attempt)) ? Number(row.attempt) : 0);
  const period = usagePeriodAt(row.created_at);
  const effective = effectiveSubscriptionForSpace(row.space_id);
  let inserted = 0;
  for (let attempt = 1; attempt <= reservedAttempts; attempt += 1) {
    const identity = {
      jobId: row.id, spaceId: row.space_id, kind: row.kind, requestedBy: row.requested_by,
      generation, attempt, now: row.created_at
    };
    if (durableAiJobUsageReplay(identity)) continue;
    const result = db.prepare(`INSERT INTO platform_usage_events
      (id,space_id,subscription_id,meter,quantity,period_start,period_end,idempotency_key,intent_hash,
        source_type,source_id,actor_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(
        crypto.randomUUID(), row.space_id, effective.subscriptionId, 'monthlyAiActions', 1, period.start, period.end,
        durableAiJobUsageKey(identity), usageIntentHash(durableAiJobUsageIntent(identity)),
        'durable_ai_job_attempt', row.id, row.requested_by || null, row.created_at
      );
    inserted += result.changes;
  }
  if (inserted) db.prepare(`INSERT INTO platform_usage_buckets(space_id,meter,period_start,period_end,quantity,updated_at)
    VALUES (?,'monthlyAiActions',?,?,?,?) ON CONFLICT(space_id,meter,period_start) DO UPDATE SET
      period_end=excluded.period_end,quantity=platform_usage_buckets.quantity+excluded.quantity,updated_at=excluded.updated_at`)
    .run(row.space_id, period.start, period.end, inserted, row.created_at);
}

/** Idempotently reserve an execution for an existing queued/retried job. New
 * jobs replay their creation reservation; legacy jobs are first adopted into
 * the ledger so the compatibility count and bucket never overlap. */
export function reserveExistingDurableAiJobAttempt(input: {
  jobId: string;
  spaceId: string;
  generation: number;
  attempt: number;
  now?: Date | string;
}) {
  validExecutionOrdinal('generation', input.generation, 0);
  validExecutionOrdinal('attempt', input.attempt, 1);
  return db.transaction(() => {
    if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
    const row = db.prepare(`SELECT id,space_id,kind,requested_by,attempt,input_json,created_at
      FROM ai_jobs WHERE id=? AND space_id=?`).get(input.jobId, input.spaceId) as {
        id: string; space_id: string; kind: string; requested_by: string | null;
        attempt: number; input_json: string; created_at: string;
      } | undefined;
    if (!row) throw new SubscriptionEntitlementError('Durable AI job not found.', 404,
      'SUBSCRIPTION_USAGE_SOURCE_NOT_FOUND', { sourceId: input.jobId });
    materializeLegacyDurableAiJob(row);
    const identity = {
      jobId: row.id,
      spaceId: row.space_id,
      kind: row.kind,
      requestedBy: row.requested_by,
      generation: input.generation,
      attempt: input.attempt,
      now: input.now
    };
    return durableAiJobUsageReplay(identity) || reserveNewDurableAiJob(identity);
  })();
}

export type UsageReconciliationDifference = {
  spaceId: string;
  quota: string;
  periodStart: string;
  periodEnd: string;
  ledgerQuantity: number;
  bucketQuantity: number;
  delta: number;
};

/** Compare the immutable event ledger, including durable AI attempts, with its
 * materialized acceleration buckets. */
export function reconcileSubscriptionUsage(spaceId?: string) {
  const where = spaceId ? 'WHERE space_id=?' : '';
  const parameters = spaceId ? [spaceId] : [];
  const ledger = db.prepare(`SELECT space_id,meter,period_start,MAX(period_end) period_end,SUM(quantity) quantity
    FROM platform_usage_events ${where} GROUP BY space_id,meter,period_start`)
    .all(...parameters) as Array<any>;
  const buckets = db.prepare(`SELECT space_id,meter,period_start,period_end,quantity
    FROM platform_usage_buckets ${where}`).all(...parameters) as Array<any>;
  const keys = new Set<string>();
  const ledgerByKey = new Map<string, any>();
  const bucketByKey = new Map<string, any>();
  const rowKey = (row: any) => `${row.space_id}\u0000${row.meter}\u0000${row.period_start}`;
  for (const row of ledger) { const key = rowKey(row); keys.add(key); ledgerByKey.set(key, row); }
  for (const row of buckets) { const key = rowKey(row); keys.add(key); bucketByKey.set(key, row); }
  const differences: UsageReconciliationDifference[] = [];
  for (const key of [...keys].sort()) {
    const ledgerRow = ledgerByKey.get(key);
    const bucketRow = bucketByKey.get(key);
    const ledgerQuantity = Number(ledgerRow?.quantity || 0);
    const materializedQuantity = Number(bucketRow?.quantity || 0);
    if (ledgerQuantity === materializedQuantity && (!ledgerRow || ledgerRow.period_end === bucketRow?.period_end)) continue;
    const [rowSpaceId, quota, periodStart] = key.split('\u0000');
    differences.push({
      spaceId: rowSpaceId, quota, periodStart,
      periodEnd: String(ledgerRow?.period_end || bucketRow?.period_end || ''),
      ledgerQuantity, bucketQuantity: materializedQuantity, delta: ledgerQuantity - materializedQuantity
    });
  }
  return { matched: differences.length === 0, differences, ledgerBuckets: ledger.length, materializedBuckets: buckets.length };
}

/** One-time compatibility import for SQLite and an explicit repair primitive
 * for installations that still contain pre-runtime-15 direct AI records. */
export function backfillLegacyDirectAiUsage() {
  try { db.prepare('SELECT 1 FROM platform_usage_events LIMIT 1').get(); }
  catch { return { inserted: 0 }; }
  const legacy = db.prepare(`SELECT event.id,event.space_id,event.subscription_id,event.actor_user_id,event.created_at
    FROM platform_subscription_events event
    LEFT JOIN platform_usage_events usage ON usage.source_type='legacy_subscription_event' AND usage.source_id=event.id
    WHERE event.event_type='usage.ai_action' AND usage.id IS NULL ORDER BY event.created_at,event.id`).all() as Array<any>;
  const insert = db.prepare(`INSERT INTO platform_usage_events
    (id,space_id,subscription_id,meter,quantity,period_start,period_end,idempotency_key,intent_hash,
      source_type,source_id,actor_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const touched = new Set<string>();
  let inserted = 0;
  for (const row of legacy) {
    const period = usagePeriodAt(String(row.created_at));
    const idempotencyKey = `legacy-subscription-event:${String(row.id)}`.slice(0, 200);
    const hash = usageIntentHash({ eventType: 'usage.ai_action', legacySubscriptionEventId: String(row.id) });
    const result = insert.run(String(row.id), String(row.space_id), row.subscription_id || null,
      'monthlyAiActions', 1, period.start, period.end, idempotencyKey, hash,
      'legacy_subscription_event', String(row.id).slice(0, 200), row.actor_user_id || null, String(row.created_at));
    inserted += result.changes;
    touched.add(`${String(row.space_id)}\u0000${period.start}`);
  }
  for (const item of touched) {
    const [rowSpaceId, periodStart] = item.split('\u0000');
    const aggregate = db.prepare(`SELECT MAX(period_end) period_end,SUM(quantity) quantity,MAX(created_at) updated_at
      FROM platform_usage_events WHERE space_id=? AND meter='monthlyAiActions' AND period_start=?`)
      .get(rowSpaceId, periodStart) as any;
    db.prepare(`INSERT INTO platform_usage_buckets(space_id,meter,period_start,period_end,quantity,updated_at)
      VALUES (?,'monthlyAiActions',?,?,?,?) ON CONFLICT(space_id,meter,period_start) DO UPDATE SET
        period_end=excluded.period_end,quantity=excluded.quantity,updated_at=excluded.updated_at`)
      .run(rowSpaceId, periodStart, aggregate.period_end, Number(aggregate.quantity || 0), aggregate.updated_at);
  }
  return { inserted };
}

/** Reserve one synchronous AI call in the same ledger/mutex used by durable jobs. */
export function consumeDirectAiAction(input: {
  spaceId: string; userId: string | null; actionId: string; requestKey: string; now?: Date | string;
}) {
  const metadata = JSON.stringify({ actionId: input.actionId, requestKey: input.requestKey });
  const key = `direct-ai:${crypto.createHash('sha256').update(metadata).digest('hex')}`;
  const intent = { actionId: input.actionId, requestKey: input.requestKey };
  const intentHash = usageIntentHash(intent);
  return db.transaction(() => {
    // Direct request identities, unlike generic export keys, are globally
    // replayable across UTC months. Keep this lookup behind the same mutex so
    // an Aug/Sep race cannot insert one copy into each monthly period.
    if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
    const legacy = db.prepare(`SELECT id FROM platform_subscription_events
      WHERE space_id=? AND event_type='usage.ai_action' AND metadata_json=? LIMIT 1`)
      .get(input.spaceId, metadata) as { id?: string } | undefined;
    if (legacy?.id) {
      backfillLegacyDirectAiUsage();
      return { id: legacy.id, replayed: true };
    }
    const replay = db.prepare(`SELECT id,quantity,intent_hash FROM platform_usage_events
      WHERE space_id=? AND meter='monthlyAiActions' AND source_type='direct_ai_action'
        AND source_id=? AND idempotency_key=? ORDER BY created_at,id LIMIT 1`)
      .get(input.spaceId, input.actionId, key) as UsageEventRow | undefined;
    if (replay) {
      if (Number(replay.quantity) !== 1 || replay.intent_hash !== intentHash) {
        throw new SubscriptionEntitlementError(
          'This direct AI request identity was already used for a different usage intent.', 409,
          'SUBSCRIPTION_USAGE_IDEMPOTENCY_CONFLICT', { quota: 'monthlyAiActions' }
        );
      }
      return { id: replay.id, replayed: true };
    }
    const receipt = consumeSubscriptionUsage({
      spaceId: input.spaceId, quota: 'monthlyAiActions', idempotencyKey: key,
      intent, sourceType: 'direct_ai_action', sourceId: input.actionId,
      actorUserId: input.userId, now: input.now
    });
    return { id: receipt.eventId, replayed: receipt.replayed };
  })();
}
