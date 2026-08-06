import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './database.js';
import { mailTransportStatus, sendMail } from './mailClient.js';
import type { Collector, Survey } from './types.js';

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const EMAIL_SENDER_NAME_MAX_LENGTH = 150;
const unsafeSenderNameCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const unsafeSenderNameCharactersGlobal = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu;

function configuredSenderName() {
  return String(config.mailFromName || '')
    .replace(unsafeSenderNameCharactersGlobal, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, EMAIL_SENDER_NAME_MAX_LENGTH) || 'Experience Management';
}

/**
 * Sender display names end up inside a From header, so they are treated as
 * header input. Reject controls defensively and use the verified account
 * default whenever an optional campaign display name is empty.
 */
export function normalizeEmailSenderName(value?: string | null) {
  if (value !== undefined && value !== null) {
    const raw = String(value);
    if (unsafeSenderNameCharacters.test(raw)) throw new Error('Sender name cannot contain control characters.');
    const trimmed = raw.trim();
    if (trimmed.length > EMAIL_SENDER_NAME_MAX_LENGTH) {
      throw new Error(`Sender name cannot exceed ${EMAIL_SENDER_NAME_MAX_LENGTH} characters.`);
    }
    if (trimmed) return trimmed;
  }
  return configuredSenderName();
}

export function emailStatus() {
  const transport = mailTransportStatus();
  return {
    configured: transport.configured,
    mode: config.emailMode,
    provider: 'seemplify-mail',
    sender: config.mailFromEmail,
    senderName: config.mailFromName,
    source: transport.configured ? 'seemplify-mail-service' : 'not-configured'
  };
}

/**
 * Single funnel for every outbound message in this service. Callers keep their
 * own delivery ledgers, so this deliberately performs exactly one attempt and
 * lets the classified MailError decide whether the caller retries.
 */
async function deliver(input: {
  to: string;
  /**
   * Accepted for call-site compatibility. The mail service composes headers
   * from bare mailboxes, so a recipient display name is not transported.
   */
  name?: string;
  senderName?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  correlation: string;
  tag: string;
}) {
  return sendMail({
    from: config.mailFromEmail,
    fromName: normalizeEmailSenderName(input.senderName),
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    tag: input.tag,
    idempotencyKey: input.idempotencyKey,
    headers: { 'X-Seemplify-Correlation': input.correlation.slice(0, 500) }
  });
}

export async function sendTransactionalEmail(input: {
  to: string;
  name?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  correlation: string;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)) throw new Error('Email idempotency key must be a UUID.');
  return deliver({
    to: input.to.trim().toLowerCase(),
    name: input.name?.trim(),
    subject: input.subject.replace(/[\r\n]+/g, ' ').slice(0, 250),
    html: input.html,
    text: input.text,
    idempotencyKey: input.idempotencyKey,
    correlation: input.correlation,
    tag: input.correlation.split(':')[0] || 'transactional'
  });
}

function personalize(value: string, variables: Record<string, string>, html = false) {
  return String(value || '').replace(/\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?)\s*\}\}/gi, (token, key: string) => {
    const normalized = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(variables, normalized)) return token;
    const replacement = variables[normalized] || '';
    return html ? escapeHtml(replacement) : replacement;
  });
}

/**
 * Campaign HTML is deliberately conservative. The optional HTML editor supports
 * text structure and links, while scripts, forms, remote media, inline styles and
 * event handlers are discarded before any personalized values are inserted.
 */
