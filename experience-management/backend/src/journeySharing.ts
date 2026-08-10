import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { db } from './database.js';
import {
  assertJourneyCapability, getJourneyCollaborationContext, idempotentMutation,
  journeyCollaborationPlanState, recordJourneyGovernedActivity,
  resolveJourneyCollaborationTarget, JourneyCollaborationError
} from './journeyCollaboration.js';
import { journeyCollaborationLimits, parseJourneyCollaborationViewConfiguration } from './journeyCollaborationSchema.js';
import { getEvidenceLinkSource, getJourneyMap } from './journeyMaps.js';
import { getPersonaVersion } from './journeyPersonaVersions.js';
import { listJourneyPortfolioItems } from './journeyPortfolio.js';
import { assertSubscriptionQuota } from './subscriptionEntitlements.js';

export const journeyShareTargetTypes = ['journey_map', 'persona', 'portfolio', 'collaboration_view'] as const;
export type JourneyShareTargetType = typeof journeyShareTargetTypes[number];
export type JourneyShareAction = 'view' | 'download';

type ShareRow = {
  id: string; space_id: string; target_type: JourneyShareTargetType; target_id: string;
  target_revision: number; token_hash: string; token_prefix: string; token_version: number;
  permission: 'view'; allow_export: unknown; allow_download: unknown; snapshot_json: string;
  snapshot_sha256: string; state: 'active' | 'revoked'; revision: number;
  created_by_user_id: string; created_at: string | Date; expires_at: string | Date;
  rotated_at: string | Date | null; revoked_at: string | Date | null;
  revoked_by_user_id: string | null; revocation_reason_sha256: string | null;
};

function instant(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new JourneyCollaborationError(
    'A Journey share contains an invalid timestamp.', 500, 'JOURNEY_SHARE_INTEGRITY_FAILED');
  return parsed.toISOString();
}
function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== 'object') return value === undefined ? null : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, nested]) => [key, stable(nested)]));
}
function canonical(value: unknown) { return JSON.stringify(stable(value)); }
function bool(value: unknown) { return value === true || value === 1 || value === '1'; }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

let signingKey: Buffer | null = null;
function shareSigningKey() {
  if (signingKey) return signingKey;
  let value = '';
  try { value = fs.readFileSync(config.sessionSecretFile, 'utf8').trim(); } catch { value = ''; }
  if (value.length < 20) throw new JourneyCollaborationError(
    'Journey sharing is unavailable because the server signing key is not configured.', 503,
    'JOURNEY_SHARE_SIGNING_KEY_UNAVAILABLE');
  signingKey = Buffer.from(value, 'utf8');
  return signingKey;
}

/** The raw bearer is reproducible for an idempotent retry without ever being
 * persisted. Domain separation prevents a Journey link from being usable as a
 * session token even though both use the same deployment-managed secret file. */
function tokenFor(row: Pick<ShareRow, 'id' | 'token_version' | 'created_at' | 'rotated_at'>) {
  const epoch = row.rotated_at ? instant(row.rotated_at) : instant(row.created_at);
  return crypto.createHmac('sha256', shareSigningKey())
    .update(`journey-read-only-share\u0000${row.id}\u0000${Number(row.token_version)}\u0000${epoch}`)
    .digest('base64url');
}

function readShare(spaceId: string, shareId: string) {
  const row = db.prepare('SELECT * FROM journey_read_only_shares WHERE id=? AND space_id=?')
    .get(shareId, spaceId) as ShareRow | undefined;
  if (!row) throw new JourneyCollaborationError('Journey share not found.', 404, 'JOURNEY_SHARE_NOT_FOUND');
  return row;
}

function publicShare(row: ShareRow) {
  return {
    id: row.id, targetType: row.target_type, targetId: row.target_id,
    targetRevision: Number(row.target_revision), tokenPrefix: row.token_prefix,
    permission: 'view' as const, allowExport: bool(row.allow_export), allowDownload: bool(row.allow_download),
    checksum: row.snapshot_sha256, state: row.state, revision: Number(row.revision),
    createdAt: instant(row.created_at), expiresAt: instant(row.expires_at),
    rotatedAt: row.rotated_at ? instant(row.rotated_at) : null,
    revokedAt: row.revoked_at ? instant(row.revoked_at) : null
  };
}

