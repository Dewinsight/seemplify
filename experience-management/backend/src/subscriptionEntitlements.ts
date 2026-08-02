import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './database.js';

export type SubscriptionFeature = 'surveys' | 'campaigns' | 'agreements' | 'serviceRecovery'
  | 'socialListening' | 'knowledgeBases' | 'terra';
export type SubscriptionQuota = 'seats' | 'activeSurveys' | 'monthlyAiActions' | 'knowledgeStorageBytes';
export type SubscriptionPlanCode = 'starter' | 'team' | 'enterprise';

export const subscriptionCatalogVersion = '2026-07-30.1';

export const subscriptionPlanCatalog = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'Core experience management for a small team.',
    requestable: true,
    features: {
      surveys: true, campaigns: true, agreements: true, serviceRecovery: true,
      socialListening: false, knowledgeBases: false, terra: true
    },
    limits: { seats: 3, activeSurveys: 10, monthlyAiActions: 100, knowledgeStorageBytes: 0 }
  },
  {
    code: 'team',
    name: 'Team',
    description: 'Collaboration, intelligence, listening, and knowledge workflows.',
    requestable: true,
    features: {
      surveys: true, campaigns: true, agreements: true, serviceRecovery: true,
      socialListening: true, knowledgeBases: true, terra: true
    },
    limits: { seats: 25, activeSurveys: 250, monthlyAiActions: 5_000, knowledgeStorageBytes: 20 * 1024 * 1024 * 1024 }
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Managed limits and governance for larger organisations.',
    requestable: true,
    features: {
      surveys: true, campaigns: true, agreements: true, serviceRecovery: true,
      socialListening: true, knowledgeBases: true, terra: true
    },
    limits: { seats: 250, activeSurveys: 5_000, monthlyAiActions: 100_000, knowledgeStorageBytes: 200 * 1024 * 1024 * 1024 }
  }
] as const;

export const subscriptionPlanCodes = ['starter', 'team', 'enterprise'] as const;
export type SubscriptionPlan = (typeof subscriptionPlanCatalog)[number];

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

export function publicSubscriptionPlan(code: string): SubscriptionPlan | null {
  return subscriptionPlanCatalog.find((plan) => plan.code === code) || null;
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

export function assertCanQueueAiAction(spaceId: string) {
  const start = new Date();
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const current = Number((db.prepare('SELECT COUNT(*) count FROM ai_jobs WHERE space_id=? AND created_at>=?')
    .get(spaceId, start.toISOString()) as { count?: number } | undefined)?.count || 0);
  return assertSubscriptionQuota(spaceId, 'monthlyAiActions', current, 1);
}
