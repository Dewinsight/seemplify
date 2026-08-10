import crypto from 'node:crypto';
import { resolveEffectiveJourneyKillSwitch, type JourneyKillSwitchRecord,
  type JourneyKillSwitchScope } from './journeyKillSwitchDomain.js';

export const workerGateOrder = Object.freeze(['consent', 'suppression', 'entitlement', 'quota',
  'quiet_hours', 'frequency_cap', 'source_state', 'platform_kill_switch', 'space_kill_switch',
  'workflow_kill_switch', 'adapter_kill_switch', 'profile_kill_switch'] as const);
export type WorkerGateKey = typeof workerGateOrder[number];
export type WorkerGateDecision = 'allow' | 'deny' | 'unknown';
export type WorkerGateResult = Readonly<{ key: WorkerGateKey; decision: WorkerGateDecision; reasonCode: string }>;

export type WorkerAuthority = Readonly<{
  kind: 'journey_action_worker'; workerIdSha256: string; allowedSpaceIds: readonly string[];
  allowedAdapters: readonly string[]; issuedAt: string; expiresAt: string; keyId: string;
}>;

type CredentialPayload = Readonly<{ v: 1; kind: 'journey_action_worker'; workerId: string; spaces: string[];
  adapters: string[]; iat: string; exp: string; kid: string }>;
const tokenPart = /^[A-Za-z0-9_-]+$/u;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

export class JourneyActionWorkerError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400) {
    super(message); this.name = 'JourneyActionWorkerError';
  }
}

function validCredentialPayload(value: unknown): value is CredentialPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<CredentialPayload>;
  return p.v === 1 && p.kind === 'journey_action_worker' && typeof p.workerId === 'string'
    && identifier.test(p.workerId) && Array.isArray(p.spaces) && p.spaces.length > 0
    && p.spaces.every((entry) => typeof entry === 'string' && identifier.test(entry))
    && new Set(p.spaces).size === p.spaces.length && Array.isArray(p.adapters) && p.adapters.length > 0
    && p.adapters.every((entry) => typeof entry === 'string' && identifier.test(entry))
    && new Set(p.adapters).size === p.adapters.length && typeof p.iat === 'string' && Number.isFinite(Date.parse(p.iat))
    && typeof p.exp === 'string' && Number.isFinite(Date.parse(p.exp)) && typeof p.kid === 'string'
    && identifier.test(p.kid);
}

/** Provisioning helper. Credentials remain service credentials and cannot represent a user session. */
export function mintJourneyWorkerCredential(input: { workerId: string; allowedSpaceIds: string[];
  allowedAdapters: string[]; issuedAt: string; expiresAt: string; keyId: string; secret: string }): string {
  const payload: CredentialPayload = { v: 1, kind: 'journey_action_worker', workerId: input.workerId,
    spaces: input.allowedSpaceIds, adapters: input.allowedAdapters, iat: input.issuedAt, exp: input.expiresAt,
    kid: input.keyId };
  if (input.secret.length < 32 || !validCredentialPayload(payload) || Date.parse(payload.exp) <= Date.parse(payload.iat)) {
    throw new JourneyActionWorkerError('Worker credential configuration is invalid.', 'WORKER_CREDENTIAL_INVALID');
  }
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(crypto.createHmac('sha256', input.secret).update(body).digest());
  return `${body}.${signature}`;
}

export function authenticateJourneyWorker(input: { credential: string; secretForKey: (keyId: string) => string | null;
  now: string }): WorkerAuthority {
  const parts = input.credential.split('.');
  if (parts.length !== 2 || parts.some((part) => !tokenPart.test(part))) throw new JourneyActionWorkerError(
    'Worker authentication failed.', 'WORKER_UNAUTHENTICATED', 401);
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { payload = null; }
  if (!validCredentialPayload(payload)) throw new JourneyActionWorkerError(
    'Worker authentication failed.', 'WORKER_UNAUTHENTICATED', 401);
  const secret = input.secretForKey(payload.kid);
  if (!secret || secret.length < 32) throw new JourneyActionWorkerError('Worker authentication failed.',
    'WORKER_UNAUTHENTICATED', 401);
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest();
  let actual: Buffer;
  try { actual = Buffer.from(parts[1], 'base64url'); } catch { actual = Buffer.alloc(0); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new JourneyActionWorkerError(
    'Worker authentication failed.', 'WORKER_UNAUTHENTICATED', 401);
  const now = Date.parse(input.now);
  if (!Number.isFinite(now) || Date.parse(payload.iat) > now || Date.parse(payload.exp) <= now) {
    throw new JourneyActionWorkerError('Worker credential is not currently valid.', 'WORKER_CREDENTIAL_EXPIRED', 401);
  }
  return Object.freeze({ kind: 'journey_action_worker', workerIdSha256: sha256(payload.workerId),
    allowedSpaceIds: Object.freeze([...payload.spaces]), allowedAdapters: Object.freeze([...payload.adapters]),
    issuedAt: payload.iat, expiresAt: payload.exp, keyId: payload.kid });
}

export type WorkerLiveFacts = Readonly<{
  consent: 'granted' | 'denied' | 'unknown'; suppressed: boolean | null; entitled: boolean | null;
  quota: Readonly<{ used: number; reserved: number; limit: number }> | null;
  quietHours: Readonly<{ timezone: string; startMinute: number; endMinute: number }> | null;
  frequency: Readonly<{ observed: number; maximum: number; windowEndsAt: string }> | null;
  sourceState: 'active' | 'paused' | 'retired' | 'unknown';
  killSwitchScope: JourneyKillSwitchScope; killSwitchRecords: readonly JourneyKillSwitchRecord[];
}>;

function localMinute(now: string, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23' }).formatToParts(new Date(now));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
  } catch { return null; }
}