function externalShare(row: ShareRow) {
  return {
    targetType: row.target_type, targetRevision: Number(row.target_revision), permission: 'view' as const,
    allowExport: bool(row.allow_export), allowDownload: bool(row.allow_download),
    state: row.state, expiresAt: instant(row.expires_at)
  };
}

function safeEvidence(value: unknown) {
  const evidence = object(value);
  const supporting = Math.max(0, Math.trunc(Number(evidence.supporting) || 0));
  const contradicting = Math.max(0, Math.trunc(Number(evidence.contradicting) || 0));
  const neutral = Math.max(0, Math.trunc(Number(evidence.neutral) || 0));
  return {
    state: String(evidence.state || 'hypothesis'),
    reason: evidence.reason === 'all_links_inaccessible' ? 'no_accessible_evidence' : String(evidence.reason || ''),
    supporting, contradicting, neutral,
    stale: Math.max(0, Math.trunc(Number(evidence.stale) || 0)),
    accessibleLinkCount: supporting + contradicting + neutral
  };
}

function mapProjection(spaceId: string, definitionId: string, actorUserId: string) {
  const target = resolveJourneyCollaborationTarget(spaceId, { targetType: 'journey_map', targetId: definitionId });
  assertJourneyCapability(spaceId, actorUserId, 'journeys.manage_shares', target);
  const map = getJourneyMap(spaceId, definitionId, undefined, actorUserId);
  if (!map) throw new JourneyCollaborationError('Journey map not found.', 404, 'JOURNEY_SHARE_TARGET_NOT_FOUND');
  return {
    targetRevision: target.revision,
    title: target.title,
    payload: {
      kind: 'journey_map',
      definition: {
        name: map.definition.name, mode: map.definition.mode,
        status: map.definition.status
      },
      version: {
        versionNumber: map.version.versionNumber, state: map.version.state,
        mapType: map.version.mapType, experienceType: map.version.experienceType,
        objective: map.version.objective, summary: map.version.summary
      },
      stages: map.stages.map((stage) => ({ stageKey: stage.stageKey, name: stage.name,
        goal: stage.goal, description: stage.description, ordinal: stage.ordinal })),
      lanes: map.lanes.map((lane) => ({ laneType: lane.laneType, title: lane.title,
        description: lane.description, ordinal: lane.ordinal, visible: lane.visible })),
      cards: map.cards.map((card) => ({ stageKey: card.stageKey, laneType: card.laneType,
        kind: card.kind, title: card.title, content: card.content, ordinal: card.ordinal,
        status: card.status, evidence: safeEvidence(card.evidence) })),
      personas: map.personas.map((persona) => ({ name: persona.name,
        summary: persona.summary, lifecycleState: persona.lifecycleState }))
    }
  };
}

function personaProjection(spaceId: string, personaId: string, actorUserId: string) {
  const target = resolveJourneyCollaborationTarget(spaceId, { targetType: 'persona', targetId: personaId });
  assertJourneyCapability(spaceId, actorUserId, 'journeys.manage_shares', target);
  const row = db.prepare(`SELECT current_version_id FROM journey_personas
    WHERE id=? AND space_id=? AND lifecycle_state<>'retired'`).get(personaId, spaceId) as
    { current_version_id?: string | null } | undefined;
  if (!row?.current_version_id) throw new JourneyCollaborationError(
    'This persona has no current version to share.', 409, 'JOURNEY_SHARE_TARGET_UNAVAILABLE');
  const persona = getPersonaVersion(spaceId, personaId, row.current_version_id);
  if (!persona) throw new JourneyCollaborationError('Persona not found.', 404, 'JOURNEY_SHARE_TARGET_NOT_FOUND');
  return {
    targetRevision: target.revision,
    title: persona.name,
    payload: {
      kind: 'persona', versionNumber: persona.versionNumber,
      name: persona.name, summary: persona.summary, lifecycleState: persona.lifecycleState,
      attributes: persona.attributes, goals: persona.goals, behaviours: persona.behaviours,
      needs: persona.needs, barriers: persona.barriers, reviewAt: persona.reviewAt,
      claims: persona.claims.map((claim) => ({ type: claim.type, label: claim.label,
        value: claim.value, ordinal: claim.ordinal,
        evidenceCount: claim.evidence.filter((evidence) => {
          try { getEvidenceLinkSource(spaceId, actorUserId, evidence.evidenceLinkId); return true; }
          catch { return false; }
        }).length }))
    }
  };
}