export function sanitizeCampaignHtml(input: string) {
  const allowed = new Set(['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'hr']);
  let value = String(input || '')
    .replace(/<(script|style|iframe|object|embed|form|svg|math)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '');
  value = value.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (tag, rawName: string, rawAttributes: string) => {
    const name = rawName.toLowerCase();
    if (!allowed.has(name)) return '';
    if (tag.startsWith('</')) return `</${name}>`;
    if (name === 'br' || name === 'hr') return `<${name}>`;
    if (name !== 'a') return `<${name}>`;
    const hrefMatch = rawAttributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    const href = hrefMatch?.[2]?.trim() || '';
    const safeHref = /^(https?:\/\/|mailto:|\{\{\s*survey_link\s*\}\})/i.test(href) ? href : '';
    return safeHref ? `<a href="${escapeHtml(safeHref)}" rel="noopener noreferrer">` : '<a>';
  });
  return value;
}

export async function sendCampaignEmail(input: {
  deliveryId: string;
  to: string;
  name?: string;
  senderName?: string;
  subject: string;
  mode: 'plain' | 'html';
  bodyText: string;
  bodyHtml?: string;
  variables: Record<string, string>;
  embeddedQuestionHtml?: string;
  embeddedQuestionText?: string;
  unsubscribeUrl?: string;
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.deliveryId)) throw new Error('Campaign delivery idempotency key must be a UUID v4.');
  const subject = personalize(input.subject, input.variables).replace(/[\r\n]+/g, ' ').slice(0, 250);
  const textBody = personalize(input.bodyText, input.variables).trim();
  const htmlBody = input.mode === 'html'
    ? personalize(sanitizeCampaignHtml(input.bodyHtml || ''), input.variables, true)
    : `<p>${escapeHtml(textBody).replace(/\r?\n/g, '<br>')}</p>`;
  const unsubscribeHtml = input.unsubscribeUrl
    ? `<p style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">Do not want more messages from this survey campaign? <a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe</a>.</p>`
    : '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">
    ${htmlBody}${input.embeddedQuestionHtml || ''}${unsubscribeHtml}
  </div>`;
  const text = `${textBody}${input.embeddedQuestionText ? `\n\n${input.embeddedQuestionText}` : ''}${input.unsubscribeUrl ? `\n\nUnsubscribe: ${input.unsubscribeUrl}` : ''}`.trim();
  return deliver({
    to: input.to,
    name: input.name,
    senderName: input.senderName,
    subject,
    html,
    text,
    idempotencyKey: input.deliveryId,
    correlation: `campaign_delivery:${input.deliveryId}`,
    tag: 'campaign_delivery'
  });
}

export async function sendPasswordResetEmail(input: { resetId: string; email: string; name: string; token: string }) {
  const resetUrl = `${config.publicUrl}/reset-password?token=${encodeURIComponent(input.token)}`;
  const greeting = input.name ? `Hello ${escapeHtml(input.name)},` : 'Hello,';
  return deliver({
    to: input.email,
    name: input.name,
    idempotencyKey: input.resetId,
    correlation: `password_reset:${input.resetId}`,
    tag: 'password_reset',
    subject: 'Reset your Experience Management password',
    html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="font-size:22px;margin:0 0 18px">Reset your password</h2>
      <p>${greeting}</p><p>Use the secure link below to choose a new password. It expires in 30 minutes and can only be used once.</p>
      <p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">Reset password</a></p>
      <p style="font-size:13px;color:#6b706c">If you did not request this, you can ignore this email. Do not share the link.</p>
    </div>`,
    text: `Reset your Experience Management password using this one-time link: ${resetUrl}\n\nIt expires in 30 minutes. If you did not request this, ignore this email.`
  });
}

export async function sendEmailVerificationEmail(input: {
  verificationId: string;
  email: string;
  name: string;
  token: string;
  expiresAt: string;
  requiresPasswordSetup?: boolean;
  returnPath?: string | null;
}) {
  const returnQuery = input.returnPath === '/my-documents' ? `&returnTo=${encodeURIComponent(input.returnPath)}` : '';
  const verificationUrl = `${config.publicUrl}/verify-email?token=${encodeURIComponent(input.token)}&request=${encodeURIComponent(input.verificationId)}${returnQuery}`;
  const greeting = input.name ? `Hello ${escapeHtml(input.name)},` : 'Hello,';
  const action = input.requiresPasswordSetup
    ? 'Confirm this email address, then choose a private password to secure the account.'
    : 'Confirm this email address to finish creating your Experience Management account.';
  return sendTransactionalEmail({
    to: input.email,
    name: input.name,
    subject: 'Verify your Experience Management email',
    idempotencyKey: input.verificationId,
    correlation: `account_email_verification:${input.verificationId}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="font-size:22px;margin:0 0 18px">Verify your email</h2>
      <p>${greeting}</p><p>${action}</p>
      <p><a href="${escapeHtml(verificationUrl)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">Verify email</a></p>
      <p style="font-size:13px;color:#6b706c">This one-time link expires at ${escapeHtml(new Date(input.expiresAt).toUTCString())}. If you did not create this account, you can ignore this message.</p>
    </div>`,
    text: `${action} Use this one-time link: ${verificationUrl}\n\nIt expires at ${new Date(input.expiresAt).toUTCString()}. If you did not create this account, ignore this email.`
  });
}

