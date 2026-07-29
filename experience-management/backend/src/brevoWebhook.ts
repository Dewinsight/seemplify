import crypto from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { reconcileCampaignCompletion } from './campaigns.js';
import { config } from './config.js';
import { db } from './database.js';
import { publishEvent } from './events.js';

const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_NAMES = [
  'request', 'sent', 'delivered', 'opened', 'unique_opened', 'uniqueOpened', 'proxy_open', 'unique_proxy_open',
  'click', 'deferred', 'soft_bounce', 'softBounce', 'hard_bounce', 'hardBounce', 'spam', 'invalid',
  'invalid_email', 'blocked', 'error', 'unsubscribed'
] as const;

const webhookEventSchema = z.object({
  event: z.enum(EVENT_NAMES),
  email: z.string().email().max(320),
  id: z.union([z.string().max(100), z.number().finite()]).optional(),
  'message-id': z.string().min(1).max(500).optional(),
  messageId: z.string().min(1).max(500).optional(),
  'X-Mailin-custom': z.string().max(1000).optional(),
  'x-mailin-custom': z.string().max(1000).optional(),
  ts_event: z.number().int().min(0).max(10_000_000_000_000).optional(),
  ts_epoch: z.number().int().min(0).max(10_000_000_000_000).optional(),
  ts: z.number().int().min(0).max(10_000_000_000_000).optional(),
  date: z.string().min(1).max(100).optional()
}).refine((event) => Boolean(event['X-Mailin-custom'] || event['x-mailin-custom'] || event['message-id'] || event.messageId), {
  message: 'A delivery correlation value is required.'
}).refine((event) => event.ts_event !== undefined || event.ts_epoch !== undefined || event.ts !== undefined || Boolean(event.date), {
  message: 'An event timestamp is required.'
});

export type BrevoWebhookEvent = z.infer<typeof webhookEventSchema>;

export function readBrevoWebhookSecret() {
  try {
    const secret = fs.readFileSync(config.brevoWebhookSecretFile, 'utf8').trim();
    return secret.length >= 32 && secret.length <= 512 ? secret : null;
  } catch { return null; }
}

export function authenticateBrevoWebhook(authorization: string | undefined) {
  const secret = readBrevoWebhookSecret();
  if (!secret) return { configured: false, authorized: false };
  const match = String(authorization || '').match(/^Bearer\s+(.{1,512})$/i); const supplied = match?.[1] || '';
  const left = Buffer.from(secret); const right = Buffer.from(supplied);
  return { configured: true, authorized: left.length === right.length && crypto.timingSafeEqual(left, right) };
}

export function parseBrevoWebhookPayload(payload: unknown): BrevoWebhookEvent[] {
  let items: unknown;
  if (Array.isArray(payload)) items = payload;
  else if (payload && typeof payload === 'object' && Array.isArray((payload as any).events)) items = (payload as any).events;
  else if (payload && typeof payload === 'object' && Array.isArray((payload as any).items)) items = (payload as any).items;
  else items = [payload];
  return z.array(webhookEventSchema).min(1).max(500).parse(items);
}

function normalizedEventName(value: string) {
  const key = value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
  if (key === 'request' || key === 'sent') return 'sent';
  if (['opened', 'unique_opened', 'proxy_open', 'unique_proxy_open'].includes(key)) return 'opened';
  if (key === 'click') return 'clicked';
  if (key === 'soft_bounce') return 'soft_bounce';
  if (key === 'hard_bounce') return 'hard_bounce';
  if (key === 'spam') return 'complaint';
  if (key === 'invalid' || key === 'invalid_email') return 'invalid';
  return key;
}

