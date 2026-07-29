import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './database.js';
import type { Collector, Survey } from './types.js';

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function emailStatus() {
  return {
    configured: Boolean(config.brevoApiKey),
    mode: config.emailMode,
    provider: 'brevo',
    sender: config.brevoFromEmail,
    senderName: config.brevoFromName,
    source: config.brevoApiKey ? 'seemplify-shared-environment' : 'not-configured'
  };
}

async function sendBrevoEmail(input: { to: string; name?: string; subject: string; html: string; text: string; headers?: Record<string, string> }) {
  if (config.emailMode === 'log') return { messageId: `log_${Date.now()}`, mode: 'log' };
  if (!config.brevoApiKey) throw new Error('BREVO_API_KEY is not configured in the shared Seemplify environment.');
  const response = await fetch(config.brevoApiUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'api-key': config.brevoApiKey },
    body: JSON.stringify({
      sender: { name: config.brevoFromName, email: config.brevoFromEmail },
      to: [{ email: input.to, name: input.name || undefined }],
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.text,
      headers: input.headers
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    if (String(payload.code || '').toLowerCase() === 'duplicate_parameter' && input.headers?.idempotencyKey) {
      return { messageId: `idempotent:${input.headers.idempotencyKey}`, mode: 'brevo', idempotentDuplicate: true };
    }
    throw new Error(payload.message || `Brevo returned HTTP ${response.status}`);
  }
  return { ...payload, mode: 'brevo' };
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
  return sendBrevoEmail({
    to: input.to,
    name: input.name,
    subject,
    html,
    text,
    headers: { idempotencyKey: input.deliveryId, 'X-Mailin-custom': `campaign_delivery:${input.deliveryId}` }
  });
}

export async function sendPasswordResetEmail(input: { email: string; name: string; token: string }) {
  const resetUrl = `${config.publicUrl}/reset-password?token=${encodeURIComponent(input.token)}`;
  const greeting = input.name ? `Hello ${escapeHtml(input.name)},` : 'Hello,';
  return sendBrevoEmail({
    to: input.email,
    name: input.name,
    subject: 'Reset your Seemplify Experience password',
    html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="font-size:22px;margin:0 0 18px">Reset your password</h2>
      <p>${greeting}</p><p>Use the secure link below to choose a new password. It expires in 30 minutes and can only be used once.</p>
      <p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">Reset password</a></p>
      <p style="font-size:13px;color:#6b706c">If you did not request this, you can ignore this email. Do not share the link.</p>
    </div>`,
    text: `Reset your Seemplify Experience password using this one-time link: ${resetUrl}\n\nIt expires in 30 minutes. If you did not request this, ignore this email.`
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
  const insert = db.prepare(`INSERT INTO recipients (id,collector_id,name,email,token,status,first_attempt_at,updated_at,created_at) VALUES (?,?,?,?,?,'sending',?,?,?)`);
  const update = db.prepare(`UPDATE recipients SET status=?,invite_sent_at=?,message_id=?,error=?,updated_at=? WHERE id=?`);
  const findExisting = db.prepare('SELECT * FROM recipients WHERE collector_id=? AND email=? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1');
  const isSuppressed = db.prepare('SELECT 1 FROM email_suppressions WHERE email=?');
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
    if (isSuppressed.get(email) || ['suppressed', 'unsubscribed'].includes(String(stored.status))) {
      update.run('suppressed', stored.invite_sent_at || null, stored.message_id || null, 'Recipient has opted out of survey emails.', now, id);
      outcomes.push({ id, email, status: 'failed', error: 'Recipient has opted out of survey emails.' });
      continue;
    }
    if (['sent', 'responded'].includes(String(stored.status))) {
      outcomes.push({ id, email, status: 'sent', surveyUrl: content.surveyUrl });
      continue;
    }
    const firstAttemptAt = stored.first_attempt_at ? Date.parse(String(stored.first_attempt_at)) : Date.now();
    if (stored.first_attempt_at && (!Number.isFinite(firstAttemptAt) || Date.now() - firstAttemptAt >= config.brevoIdempotencyTtlMinutes * 60_000)) {
      const error = 'The previous invitation delivery state is unknown outside the provider idempotency window; it was not resent.';
      update.run('failed', stored.invite_sent_at || null, stored.message_id || null, error, now, id);
      outcomes.push({ id, email, status: 'failed', error });
      continue;
    }
    db.prepare("UPDATE recipients SET status='sending',first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=?").run(now, now, id);
    try {
      const result = await sendBrevoEmail({
        to: email,
        name: recipient.name,
        subject: `Your feedback: ${survey.title}`,
        html: content.html,
        text: content.text,
        headers: { idempotencyKey: id, 'X-Mailin-custom': `collector_recipient:${id}` }
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
  return db.prepare(`SELECT id,name,email,status,invite_sent_at inviteSentAt,reminder_sent_at reminderSentAt,responded_at respondedAt,message_id messageId,error,created_at createdAt FROM recipients WHERE collector_id=? ORDER BY created_at DESC`).all(collectorId);
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
  const row = token ? db.prepare('SELECT id,email,status FROM recipients WHERE token=?').get(token) as any : null;
  if (!row) return null;
  const now = new Date().toISOString();
  db.prepare("UPDATE recipients SET status='unsubscribed',updated_at=? WHERE id=? AND status<>'responded'").run(now, row.id);
  return { email: String(row.email).trim().toLowerCase(), maskedEmail: maskRecipientEmail(String(row.email)) };
}