export async function sendExistingAccountSignupNotice(input: {
  attemptId: string;
  email: string;
  name: string;
  inviteToken?: string;
  returnPath?: string | null;
}) {
  const signInQuery = input.inviteToken
    ? `?invite=${encodeURIComponent(input.inviteToken)}`
    : input.returnPath === '/my-documents' ? '?returnTo=%2Fmy-documents' : '';
  const signInUrl = `${config.publicUrl}/login${signInQuery}`;
  const recoveryUrl = `${config.publicUrl}/forgot-password`;
  const greeting = input.name ? `Hello ${escapeHtml(input.name)},` : 'Hello,';
  return sendTransactionalEmail({
    to: input.email,
    name: input.name,
    subject: 'A sign-up was requested for your Experience Management account',
    idempotencyKey: input.attemptId,
    correlation: `existing_account_signup:${input.attemptId}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="font-size:22px;margin:0 0 18px">Your account already exists</h2>
      <p>${greeting}</p><p>Someone tried to create another Experience Management account with this email address. Your existing account and password were not changed.</p>
      <p><a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">Sign in</a></p>
      <p style="font-size:13px;color:#6b706c">If you no longer know your password, use <a href="${escapeHtml(recoveryUrl)}">password recovery</a>. If this was not you, no action is required.</p>
    </div>`,
    text: `A sign-up was requested for your existing Experience Management account. Sign in: ${signInUrl}\n\nForgot your password? ${recoveryUrl}\n\nIf this was not you, no action is required.`
  });
}