function portfolioProjection(spaceId: string, actorUserId: string) {
  assertJourneyCapability(spaceId, actorUserId, 'journeys.manage_shares');
  const items: any[] = [];
  let offset = 0;
  while (offset < 5_000) {
    const page = listJourneyPortfolioItems({ spaceId, actorUserId, state: 'active', limit: 100, offset });
    items.push(...page.items);
    if (!page.page.hasMore) break;
    offset += page.page.limit;
  }
  if (items.length >= 5_000) throw new JourneyCollaborationError(
    'The portfolio is too large for one read-only snapshot.', 413, 'JOURNEY_SHARE_SNAPSHOT_TOO_LARGE');
  const projected = items.map((item) => ({
    kind: item.kind, title: item.title, description: item.description,
    lifecycle: item.lifecycle, priority: item.priority, risk: item.risk, severity: item.severity,
    frequency: item.frequency, desiredOutcome: item.desiredOutcome, hypothesis: item.hypothesis,
    constraints: item.constraints, estimatedEffort: item.estimatedEffort, estimatedCost: item.estimatedCost,
    expectedOutcome: item.expectedOutcome, plannedStart: item.plannedStart, plannedEnd: item.plannedEnd,
    actualStart: item.actualStart, actualEnd: item.actualEnd, dueDate: item.dueDate,
    progressPercent: item.progressPercent, reviewState: item.reviewState,
    targetMetrics: item.targetMetrics, tags: item.tags, revision: item.revision,
    latestScore: item.latestScore, usageCount: item.usageCount, evidenceCount: item.evidenceCount,
    updatedAt: item.updatedAt
  }));
  return { targetRevision: Math.max(1, ...projected.map((item) => Number(item.revision) || 1)),
    title: 'Journey portfolio', payload: { kind: 'portfolio', items: projected } };
}

function collaborationViewProjection(spaceId: string, viewId: string, actorUserId: string) {
  assertJourneyCapability(spaceId, actorUserId, 'journeys.manage_shares');
  const row = db.prepare(`SELECT * FROM journey_collaboration_views
    WHERE id=? AND space_id=? AND state='active'`).get(viewId, spaceId) as any;
  if (!row) throw new JourneyCollaborationError('Collaboration view not found.', 404, 'JOURNEY_SHARE_TARGET_NOT_FOUND');
  const configuration = parseJourneyCollaborationViewConfiguration(JSON.parse(String(row.configuration_json)), row.resource_type);
  const resource = row.resource_type === 'journey_map'
    ? mapProjection(spaceId, String(row.resource_id), actorUserId)
    : portfolioProjection(spaceId, actorUserId);
  return {
    targetRevision: Number(row.revision), title: String(row.name),
    payload: { kind: 'collaboration_view', name: row.name, audience: row.audience,
      revision: Number(row.revision), configuration, resource: resource.payload }
  };
}

function snapshotFor(input: { spaceId: string; actorUserId: string; targetType: JourneyShareTargetType; targetId: string }) {
  const resolved = input.targetType === 'journey_map'
    ? mapProjection(input.spaceId, input.targetId, input.actorUserId)
    : input.targetType === 'persona'
      ? personaProjection(input.spaceId, input.targetId, input.actorUserId)
      : input.targetType === 'portfolio'
        ? (input.targetId === input.spaceId ? portfolioProjection(input.spaceId, input.actorUserId) : (() => {
          throw new JourneyCollaborationError('Portfolio shares must use the active space as their target.', 400,
            'JOURNEY_SHARE_TARGET_INVALID');
        })())
        : collaborationViewProjection(input.spaceId, input.targetId, input.actorUserId);
  const snapshot = { schemaVersion: 2, title: resolved.title, targetType: input.targetType,
    targetId: input.targetId, targetRevision: resolved.targetRevision, capturedAt: new Date().toISOString(),
    content: resolved.payload };
  const serialized = canonical(snapshot);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > journeyCollaborationLimits.shareSnapshotBytes) throw new JourneyCollaborationError(
    'The read-only snapshot is too large to share safely.', 413, 'JOURNEY_SHARE_SNAPSHOT_TOO_LARGE',
    { bytes, maximumBytes: journeyCollaborationLimits.shareSnapshotBytes });
  return { snapshot, serialized, checksum: sha256(serialized), targetRevision: resolved.targetRevision };
}