const gate = (key: WorkerGateKey, decision: WorkerGateDecision, reasonCode: string): WorkerGateResult =>
  Object.freeze({ key, decision, reasonCode });

/** Resolves raw server-owned facts. Unknown or malformed evidence fails closed. */
export function resolveJourneyWorkerGates(facts: WorkerLiveFacts, now: string) {
  const results: WorkerGateResult[] = [];
  results.push(gate('consent', facts.consent === 'granted' ? 'allow' : facts.consent === 'denied' ? 'deny' : 'unknown',
    facts.consent === 'granted' ? 'CONSENT_GRANTED' : facts.consent === 'denied' ? 'CONSENT_DENIED' : 'CONSENT_UNKNOWN'));
  results.push(gate('suppression', facts.suppressed === false ? 'allow' : facts.suppressed === true ? 'deny' : 'unknown',
    facts.suppressed === false ? 'NOT_SUPPRESSED' : facts.suppressed === true ? 'RECIPIENT_SUPPRESSED' : 'SUPPRESSION_UNKNOWN'));
  results.push(gate('entitlement', facts.entitled === true ? 'allow' : facts.entitled === false ? 'deny' : 'unknown',
    facts.entitled === true ? 'ENTITLEMENT_ACTIVE' : facts.entitled === false ? 'ENTITLEMENT_INACTIVE' : 'ENTITLEMENT_UNKNOWN'));
  const quotaValid = facts.quota && Number.isSafeInteger(facts.quota.used) && Number.isSafeInteger(facts.quota.reserved)
    && Number.isSafeInteger(facts.quota.limit) && facts.quota.used >= 0 && facts.quota.reserved >= 0 && facts.quota.limit >= 0;
  results.push(gate('quota', !quotaValid ? 'unknown' : facts.quota!.used + facts.quota!.reserved < facts.quota!.limit
    ? 'allow' : 'deny', !quotaValid ? 'QUOTA_UNKNOWN' : facts.quota!.used + facts.quota!.reserved < facts.quota!.limit
      ? 'QUOTA_AVAILABLE' : 'QUOTA_EXHAUSTED'));
  let quietDecision: WorkerGateDecision = 'unknown'; let quietReason = 'QUIET_HOURS_UNKNOWN';
  if (facts.quietHours && Number.isInteger(facts.quietHours.startMinute) && Number.isInteger(facts.quietHours.endMinute)
      && facts.quietHours.startMinute >= 0 && facts.quietHours.startMinute < 1440
      && facts.quietHours.endMinute >= 0 && facts.quietHours.endMinute < 1440 && Number.isFinite(Date.parse(now))) {
    const minute = localMinute(now, facts.quietHours.timezone);
    if (minute !== null) {
      const { startMinute: start, endMinute: end } = facts.quietHours;
      const quiet = start === end ? true : start < end ? minute >= start && minute < end : minute >= start || minute < end;
      quietDecision = quiet ? 'deny' : 'allow'; quietReason = quiet ? 'QUIET_HOURS_ACTIVE' : 'OUTSIDE_QUIET_HOURS';
    }
  }
  results.push(gate('quiet_hours', quietDecision, quietReason));
  const frequencyValid = facts.frequency && Number.isSafeInteger(facts.frequency.observed)
    && Number.isSafeInteger(facts.frequency.maximum) && facts.frequency.observed >= 0 && facts.frequency.maximum >= 0
    && Number.isFinite(Date.parse(facts.frequency.windowEndsAt)) && Date.parse(facts.frequency.windowEndsAt) > Date.parse(now);
  results.push(gate('frequency_cap', !frequencyValid ? 'unknown' : facts.frequency!.observed < facts.frequency!.maximum
    ? 'allow' : 'deny', !frequencyValid ? 'FREQUENCY_CAP_UNKNOWN' : facts.frequency!.observed < facts.frequency!.maximum
      ? 'FREQUENCY_CAP_AVAILABLE' : 'FREQUENCY_CAP_REACHED'));
  results.push(gate('source_state', facts.sourceState === 'active' ? 'allow' : facts.sourceState === 'unknown' ? 'unknown' : 'deny',
    facts.sourceState === 'active' ? 'SOURCE_ACTIVE' : facts.sourceState === 'unknown' ? 'SOURCE_STATE_UNKNOWN' : 'SOURCE_INACTIVE'));
  const killSwitch = resolveEffectiveJourneyKillSwitch({ scope: facts.killSwitchScope, records: facts.killSwitchRecords });
  for (const level of killSwitch.levels) results.push(gate(level.gateKey, level.decision, level.reasonCode));
  const firstBlocking = results.find((result) => result.decision !== 'allow') || null;
  return Object.freeze({ decision: firstBlocking ? 'deny' as const : 'allow' as const,
    reasonCode: firstBlocking?.reasonCode ?? 'ALL_LIVE_GATES_ALLOW', blockedGate: firstBlocking?.key ?? null,
    gates: Object.freeze(results) });
}

export function assertWorkerScope(authority: WorkerAuthority, spaceId: string, adapter: string): void {
  if (authority.kind !== 'journey_action_worker') throw new JourneyActionWorkerError('Service authority is required.',
    'WORKER_SERVICE_AUTHORITY_REQUIRED', 403);
  if (!authority.allowedSpaceIds.includes(spaceId)) throw new JourneyActionWorkerError('Worker space scope denied.',
    'WORKER_SPACE_SCOPE_DENIED', 403);
  if (!authority.allowedAdapters.includes(adapter)) throw new JourneyActionWorkerError('Worker adapter scope denied.',
    'WORKER_ADAPTER_SCOPE_DENIED', 403);
}