function eventTimestamp(event: BrevoWebhookEvent) {
  let milliseconds: number | null = null;
  if (event.ts_event !== undefined) milliseconds = event.ts_event > 100_000_000_000 ? event.ts_event : event.ts_event * 1000;
  else if (event.ts_epoch !== undefined) milliseconds = event.ts_epoch > 100_000_000_000 ? event.ts_epoch : event.ts_epoch * 1000;
  else if (event.ts !== undefined) milliseconds = event.ts > 100_000_000_000 ? event.ts : event.ts * 1000;
  else if (event.date) milliseconds = Date.parse(event.date.replace(' ', 'T'));
  if (milliseconds === null || !Number.isFinite(milliseconds)) throw new Error('Invalid Brevo webhook timestamp.');
  const date = new Date(milliseconds);
  if (date.getUTCFullYear() < 2000 || date.getTime() > Date.now() + 7 * 24 * 60 * 60_000) throw new Error('Brevo webhook timestamp is outside the accepted range.');
  return date.toISOString();
}

function correlation(event: BrevoWebhookEvent) {
  const custom = event['X-Mailin-custom'] || event['x-mailin-custom'] || '';
  const deliveryId = custom.match(/(?:^|[\s,;|])campaign_delivery:([0-9a-f-]{36})(?:$|[\s,;|])/i)?.[1] || '';
  return { deliveryId: DELIVERY_ID.test(deliveryId) ? deliveryId : '', messageId: String(event['message-id'] || event.messageId || '').trim() };
}

function findDelivery(event: BrevoWebhookEvent) {
  const identifier = correlation(event); let row: any = null;
  if (identifier.deliveryId) {
    row = db.prepare(`SELECT d.*,r.email contact_email FROM campaign_deliveries d
      JOIN campaign_contacts r ON r.id=d.contact_id WHERE d.id=?`).get(identifier.deliveryId);
  }
  if (!row && identifier.messageId) {
    const normalized = identifier.messageId.replace(/^<|>$/g, '');
    row = db.prepare(`SELECT d.*,r.email contact_email FROM campaign_deliveries d JOIN campaign_contacts r ON r.id=d.contact_id
      WHERE d.provider_message_id=? OR REPLACE(REPLACE(d.provider_message_id,'<',''),'>','')=? ORDER BY d.sent_at DESC LIMIT 1`)
      .get(identifier.messageId, normalized);
  }
  if (!row || String(row.contact_email).trim().toLowerCase() !== event.email.trim().toLowerCase()) return null;
  return row;
}

const statusTimestampColumn: Record<string, string | undefined> = {
  delivered: 'delivered_at', opened: 'opened_at', clicked: 'clicked_at', soft_bounce: 'bounced_at',
  hard_bounce: 'bounced_at', invalid: 'bounced_at', blocked: 'bounced_at', complaint: 'complained_at',
  unsubscribed: 'unsubscribed_at'
};
const globallySuppressive = new Set(['hard_bounce', 'complaint', 'invalid', 'blocked', 'unsubscribed']);

