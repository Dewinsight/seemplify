import crypto from 'node:crypto';
import { config } from './config.js';
import { createCollector, db, getCollector, getSurvey } from './database.js';
import { sendCampaignEmail } from './emailService.js';
import { publishEvent } from './events.js';
import type {
  Campaign, CampaignContact, CampaignDelivery, CampaignStep, Collector, Question, Survey
} from './types.js';

type CampaignTemplate = {
  id: string;
  name: string;
  description: string;
  steps: Array<Pick<CampaignStep, 'delayMinutes' | 'subject' | 'mode' | 'bodyText' | 'bodyHtml' | 'embedQuestionId'>>;
};

const EMBEDDABLE_QUESTION_TYPES = new Set(['single_choice', 'nps', 'csat', 'ces', 'rating', 'graphical_rating']);

export const campaignTemplates: CampaignTemplate[] = [
  {
    id: 'simple-survey-invitation',
    name: 'Simple survey invitation',
    description: 'A concise plain-text invitation with one polite reminder.',
    steps: [
      { delayMinutes: 0, subject: 'We would value your feedback', mode: 'plain', bodyText: 'Hello {{first_name}},\n\nWe would value your feedback in “{{survey_title}}”. It should only take a few minutes.\n\n{{survey_link}}', bodyHtml: '', embedQuestionId: null },
      { delayMinutes: 2880, subject: 'A quick reminder: {{survey_title}}', mode: 'plain', bodyText: 'Hello {{first_name}},\n\nThis is a quick reminder in case you have not yet shared your feedback.\n\n{{survey_link}}', bodyHtml: '', embedQuestionId: null }
    ]
  },
  {
    id: 'customer-experience-check-in',
    name: 'Customer experience check-in',
    description: 'A friendly three-touch sequence for customer feedback.',
    steps: [
      { delayMinutes: 0, subject: 'How was your experience with {{company}}?', mode: 'plain', bodyText: 'Hello {{first_name}},\n\nYour experience matters to us. Please share a little feedback in {{survey_title}}.\n\n{{survey_link}}', bodyHtml: '', embedQuestionId: null },
      { delayMinutes: 1440, subject: 'Could you share a minute of feedback?', mode: 'plain', bodyText: 'Hello {{first_name}},\n\nWe are still keen to hear what worked and what could be better.\n\n{{survey_link}}', bodyHtml: '', embedQuestionId: null },
      { delayMinutes: 4320, subject: 'Last call for feedback', mode: 'plain', bodyText: 'Hello {{first_name}},\n\nThis is our final reminder for {{survey_title}}. Thank you for helping us improve.\n\n{{survey_link}}', bodyHtml: '', embedQuestionId: null }
    ]
  },
  {
    id: 'single-message-html',
    name: 'Branded single message',
    description: 'A restrained HTML invitation for teams that need light formatting.',
    steps: [{
      delayMinutes: 0,
      subject: 'An invitation to share your feedback',
      mode: 'html',
      bodyText: 'Hello {{first_name}},\n\nPlease take part in {{survey_title}}: {{survey_link}}',
      bodyHtml: '<h2>Your feedback matters</h2><p>Hello {{first_name}},</p><p>Please take part in <strong>{{survey_title}}</strong>.</p><p><a href="{{survey_link}}">Open the survey</a></p>',
      embedQuestionId: null
    }]
  }
];

const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
};

const rowCampaign = (row: any): Campaign => ({
  id: row.id, surveyId: row.survey_id, collectorId: row.collector_id, name: row.name,
  status: row.status === 'running' ? 'active' : row.status, stopOnResponse: Boolean(row.stop_on_response), startAt: row.start_at,
  startsAt: row.start_at, settings: { stopOnResponse: Boolean(row.stop_on_response) },
  createdAt: row.created_at, updatedAt: row.updated_at, launchedAt: row.launched_at,
  pausedAt: row.paused_at, completedAt: row.completed_at
});

const rowStep = (row: any): CampaignStep => ({
  id: row.id, campaignId: row.campaign_id, position: Number(row.position), delayMinutes: Number(row.delay_minutes),
  subject: row.subject, mode: row.content_mode, bodyText: row.body_text, bodyHtml: row.body_html,
  embedQuestionId: row.embed_question_id, createdAt: row.created_at, updatedAt: row.updated_at
});

const rowContact = (row: any): CampaignContact => ({
  id: row.id, campaignId: row.campaign_id, email: row.email, firstName: row.first_name,
  lastName: row.last_name, company: row.company, token: row.token, status: row.status,
  customData: parseJson(row.custom_json, {}), currentStep: Number(row.current_step), lastSentAt: row.last_sent_at,
  respondedAt: row.responded_at, createdAt: row.created_at, updatedAt: row.updated_at,
  recipientId: row.id, nextSendAt: row.next_send_at || null
});

