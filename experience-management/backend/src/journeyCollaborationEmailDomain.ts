import crypto from 'node:crypto';
import { config } from './config.js';
import { isRetryableMailError } from './mailClient.js';

/**
 * Runtime-56 domain rules for Journey collaboration email delivery.
 *
 * Everything here is pure and content-free on purpose. The delivery plane never
 * sees a comment body, an excerpt or a person's name, so the only inputs a
 * rendered message may use are the notification KIND, the target TYPE and an
 * authenticated product link. If a future change wants richer copy it has to
 * change this file, which is where the content ban is testable in isolation.
 *
 * The durable contract lives in
 * `migrations/postgres/future/0056_journey_collaboration_email_delivery.sql`.
 */

export const JOURNEY_COLLABORATION_EMAIL_RUNTIME_SCHEMA_VERSION = 56 as const;

/** Fixed namespace for the derived delivery key. Never rotate it: the value is
 * what makes a recovered row deduplicate against the message already accepted by
 * the mail service instead of sending a second copy. */
const DELIVERY_KEY_NAMESPACE = 'seemplify/journey-collaboration-email/v1';

export const journeyCollaborationEmailKinds = [
  'mention', 'comment', 'reply', 'resolved', 'reopened',
  'review_requested', 'review_decided', 'published', 'role_changed'
] as const;
export type JourneyCollaborationEmailKind = typeof journeyCollaborationEmailKinds[number];

export const journeyCollaborationEmailStates = [
  'pending', 'sending', 'sent', 'cancelled', 'dead_letter'] as const;
export type JourneyCollaborationEmailState = typeof journeyCollaborationEmailStates[number];

export const journeyCollaborationEmailOutcomeCodes = [
  'delivered', 'transport_retryable', 'transport_permanent', 'recipient_opted_out',
  'membership_revoked', 'recipient_unverified', 'recipient_inactive', 'lease_lost', 'recovery_timeout'
] as const;
export type JourneyCollaborationEmailOutcomeCode = typeof journeyCollaborationEmailOutcomeCodes[number];

/** Codes that describe the recipient rather than the transport. They are always
 * terminal cancellations: retrying cannot make an opted-out or removed member
 * eligible again, and a later opt-in produces its own new notifications. */
export const journeyCollaborationEmailCancelCodes = [
  'recipient_opted_out', 'membership_revoked', 'recipient_unverified', 'recipient_inactive'
] as const;

export const journeyCollaborationEmailLimits = Object.freeze({
  maxAttempts: 5,
  minimumBackoffMs: 60_000,
  maximumBackoffMs: 6 * 60 * 60_000,
  leaseMs: 120_000,
  batchSize: 25
});

export class JourneyCollaborationEmailError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_COLLABORATION_EMAIL_INVALID'
  ) {
    super(message);
    this.name = 'JourneyCollaborationEmailError';
  }
}

/**
 * A stable RFC-4122 v5-shaped UUID derived from the tenant, the notification and
 * the recipient. `sendTransactionalEmail` requires a UUID and the mail service
 * deduplicates on it, so deriving rather than generating is what makes a crash
 * mid-send safe: the recovered attempt presents the same key and the provider
 * collapses it instead of delivering twice.
 */
export function journeyCollaborationEmailIdempotencyKey(input: {
  spaceId: string; notificationId: string; recipientUserId: string;
}) {
  const digest = crypto.createHash('sha256')
    .update(`${DELIVERY_KEY_NAMESPACE}\x1F${input.spaceId}\x1F${input.notificationId}\x1F${input.recipientUserId}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Full jitter is deliberately absent: the schedule has to be reproducible for a
 * test and for an operator reading the ledger, and the fenced lease already
 * prevents two workers from colliding on one row. */
export function journeyCollaborationEmailBackoffMs(attempt: number) {
  const bounded = Math.max(1, Math.min(journeyCollaborationEmailLimits.maxAttempts, Math.trunc(attempt)));
  return Math.min(journeyCollaborationEmailLimits.maximumBackoffMs,
    journeyCollaborationEmailLimits.minimumBackoffMs * 2 ** (bounded - 1));
}

export function journeyCollaborationEmailNextAttemptAt(at: string, attempt: number) {
  const base = Date.parse(at);
  if (!Number.isFinite(base)) throw new JourneyCollaborationEmailError(
    'Timestamp is invalid.', 400, 'JOURNEY_COLLABORATION_EMAIL_TIME_INVALID');
  return new Date(base + journeyCollaborationEmailBackoffMs(attempt)).toISOString();
}

export function classifyJourneyCollaborationEmailFailure(error: unknown): JourneyCollaborationEmailOutcomeCode {
  return isRetryableMailError(error) ? 'transport_retryable' : 'transport_permanent';
}

/** The one authenticated destination this plane may link to. It carries no
 * token, no share secret and no target identifier: the recipient signs in and
 * the existing in-app inbox decides what they are still allowed to see. */
export function journeyCollaborationEmailInboxUrl() {
  return `${config.publicUrl}/journey-collaboration`;
}

const kindSummaries: Record<JourneyCollaborationEmailKind, string> = {
  mention: 'You were mentioned in a Journey discussion.',
  comment: 'There is a new comment on a Journey item you follow.',
  reply: 'There is a new reply in a Journey discussion you follow.',
  resolved: 'A Journey discussion you follow was resolved.',
  reopened: 'A Journey discussion you follow was reopened.',
  review_requested: 'A Journey review was requested from you.',
  review_decided: 'A Journey review you requested was decided.',
  published: 'A Journey review you follow was published.',
  role_changed: 'Your Journey collaboration access changed.'
};

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Generic notice. It states WHAT KIND of thing happened and links to the
 * authenticated inbox; it never states who acted, what was written or which
 * item was touched, because an inbox address is outside the tenant's access
 * control and a subject line is stored by every mail provider in the path.
 */
export function renderJourneyCollaborationEmail(input: { kind: JourneyCollaborationEmailKind }) {
  if (!journeyCollaborationEmailKinds.includes(input.kind)) throw new JourneyCollaborationEmailError(
    'Unknown Journey collaboration notification kind.', 400, 'JOURNEY_COLLABORATION_EMAIL_KIND_UNKNOWN');
  const url = journeyCollaborationEmailInboxUrl();
  const summary = kindSummaries[input.kind];
  const subject = 'You have a new Journey collaboration notification';
  const text = [
    summary,
    '',
    'Open your Journey collaboration inbox to read it:',
    url,
    '',
    'This message contains no discussion content. You are receiving it because you turned on '
      + 'email notifications for this workspace; you can turn them off in Journey collaboration.'
  ].join('\n');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">'
    + `<p>${escapeHtml(summary)}</p>`
    + `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;`
    + 'padding:12px 18px;border-radius:7px;font-weight:600">Open your inbox</a></p>'
    + `<p style="font-size:12px;color:#69716c;word-break:break-all">${escapeHtml(url)}</p>`
    + '<p style="font-size:12px;color:#69716c">This message contains no discussion content. You are receiving it '
    + 'because you turned on email notifications for this workspace; you can turn them off in Journey collaboration.</p>'
    + '</div>';
  return { subject, text, html, url };
}
