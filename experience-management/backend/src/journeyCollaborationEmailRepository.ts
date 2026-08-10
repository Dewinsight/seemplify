import crypto from 'node:crypto';
import { db } from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
// Guarantees users.account_status and the space/membership tables exist before
// the consent trigger below is compiled against them.
import './platformSchema.js';
import {
  JOURNEY_COLLABORATION_EMAIL_RUNTIME_SCHEMA_VERSION,
  JourneyCollaborationEmailError,
  journeyCollaborationEmailCancelCodes,
  journeyCollaborationEmailIdempotencyKey,
  journeyCollaborationEmailLimits,
  journeyCollaborationEmailNextAttemptAt,
  type JourneyCollaborationEmailKind,
  type JourneyCollaborationEmailOutcomeCode
} from './journeyCollaborationEmailDomain.js';

/**
 * Runtime-56 storage for Journey collaboration email delivery.
 *
 * This module is the only writer of the delivery plane and mirrors
 * `migrations/postgres/future/0056_journey_collaboration_email_delivery.sql` for
 * SQLite, so development and test runs enforce the same shape a migrated
 * PostgreSQL database does. Three rules shape everything below:
 *
 *   Consent is checked twice. Once when the delivery is queued, inside the same
 *   transaction as the notification, and again under the lease immediately
 *   before the send. An opt-out or a lost membership between those two moments
 *   cancels the delivery instead of racing it.
 *
 *   Nothing readable is stored. No row here has a column for a comment body, an
 *   excerpt, an address or a name. The recipient's address is resolved from the
 *   account at execution and never written back.
 *
 *   Every state move is fenced. A claim takes a lease and bumps a fencing token;
 *   a completion only lands if the lease and the token still match, so a worker
 *   that was paused past its lease cannot overwrite the outcome of the worker
 *   that replaced it.
 */

export type JourneyCollaborationEmailClaim = {
  outboxId: string;
  spaceId: string;
  notificationId: string;
  recipientUserId: string;
  kind: JourneyCollaborationEmailKind;
  attemptNumber: number;
  maxAttempts: number;
  fencingToken: number;
  leaseOwner: string;
  leaseToken: string;
  idempotencyKey: string;
  /** Resolved from the account under the lease. Never persisted. */
  recipientEmail: string;
  startedAt: string;
};

export type JourneyCollaborationEmailPreference = {
  spaceId: string;
  userId: string;
  emailEnabled: boolean;
  revision: number;
  updatedAt: string | null;
  decidedAt: string | null;
};

const cancelCodes = new Set<JourneyCollaborationEmailOutcomeCode>(journeyCollaborationEmailCancelCodes);

function sha(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }

function iso(value: Date | string = new Date()) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new JourneyCollaborationEmailError(
    'Timestamp is invalid.', 400, 'JOURNEY_COLLABORATION_EMAIL_TIME_INVALID');
  return parsed.toISOString();
}

function isUniqueViolation(error: unknown) {
  if (!isDatabaseConstraintError(error)) return false;
  const code = String((error as { code?: unknown })?.code || '');
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === '23505';
}

/** PostgreSQL is migrated offline by runtime-56. SQLite creates the same shape,
 * including the consent and forward-only guards, when this module is imported. */