const rowDelivery = (row: any): CampaignDelivery => ({
  id: row.id, campaignId: row.campaign_id, stepId: row.step_id, contactId: row.contact_id,
  stepPosition: Number(row.step_position), state: row.state, scheduledAt: row.scheduled_at,
  attempt: Number(row.attempt), maxAttempts: Number(row.max_attempts), providerMessageId: row.provider_message_id,
  providerStatus: row.provider_status, deliveredAt: row.delivered_at, openedAt: row.opened_at,
  clickedAt: row.clicked_at, bouncedAt: row.bounced_at, complainedAt: row.complained_at,
  unsubscribedAt: row.unsubscribed_at, providerUpdatedAt: row.provider_updated_at,
  firstAttemptAt: row.first_attempt_at, error: row.error, sentAt: row.sent_at, createdAt: row.created_at, updatedAt: row.updated_at,
  messageId: row.provider_message_id
});

function requireCampaign(id: string) {
  const row = db.prepare('SELECT * FROM campaigns WHERE id=?').get(id) as any;
  if (!row) throw new Error('Campaign not found.');
  return rowCampaign(row);
}

function campaignMetrics(campaignId: string) {
  const contacts = db.prepare(`SELECT status,COUNT(*) count FROM campaign_contacts WHERE campaign_id=? GROUP BY status`).all(campaignId) as any[];
  const deliveries = db.prepare(`SELECT state,COUNT(*) count FROM campaign_deliveries WHERE campaign_id=? GROUP BY state`).all(campaignId) as any[];
  const contactCounts = Object.fromEntries(contacts.map((item) => [item.status, Number(item.count)]));
  const deliveryCounts = Object.fromEntries(deliveries.map((item) => [item.state, Number(item.count)]));
  const totalContacts = Object.values(contactCounts).reduce((sum: number, count) => sum + Number(count), 0);
  const totalDeliveries = Object.values(deliveryCounts).reduce((sum: number, count) => sum + Number(count), 0);
  const responded = Number((db.prepare('SELECT COUNT(*) count FROM campaign_contacts WHERE campaign_id=? AND responded_at IS NOT NULL').get(campaignId) as any).count);
  const last = db.prepare(`SELECT MAX(COALESCE(sent_at,updated_at)) last_activity FROM campaign_deliveries WHERE campaign_id=?`).get(campaignId) as any;
  return {
    totalContacts, activeContacts: contactCounts.active || 0, respondedContacts: responded,
    completedContacts: contactCounts.completed || 0, failedContacts: contactCounts.failed || 0,
    suppressedContacts: (contactCounts.suppressed || 0) + (contactCounts.unsubscribed || 0),
    unsubscribedContacts: contactCounts.unsubscribed || 0, totalDeliveries, queuedDeliveries: deliveryCounts.queued || 0,
    sendingDeliveries: deliveryCounts.sending || 0, sentDeliveries: deliveryCounts.sent || 0,
    failedDeliveries: deliveryCounts.failed || 0, skippedDeliveries: deliveryCounts.skipped || 0,
    responseRate: totalContacts ? Math.round((responded / totalContacts) * 1000) / 10 : 0,
    lastActivityAt: last?.last_activity || null,
    contacts: totalContacts, queued: deliveryCounts.queued || 0, sent: deliveryCounts.sent || 0,
    failed: deliveryCounts.failed || 0, skipped: deliveryCounts.skipped || 0,
    responded, completed: contactCounts.completed || 0
  };
}

export function getCampaignDetail(id: string) {
  const campaign = requireCampaign(id);
  return {
    campaign,
    survey: getSurvey(campaign.surveyId),
    collector: getCollector(campaign.collectorId),
    steps: (db.prepare('SELECT * FROM campaign_steps WHERE campaign_id=? ORDER BY position').all(id) as any[]).map(rowStep),
    contacts: (db.prepare(`SELECT r.*,(SELECT MIN(d.scheduled_at) FROM campaign_deliveries d WHERE d.contact_id=r.id AND d.state='queued') next_send_at
      FROM campaign_contacts r WHERE r.campaign_id=? ORDER BY r.created_at DESC LIMIT 1000`).all(id) as any[]).map(rowContact),
    deliveries: (db.prepare('SELECT * FROM campaign_deliveries WHERE campaign_id=? ORDER BY created_at DESC LIMIT 1000').all(id) as any[]).map(rowDelivery),
    metrics: campaignMetrics(id)
  };
}

export function listCampaignSummaries() {
  return (db.prepare('SELECT * FROM campaigns ORDER BY updated_at DESC').all() as any[]).map((row) => {
    const campaign = rowCampaign(row);
    const survey = getSurvey(campaign.surveyId);
    const metrics = campaignMetrics(campaign.id);
    return {
      ...campaign, surveyTitle: survey?.title || 'Deleted survey', metrics,
      contactCount: metrics.contacts, sentCount: metrics.sent, failedCount: metrics.failed,
      respondedCount: metrics.responded, queuedCount: metrics.queued
    };
  });
}

function resolveEmailCollector(surveyId: string, collectorId?: string) {
  if (collectorId) {
    const collector = getCollector(collectorId);
    if (!collector || collector.surveyId !== surveyId) throw new Error('Collector does not belong to this survey.');
    if (collector.type !== 'email' || collector.status !== 'open') throw new Error('Campaigns require an open email collector.');
    return collector;
  }
  const existing = db.prepare("SELECT id FROM collectors WHERE survey_id=? AND type='email' AND status='open' ORDER BY created_at LIMIT 1").get(surveyId) as any;
  return existing ? getCollector(existing.id)! : createCollector(surveyId, { name: 'Email campaign', type: 'email' });
}