const persistEvents = db.transaction((events: BrevoWebhookEvent[]) => {
  const affectedCampaigns = new Map<string, Set<string>>(); let accepted = 0; let replayed = 0; let ignored = 0;
  const now = new Date().toISOString();
  for (const event of events) {
    const delivery = findDelivery(event); if (!delivery) { ignored += 1; continue; }
    const status = normalizedEventName(event.event); const eventAt = eventTimestamp(event);
    const providerMessageId = String(event['message-id'] || event.messageId || '').trim();
    const eventId = crypto.createHash('sha256').update(JSON.stringify([
      delivery.id, status, eventAt, providerMessageId, String(event.id ?? '')
    ])).digest('hex');
    const inserted = db.prepare(`INSERT OR IGNORE INTO campaign_delivery_events
      (id,delivery_id,provider_event_id,provider_message_id,event_type,event_at,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(eventId, delivery.id, String(event.id ?? ''), providerMessageId, status, eventAt, now).changes;
    if (!inserted) { replayed += 1; continue; }
    accepted += 1;
    const timestampColumn = statusTimestampColumn[status];
    if (timestampColumn) {
      db.prepare(`UPDATE campaign_deliveries SET
        provider_status=CASE WHEN provider_updated_at IS NULL OR provider_updated_at<=? THEN ? ELSE provider_status END,
        provider_updated_at=CASE WHEN provider_updated_at IS NULL OR provider_updated_at<=? THEN ? ELSE provider_updated_at END,
        ${timestampColumn}=COALESCE(${timestampColumn},?) WHERE id=?`).run(eventAt, status, eventAt, eventAt, eventAt, delivery.id);
    } else {
      db.prepare(`UPDATE campaign_deliveries SET
        provider_status=CASE WHEN provider_updated_at IS NULL OR provider_updated_at<=? THEN ? ELSE provider_status END,
        provider_updated_at=CASE WHEN provider_updated_at IS NULL OR provider_updated_at<=? THEN ? ELSE provider_updated_at END WHERE id=?`)
        .run(eventAt, status, eventAt, eventAt, delivery.id);
    }
    const campaignEvents = affectedCampaigns.get(String(delivery.campaign_id)) || new Set<string>();
    campaignEvents.add(status); affectedCampaigns.set(String(delivery.campaign_id), campaignEvents);

    if (globallySuppressive.has(status)) {
      const email = String(delivery.contact_email).trim().toLowerCase();
      const contactStatus = status === 'unsubscribed' ? 'unsubscribed' : 'suppressed';
      const reason = `Brevo ${status.replace(/_/g, ' ')}`;
      db.prepare(`INSERT INTO email_suppressions (email,reason,source,created_at,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET reason=excluded.reason,source=excluded.source,updated_at=excluded.updated_at`)
        .run(email, reason, `brevo_webhook:${status}`, now, now);
      const contacts = db.prepare('SELECT id,campaign_id FROM campaign_contacts WHERE email=?').all(email) as any[];
      db.prepare("UPDATE campaign_contacts SET status=?,updated_at=? WHERE email=? AND status NOT IN ('responded','completed','unsubscribed')")
        .run(contactStatus, now, email);
      db.prepare("UPDATE recipients SET status=?,error=COALESCE(error,?),updated_at=? WHERE email=? AND status<>'responded'")
        .run(contactStatus, reason, now, email);
      const contactIds = contacts.map((contact) => String(contact.id));
      if (contactIds.length) {
        const placeholders = contactIds.map(() => '?').join(',');
        db.prepare(`UPDATE campaign_deliveries SET state='skipped',error=?,updated_at=? WHERE contact_id IN (${placeholders}) AND state='queued'`)
          .run(reason, now, ...contactIds);
      }
      for (const contact of contacts) {
        const relatedEvents = affectedCampaigns.get(String(contact.campaign_id)) || new Set<string>();
        relatedEvents.add(status); affectedCampaigns.set(String(contact.campaign_id), relatedEvents);
      }
    } else if (status === 'error') {
      db.prepare("UPDATE campaign_contacts SET status='failed',updated_at=? WHERE id=? AND status='active'").run(now, delivery.contact_id);
      db.prepare("UPDATE campaign_deliveries SET state='skipped',error='Brevo delivery error',updated_at=? WHERE contact_id=? AND state='queued'")
        .run(now, delivery.contact_id);
    }
  }
  return { accepted, replayed, ignored, affectedCampaigns: [...affectedCampaigns].map(([campaignId, statuses]) => ({ campaignId, statuses: [...statuses] })) };
});

export function processBrevoWebhookEvents(events: BrevoWebhookEvent[]) {
  const result = persistEvents(events);
  for (const campaign of result.affectedCampaigns) {
    publishEvent('campaign', { campaignId: campaign.campaignId, reason: 'provider-status-updated', statuses: campaign.statuses });
    reconcileCampaignCompletion(campaign.campaignId);
  }
  if (result.accepted) publishEvent('data-changed', { reason: 'campaign-provider-events', count: result.accepted });
  return result;
}