function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_collaboration_email_preferences (
      space_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email_enabled INTEGER NOT NULL DEFAULT 0 CHECK(email_enabled IN (0,1)),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_at TEXT,
      PRIMARY KEY(space_id,user_id),
      FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      CHECK(updated_at>=created_at),
      CHECK(email_enabled=0 OR (email_enabled=1 AND decided_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_email_preferences_opted_in
      ON journey_collaboration_email_preferences(space_id,user_id) WHERE email_enabled=1;
    CREATE TABLE IF NOT EXISTS journey_collaboration_email_outbox (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL,
      notification_id TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      notification_kind TEXT NOT NULL CHECK(notification_kind IN ('mention','comment','reply','resolved',
        'reopened','review_requested','review_decided','published','role_changed')),
      target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 64),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','cancelled','dead_letter')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 10),
      max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 10),
      next_attempt_at TEXT NOT NULL,
      delivery_idempotency_key TEXT NOT NULL CHECK(length(delivery_idempotency_key)=36),
      lease_owner TEXT,
      lease_token_sha256 TEXT,
      lease_expires_at TEXT,
      fencing_token BIGINT NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
      last_outcome_code TEXT CHECK(last_outcome_code IN ('delivered','transport_retryable','transport_permanent',
        'recipient_opted_out','membership_revoked','recipient_unverified','recipient_inactive','lease_lost','recovery_timeout')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      terminal_at TEXT,
      UNIQUE(id,space_id),
      UNIQUE(notification_id,space_id,recipient_user_id),
      UNIQUE(delivery_idempotency_key),
      FOREIGN KEY(notification_id,space_id,recipient_user_id)
        REFERENCES journey_collaboration_notifications(id,space_id,recipient_user_id) ON DELETE CASCADE,
      FOREIGN KEY(space_id,recipient_user_id)
        REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      CHECK((lease_owner IS NULL AND lease_token_sha256 IS NULL AND lease_expires_at IS NULL)
        OR (lease_owner IS NOT NULL AND length(lease_owner) BETWEEN 1 AND 200
          AND lease_token_sha256 IS NOT NULL AND length(lease_token_sha256)=64
          AND lease_expires_at IS NOT NULL)),
      CHECK(state<>'sending' OR lease_owner IS NOT NULL),
      CHECK((state IN ('pending','sending') AND sent_at IS NULL AND terminal_at IS NULL)
        OR (state='sent' AND sent_at IS NOT NULL AND terminal_at IS NOT NULL)
        OR (state IN ('cancelled','dead_letter') AND sent_at IS NULL AND terminal_at IS NOT NULL)),
      CHECK(attempt_count<=max_attempts),
      CHECK(updated_at>=created_at)
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_email_outbox_due
      ON journey_collaboration_email_outbox(next_attempt_at,id) WHERE state='pending';
    CREATE INDEX IF NOT EXISTS journey_collaboration_email_outbox_expired_lease
      ON journey_collaboration_email_outbox(lease_expires_at,id) WHERE state='sending';
    CREATE INDEX IF NOT EXISTS journey_collaboration_email_outbox_space_state
      ON journey_collaboration_email_outbox(space_id,state,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_collaboration_email_outbox_recipient
      ON journey_collaboration_email_outbox(space_id,recipient_user_id,state,id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_email_attempts (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      outbox_id TEXT NOT NULL,
      space_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 10),
      fencing_token BIGINT NOT NULL CHECK(fencing_token>0),
      outcome TEXT NOT NULL CHECK(outcome IN ('sent','retry_scheduled','dead_lettered','cancelled')),
      outcome_code TEXT NOT NULL CHECK(outcome_code IN ('delivered','transport_retryable','transport_permanent',
        'recipient_opted_out','membership_revoked','recipient_unverified','recipient_inactive','lease_lost','recovery_timeout')),
      provider_message_sha256 TEXT CHECK(provider_message_sha256 IS NULL OR length(provider_message_sha256)=64),
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      UNIQUE(id,space_id),
      UNIQUE(outbox_id,attempt_number),
      FOREIGN KEY(outbox_id,space_id)
        REFERENCES journey_collaboration_email_outbox(id,space_id) ON DELETE CASCADE,
      CHECK(completed_at>=started_at)
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_email_attempts_history
      ON journey_collaboration_email_attempts(space_id,completed_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_email_audit_events (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      principal_user_sha256 TEXT NOT NULL CHECK(length(principal_user_sha256)=64),
      outbox_sha256 TEXT CHECK(outbox_sha256 IS NULL OR length(outbox_sha256)=64),
      event TEXT NOT NULL CHECK(event IN ('preference_enabled','preference_disabled','delivery_queued',
        'delivery_sent','delivery_retry_scheduled','delivery_dead_lettered','delivery_cancelled')),
      reason_code TEXT NOT NULL CHECK(reason_code IN ('member_request','delivered','transport_retryable',
        'transport_permanent','recipient_opted_out','membership_revoked','recipient_unverified',
        'recipient_inactive','lease_lost','recovery_timeout','queued')),
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id)
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_email_audit_history
      ON journey_collaboration_email_audit_events(space_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_collaboration_email_attempts_append_only
      BEFORE UPDATE ON journey_collaboration_email_attempts
      BEGIN SELECT RAISE(ABORT,'Journey collaboration email attempts and audit are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_collaboration_email_audit_append_only
      BEFORE UPDATE OF id,space_id,principal_user_sha256,outbox_sha256,event,reason_code,created_at
      ON journey_collaboration_email_audit_events
      BEGIN SELECT RAISE(ABORT,'Journey collaboration email attempts and audit are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_collaboration_email_outbox_consent_guard
      BEFORE INSERT ON journey_collaboration_email_outbox
      WHEN NOT EXISTS(SELECT 1 FROM journey_collaboration_email_preferences
        WHERE space_id=NEW.space_id AND user_id=NEW.recipient_user_id AND email_enabled=1)
      BEGIN SELECT RAISE(ABORT,'Journey collaboration email delivery requires an explicit recipient opt-in'); END;
    CREATE TRIGGER IF NOT EXISTS journey_collaboration_email_outbox_account_guard
      BEFORE INSERT ON journey_collaboration_email_outbox
      WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.recipient_user_id
        AND email_verified_at IS NOT NULL AND account_status='active')
      BEGIN SELECT RAISE(ABORT,'Journey collaboration email delivery requires a verified, active account'); END;
    CREATE TRIGGER IF NOT EXISTS journey_collaboration_email_outbox_identity_guard
      BEFORE UPDATE OF id,space_id,notification_id,recipient_user_id,delivery_idempotency_key
      ON journey_collaboration_email_outbox
      WHEN NEW.id<>OLD.id OR NEW.space_id<>OLD.space_id OR NEW.notification_id<>OLD.notification_id
        OR NEW.recipient_user_id<>OLD.recipient_user_id
        OR NEW.delivery_idempotency_key<>OLD.delivery_idempotency_key
      BEGIN SELECT RAISE(ABORT,'Journey collaboration email delivery identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_collaboration_email_outbox_terminal_guard
      BEFORE UPDATE OF state,attempt_count,fencing_token ON journey_collaboration_email_outbox
      WHEN OLD.state IN ('sent','cancelled','dead_letter')
      BEGIN SELECT RAISE(ABORT,'A terminal journey collaboration email delivery cannot be reopened'); END;
    CREATE TRIGGER IF NOT EXISTS journey_collaboration_email_outbox_forward_guard
      BEFORE UPDATE OF attempt_count,fencing_token ON journey_collaboration_email_outbox
      WHEN NEW.attempt_count<OLD.attempt_count OR NEW.fencing_token<OLD.fencing_token
      BEGIN SELECT RAISE(ABORT,'Journey collaboration email attempts and fencing tokens never move backwards'); END;
  `);
}

ensureSqliteSchema();

function auditInside(input: {
  spaceId: string; actorUserId: string | null; subjectUserId: string; outboxId: string | null;
  event: string; reasonCode: string; at: string;
}) {
  db.prepare(`INSERT INTO journey_collaboration_email_audit_events
    (id,space_id,actor_user_id,principal_user_sha256,outbox_sha256,event,reason_code,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, input.actorUserId,
      sha(input.subjectUserId), input.outboxId ? sha(input.outboxId) : null, input.event,
      input.reasonCode, input.at);
}

function attemptInside(input: {
  spaceId: string; outboxId: string; attemptNumber: number; fencingToken: number;
  outcome: 'sent' | 'retry_scheduled' | 'dead_lettered' | 'cancelled';
  outcomeCode: JourneyCollaborationEmailOutcomeCode; providerMessageId?: string | null;
  startedAt: string; completedAt: string;
}) {
  db.prepare(`INSERT INTO journey_collaboration_email_attempts
    (id,outbox_id,space_id,attempt_number,fencing_token,outcome,outcome_code,provider_message_sha256,
      started_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), input.outboxId, input.spaceId, input.attemptNumber, input.fencingToken,
      input.outcome, input.outcomeCode, input.providerMessageId ? sha(input.providerMessageId) : null,
      input.startedAt, input.completedAt);
}

/** Opt-in, verified and active, evaluated against live rows. Used at queue time
 * and again under the lease, because all three can change in between. */
function eligibilityInside(spaceId: string, userId: string): JourneyCollaborationEmailOutcomeCode | null {
  const member = db.prepare('SELECT 1 found FROM space_memberships WHERE space_id=? AND user_id=?')
    .get(spaceId, userId) as { found?: unknown } | undefined;
  if (!member) return 'membership_revoked';
  const account = db.prepare('SELECT email,email_verified_at,account_status FROM users WHERE id=?')
    .get(userId) as { email?: string; email_verified_at?: string | null; account_status?: string } | undefined;
  if (!account || !String(account.email || '').trim()) return 'recipient_inactive';
  if (!account.email_verified_at) return 'recipient_unverified';
  if (String(account.account_status || 'active') !== 'active') return 'recipient_inactive';
  const preference = db.prepare(`SELECT email_enabled FROM journey_collaboration_email_preferences
    WHERE space_id=? AND user_id=?`).get(spaceId, userId) as { email_enabled?: unknown } | undefined;
  if (!preference || !Number(preference.email_enabled)) return 'recipient_opted_out';
  return null;
}

export class JourneyCollaborationEmailRepository {
  available() {
    return db.provider === 'sqlite'
      || Number(db.health().runtimeSchemaVersion || 0) >= JOURNEY_COLLABORATION_EMAIL_RUNTIME_SCHEMA_VERSION;
  }

  /** The per-principal opt-in. Absence is the default and it is OFF: a member who
   * has never made a decision is never emailed. */
  getPreference(spaceId: string, userId: string): JourneyCollaborationEmailPreference {
    const row = db.prepare(`SELECT email_enabled,revision,updated_at,decided_at
      FROM journey_collaboration_email_preferences WHERE space_id=? AND user_id=?`)
      .get(spaceId, userId) as any;
    return {
      spaceId, userId,
      emailEnabled: Boolean(row && Number(row.email_enabled)),
      revision: Number(row?.revision || 0),
      updatedAt: row?.updated_at ? String(row.updated_at) : null,
      decidedAt: row?.decided_at ? String(row.decided_at) : null
    };
  }

  /**
   * Only the principal itself may write this row; the caller proves that by
   * passing the same id for `userId` and `actorUserId`. There is deliberately no
   * administrator override: consent to be emailed is not delegable, and a
   * space-wide switch would be exactly that.
   */
  setPreference(input: {
    spaceId: string; userId: string; actorUserId: string; enabled: boolean;
    expectedRevision: number; at?: string;
  }): JourneyCollaborationEmailPreference {
    if (input.actorUserId !== input.userId) throw new JourneyCollaborationEmailError(
      'A member can only manage its own Journey collaboration email preference.', 403,
      'JOURNEY_COLLABORATION_EMAIL_PREFERENCE_FORBIDDEN');
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new JourneyCollaborationEmailError('A valid expected revision is required.', 400,
        'JOURNEY_COLLABORATION_EMAIL_REVISION_INVALID');
    }
    const at = iso(input.at);
    return db.transaction(() => {
      const member = db.prepare('SELECT 1 found FROM space_memberships WHERE space_id=? AND user_id=?')
        .get(input.spaceId, input.userId) as { found?: unknown } | undefined;
      if (!member) throw new JourneyCollaborationEmailError(
        'You are not a member of this space.', 403, 'JOURNEY_COLLABORATION_EMAIL_MEMBERSHIP_REQUIRED');
      const account = db.prepare('SELECT email_verified_at,account_status FROM users WHERE id=?')
        .get(input.userId) as { email_verified_at?: string | null; account_status?: string } | undefined;
      if (input.enabled && (!account?.email_verified_at || String(account.account_status || 'active') !== 'active')) {
        throw new JourneyCollaborationEmailError(
          'Verify your account email before enabling Journey collaboration email notifications.', 409,
          'JOURNEY_COLLABORATION_EMAIL_ACCOUNT_UNVERIFIED');
      }
      const current = db.prepare(`SELECT revision FROM journey_collaboration_email_preferences
        WHERE space_id=? AND user_id=?`).get(input.spaceId, input.userId) as { revision?: unknown } | undefined;
      const revision = Number(current?.revision || 0);
      if (revision !== input.expectedRevision) throw new JourneyCollaborationEmailError(
        'This preference changed since it was opened.', 409,
        'JOURNEY_COLLABORATION_EMAIL_PREFERENCE_CONFLICT');
      const enabled = input.enabled ? 1 : 0;
      if (!current) {
        db.prepare(`INSERT INTO journey_collaboration_email_preferences
          (space_id,user_id,email_enabled,revision,created_at,updated_at,decided_at)
          VALUES (?,?,?,1,?,?,?)`).run(input.spaceId, input.userId, enabled, at, at,
            input.enabled ? at : null);
      } else {
        const changed = db.prepare(`UPDATE journey_collaboration_email_preferences
          SET email_enabled=?,revision=revision+1,updated_at=?,decided_at=?
          WHERE space_id=? AND user_id=? AND revision=?`).run(enabled, at, input.enabled ? at : null,
            input.spaceId, input.userId, revision).changes;
        if (changed !== 1) throw new JourneyCollaborationEmailError(
          'This preference changed since it was opened.', 409,
          'JOURNEY_COLLABORATION_EMAIL_PREFERENCE_CONFLICT');
      }
      // Withdrawing consent must also stop what is already queued, or the next
      // pass would deliver mail the member has just refused.
      if (!input.enabled) this.cancelQueuedForRecipient(input.spaceId, input.userId, 'recipient_opted_out', at);
      auditInside({ spaceId: input.spaceId, actorUserId: input.actorUserId, subjectUserId: input.userId,
        outboxId: null, event: input.enabled ? 'preference_enabled' : 'preference_disabled',
        reasonCode: 'member_request', at });
      return this.getPreference(input.spaceId, input.userId);
    })();
  }

  /**
   * Queues one delivery for a notification that already exists. Called from the
   * notification writer inside its transaction, so a delivery can never exist
   * without the in-app notification it mirrors, and a rolled-back notification
   * cannot leave a queued email behind.
   *
   * Ineligibility is not an error: the overwhelming majority of members have not
   * opted in, and throwing would roll back their in-app notification.
   */
  enqueueForNotification(input: {
    spaceId: string; notificationId: string; recipientUserId: string;
    kind: JourneyCollaborationEmailKind; targetType: string; at?: string;
  }): string | null {
    if (!this.available()) return null;
    const at = iso(input.at);
    if (eligibilityInside(input.spaceId, input.recipientUserId)) return null;
    const outboxId = crypto.randomUUID();
    const idempotencyKey = journeyCollaborationEmailIdempotencyKey({
      spaceId: input.spaceId, notificationId: input.notificationId, recipientUserId: input.recipientUserId
    });
    try {
      db.prepare(`INSERT INTO journey_collaboration_email_outbox
        (id,space_id,notification_id,recipient_user_id,notification_kind,target_type,state,attempt_count,
          max_attempts,next_attempt_at,delivery_idempotency_key,fencing_token,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',0,?,?,?,0,?,?)`).run(outboxId, input.spaceId, input.notificationId,
          input.recipientUserId, input.kind, String(input.targetType).slice(0, 64),
          journeyCollaborationEmailLimits.maxAttempts, at, idempotencyKey, at, at);
    } catch (error) {
      // The same notification reaching this path twice is a replay, not a defect.
      if (isUniqueViolation(error)) return null;
      throw error;
    }
    auditInside({ spaceId: input.spaceId, actorUserId: null, subjectUserId: input.recipientUserId,
      outboxId, event: 'delivery_queued', reasonCode: 'queued', at });
    return outboxId;
  }

  /** Cancels every non-terminal delivery for one principal. Used by opt-out and
   * by the membership sweep. */
  cancelQueuedForRecipient(spaceId: string, userId: string,
    code: JourneyCollaborationEmailOutcomeCode, now: Date | string = new Date()) {
    const at = iso(now);
    const rows = db.prepare(`SELECT id,attempt_count,fencing_token FROM journey_collaboration_email_outbox
      WHERE space_id=? AND recipient_user_id=? AND state IN ('pending','sending')`)
      .all(spaceId, userId) as any[];
    let cancelled = 0;
    for (const row of rows) {
      const fencingToken = Number(row.fencing_token) + 1;
      const changed = db.prepare(`UPDATE journey_collaboration_email_outbox
        SET state='cancelled',last_outcome_code=?,fencing_token=?,lease_owner=NULL,lease_token_sha256=NULL,
          lease_expires_at=NULL,updated_at=?,terminal_at=?
        WHERE id=? AND space_id=? AND state IN ('pending','sending')`)
        .run(code, fencingToken, at, at, row.id, spaceId).changes;
      if (changed !== 1) continue;
      cancelled += 1;
      attemptInside({ spaceId, outboxId: String(row.id), attemptNumber: Number(row.attempt_count) + 1,
        fencingToken, outcome: 'cancelled', outcomeCode: code, startedAt: at, completedAt: at });
      auditInside({ spaceId, actorUserId: null, subjectUserId: userId, outboxId: String(row.id),
        event: 'delivery_cancelled', reasonCode: code, at });
    }
    return cancelled;
  }

  /**
   * Crash recovery. A row left in `sending` by a killed process is either safely
   * re-sendable, because the mail service still deduplicates on its stable key,
   * or past that window and therefore of unknown delivery state. The second case
   * is dead-lettered rather than resent: a duplicate notice is worse than a
   * missing one for a message the recipient can also read in the app.
   */
  recoverStaleDeliveries(now: Date | string = new Date(), idempotencyWindowMs = 29 * 60_000) {
    if (!this.available()) return { requeued: 0, deadLettered: 0 };
    const at = iso(now);
    const safeAfter = new Date(Date.parse(at) - Math.max(60_000, idempotencyWindowMs)).toISOString();
    return db.transaction(() => {
      const rows = db.prepare(`SELECT id,space_id,recipient_user_id,attempt_count,max_attempts,fencing_token,updated_at
        FROM journey_collaboration_email_outbox WHERE state='sending' AND lease_expires_at<=?
        ORDER BY lease_expires_at,id LIMIT 200`).all(at) as any[];
      let requeued = 0; let deadLettered = 0;
      for (const row of rows) {
        const fencingToken = Number(row.fencing_token) + 1;
        const attemptCount = Number(row.attempt_count);
        const expired = String(row.updated_at) < safeAfter;
        const exhausted = attemptCount >= Number(row.max_attempts);
        if (expired || exhausted) {
          const code: JourneyCollaborationEmailOutcomeCode = expired ? 'recovery_timeout' : 'lease_lost';
          const changed = db.prepare(`UPDATE journey_collaboration_email_outbox
            SET state='dead_letter',last_outcome_code=?,fencing_token=?,lease_owner=NULL,lease_token_sha256=NULL,
              lease_expires_at=NULL,updated_at=?,terminal_at=?
            WHERE id=? AND space_id=? AND state='sending' AND fencing_token=?`)
            .run(code, fencingToken, at, at, row.id, row.space_id, row.fencing_token).changes;
          if (changed !== 1) continue;
          deadLettered += 1;
          auditInside({ spaceId: String(row.space_id), actorUserId: null,
            subjectUserId: String(row.recipient_user_id), outboxId: String(row.id),
            event: 'delivery_dead_lettered', reasonCode: code, at });
          continue;
        }
        const changed = db.prepare(`UPDATE journey_collaboration_email_outbox
          SET state='pending',last_outcome_code='lease_lost',fencing_token=?,lease_owner=NULL,
            lease_token_sha256=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=?
          WHERE id=? AND space_id=? AND state='sending' AND fencing_token=?`)
          .run(fencingToken, at, at, row.id, row.space_id, row.fencing_token).changes;
        if (changed !== 1) continue;
        requeued += 1;
        auditInside({ spaceId: String(row.space_id), actorUserId: null,
          subjectUserId: String(row.recipient_user_id), outboxId: String(row.id),
          event: 'delivery_retry_scheduled', reasonCode: 'lease_lost', at });
      }
      return { requeued, deadLettered };
    })();
  }

  /**
   * Takes a fenced lease on one due delivery and resolves the recipient address
   * from the account. A row that is no longer eligible is cancelled here rather
   * than claimed, so the send path only ever sees deliveries that are still
   * consented to at this instant.
   */
  claim(input: { owner: string; now?: Date | string; leaseMs?: number }): JourneyCollaborationEmailClaim | null {
    if (!this.available()) return null;
    const owner = String(input.owner || '').trim();
    if (!owner || owner.length > 200) throw new JourneyCollaborationEmailError(
      'A worker lease owner is required.', 500, 'JOURNEY_COLLABORATION_EMAIL_OWNER_INVALID');
    const at = iso(input.now || new Date());
    const leaseMs = Math.max(5_000, Math.min(600_000, input.leaseMs || journeyCollaborationEmailLimits.leaseMs));
    const leaseExpires = new Date(Date.parse(at) + leaseMs).toISOString();
    const lock = db.provider === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
    return db.transaction(() => {
      const candidate = db.prepare(`SELECT * FROM journey_collaboration_email_outbox
        WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 1${lock}`)
        .get(at) as any;
      if (!candidate) return null;
      const fencingToken = Number(candidate.fencing_token) + 1;
      const attemptNumber = Number(candidate.attempt_count) + 1;
      const ineligible = eligibilityInside(String(candidate.space_id), String(candidate.recipient_user_id));
      if (ineligible) {
        const changed = db.prepare(`UPDATE journey_collaboration_email_outbox
          SET state='cancelled',last_outcome_code=?,fencing_token=?,updated_at=?,terminal_at=?
          WHERE id=? AND space_id=? AND state='pending' AND fencing_token=?`)
          .run(ineligible, fencingToken, at, at, candidate.id, candidate.space_id, candidate.fencing_token).changes;
        if (changed !== 1) return null;
        attemptInside({ spaceId: String(candidate.space_id), outboxId: String(candidate.id), attemptNumber,
          fencingToken, outcome: 'cancelled', outcomeCode: ineligible, startedAt: at, completedAt: at });
        auditInside({ spaceId: String(candidate.space_id), actorUserId: null,
          subjectUserId: String(candidate.recipient_user_id), outboxId: String(candidate.id),
          event: 'delivery_cancelled', reasonCode: ineligible, at });
        return null;
      }
      const leaseToken = crypto.randomBytes(32).toString('hex');
      const changed = db.prepare(`UPDATE journey_collaboration_email_outbox
        SET state='sending',attempt_count=?,fencing_token=?,lease_owner=?,lease_token_sha256=?,
          lease_expires_at=?,updated_at=?
        WHERE id=? AND space_id=? AND state='pending' AND fencing_token=?`)
        .run(attemptNumber, fencingToken, owner, sha(leaseToken), leaseExpires, at,
          candidate.id, candidate.space_id, candidate.fencing_token).changes;
      if (changed !== 1) return null;
      const account = db.prepare('SELECT email FROM users WHERE id=?')
        .get(candidate.recipient_user_id) as { email?: string } | undefined;
      const recipientEmail = String(account?.email || '').trim();
      if (!recipientEmail) return null;
      return {
        outboxId: String(candidate.id), spaceId: String(candidate.space_id),
        notificationId: String(candidate.notification_id),
        recipientUserId: String(candidate.recipient_user_id),
        kind: String(candidate.notification_kind) as JourneyCollaborationEmailKind,
        attemptNumber, maxAttempts: Number(candidate.max_attempts), fencingToken,
        leaseOwner: owner, leaseToken, idempotencyKey: String(candidate.delivery_idempotency_key),
        recipientEmail, startedAt: at
      };
    })();
  }

  markSent(claim: JourneyCollaborationEmailClaim, providerMessageId: string | null,
    now: Date | string = new Date()) {
    const at = iso(now);
    return db.transaction(() => {
      const changed = db.prepare(`UPDATE journey_collaboration_email_outbox
        SET state='sent',last_outcome_code='delivered',lease_owner=NULL,lease_token_sha256=NULL,
          lease_expires_at=NULL,updated_at=?,sent_at=?,terminal_at=?
        WHERE id=? AND space_id=? AND state='sending' AND fencing_token=? AND lease_token_sha256=?`)
        .run(at, at, at, claim.outboxId, claim.spaceId, claim.fencingToken, sha(claim.leaseToken)).changes;
      if (changed !== 1) throw new JourneyCollaborationEmailError(
        'The Journey collaboration email lease was lost.', 409, 'JOURNEY_COLLABORATION_EMAIL_LEASE_LOST');
      attemptInside({ spaceId: claim.spaceId, outboxId: claim.outboxId, attemptNumber: claim.attemptNumber,
        fencingToken: claim.fencingToken, outcome: 'sent', outcomeCode: 'delivered',
        providerMessageId, startedAt: claim.startedAt, completedAt: at });
      auditInside({ spaceId: claim.spaceId, actorUserId: null, subjectUserId: claim.recipientUserId,
        outboxId: claim.outboxId, event: 'delivery_sent', reasonCode: 'delivered', at });
      return { state: 'sent' as const };
    })();
  }

  /**
   * Records a failed attempt under the lease. A recipient-shaped code cancels
   * outright; a transport code retries with bounded exponential backoff until the
   * attempt budget is spent, after which the row dead-letters and stops.
   */
  recordFailure(claim: JourneyCollaborationEmailClaim, code: JourneyCollaborationEmailOutcomeCode,
    now: Date | string = new Date()) {
    const at = iso(now);
    const cancelled = cancelCodes.has(code);
    const exhausted = code === 'transport_permanent' || claim.attemptNumber >= claim.maxAttempts;
    const state = cancelled ? 'cancelled' : exhausted ? 'dead_letter' : 'pending';
    return db.transaction(() => {
      const changed = state === 'pending'
        ? db.prepare(`UPDATE journey_collaboration_email_outbox
            SET state='pending',last_outcome_code=?,lease_owner=NULL,lease_token_sha256=NULL,
              lease_expires_at=NULL,next_attempt_at=?,updated_at=?
            WHERE id=? AND space_id=? AND state='sending' AND fencing_token=? AND lease_token_sha256=?`)
          .run(code, journeyCollaborationEmailNextAttemptAt(at, claim.attemptNumber), at,
            claim.outboxId, claim.spaceId, claim.fencingToken, sha(claim.leaseToken)).changes
        : db.prepare(`UPDATE journey_collaboration_email_outbox
            SET state=?,last_outcome_code=?,lease_owner=NULL,lease_token_sha256=NULL,
              lease_expires_at=NULL,updated_at=?,terminal_at=?
            WHERE id=? AND space_id=? AND state='sending' AND fencing_token=? AND lease_token_sha256=?`)
          .run(state, code, at, at, claim.outboxId, claim.spaceId, claim.fencingToken,
            sha(claim.leaseToken)).changes;
      if (changed !== 1) throw new JourneyCollaborationEmailError(
        'The Journey collaboration email lease was lost.', 409, 'JOURNEY_COLLABORATION_EMAIL_LEASE_LOST');
      const outcome = state === 'pending' ? 'retry_scheduled' : state === 'cancelled' ? 'cancelled' : 'dead_lettered';
      attemptInside({ spaceId: claim.spaceId, outboxId: claim.outboxId, attemptNumber: claim.attemptNumber,
        fencingToken: claim.fencingToken, outcome, outcomeCode: code,
        startedAt: claim.startedAt, completedAt: at });
      auditInside({ spaceId: claim.spaceId, actorUserId: null, subjectUserId: claim.recipientUserId,
        outboxId: claim.outboxId,
        event: state === 'pending' ? 'delivery_retry_scheduled'
          : state === 'cancelled' ? 'delivery_cancelled' : 'delivery_dead_lettered',
        reasonCode: code, at });
      return { state };
    })();
  }

  /** Content-free counters for the tenant's own status panel. */
  status(spaceId: string) {
    const rows = db.prepare(`SELECT state,COUNT(*) total FROM journey_collaboration_email_outbox
      WHERE space_id=? GROUP BY state`).all(spaceId) as any[];
    const counts = { pending: 0, sending: 0, sent: 0, cancelled: 0, dead_letter: 0 };
    for (const row of rows) {
      const key = String(row.state) as keyof typeof counts;
      if (key in counts) counts[key] = Number(row.total);
    }
    return counts;
  }
}

export const journeyCollaborationEmailRepository = new JourneyCollaborationEmailRepository();