function assertSharingEnabled(spaceId: string, actorUserId: string) {
  const context = getJourneyCollaborationContext({ spaceId, actorUserId });
  assertJourneyCapability(spaceId, actorUserId, 'journeys.manage_shares');
  const settings = context.plan.settings;
  if (!context.plan.enabledByPlan || context.readOnly || !settings.enabled || !settings.sharingEnabled
    || !settings.securityReviewReference || !settings.securityReviewedAt) {
    throw new JourneyCollaborationError(
      'External Journey sharing requires an enabled, recorded security/privacy review.', 403,
      'JOURNEY_SHARING_SECURITY_REVIEW_REQUIRED');
  }
  return settings;
}

type TokenProof = { shareId: string; tokenVersion: number; tokenEpoch: string; shareRevision: number };

function tokenProof(row: ShareRow): TokenProof {
  return { shareId: row.id, tokenVersion: Number(row.token_version),
    tokenEpoch: row.rotated_at ? instant(row.rotated_at) : instant(row.created_at), shareRevision: Number(row.revision) };
}

function shareWithToken(spaceId: string, proof: TokenProof, replayed: boolean) {
  const row = readShare(spaceId, proof.shareId);
  const current = tokenProof(row);
  if (row.state !== 'active' || instant(row.expires_at) <= new Date().toISOString()
    || current.tokenVersion !== proof.tokenVersion || current.tokenEpoch !== proof.tokenEpoch
    || current.shareRevision !== proof.shareRevision) throw new JourneyCollaborationError(
      'This idempotent share response was superseded by a later rotation, revocation, or expiry.', 409,
      'JOURNEY_SHARE_REPLAY_SUPERSEDED');
  const token = tokenFor(row);
  if (sha256(token) !== row.token_hash) throw new JourneyCollaborationError(
    'The Journey share token failed its integrity check.', 500, 'JOURNEY_SHARE_INTEGRITY_FAILED');
  return { share: publicShare(row), token, url: `${config.publicUrl}/journey-share/${encodeURIComponent(token)}`, replayed };
}

export function createJourneyReadOnlyShare(input: {
  spaceId: string; actorUserId: string; targetType: JourneyShareTargetType; targetId: string;
  expiresAt: string; allowExport: boolean; allowDownload: boolean;
  idempotencyKey: string; requestId?: string | null;
}) {
  const settings = assertSharingEnabled(input.spaceId, input.actorUserId);
  if (!journeyShareTargetTypes.includes(input.targetType)) throw new JourneyCollaborationError(
    'Choose a supported Journey share target.', 400, 'JOURNEY_SHARE_TARGET_INVALID');
  if (input.allowDownload && !input.allowExport) throw new JourneyCollaborationError(
    'Download permission requires export permission.', 400, 'JOURNEY_SHARE_PERMISSION_INVALID');
  if ((input.allowExport || input.allowDownload) && !settings.externalDownloadsEnabled) throw new JourneyCollaborationError(
    'External downloads are disabled for this space.', 403, 'JOURNEY_SHARE_DOWNLOADS_DISABLED');
  const expiresAt = instant(input.expiresAt);
  const now = new Date();
  const maximum = new Date(now.getTime() + settings.maximumShareDays * 86_400_000);
  if (new Date(expiresAt) <= now || new Date(expiresAt) > maximum) throw new JourneyCollaborationError(
    `The share must expire within ${settings.maximumShareDays} days.`, 400, 'JOURNEY_SHARE_EXPIRY_INVALID');
  const result = idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'share.create', intent: { targetType: input.targetType, targetId: input.targetId,
      expiresAt, allowExport: input.allowExport, allowDownload: input.allowDownload },
    run: () => {
      const snapshot = snapshotFor(input);
      if (db.provider === 'postgres') {
        const locked = db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
        if (!locked) throw new JourneyCollaborationError('Space not found.', 404, 'JOURNEY_SHARE_NOT_FOUND');
      }
      const active = Number((db.prepare(`SELECT COUNT(*) count FROM journey_read_only_shares
        WHERE space_id=? AND state='active' AND expires_at>?`).get(input.spaceId, new Date().toISOString()) as any)?.count || 0);
      assertSubscriptionQuota(input.spaceId, 'journeyShares', active);
      const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
      const seed = { id, token_version: 1, created_at: createdAt, rotated_at: null };
      const token = tokenFor(seed); const tokenHash = sha256(token);
      db.prepare(`INSERT INTO journey_read_only_shares
        (id,space_id,target_type,target_id,target_revision,token_hash,token_prefix,token_version,permission,
          allow_export,allow_download,snapshot_json,snapshot_sha256,state,revision,created_by_user_id,created_at,
          expires_at,rotated_at,revoked_at,revoked_by_user_id,revocation_reason_sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',1,?,?,?,NULL,NULL,NULL,NULL)`).run(id, input.spaceId,
          input.targetType, input.targetId, snapshot.targetRevision, tokenHash, token.slice(0, 12), 1, 'view',
          input.allowExport ? 1 : 0, input.allowDownload ? 1 : 0, snapshot.serialized, snapshot.checksum,
          input.actorUserId, createdAt, expiresAt);
      recordJourneyGovernedActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'share.created', targetType: input.targetType, targetId: input.targetId,
        journeyDefinitionId: input.targetType === 'journey_map' ? input.targetId : null,
        requestId: input.requestId, detail: { shareId: id, targetRevision: snapshot.targetRevision,
          snapshotSha256: snapshot.checksum, expiresAt, allowExport: input.allowExport,
          allowDownload: input.allowDownload } });
      return tokenProof(readShare(input.spaceId, String(id)));
    }
  });
  return shareWithToken(input.spaceId, result, result.replayed);
}