export async function sendSpaceInvitationEmail(input: {
  invitationId: string;
  email: string;
  token: string;
  spaceName: string;
  invitedBy: string;
  role: string;
}) {
  const inviteUrl = `${config.publicUrl}/join/${encodeURIComponent(input.token)}`;
  return deliver({
    to: input.email,
    idempotencyKey: input.invitationId,
    correlation: `space_invitation:${input.invitationId}`,
    tag: 'space_invitation',
    subject: `Join ${input.spaceName} in Experience Management`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="font-size:22px;margin:0 0 18px">You have been invited</h2>
      <p>${escapeHtml(input.invitedBy)} invited you to join <strong>${escapeHtml(input.spaceName)}</strong> as ${escapeHtml(input.role)}.</p>
      <p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">Review invitation</a></p>
      <p style="font-size:13px;color:#6b706c">This link expires in 7 days and is bound to ${escapeHtml(input.email)}. If you were not expecting it, you can ignore this message.</p>
    </div>`,
    text: `${input.invitedBy} invited you to join ${input.spaceName} in Experience Management as ${input.role}.\n\nReview the invitation: ${inviteUrl}\n\nThis link expires in 7 days and is bound to ${input.email}.`
  });
}

function inviteContent(survey: Survey, collector: Collector, recipient: { name?: string; token: string }, message?: string) {
  const surveyUrl = `${collector.publicUrl}?recipient=${encodeURIComponent(recipient.token)}`;
  const unsubscribeUrl = `${config.publicUrl}/api/public/collectors/unsubscribe/${encodeURIComponent(recipient.token)}`;
  const greeting = recipient.name ? `Hello ${escapeHtml(recipient.name)},` : 'Hello,';
  const custom = escapeHtml(message || `We would value your feedback in “${survey.title}”.`);
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">
    <h2 style="font-size:22px;margin:0 0 18px">${escapeHtml(survey.title)}</h2>
    <p>${greeting}</p><p>${custom}</p>
    <p><a href="${escapeHtml(surveyUrl)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">Share feedback</a></p>
    <p style="font-size:13px;color:#6b706c">If the button does not open, use this link:<br>${escapeHtml(surveyUrl)}</p>
    <p style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280"><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from survey emails</a></p>
  </div>`;
  return { surveyUrl, unsubscribeUrl, html, text: `${recipient.name ? `Hello ${recipient.name}, ` : ''}${message || `We would value your feedback in “${survey.title}”.`} ${surveyUrl}\n\nUnsubscribe: ${unsubscribeUrl}` };
}

export async function sendInvitations(survey: Survey, collector: Collector, recipients: { email: string; name?: string }[], message?: string) {
  const spaceId = (db.prepare('SELECT space_id FROM surveys WHERE id=?').get(survey.id) as { space_id?: string } | undefined)?.space_id;
  if (!spaceId) throw new Error('Survey space is not configured.');
  const insert = db.prepare(`INSERT INTO recipients (id,collector_id,name,email,token,status,first_attempt_at,updated_at,created_at) VALUES (?,?,?,?,?,'sending',?,?,?)`);
  const update = db.prepare(`UPDATE recipients SET status=?,invite_sent_at=?,message_id=?,error=?,updated_at=? WHERE id=?`);
  const findExisting = db.prepare('SELECT * FROM recipients WHERE collector_id=? AND email=? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1');
  const isSuppressed = db.prepare('SELECT 1 FROM email_suppressions WHERE space_id=? AND email=?');
  const outcomes = [];
  for (const recipient of recipients) {
    const email = recipient.email.trim().toLowerCase(); const now = new Date().toISOString();
    let stored = findExisting.get(collector.id, email) as any;
    if (!stored) {
      const id = crypto.randomUUID(); const token = crypto.randomBytes(18).toString('base64url');
      insert.run(id, collector.id, recipient.name || '', email, token, now, now, now);
      stored = findExisting.get(collector.id, email) as any;
    }
    const id = String(stored.id); const token = String(stored.token);
    const content = inviteContent(survey, collector, { ...recipient, token }, message);
    if (isSuppressed.get(spaceId, email) || ['suppressed', 'unsubscribed'].includes(String(stored.status))) {
      update.run('suppressed', stored.invite_sent_at || null, stored.message_id || null, 'Recipient has opted out of survey emails.', now, id);
      outcomes.push({ id, email, status: 'failed', error: 'Recipient has opted out of survey emails.' });
      continue;
    }
    if (['sent', 'responded'].includes(String(stored.status))) {
      outcomes.push({ id, email, status: 'sent', surveyUrl: content.surveyUrl });
      continue;
    }
    const firstAttemptAt = stored.first_attempt_at ? Date.parse(String(stored.first_attempt_at)) : Date.now();
    if (stored.first_attempt_at && (!Number.isFinite(firstAttemptAt) || Date.now() - firstAttemptAt >= config.mailIdempotencyTtlMinutes * 60_000)) {
      const error = 'The previous invitation delivery state is unknown outside the provider idempotency window; it was not resent.';
      update.run('failed', stored.invite_sent_at || null, stored.message_id || null, error, now, id);
      outcomes.push({ id, email, status: 'failed', error });
      continue;
    }
    db.prepare("UPDATE recipients SET status='sending',first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=?").run(now, now, id);
    try {
      const result = await deliver({
        to: email,
        name: recipient.name,
        subject: `Your feedback: ${survey.title}`,
        html: content.html,
        text: content.text,
        idempotencyKey: id,
        correlation: `collector_recipient:${id}`,
        tag: 'collector_recipient'
      });
      const sentAt = new Date().toISOString();
      update.run('sent', sentAt, (result as any).messageId || '', null, sentAt, id);
      outcomes.push({ id, email, status: 'sent', surveyUrl: content.surveyUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      update.run('failed', stored.invite_sent_at || null, stored.message_id || null, message.slice(0, 500), new Date().toISOString(), id);
      outcomes.push({ id, email, status: 'failed', error: message });
    }
  }
  return outcomes;
}

export function listRecipients(collectorId: string) {
  return db.prepare(`SELECT id,name,email,status,invite_sent_at AS "inviteSentAt",reminder_sent_at AS "reminderSentAt",responded_at AS "respondedAt",message_id AS "messageId",error,created_at AS "createdAt" FROM recipients WHERE collector_id=? ORDER BY created_at DESC`).all(collectorId);
}

function maskRecipientEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${local.length > 1 ? '***' : ''}@${domain}`;
}

export function getRecipientUnsubscribePreview(token: string) {
  const row = token ? db.prepare(`SELECT r.email,r.status,s.title survey_title FROM recipients r
    JOIN collectors c ON c.id=r.collector_id JOIN surveys s ON s.id=c.survey_id WHERE r.token=?`).get(token) as any : null;
  return row ? { email: maskRecipientEmail(String(row.email)), surveyTitle: String(row.survey_title), alreadyUnsubscribed: ['suppressed', 'unsubscribed'].includes(String(row.status)) } : null;
}

export function markRecipientUnsubscribed(token: string) {
  const row = token ? db.prepare(`SELECT r.id,r.email,r.status,s.space_id FROM recipients r
    JOIN collectors c ON c.id=r.collector_id JOIN surveys s ON s.id=c.survey_id WHERE r.token=?`).get(token) as any : null;
  if (!row) return null;
  const now = new Date().toISOString();
  db.prepare("UPDATE recipients SET status='unsubscribed',updated_at=? WHERE id=? AND status<>'responded'").run(now, row.id);
  return { email: String(row.email).trim().toLowerCase(), maskedEmail: maskRecipientEmail(String(row.email)), spaceId: String(row.space_id) };
}