export function createCampaign(input: { name: string; surveyId: string; collectorId?: string; stopOnResponse?: boolean; startAt?: string | null; templateId?: string }) {
  if (!getSurvey(input.surveyId)) throw new Error('Survey not found.');
  const collector = resolveEmailCollector(input.surveyId, input.collectorId);
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO campaigns (id,survey_id,collector_id,name,status,stop_on_response,start_at,created_at,updated_at)
    VALUES (?,?,?,?,'draft',?,?,?,?)`).run(id, input.surveyId, collector.id, input.name.trim(), input.stopOnResponse === false ? 0 : 1, input.startAt || null, now, now);
  const template = campaignTemplates.find((item) => item.id === input.templateId) || campaignTemplates[0];
  replaceCampaignSteps(id, template.steps);
  publishEvent('campaign', { campaignId: id, reason: 'created' });
  return getCampaignDetail(id);
}

export function updateCampaign(id: string, input: { name?: string; stopOnResponse?: boolean; startAt?: string | null; surveyId?: string; collectorId?: string }) {
  const current = requireCampaign(id);
  if (current.status === 'completed') throw new Error('Completed campaigns cannot be edited.');
  if (current.launchedAt && input.startAt !== undefined && input.startAt !== current.startAt) throw new Error('The start time cannot be changed after launch.');
  let surveyId = current.surveyId; let collectorId = current.collectorId;
  if (input.surveyId && input.surveyId !== current.surveyId) {
    if (current.status !== 'draft') throw new Error('The survey can only be changed while the campaign is a draft.');
    if (!getSurvey(input.surveyId)) throw new Error('Survey not found.');
    surveyId = input.surveyId;
    collectorId = resolveEmailCollector(surveyId, input.collectorId).id;
  } else if (input.collectorId && input.collectorId !== current.collectorId) {
    if (current.status !== 'draft') throw new Error('The collector can only be changed while the campaign is a draft.');
    collectorId = resolveEmailCollector(surveyId, input.collectorId).id;
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE campaigns SET survey_id=?,collector_id=?,name=?,stop_on_response=?,start_at=?,updated_at=? WHERE id=?`).run(
    surveyId, collectorId, input.name?.trim() || current.name, input.stopOnResponse === undefined ? (current.stopOnResponse ? 1 : 0) : (input.stopOnResponse ? 1 : 0),
    input.startAt === undefined ? current.startAt : input.startAt, now, id
  );
  publishEvent('campaign', { campaignId: id, reason: 'updated' });
  return getCampaignDetail(id);
}