export function listJourneyReadOnlyShares(input: {
  spaceId: string; actorUserId: string; state?: 'active' | 'revoked'; limit?: number; offset?: number;
}) {
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.manage_shares');
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(input.limit || 50))));
  const offset = Math.max(0, Math.trunc(Number(input.offset || 0)));
  const clauses = ['space_id=?']; const values: unknown[] = [input.spaceId];
  if (input.state) { clauses.push('state=?'); values.push(input.state); }
  const total = Number((db.prepare(`SELECT COUNT(*) count FROM journey_read_only_shares
    WHERE ${clauses.join(' AND ')}`).get(...values) as any)?.count || 0);
  const rows = db.prepare(`SELECT * FROM journey_read_only_shares WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset) as ShareRow[];
  return { items: rows.map(publicShare), page: { limit, offset, total, hasMore: offset + rows.length < total },
    plan: journeyCollaborationPlanState(input.spaceId) };
}

export function rotateJourneyReadOnlyShare(input: {
  spaceId: string; actorUserId: string; shareId: string; expectedRevision: number;
  idempotencyKey: string; requestId?: string | null;
}) {
  assertSharingEnabled(input.spaceId, input.actorUserId);
  const result = idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'share.rotate', intent: { shareId: input.shareId, expectedRevision: input.expectedRevision },
    run: () => {
      const row = readShare(input.spaceId, input.shareId);
      if (row.state !== 'active' || new Date(instant(row.expires_at)) <= new Date()) throw new JourneyCollaborationError(
        'Only an active, unexpired share can be rotated.', 409, 'JOURNEY_SHARE_STATE_CONFLICT');
      const rotatedAt = new Date().toISOString(); const nextVersion = Number(row.token_version) + 1;
      const token = tokenFor({ id: row.id, token_version: nextVersion, created_at: row.created_at, rotated_at: rotatedAt });
      const changed = db.prepare(`UPDATE journey_read_only_shares SET token_hash=?,token_prefix=?,token_version=?,
        revision=revision+1,rotated_at=? WHERE id=? AND space_id=? AND state='active' AND revision=?`)
        .run(sha256(token), token.slice(0, 12), nextVersion, rotatedAt, input.shareId, input.spaceId,
          input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError('This share changed since it was opened.', 409,
        'JOURNEY_SHARE_REVISION_CONFLICT');
      recordJourneyGovernedActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'share.rotated', targetType: row.target_type, targetId: row.target_id, requestId: input.requestId,
        detail: { shareId: row.id, tokenVersion: nextVersion, revision: input.expectedRevision + 1 } });
      return tokenProof(readShare(input.spaceId, row.id));
    }
  });
  return shareWithToken(input.spaceId, result, result.replayed);
}

export function revokeJourneyReadOnlyShare(input: {
  spaceId: string; actorUserId: string; shareId: string; expectedRevision: number; reason: string;
  idempotencyKey: string; requestId?: string | null;
}) {
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.manage_shares');
  const reason = String(input.reason || '').trim();
  if (reason.length < 8 || reason.length > 500) throw new JourneyCollaborationError(
    'Revoking a share requires a reason between 8 and 500 characters.', 400, 'JOURNEY_SHARE_REASON_REQUIRED');
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'share.revoke', intent: { shareId: input.shareId, expectedRevision: input.expectedRevision,
      reasonSha256: sha256(reason) },
    run: () => {
      const row = readShare(input.spaceId, input.shareId);
      const revokedAt = new Date().toISOString();
      const changed = db.prepare(`UPDATE journey_read_only_shares SET state='revoked',revision=revision+1,
        revoked_at=?,revoked_by_user_id=?,revocation_reason_sha256=?
        WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(revokedAt, input.actorUserId,
          sha256(reason), input.shareId, input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError('This share changed or was already revoked.', 409,
        'JOURNEY_SHARE_REVISION_CONFLICT');
      recordJourneyGovernedActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'share.revoked', targetType: row.target_type, targetId: row.target_id, requestId: input.requestId,
        detail: { shareId: row.id, revision: input.expectedRevision + 1, reasonSha256: sha256(reason) } });
      return { share: publicShare(readShare(input.spaceId, input.shareId)) };
    }
  });
}

