-- Runtime schema 56: opt-in, content-free email delivery for Journey
-- collaboration notifications.
--
-- Additive only. No existing table, index, trigger or grant is altered, so the
-- in-app notification semantics runtime-28 defined are untouched: this tranche
-- adds a delivery plane that reads journey_collaboration_notifications and never
-- writes to it.
--
-- Content safety is structural, not a redaction rule. No table below has a
-- column that could hold a comment body, an excerpt, a recipient address or a
-- person's name. The recipient is identified by its tenant-scoped user id
-- (already present throughout runtime-28) and the delivery worker resolves the
-- current verified account email at execution; nothing here caches it.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>55 THEN
    RAISE EXCEPTION 'runtime-56 journey collaboration email delivery requires runtime-55' USING ERRCODE='55000';
  END IF;
END $predecessor$;

-- Per-user, per-space opt-in. There is no space-wide or administrator-wide
-- switch that can turn email on for somebody else: the primary key is the
-- principal, and the membership foreign key means losing membership removes the
-- consent record with it.
CREATE TABLE journey_collaboration_email_preferences (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  PRIMARY KEY(space_id,user_id),
  CONSTRAINT journey_collaboration_email_preferences_membership_fk FOREIGN KEY(space_id,user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_email_preferences_clock CHECK(updated_at>=created_at),
  CONSTRAINT journey_collaboration_email_preferences_decision CHECK(
    (email_enabled=FALSE) OR (email_enabled=TRUE AND decided_at IS NOT NULL))
);
-- The enqueue path asks one question only: "is this principal opted in".
CREATE INDEX journey_collaboration_email_preferences_opted_in
  ON journey_collaboration_email_preferences(space_id,user_id) WHERE email_enabled;

-- The delivery outbox. One row per notification per recipient, created in the
-- same transaction as the notification it mirrors.
CREATE TABLE journey_collaboration_email_outbox (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  notification_kind TEXT NOT NULL CHECK(notification_kind IN (
    'mention','comment','reply','resolved','reopened','review_requested','review_decided','published','role_changed')),
  target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 64),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','cancelled','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 10),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 10),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  -- Derived from (space, notification, recipient) and therefore stable across a
  -- crash, a replay and a lease handover. The mail service deduplicates on it,
  -- so a recovered row cannot become a second message.
  delivery_idempotency_key TEXT NOT NULL CHECK(
    delivery_idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  lease_owner TEXT,
  lease_token_sha256 TEXT,
  lease_expires_at TIMESTAMPTZ,
  fencing_token BIGINT NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
  last_outcome_code TEXT CHECK(last_outcome_code IN (
    'delivered','transport_retryable','transport_permanent','recipient_opted_out','membership_revoked',
    'recipient_unverified','recipient_inactive','lease_lost','recovery_timeout')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  CONSTRAINT journey_collaboration_email_outbox_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_collaboration_email_outbox_once UNIQUE(notification_id,space_id,recipient_user_id),
  CONSTRAINT journey_collaboration_email_outbox_key_once UNIQUE(delivery_idempotency_key),
  CONSTRAINT journey_collaboration_email_outbox_notification_fk
    FOREIGN KEY(notification_id,space_id,recipient_user_id)
    REFERENCES journey_collaboration_notifications(id,space_id,recipient_user_id) ON DELETE CASCADE,
  -- Losing membership deletes the queued delivery, so a revoked member cannot be
  -- emailed by a row that was queued while they still belonged to the tenant.
  CONSTRAINT journey_collaboration_email_outbox_membership_fk FOREIGN KEY(space_id,recipient_user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_email_outbox_lease CHECK(
    (lease_owner IS NULL AND lease_token_sha256 IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND length(lease_owner) BETWEEN 1 AND 200
      AND lease_token_sha256 IS NOT NULL AND lease_token_sha256 ~ '^[a-f0-9]{64}$'
      AND lease_expires_at IS NOT NULL)),
  CONSTRAINT journey_collaboration_email_outbox_leased_state CHECK(
    state<>'sending' OR lease_owner IS NOT NULL),
  CONSTRAINT journey_collaboration_email_outbox_terminal CHECK(
    (state IN ('pending','sending') AND sent_at IS NULL AND terminal_at IS NULL)
    OR (state='sent' AND sent_at IS NOT NULL AND terminal_at IS NOT NULL)
    OR (state IN ('cancelled','dead_letter') AND sent_at IS NULL AND terminal_at IS NOT NULL)),
  CONSTRAINT journey_collaboration_email_outbox_attempts CHECK(attempt_count<=max_attempts),
  CONSTRAINT journey_collaboration_email_outbox_clock CHECK(updated_at>=created_at)
);
CREATE INDEX journey_collaboration_email_outbox_due
  ON journey_collaboration_email_outbox(next_attempt_at,id) WHERE state='pending';
CREATE INDEX journey_collaboration_email_outbox_expired_lease
  ON journey_collaboration_email_outbox(lease_expires_at,id) WHERE state='sending';
CREATE INDEX journey_collaboration_email_outbox_space_state
  ON journey_collaboration_email_outbox(space_id,state,updated_at DESC,id);
CREATE INDEX journey_collaboration_email_outbox_recipient
  ON journey_collaboration_email_outbox(space_id,recipient_user_id,state,id);

-- Immutable attempt ledger. Content-free by construction: an attempt records a
-- fencing token, an enumerated outcome and a hash of the provider message id.
CREATE TABLE journey_collaboration_email_attempts (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  outbox_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 10),
  fencing_token BIGINT NOT NULL CHECK(fencing_token>0),
  outcome TEXT NOT NULL CHECK(outcome IN ('sent','retry_scheduled','dead_lettered','cancelled')),
  outcome_code TEXT NOT NULL CHECK(outcome_code IN (
    'delivered','transport_retryable','transport_permanent','recipient_opted_out','membership_revoked',
    'recipient_unverified','recipient_inactive','lease_lost','recovery_timeout')),
  provider_message_sha256 TEXT CHECK(
    provider_message_sha256 IS NULL OR provider_message_sha256 ~ '^[a-f0-9]{64}$'),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_email_attempts_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_collaboration_email_attempts_sequence UNIQUE(outbox_id,attempt_number),
  CONSTRAINT journey_collaboration_email_attempts_outbox_fk FOREIGN KEY(outbox_id,space_id)
    REFERENCES journey_collaboration_email_outbox(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_email_attempts_clock CHECK(completed_at>=started_at)
);
CREATE INDEX journey_collaboration_email_attempts_history
  ON journey_collaboration_email_attempts(space_id,completed_at DESC,id);

-- Audit trail. The subject principal and the outbox row are recorded as hashes
-- and the event is an enumeration, so there is no free-text column for content
-- to leak into and no redaction rule for a later change to get wrong.
CREATE TABLE journey_collaboration_email_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  principal_user_sha256 TEXT NOT NULL CHECK(principal_user_sha256 ~ '^[a-f0-9]{64}$'),
  outbox_sha256 TEXT CHECK(outbox_sha256 IS NULL OR outbox_sha256 ~ '^[a-f0-9]{64}$'),
  event TEXT NOT NULL CHECK(event IN (
    'preference_enabled','preference_disabled','delivery_queued','delivery_sent',
    'delivery_retry_scheduled','delivery_dead_lettered','delivery_cancelled')),
  reason_code TEXT NOT NULL CHECK(reason_code IN (
    'member_request','delivered','transport_retryable','transport_permanent','recipient_opted_out',
    'membership_revoked','recipient_unverified','recipient_inactive','lease_lost','recovery_timeout','queued')),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_email_audit_events_tenant_identity UNIQUE(id,space_id)
);
CREATE INDEX journey_collaboration_email_audit_history
  ON journey_collaboration_email_audit_events(space_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_collaboration_email_history_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  RAISE EXCEPTION 'Journey collaboration email attempts and audit are append-only' USING ERRCODE='55000';
END $guard$;
REVOKE ALL ON FUNCTION journey_collaboration_email_history_guard() FROM PUBLIC;
-- UPDATE, not UPDATE OR DELETE. Both ledgers sit downstream of cascades that
-- must keep working: comment retention deletes a comment, which cascades through
-- journey_collaboration_notifications to the outbox and on to its attempts, and
-- deleting a tenant cascades the audit. A BEFORE DELETE guard would convert both
-- into a hard failure. Rewriting is what has to be impossible, and DELETE is
-- withheld from the runtime role by the REVOKE at the end of this file.
CREATE TRIGGER journey_collaboration_email_attempts_append_only BEFORE UPDATE
  ON journey_collaboration_email_attempts FOR EACH ROW
  EXECUTE FUNCTION journey_collaboration_email_history_guard();
-- Column-scoped so the ON DELETE SET NULL that fires when an attributed account
-- is removed can still land: naming actor_user_id here would make deleting a
-- user fail against its own audit trail.
CREATE TRIGGER journey_collaboration_email_audit_append_only BEFORE UPDATE OF
  id,space_id,principal_user_sha256,outbox_sha256,event,reason_code,created_at
  ON journey_collaboration_email_audit_events FOR EACH ROW
  EXECUTE FUNCTION journey_collaboration_email_history_guard();

-- Consent is enforced by the database, not only by the writer. A queued delivery
-- must belong to a principal that has opted in and whose account is both
-- verified and active at the moment of queueing; the send path re-checks all
-- three, because consent can be withdrawn between queue and send.
CREATE OR REPLACE FUNCTION journey_collaboration_email_outbox_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM journey_collaboration_email_preferences preference
    WHERE preference.space_id=NEW.space_id AND preference.user_id=NEW.recipient_user_id
      AND preference.email_enabled
  ) THEN
    RAISE EXCEPTION 'Journey collaboration email delivery requires an explicit recipient opt-in'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM users account
    WHERE account.id=NEW.recipient_user_id AND account.email_verified_at IS NOT NULL
      AND account.account_status='active'
  ) THEN
    RAISE EXCEPTION 'Journey collaboration email delivery requires a verified, active account'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION journey_collaboration_email_outbox_consent_guard() FROM PUBLIC;