export const replaceCampaignSteps = db.transaction((campaignId: string, steps: Array<Partial<CampaignStep> & { delayMinutes: number; subject: string; mode: 'plain' | 'html'; bodyText: string }>) => {
  const campaign = requireCampaign(campaignId);
  if (campaign.status !== 'draft' || campaign.launchedAt) throw new Error('Sequence steps can only be replaced before launch.');
  const survey = getSurvey(campaign.surveyId)!;
  const questions = new Map((survey.questions || []).map((question) => [question.id, question]));
  for (const step of steps) {
    if (!step.embedQuestionId) continue;
    const question = questions.get(step.embedQuestionId);
    if (!question) throw new Error('Embedded question does not belong to this survey.');
    if (question.page !== 1 || !EMBEDDABLE_QUESTION_TYPES.has(question.type) || !compatibleOptions(question).length) {
      throw new Error('Only supported choice or rating questions on the first survey page can be embedded in an email.');
    }
  }
  db.prepare('DELETE FROM campaign_steps WHERE campaign_id=?').run(campaignId);
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO campaign_steps (id,campaign_id,position,delay_minutes,subject,content_mode,body_text,body_html,embed_question_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  steps.forEach((step, position) => insert.run(
    step.id || crypto.randomUUID(), campaignId, position, Math.max(0, Math.floor(step.delayMinutes)), step.subject.trim(), step.mode,
    step.bodyText || '', step.bodyHtml || '', step.embedQuestionId || null, now, now
  ));
  db.prepare('UPDATE campaigns SET updated_at=? WHERE id=?').run(now, campaignId);
  publishEvent('campaign', { campaignId, reason: 'sequence-updated' });
  return getCampaignDetail(campaignId);
});

export const addCampaignContacts = db.transaction((campaignId: string, contacts: Array<{ email: string; firstName?: string; lastName?: string; company?: string; customData?: Record<string, unknown> }>) => {
  const campaign = requireCampaign(campaignId);
  if (campaign.status === 'active' || campaign.status === 'completed') throw new Error('Pause the campaign before adding contacts.');
  const now = new Date().toISOString(); let added = 0; let duplicates = 0; let suppressed = 0;
  const isSuppressed = db.prepare('SELECT 1 FROM email_suppressions WHERE email=?');
  const insert = db.prepare(`INSERT OR IGNORE INTO campaign_contacts (id,campaign_id,email,first_name,last_name,company,token,status,custom_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'active',?,?,?)`);
  for (const item of contacts) {
    const email = item.email.trim().toLowerCase();
    if (isSuppressed.get(email)) { suppressed += 1; continue; }
    const result = insert.run(crypto.randomUUID(), campaignId, email, item.firstName || '', item.lastName || '', item.company || '', crypto.randomBytes(18).toString('base64url'), JSON.stringify(item.customData || {}), now, now);
    if (result.changes) added += 1; else duplicates += 1;
  }
  db.prepare('UPDATE campaigns SET updated_at=? WHERE id=?').run(now, campaignId);
  if (campaign.launchedAt) ensureInitialDeliveries(campaignId);
  publishEvent('campaign', { campaignId, reason: 'contacts-imported', added, duplicates, suppressed });
  return {
    contacts: (db.prepare(`SELECT r.*,(SELECT MIN(d.scheduled_at) FROM campaign_deliveries d WHERE d.contact_id=r.id AND d.state='queued') next_send_at
      FROM campaign_contacts r WHERE r.campaign_id=? ORDER BY r.created_at DESC LIMIT 1000`).all(campaignId) as any[]).map(rowContact),
    summary: { received: contacts.length, added, duplicates, suppressed, imported: added, skipped: duplicates + suppressed }
  };
});

export function suppressCampaignContact(campaignId: string, contactId: string) {
  requireCampaign(campaignId); const now = new Date().toISOString();
  const changed = db.prepare("UPDATE campaign_contacts SET status='suppressed',updated_at=? WHERE id=? AND campaign_id=? AND status NOT IN ('responded','completed','unsubscribed')").run(now, contactId, campaignId).changes;
  if (!changed) return false;
  db.prepare("UPDATE campaign_deliveries SET state='skipped',error='Contact removed',updated_at=? WHERE contact_id=? AND state='queued'").run(now, contactId);
  publishEvent('campaign', { campaignId, reason: 'contact-suppressed', contactId });
  refreshCampaignCompletion(campaignId);
  return true;
}

const applyGlobalEmailSuppression = db.transaction((input: { email: string; reason: string; source: string; contactStatus: 'suppressed' | 'unsubscribed' }) => {
  const now = new Date().toISOString(); const email = input.email.trim().toLowerCase();
  db.prepare(`INSERT INTO email_suppressions (email,reason,source,created_at,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET reason=excluded.reason,source=excluded.source,updated_at=excluded.updated_at`)
    .run(email, input.reason.slice(0, 250), input.source.slice(0, 100), now, now);
  const contacts = db.prepare('SELECT id,campaign_id FROM campaign_contacts WHERE email=?').all(email) as any[];
  const contactIds = contacts.map((contact) => String(contact.id));
  db.prepare("UPDATE campaign_contacts SET status=?,updated_at=? WHERE email=? AND status NOT IN ('responded','completed','unsubscribed')")
    .run(input.contactStatus, now, email);
  db.prepare("UPDATE recipients SET status=?,error=COALESCE(error,?),updated_at=? WHERE email=? AND status<>'responded'")
    .run(input.contactStatus, input.reason.slice(0, 500), now, email);
  if (contactIds.length) {
    const placeholders = contactIds.map(() => '?').join(',');
    db.prepare(`UPDATE campaign_deliveries SET state='skipped',error=?,updated_at=?
      WHERE contact_id IN (${placeholders}) AND state='queued'`).run(input.reason.slice(0, 1000), now, ...contactIds);
  }
  return { email, campaignIds: [...new Set(contacts.map((contact) => String(contact.campaign_id)))] };
});

export function suppressEmailGlobally(input: { email: string; reason: string; source: string; contactStatus?: 'suppressed' | 'unsubscribed' }) {
  const result = applyGlobalEmailSuppression({ ...input, contactStatus: input.contactStatus || 'suppressed' });
  for (const campaignId of result.campaignIds) {
    publishEvent('campaign', { campaignId, reason: 'email-suppressed', source: input.source });
    refreshCampaignCompletion(campaignId);
  }
  return result;
}

function maskedEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${local.length > 1 ? '***' : ''}@${domain}`;
}

export function getCampaignUnsubscribePreview(token: string) {
  if (!token) return null;
  const row = db.prepare(`SELECT r.email,r.status,c.name campaign_name,s.title survey_title
    FROM campaign_contacts r JOIN campaigns c ON c.id=r.campaign_id JOIN surveys s ON s.id=c.survey_id
    WHERE r.token=?`).get(token) as any;
  return row ? {
    email: maskedEmail(String(row.email)), campaignName: String(row.campaign_name), surveyTitle: String(row.survey_title),
    alreadyUnsubscribed: row.status === 'unsubscribed'
  } : null;
}

function unsubscribeEmail(token: string) {
  const row = db.prepare('SELECT id,campaign_id,email,status FROM campaign_contacts WHERE token=?').get(token) as any;
  if (!row) return null;
  const result = suppressEmailGlobally({ email: String(row.email), reason: 'Recipient unsubscribed', source: 'campaign', contactStatus: 'unsubscribed' });
  return { email: maskedEmail(result.email), campaignIds: result.campaignIds };
}

export function unsubscribeCampaignContact(token: string) {
  if (!token) return null;
  const result = unsubscribeEmail(token);
  if (!result) return null;
  return { email: result.email };
}

function ensureInitialDeliveries(campaignId: string) {
  const campaign = requireCampaign(campaignId);
  const first = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id=? ORDER BY position LIMIT 1').get(campaignId) as any;
  if (!first) return;
  const base = Math.max(Date.now(), campaign.startAt ? Date.parse(campaign.startAt) : 0);
  const scheduledAt = new Date(base + Number(first.delay_minutes) * 60_000).toISOString(); const now = new Date().toISOString();
  const insert = db.prepare(`INSERT OR IGNORE INTO campaign_deliveries (id,campaign_id,step_id,contact_id,step_position,state,scheduled_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'queued',?,?,?)`);
  const contacts = db.prepare(`SELECT r.id FROM campaign_contacts r WHERE r.campaign_id=? AND r.status='active'
    AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email=r.email)`).all(campaignId) as any[];
  for (const contact of contacts) insert.run(crypto.randomUUID(), campaignId, first.id, contact.id, Number(first.position), scheduledAt, now, now);
}

export function launchCampaign(id: string) {
  const campaign = requireCampaign(id); const survey = getSurvey(campaign.surveyId); const collector = getCollector(campaign.collectorId);
  if (!survey || survey.status !== 'live') throw new Error('Publish the survey before launching its campaign.');
  if (!collector || collector.type !== 'email' || collector.status !== 'open') throw new Error('An open email collector is required.');
  const steps = Number((db.prepare('SELECT COUNT(*) count FROM campaign_steps WHERE campaign_id=?').get(id) as any).count);
  const contacts = Number((db.prepare(`SELECT COUNT(*) count FROM campaign_contacts r WHERE campaign_id=? AND status='active'
    AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email=r.email)`).get(id) as any).count);
  if (!steps) throw new Error('Add at least one sequence step before launch.');
  if (!contacts) throw new Error('Add at least one active contact before launch.');
  const now = new Date().toISOString();
  db.prepare("UPDATE campaigns SET status='active',launched_at=COALESCE(launched_at,?),paused_at=NULL,completed_at=NULL,updated_at=? WHERE id=?").run(now, now, id);
  ensureInitialDeliveries(id); publishEvent('campaign', { campaignId: id, reason: 'launched' }); refreshCampaignCompletion(id); void campaignRunner.pump();
  return getCampaignDetail(id);
}

export function pauseCampaign(id: string) {
  const campaign = requireCampaign(id); if (campaign.status !== 'active') throw new Error('Only an active campaign can be paused.');
  const now = new Date().toISOString(); db.prepare("UPDATE campaigns SET status='paused',paused_at=?,updated_at=? WHERE id=?").run(now, now, id);
  publishEvent('campaign', { campaignId: id, reason: 'paused' }); return getCampaignDetail(id);
}

export function resumeCampaign(id: string) {
  const campaign = requireCampaign(id); if (campaign.status !== 'paused') throw new Error('Only a paused campaign can be resumed.');
  const now = new Date().toISOString(); db.prepare("UPDATE campaigns SET status='active',paused_at=NULL,updated_at=? WHERE id=?").run(now, id);
  ensureInitialDeliveries(id); publishEvent('campaign', { campaignId: id, reason: 'resumed' }); refreshCampaignCompletion(id);
  if (requireCampaign(id).status === 'active') void campaignRunner.pump();
  return getCampaignDetail(id);
}

export function markCampaignContactResponded(token: string) {
  if (!token) return false; const now = new Date().toISOString();
  const row = db.prepare('SELECT id,campaign_id FROM campaign_contacts WHERE token=?').get(token) as any;
  if (!row) return false;
  const campaign = requireCampaign(row.campaign_id);
  if (campaign.stopOnResponse) {
    db.prepare("UPDATE campaign_contacts SET status='responded',responded_at=?,updated_at=? WHERE id=?").run(now, now, row.id);
    db.prepare("UPDATE campaign_deliveries SET state='skipped',error='Survey response received',updated_at=? WHERE contact_id=? AND state='queued'").run(now, row.id);
  } else {
    db.prepare('UPDATE campaign_contacts SET responded_at=?,updated_at=? WHERE id=?').run(now, now, row.id);
  }
  publishEvent('campaign', { campaignId: row.campaign_id, reason: 'contact-responded', contactId: row.id });
  refreshCampaignCompletion(row.campaign_id); return true;
}

function refreshCampaignCompletion(campaignId: string) {
  const campaign = requireCampaign(campaignId); if (campaign.status !== 'active') return;
  const now = new Date().toISOString();
  db.prepare(`UPDATE campaign_contacts SET status='suppressed',updated_at=? WHERE campaign_id=? AND status='active'
    AND EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email=campaign_contacts.email)`).run(now, campaignId);
  db.prepare(`UPDATE campaign_deliveries SET state='skipped',error=COALESCE(error,'Contact is no longer sendable'),updated_at=?
    WHERE campaign_id=? AND state='queued' AND EXISTS (
      SELECT 1 FROM campaign_contacts r WHERE r.id=campaign_deliveries.contact_id AND r.status<>'active'
    )`).run(now, campaignId);
  const active = Number((db.prepare("SELECT COUNT(*) count FROM campaign_contacts WHERE campaign_id=? AND status='active'").get(campaignId) as any).count);
  const pending = Number((db.prepare("SELECT COUNT(*) count FROM campaign_deliveries WHERE campaign_id=? AND state IN ('queued','sending')").get(campaignId) as any).count);
  if (active || pending) return;
  db.prepare("UPDATE campaigns SET status='completed',completed_at=?,updated_at=? WHERE id=?").run(now, now, campaignId);
  publishEvent('campaign', { campaignId, reason: 'completed' });
}

export function reconcileCampaignCompletion(campaignId: string) { refreshCampaignCompletion(campaignId); }

const claimNextDelivery = db.transaction(() => {
  const now = new Date().toISOString();
  const row = db.prepare(`SELECT d.* FROM campaign_deliveries d
    JOIN campaigns c ON c.id=d.campaign_id JOIN campaign_contacts r ON r.id=d.contact_id
    WHERE d.state='queued' AND d.scheduled_at<=? AND c.status='active' AND r.status='active'
      AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email=r.email)
    ORDER BY d.scheduled_at,d.created_at LIMIT 1`).get(now) as any;
  if (!row) return null;
  const changed = db.prepare("UPDATE campaign_deliveries SET state='sending',attempt=attempt+1,first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=? AND state='queued'").run(now, now, row.id).changes;
  return changed ? rowDelivery(db.prepare('SELECT * FROM campaign_deliveries WHERE id=?').get(row.id)) : null;
});

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function compatibleOptions(question?: Question) {
  if (!question || question.page !== 1 || !EMBEDDABLE_QUESTION_TYPES.has(question.type)) return [];
  if (question.type === 'single_choice') return (question.options || []).slice(0, 12);
  if (question.type === 'nps') return Array.from({ length: 11 }, (_, index) => String(index));
  if (question.type === 'ces') return Array.from({ length: 7 }, (_, index) => String(index + 1));
  if (['csat', 'rating', 'graphical_rating'].includes(question.type)) return Array.from({ length: 5 }, (_, index) => String(index + 1));
  return [];
}

function embeddedQuestion(question: Question | undefined, surveyUrl: string) {
  const options = compatibleOptions(question); if (!question || !options.length) return { html: '', text: '' };
  const separator = surveyUrl.includes('?') ? '&' : '?';
  const links = options.map((option) => `${surveyUrl}${separator}answerQuestion=${encodeURIComponent(question.id)}&answerValue=${encodeURIComponent(option)}`);
  const html = `<div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:18px"><p><strong>${escapeHtml(question.title)}</strong></p><div>${options.map((option, index) => `<a href="${escapeHtml(links[index])}" style="display:inline-block;margin:0 6px 8px 0;padding:8px 12px;border:1px solid #d1d5db;text-decoration:none;color:#111827">${escapeHtml(option)}</a>`).join('')}</div></div>`;
  const text = `${question.title}\n${options.map((option, index) => `${option}: ${links[index]}`).join('\n')}`;
  return { html, text };
}

