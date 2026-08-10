import { z } from 'zod';
import { api } from '@/lib/api';

export const killSwitchLevels = ['platform','space','workflow','adapter','profile'] as const;
export const killSwitchReasons = ['operational_incident','safety_incident','compliance_hold','maintenance',
  'cost_control','governance_review','recovery_verified'] as const;
export const reviewedAdapters = ['survey_invitation','service_recovery_ticket','assistant_action',
  'internal_notification','signed_webhook'] as const;
const stateSchema = z.object({ scopeLevel: z.enum(killSwitchLevels), spaceId: z.string().nullable(), scopeKey: z.string(),
  state: z.enum(['enabled','disabled']), reasonCode: z.string(), revision: z.number(), gateKey: z.string(),
  updatedAt: z.string() }).strict();
const summaryResolution = z.object({ decision: z.enum(['allow','deny']), blockedLevel: z.enum(killSwitchLevels).nullable(),
  reasonCode: z.string(), levels: z.array(z.object({ level: z.enum(killSwitchLevels), decision: z.enum(['allow','deny']),
    state: z.enum(['enabled','disabled','unknown']), reasonCode: z.string(), source: z.enum(['record','default']) }).strict()) }).strict();
const levelResolution = z.object({ level: z.enum(killSwitchLevels), gateKey: z.string(), scopeRefSha256: z.string().nullable(),
  state: z.enum(['enabled','disabled','unknown']), decision: z.enum(['allow','deny','unknown']), reasonCode: z.string(),
  source: z.enum(['record','default','missing_scope']) }).strict();
const effectiveResolution = z.object({ decision: z.enum(['allow','deny']), blockedLevel: z.enum(killSwitchLevels).nullable(),
  reasonCode: z.string(), levels: z.array(levelResolution), gates: z.record(z.string(), z.enum(['allow','deny','unknown'])) }).strict();
const mutationResult = z.object({ switch: stateSchema, replayed: z.boolean(), changed: z.boolean(), mutationId: z.string(),
  idempotencyKey: z.string(), pausedCount: z.number(), releasedLeaseCount: z.number(), resumedCount: z.number(),
  stillDisabledCount: z.number(), createdAt: z.string() }).strict();
const listSchema = z.object({ platform: stateSchema.nullable(), scopes: z.array(stateSchema), effective: summaryResolution }).strict();
const platformSchema = z.object({ switch: stateSchema.nullable(), effective: summaryResolution }).strict();
const auditSchema = z.object({ events: z.array(z.object({ id: z.string(), authority: z.string(), action: z.string(),
  scopeLevel: z.string(), scopeKey: z.string(), detail: z.record(z.string(), z.unknown()), detailSha256: z.string(),
  createdAt: z.string() }).strict()) }).strict();
const pausesSchema = z.object({ pauses: z.array(z.object({ id: z.string(), queueId: z.string(), previousState: z.string(),
  leaseReleased: z.boolean(), fencingToken: z.number(), reasonCode: z.string(), createdAt: z.string(),
  resumption: z.string().nullable() }).strict()) }).strict();

export type KillSwitchState = z.infer<typeof stateSchema>;
export type KillSwitchMutation = z.infer<typeof mutationResult>;
export type KillSwitchList = z.infer<typeof listSchema>;
export type KillSwitchReason = typeof killSwitchReasons[number];
export type ScopedKillSwitchLevel = 'workflow' | 'adapter' | 'profile';

async function parsed<T>(schema: z.ZodType<T>, path: string, options?: RequestInit) {
  return schema.parse(await api<unknown>(path, options));
}
function mutationOptions(state: 'enabled' | 'disabled', reasonCode: KillSwitchReason, expectedRevision: number): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json',
    'Idempotency-Key': `journey-switch-${crypto.randomUUID()}` }, body: JSON.stringify({ state, reasonCode, expectedRevision }) };
}
export const listJourneyKillSwitches = () => parsed(listSchema, '/api/journey-kill-switches');
export const readPlatformKillSwitch = () => parsed(platformSchema, '/api/journey-kill-switches/platform');
export const setSpaceKillSwitch = (record: KillSwitchState | null, state: 'enabled' | 'disabled', reason: KillSwitchReason) =>
  parsed(mutationResult, '/api/journey-kill-switches/space', mutationOptions(state, reason, record?.revision || 0));
export const setPlatformKillSwitch = (record: KillSwitchState | null, state: 'enabled' | 'disabled', reason: KillSwitchReason) =>
  parsed(mutationResult, '/api/journey-kill-switches/platform', mutationOptions(state, reason, record?.revision || 0));
export const setScopedKillSwitch = (level: ScopedKillSwitchLevel, scopeKey: string, record: KillSwitchState | null,
  state: 'enabled' | 'disabled', reason: KillSwitchReason) => parsed(mutationResult,
  `/api/journey-kill-switches/scopes/${level}/${encodeURIComponent(scopeKey)}`,
  mutationOptions(state, reason, record?.revision || 0));
export const resolveJourneyKillSwitch = (input: { workflowId: string; adapter: typeof reviewedAdapters[number];
  profileRefSha256: string }) => parsed(z.object({ spaceId: z.string(), workflowId: z.string(), adapter: z.string(),
  profileRefSha256: z.string(), resolution: effectiveResolution }).strict(),
  `/api/journey-kill-switches/effective?${new URLSearchParams(input).toString()}`);
export const listJourneyKillSwitchAudit = () => parsed(auditSchema, '/api/journey-kill-switches/audit?limit=30');
export const listJourneyKillSwitchPauses = () => parsed(pausesSchema, '/api/journey-kill-switches/pauses?limit=50');
