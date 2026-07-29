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
    source: config.brevoApiKey ? 'seemplify-shared-environment' : 'not-configured'
  };
}

async function sendBrevoEmail(input: { to: string; name?: string; subject: string; html: string; text: string }) {
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
      textContent: input.text
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload.message || `Brevo returned HTTP ${response.status}`);
  return { ...payload, mode: 'brevo' };
}

function inviteContent(survey: Survey, collector: Collector, recipient: { name?: string; token: string }, message?: string) {
  const surveyUrl = `${collector.publicUrl}?recipient=${encodeURIComponent(recipient.token)}`;
  const greeting = recipient.name ? `Hello ${escapeHtml(recipient.name)},` : 'Hello,';
  const custom = escapeHtml(message || `We would value your feedback in “${survey.title}”.`);
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto">
    <h2 style="font-size:22px;margin:0 0 18px">${escapeHtml(survey.title)}</h2>
    <p>${greeting}</p><p>${custom}</p>
    <p><a href="${escapeHtml(surveyUrl)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">Share feedback</a></p>
    <p style="font-size:13px;color:#6b706c">If the button does not open, use this link:<br>${escapeHtml(surveyUrl)}</p>
  </div>`;
  return { surveyUrl, html, text: `${recipient.name ? `Hello ${recipient.name}, ` : ''}${message || `We would value your feedback in “${survey.title}”.`} ${surveyUrl}` };
}

export async function sendInvitations(survey: Survey, collector: Collector, recipients: { email: string; name?: string }[], message?: string) {
  const insert = db.prepare(`INSERT INTO recipients (id,collector_id,name,email,token,status,created_at) VALUES (?,?,?,?,?,'pending',?)`);
  const update = db.prepare(`UPDATE recipients SET status=?,invite_sent_at=?,message_id=?,error=? WHERE id=?`);
  const outcomes = [];
  for (const recipient of recipients) {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(18).toString('base64url');
    insert.run(id, collector.id, recipient.name || '', recipient.email.trim().toLowerCase(), token, new Date().toISOString());
    const content = inviteContent(survey, collector, { ...recipient, token }, message);
    try {
      const result = await sendBrevoEmail({
        to: recipient.email,
        name: recipient.name,
        subject: `Your feedback: ${survey.title}`,
        html: content.html,
        text: content.text
      });
      update.run('sent', new Date().toISOString(), (result as any).messageId || '', null, id);
      outcomes.push({ id, email: recipient.email, status: 'sent', surveyUrl: content.surveyUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      update.run('failed', null, null, message.slice(0, 500), id);
      outcomes.push({ id, email: recipient.email, status: 'failed', error: message });
    }
  }
  return outcomes;
}

export function listRecipients(collectorId: string) {
  return db.prepare(`SELECT id,name,email,status,invite_sent_at inviteSentAt,reminder_sent_at reminderSentAt,responded_at respondedAt,message_id messageId,error,created_at createdAt FROM recipients WHERE collector_id=? ORDER BY created_at DESC`).all(collectorId);
}