const finalizeSuccessfulDelivery = db.transaction((input: { deliveryId: string; campaignId: string; contactId: string; stepPosition: number; providerMessageId: string }) => {
  const now = new Date().toISOString();
  db.prepare("UPDATE campaign_deliveries SET state='sent',provider_message_id=?,error=NULL,sent_at=?,updated_at=? WHERE id=? AND state='sending'").run(input.providerMessageId, now, now, input.deliveryId);
  const contact = db.prepare('SELECT status FROM campaign_contacts WHERE id=?').get(input.contactId) as any;
  if (!contact) return;
  db.prepare('UPDATE campaign_contacts SET current_step=?,last_sent_at=?,updated_at=? WHERE id=?').run(input.stepPosition, now, now, input.contactId);
  if (contact.status !== 'active') return;
  const nextRow = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id=? AND position>? ORDER BY position LIMIT 1').get(input.campaignId, input.stepPosition) as any;
  if (!nextRow) {
    db.prepare("UPDATE campaign_contacts SET status='completed',updated_at=? WHERE id=? AND status='active'").run(now, input.contactId);
    return;
  }
  const next = rowStep(nextRow); const scheduled = new Date(Date.now() + next.delayMinutes * 60_000).toISOString();
  db.prepare(`INSERT OR IGNORE INTO campaign_deliveries (id,campaign_id,step_id,contact_id,step_position,state,scheduled_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'queued',?,?,?)`).run(crypto.randomUUID(), input.campaignId, next.id, input.contactId, next.position, scheduled, now, now);
});