function recordAccess(row: ShareRow | null, tokenFingerprint: string, requesterFingerprint: string,
  outcome: 'allowed' | 'denied', reasonCode: string, action: JourneyShareAction) {
  db.prepare(`INSERT INTO journey_share_access_events
    (id,share_id,space_id,token_fingerprint,requester_fingerprint,outcome,reason_code,requested_action,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), row?.id || null, row?.space_id || null,
      tokenFingerprint, requesterFingerprint, outcome, reasonCode, action, new Date().toISOString());
}

function rateLimit(tokenFingerprint: string, requesterFingerprint: string) {
  const now = new Date(); const bucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  return db.transaction(() => {
    db.prepare(`DELETE FROM journey_share_rate_buckets WHERE bucket_started_at<?`)
      .run(new Date(now.getTime() - 3_600_000).toISOString());
    const existing = db.prepare(`SELECT attempts FROM journey_share_rate_buckets
      WHERE requester_fingerprint=? AND token_fingerprint=? AND bucket_started_at=?`)
      .get(requesterFingerprint, tokenFingerprint, bucket) as { attempts?: number } | undefined;
    const attempts = Number(existing?.attempts || 0) + 1;
    if (existing) db.prepare(`UPDATE journey_share_rate_buckets SET attempts=?,updated_at=?
      WHERE requester_fingerprint=? AND token_fingerprint=? AND bucket_started_at=?`)
      .run(attempts, now.toISOString(), requesterFingerprint, tokenFingerprint, bucket);
    else db.prepare(`INSERT INTO journey_share_rate_buckets
      (requester_fingerprint,token_fingerprint,bucket_started_at,attempts,updated_at) VALUES (?,?,?,?,?)`)
      .run(requesterFingerprint, tokenFingerprint, bucket, attempts, now.toISOString());
    return { allowed: attempts <= journeyCollaborationLimits.shareRequestsPerMinute, attempts };
  })();
}

export function resolveJourneyReadOnlyShare(input: {
  token: string; requesterKey: string; action?: JourneyShareAction;
}) {
  const token = String(input.token || '').trim();
  const tokenFingerprint = sha256(token);
  const requesterFingerprint = sha256(String(input.requesterKey || 'unknown').slice(0, 2_000));
  const action = input.action || 'view';
  const syntacticallyValid = /^[A-Za-z0-9_-]{43}$/u.test(token);
  const row = syntacticallyValid
    ? db.prepare('SELECT * FROM journey_read_only_shares WHERE token_hash=?').get(tokenFingerprint) as ShareRow | undefined
    : undefined;
  // Unknown-token attempts share one requester bucket. Otherwise an attacker
  // can generate a fresh token-shaped string per request and bypass the
  // (requester,token,bucket) primary key indefinitely.
  const limiterFingerprint = row ? tokenFingerprint : sha256('unknown-journey-share-token');
  const rate = rateLimit(limiterFingerprint, requesterFingerprint);
  if (!syntacticallyValid || !rate.allowed) {
    // One content-safe ledger event marks the crossing; subsequent rejected
    // requests in the same bucket are deliberately not amplified into writes.
    if (rate.attempts <= journeyCollaborationLimits.shareRequestsPerMinute + 1) {
      recordAccess(null, tokenFingerprint, requesterFingerprint, 'denied',
        rate.allowed ? 'not_available' : 'rate_limited', action);
    }
    throw new JourneyCollaborationError('This Journey share is unavailable.', 404, 'JOURNEY_SHARE_UNAVAILABLE');
  }
  if (!row || row.state !== 'active' || new Date(instant(row.expires_at)) <= new Date()) {
    recordAccess(row || null, tokenFingerprint, requesterFingerprint, 'denied', 'not_available', action);
    throw new JourneyCollaborationError('This Journey share is unavailable.', 404, 'JOURNEY_SHARE_UNAVAILABLE');
  }
  const space = db.prepare('SELECT status FROM spaces WHERE id=?').get(row.space_id) as { status?: string } | undefined;
  const plan = journeyCollaborationPlanState(row.space_id);
  if (!space || String(space.status || 'active') !== 'active' || !plan.enabledByPlan || plan.readOnly
    || !plan.settings.sharingEnabled || !plan.settings.securityReviewReference || !plan.settings.securityReviewedAt) {
    recordAccess(row, tokenFingerprint, requesterFingerprint, 'denied', 'sharing_disabled', action);
    throw new JourneyCollaborationError('This Journey share is unavailable.', 404, 'JOURNEY_SHARE_UNAVAILABLE');
  }
  if (action === 'download' && !plan.settings.externalDownloadsEnabled) {
    recordAccess(row, tokenFingerprint, requesterFingerprint, 'denied', 'downloads_disabled', action);
    throw new JourneyCollaborationError('Downloads are not allowed for this Journey share.', 403,
      'JOURNEY_SHARE_DOWNLOAD_FORBIDDEN');
  }
  if (action === 'download' && !bool(row.allow_download)) {
    recordAccess(row, tokenFingerprint, requesterFingerprint, 'denied', 'download_not_allowed', action);
    throw new JourneyCollaborationError('Downloads are not allowed for this Journey share.', 403,
      'JOURNEY_SHARE_DOWNLOAD_FORBIDDEN');
  }
  const serialized = String(row.snapshot_json);
  if (sha256(serialized) !== row.snapshot_sha256) {
    recordAccess(row, tokenFingerprint, requesterFingerprint, 'denied', 'integrity_failed', action);
    throw new JourneyCollaborationError('This Journey share is unavailable.', 404, 'JOURNEY_SHARE_UNAVAILABLE');
  }
  let snapshot: unknown;
  try { snapshot = JSON.parse(serialized); } catch {
    recordAccess(row, tokenFingerprint, requesterFingerprint, 'denied', 'integrity_failed', action);
    throw new JourneyCollaborationError('This Journey share is unavailable.', 404, 'JOURNEY_SHARE_UNAVAILABLE');
  }
  const parsed = object(snapshot);
  if (parsed.schemaVersion !== 2 || typeof parsed.title !== 'string' || parsed.targetType !== row.target_type
    || Number(parsed.targetRevision) !== Number(row.target_revision) || !object(parsed.content).kind) {
    recordAccess(row, tokenFingerprint, requesterFingerprint, 'denied', 'integrity_failed', action);
    throw new JourneyCollaborationError('This Journey share is unavailable.', 404, 'JOURNEY_SHARE_UNAVAILABLE');
  }
  const publicSnapshot = { schemaVersion: 2, title: parsed.title, targetType: parsed.targetType,
    targetRevision: Number(parsed.targetRevision), capturedAt: parsed.capturedAt, content: parsed.content };
  recordAccess(row, tokenFingerprint, requesterFingerprint, 'allowed', 'allowed', action);
  return { share: externalShare(row), snapshot: publicSnapshot };
}