CREATE TRIGGER journey_collaboration_email_outbox_consent_guard BEFORE INSERT
  ON journey_collaboration_email_outbox FOR EACH ROW
  EXECUTE FUNCTION journey_collaboration_email_outbox_consent_guard();

-- A delivery never moves backwards out of a terminal state, and its stable
-- idempotency key, its recipient and the notification it mirrors are immutable.
CREATE OR REPLACE FUNCTION journey_collaboration_email_outbox_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF NEW.id<>OLD.id OR NEW.space_id<>OLD.space_id OR NEW.notification_id<>OLD.notification_id
    OR NEW.recipient_user_id<>OLD.recipient_user_id
    OR NEW.delivery_idempotency_key<>OLD.delivery_idempotency_key THEN
    RAISE EXCEPTION 'Journey collaboration email delivery identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state IN ('sent','cancelled','dead_letter') THEN
    RAISE EXCEPTION 'A terminal journey collaboration email delivery cannot be reopened' USING ERRCODE='23514';
  END IF;
  IF NEW.attempt_count<OLD.attempt_count OR NEW.fencing_token<OLD.fencing_token THEN
    RAISE EXCEPTION 'Journey collaboration email attempts and fencing tokens never move backwards'
      USING ERRCODE='40001';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION journey_collaboration_email_outbox_transition_guard() FROM PUBLIC;
-- Column-scoped: the membership and notification cascades must stay able to
-- delete a row without tripping the forward-only rule.
CREATE TRIGGER journey_collaboration_email_outbox_transition_guard BEFORE UPDATE OF
  id,space_id,notification_id,recipient_user_id,delivery_idempotency_key,state,attempt_count,fencing_token
  ON journey_collaboration_email_outbox FOR EACH ROW
  EXECUTE FUNCTION journey_collaboration_email_outbox_transition_guard();

-- Least privilege. The delivery plane is machinery, not tenant content: the
-- immutable ledgers are never rewritten and the outbox is never inserted into or
-- deleted by anything but the application role the aggregate privilege file
-- grants at registration time.
REVOKE UPDATE,DELETE ON journey_collaboration_email_attempts,
  journey_collaboration_email_audit_events FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE ON journey_collaboration_email_preferences,
  journey_collaboration_email_outbox FROM PUBLIC;