const finalizeFailedDelivery = db.transaction((input: { deliveryId: string; campaignId: string; contactId: string; error: string }) => {
  const now = new Date().toISOString();
  const delivery = db.prepare('SELECT attempt,max_attempts,first_attempt_at FROM campaign_deliveries WHERE id=?').get(input.deliveryId) as any;
  const contact = db.prepare('SELECT status FROM campaign_contacts WHERE id=?').get(input.contactId) as any;
  const campaign = db.prepare('SELECT status FROM campaigns WHERE id=?').get(input.campaignId) as any;
  if (!delivery) return 'missing';
  if (!contact || contact.status !== 'active' || !campaign || !['active', 'paused'].includes(campaign.status)) {
    db.prepare("UPDATE campaign_deliveries SET state='skipped',error=?,updated_at=? WHERE id=?").run(input.error, now, input.deliveryId);
    return 'skipped';
  }
  if (Number(delivery.attempt) >= Number(delivery.max_attempts)) {
    db.prepare("UPDATE campaign_deliveries SET state='failed',error=?,updated_at=? WHERE id=?").run(input.error, now, input.deliveryId);
    db.prepare("UPDATE campaign_contacts SET status='failed',updated_at=? WHERE id=? AND status='active'").run(now, input.contactId);
    return 'failed';
  }
  const delay = Math.min(60, Math.pow(2, Math.max(0, Number(delivery.attempt) - 1))) * 60_000;
  const firstAttemptAt = Date.parse(String(delivery.first_attempt_at || now));
  const idempotencyExpiresAt = firstAttemptAt + config.brevoIdempotencyTtlMinutes * 60_000;
  if (!Number.isFinite(firstAttemptAt) || Date.now() + delay >= idempotencyExpiresAt) {
    const error = `${input.error} Retry stopped before the provider idempotency window expired to avoid a duplicate send.`.slice(0, 1000);
    db.prepare("UPDATE campaign_deliveries SET state='failed',error=?,updated_at=? WHERE id=?").run(error, now, input.deliveryId);
    db.prepare("UPDATE campaign_contacts SET status='failed',updated_at=? WHERE id=? AND status='active'").run(now, input.contactId);
    return 'failed';
  }
  db.prepare("UPDATE campaign_deliveries SET state='queued',scheduled_at=?,error=?,updated_at=? WHERE id=?").run(new Date(Date.now() + delay).toISOString(), input.error, now, input.deliveryId);
  return 'retrying';
});

async function processDelivery(delivery: CampaignDelivery) {
  const campaign = requireCampaign(delivery.campaignId);
  const stepRow = db.prepare('SELECT * FROM campaign_steps WHERE id=?').get(delivery.stepId) as any;
  const contactRow = db.prepare('SELECT * FROM campaign_contacts WHERE id=?').get(delivery.contactId) as any;
  const survey = getSurvey(campaign.surveyId); const collector = getCollector(campaign.collectorId);
  if (campaign.status === 'paused') {
    const now = new Date().toISOString();
    db.prepare("UPDATE campaign_deliveries SET state='queued',updated_at=? WHERE id=? AND state='sending'").run(now, delivery.id);
    return;
  }
  if (!stepRow || !contactRow || !survey || !collector || contactRow.status !== 'active' || campaign.status !== 'active') {
    const now = new Date().toISOString(); db.prepare("UPDATE campaign_deliveries SET state='skipped',error='Campaign or contact is no longer sendable',updated_at=? WHERE id=?").run(now, delivery.id);
    refreshCampaignCompletion(delivery.campaignId); return;
  }
  const globallySuppressed = db.prepare('SELECT 1 FROM email_suppressions WHERE email=?').get(contactRow.email);
  if (globallySuppressed) {
    const now = new Date().toISOString();
    db.prepare("UPDATE campaign_contacts SET status='unsubscribed',updated_at=? WHERE id=? AND status='active'").run(now, delivery.contactId);
    db.prepare("UPDATE campaign_deliveries SET state='skipped',error='Email is globally suppressed',updated_at=? WHERE id=? AND state='sending'").run(now, delivery.id);
    publishEvent('campaign', { campaignId: campaign.id, reason: 'delivery-suppressed', deliveryId: delivery.id, contactId: delivery.contactId });
    refreshCampaignCompletion(delivery.campaignId); return;
  }
  const step = rowStep(stepRow); const contact = rowContact(contactRow);
  const surveyUrl = `${collector.publicUrl}?recipient=${encodeURIComponent(contact.token)}`;
  const question = (survey.questions || []).find((item) => item.id === step.embedQuestionId);
  const embedded = embeddedQuestion(question, surveyUrl);
  try {
    const sent = await sendCampaignEmail({
      deliveryId: delivery.id, to: contact.email, name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
      subject: step.subject, mode: step.mode, bodyText: step.bodyText, bodyHtml: step.bodyHtml,
      variables: { first_name: contact.firstName, last_name: contact.lastName, company: contact.company, survey_title: survey.title, survey_link: surveyUrl },
      embeddedQuestionHtml: embedded.html, embeddedQuestionText: embedded.text,
      unsubscribeUrl: `${config.publicUrl.replace(/\/$/, '')}/api/public/campaigns/unsubscribe/${encodeURIComponent(contact.token)}`
    });
    finalizeSuccessfulDelivery({ deliveryId: delivery.id, campaignId: campaign.id, contactId: contact.id, stepPosition: step.position, providerMessageId: (sent as any).messageId || '' });
    publishEvent('campaign', { campaignId: campaign.id, reason: 'delivery-sent', deliveryId: delivery.id, contactId: contact.id });
    refreshCampaignCompletion(campaign.id);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    finalizeFailedDelivery({ deliveryId: delivery.id, campaignId: campaign.id, contactId: delivery.contactId, error: message });
    publishEvent('campaign', { campaignId: campaign.id, reason: 'delivery-failed', deliveryId: delivery.id, error: message });
    refreshCampaignCompletion(campaign.id);
  }
}

const recoverSendingDeliveries = db.transaction((now: string, freshAfter: string) => {
  const rows = db.prepare("SELECT id,campaign_id,contact_id,COALESCE(first_attempt_at,updated_at) lease_started_at FROM campaign_deliveries WHERE state='sending'").all() as any[];
  const campaignIds = new Set<string>(); let recovered = 0; let failed = 0;
  for (const row of rows) {
    campaignIds.add(String(row.campaign_id));
    if (String(row.lease_started_at) >= freshAfter) {
      recovered += db.prepare(`UPDATE campaign_deliveries SET state='queued',scheduled_at=?,
        error='Recovered after restart within provider idempotency window',updated_at=? WHERE id=? AND state='sending'`).run(now, now, row.id).changes;
    } else {
      failed += db.prepare(`UPDATE campaign_deliveries SET state='failed',
        error='Delivery state is unknown after the provider idempotency window; it was not retried to avoid a duplicate send',updated_at=?
        WHERE id=? AND state='sending'`).run(now, row.id).changes;
      db.prepare("UPDATE campaign_contacts SET status='failed',updated_at=? WHERE id=? AND status='active'").run(now, row.contact_id);
    }
  }
  return { recovered, failed, campaignIds: [...campaignIds] };
});

export function recoverCampaignDeliveries() {
  const now = new Date();
  const result = recoverSendingDeliveries(now.toISOString(), new Date(now.getTime() - config.brevoIdempotencyTtlMinutes * 60_000).toISOString());
  for (const campaignId of result.campaignIds) {
    publishEvent('campaign', { campaignId, reason: result.failed ? 'delivery-recovery-failed' : 'delivery-recovered' });
    refreshCampaignCompletion(campaignId);
  }
  return result.recovered + result.failed;
}

class CampaignRunner {
  private timer: NodeJS.Timeout | null = null;
  private pumpPromise: Promise<void> | null = null;
  private stopping = false;
  start() {
    if (this.timer) return; this.stopping = false; recoverCampaignDeliveries();
    this.timer = setInterval(() => void this.pump(), 1000); this.timer.unref(); void this.pump();
  }
  async stop(timeoutMs = 10_000) {
    if (this.timer) clearInterval(this.timer); this.timer = null; this.stopping = true;
    const active = this.pumpPromise; if (!active) return true;
    let timeout: NodeJS.Timeout | null = null;
    const drained = await Promise.race([
      active.then(() => true),
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs)); timeout.unref(); })
    ]);
    if (timeout) clearTimeout(timeout);
    return drained;
  }
  pump() {
    if (this.stopping) return Promise.resolve();
    if (this.pumpPromise) return this.pumpPromise;
    const running = this.runPump().catch((error) => console.error('Campaign runner failed:', error));
    this.pumpPromise = running;
    void running.then(() => { if (this.pumpPromise === running) this.pumpPromise = null; });
    return running;
  }
  private async runPump() {
    for (let count = 0; count < 50 && !this.stopping; count += 1) {
      const delivery = claimNextDelivery(); if (!delivery) break; await processDelivery(delivery);
    }
    const activeCampaigns = db.prepare("SELECT id FROM campaigns WHERE status='active'").all() as any[];
    for (const campaign of activeCampaigns) refreshCampaignCompletion(String(campaign.id));
  }
}

export const campaignRunner = new CampaignRunner();

export async function sendCampaignTest(campaignId: string, emails: string[]) {
  const detail = getCampaignDetail(campaignId); const step = detail.steps[0];
  if (!step) throw new Error('Add a sequence step before sending a test.');
  const survey = detail.survey as Survey; const collector = detail.collector as Collector;
  const question = (survey.questions || []).find((item) => item.id === step.embedQuestionId);
  const surveyUrl = collector.publicUrl || ''; const embedded = embeddedQuestion(question, surveyUrl);
  const outcomes = [];
  for (const email of emails) {
    try {
      const sent = await sendCampaignEmail({
        deliveryId: crypto.randomUUID(), to: email, subject: step.subject, mode: step.mode,
        bodyText: step.bodyText, bodyHtml: step.bodyHtml,
        variables: { first_name: 'Test', last_name: 'Recipient', company: 'Example company', survey_title: survey.title, survey_link: surveyUrl },
        embeddedQuestionHtml: embedded.html, embeddedQuestionText: embedded.text
      });
      outcomes.push({ email, status: 'sent', messageId: (sent as any).messageId || null });
    } catch (error) { outcomes.push({ email, status: 'failed', error: error instanceof Error ? error.message : String(error) }); }
  }
  return { outcomes };
}
