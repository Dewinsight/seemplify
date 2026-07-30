import crypto from 'node:crypto';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { config } from './config.js';
import { db } from './database.js';
import { sendTransactionalEmail } from './emailService.js';
import { publishEvent } from './events.js';
import {
  auditDigest, hashBytes, hashToken, openText, randomOpaqueToken, readProtectedFile,
  removeProtectedFile, sealText, writeProtectedFile
} from './esignStorage.js';

export class EsignError extends Error {
  constructor(message: string, public status = 400, public code = 'ESIGN_ERROR') { super(message); }
}

export type EsignActor = {
  userId?: string | null;
  recipientId?: string | null;
  actorType: 'user' | 'recipient' | 'system';
  ip?: string | null;
  userAgent?: string | null;
};

type EnvelopeInput = {
  title: string;
  subject?: string;
  message?: string;
  routingMode?: 'sequential' | 'parallel';
  expiresInDays?: number | null;
  reminderIntervalHours?: number | null;
};

type RecipientInput = {
  id?: string;
  name: string;
  email: string;
  role: 'signer' | 'approver' | 'cc' | 'viewer';
  routingOrder: number;
  accessCode?: string | null;
};

type FieldInput = {
  id?: string;
  documentId: string;
  recipientId: string;
  type: 'signature' | 'initials' | 'name' | 'email' | 'date_signed' | 'text' | 'checkbox' | 'radio' | 'dropdown';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
  label?: string;
  placeholder?: string;
  tabOrder?: number;
  options?: string[];
  validation?: Record<string, unknown>;
};

const ACTION_ROLES = new Set(['signer', 'approver']);
const EDITABLE_ENVELOPE = new Set(['draft']);
const ACTIVE_RECIPIENT = new Set(['ready', 'sent', 'viewed', 'in_progress']);
const FINAL_ENVELOPE = new Set(['completed', 'declined', 'voided', 'expired', 'failed']);
const scryptParameters = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const ESIGN_DISCLOSURE_VERSION = '2026-07-29.1';
export const ESIGN_DISCLOSURE_TEXT = 'By selecting I agree, I consent to use electronic records and signatures for this envelope. I understand that I may decline to sign electronically and may request a paper copy or withdraw consent by contacting the sender. I can download and retain a copy after completion. I confirm that I can access and read the documents presented in this browser and that my electronic signature will have the same effect as my handwritten signature.';
export const ESIGN_DISCLOSURE_SHA256 = crypto.createHash('sha256').update(ESIGN_DISCLOSURE_TEXT, 'utf8').digest('hex');

function now() { return new Date().toISOString(); }
function parseJson<T>(value: unknown, fallback: T): T { try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; } }
function cleanText(value: unknown, maximum: number) { return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maximum); }
function normalizedEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new EsignError('Enter a valid recipient email address.');
  return email;
}
function safeFilename(value: string) {
  const base = value.replace(/[\r\n"\\/<>:*?|\u0000-\u001f]/g, '_').trim().slice(0, 180);
  return base || 'document.pdf';
}
function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}
function stableJson(value: unknown) { return JSON.stringify(stableValue(value)); }
function sealFieldValue(fieldId: string, value: unknown) { return sealText(stableJson(value), `esign-field-value:${fieldId}`); }
function openFieldValue(fieldId: string, value: unknown) {
  const stored = String(value || '');
  return parseJson(stored.startsWith('v1.') ? openText(stored, `esign-field-value:${fieldId}`) : stored, null);
}
function maskEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${local.length > 1 ? '***' : ''}@${domain}`;
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]?.toUpperCase()).join(''); }
function pdfSafe(value: unknown) { return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?'); }

function hashAccessCode(code: string) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(code, salt, 64, scryptParameters).toString('base64url');
  return `scrypt$${scryptParameters.N}$${scryptParameters.r}$${scryptParameters.p}$${salt}$${derived}`;
}
function verifyAccessCode(code: string, encoded: string) {
  try {
    const [scheme, n, r, p, salt, expected] = encoded.split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const actual = crypto.scryptSync(code, salt, 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: scryptParameters.maxmem }).toString('base64url');
    const left = Buffer.from(actual); const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch { return false; }
}

function envelopeRow(row: any) {
  const expiresInDays = row.expiration_days == null ? null : Number(row.expiration_days);
  return {
    id: row.id, spaceId: row.space_id, createdByUserId: row.created_by_user_id, sourceEnvelopeId: row.source_envelope_id,
    title: row.title, subject: row.subject, message: row.message, status: row.status,
    routingMode: row.routing_mode, expiresAt: row.expires_at, expiresInDays,
    reminderIntervalHours: row.reminder_interval_hours == null ? null : Number(row.reminder_interval_hours),
    lastReminderAt: row.last_reminder_at, revision: Number(row.revision), createdAt: row.created_at,
    updatedAt: row.updated_at, sentAt: row.sent_at, completedAt: row.completed_at,
    declinedAt: row.declined_at, voidedAt: row.voided_at, voidReason: row.void_reason,
    finalizationAttempt: Number(row.finalization_attempt || 0), finalizationRetryAt: row.finalization_retry_at,
    finalizationError: row.finalization_error
  };
}
function documentRow(row: any) {
  return { id: row.id, envelopeId: row.envelope_id, position: Number(row.position), name: row.original_name, mimeType: row.mime_type, size: Number(row.size_bytes), pageCount: Number(row.page_count), sha256: row.sha256, state: row.state, error: row.error, createdAt: row.created_at };
}
function recipientRow(row: any) {
  return {
    id: row.id, envelopeId: row.envelope_id, position: Number(row.position), routingOrder: Number(row.routing_order),
    role: row.role, name: row.name, email: row.email, status: row.status, requiresAccessCode: Boolean(row.access_code_hash), accessCodeSet: Boolean(row.access_code_hash),
    invitationSentAt: row.invitation_sent_at, sentAt: row.invitation_sent_at, viewedAt: row.viewed_at, authenticatedAt: row.authenticated_at,
    consentedAt: row.consented_at, completedAt: row.completed_at, declinedAt: row.declined_at,
    declineReason: row.decline_reason, createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function fieldRow(row: any) {
  return {
    id: row.id, envelopeId: row.envelope_id, documentId: row.document_id, recipientId: row.recipient_id,
    type: row.type, page: Number(row.page), x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height),
    required: Boolean(row.required), label: row.label, placeholder: row.placeholder, tabOrder: Number(row.tab_order),
    options: parseJson(row.options_json, []), validation: parseJson(row.validation_json, {}), createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function artifactRow(row: any) {
  return { id: row.id, envelopeId: row.envelope_id, kind: row.kind, name: row.file_name, fileName: row.file_name, mimeType: row.mime_type, size: Number(row.size_bytes), pageCount: Number(row.page_count), sha256: row.sha256, certificateId: row.public_id, publicId: row.public_id, state: row.state, createdAt: row.created_at };
}
function auditRow(row: any) {
  const metadata = parseJson(row.metadata_json, {});
  return { id: row.id, envelopeId: row.envelope_id, sequence: row.audit_sequence == null ? undefined : Number(row.audit_sequence), recipientId: row.recipient_id, actorUserId: row.actor_user_id, actorType: row.actor_type, action: row.event_type, eventType: row.event_type, actorName: row.actor_name || (row.actor_type === 'system' ? 'Seemplify system' : row.actor_type === 'recipient' ? 'Recipient' : 'Workspace user'), ipAddress: row.ip_address, userAgent: row.user_agent, detail: metadata, metadata, previousHash: row.previous_hash, eventHash: row.event_hash, createdAt: row.created_at };
}
function deliveryRow(row: any) {
  return {
    id: row.id, envelopeId: row.envelope_id, recipientId: row.recipient_id,
    recipientName: row.recipient_name, recipientEmail: row.recipient_email,
    kind: row.kind, state: row.state, attempts: Number(row.attempt || 0),
    scheduledAt: row.scheduled_at, providerMessageId: row.provider_message_id,
    providerStatus: row.provider_status, providerUpdatedAt: row.provider_updated_at,
    deliveredAt: row.delivered_at, openedAt: row.opened_at, bouncedAt: row.bounced_at,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at, sentAt: row.sent_at
  };
}

function requireSpaceEnvelope(id: string, spaceId: string) {
  const row = db.prepare('SELECT * FROM esign_envelopes WHERE id=? AND space_id=?').get(id, spaceId) as any;
  if (!row) throw new EsignError('Envelope not found.', 404, 'ENVELOPE_NOT_FOUND');
  return row;
}
function requireEditable(id: string, spaceId: string) {
  const row = requireSpaceEnvelope(id, spaceId);
  if (!EDITABLE_ENVELOPE.has(row.status)) throw new EsignError('Only a draft envelope can be edited.', 409, 'ENVELOPE_NOT_EDITABLE');
  return row;
}

function reservedEsignBytes(spaceId: string) {
  const documents = Number((db.prepare(`SELECT COALESCE(SUM(d.size_bytes),0) bytes
    FROM esign_documents d JOIN esign_envelopes e ON e.id=d.envelope_id WHERE e.space_id=?`)
    .get(spaceId) as any)?.bytes || 0);
  const artifacts = Number((db.prepare(`SELECT COALESCE(SUM(a.size_bytes),0) bytes
    FROM esign_artifacts a JOIN esign_envelopes e ON e.id=a.envelope_id WHERE e.space_id=?`)
    .get(spaceId) as any)?.bytes || 0);
  // Reserve one additional document-sized copy for completion output before an
  // envelope is signed, rather than discovering a full disk at finalization.
  return documents * 2 + artifacts;
}

function requireEsignSpaceCapacity(spaceId: string, additionalReservedBytes: number) {
  if (reservedEsignBytes(spaceId) + Math.max(0, additionalReservedBytes) > config.esignMaxSpaceBytes) {
    throw new EsignError(
      `This space has reached its ${Math.floor(config.esignMaxSpaceBytes / 1024 / 1024)} MB agreement storage allowance.`,
      409,
      'SPACE_STORAGE_LIMIT'
    );
  }
}

export function recordEsignAudit(envelopeId: string, eventType: string, actor: EsignActor, metadata: Record<string, unknown> = {}) {
  const id = crypto.randomUUID(); const createdAt = now();
  const previous = db.prepare('SELECT event_hash FROM esign_audit_events WHERE envelope_id=? ORDER BY rowid DESC LIMIT 1').get(envelopeId) as any;
  const previousHash = previous?.event_hash || null;
  const canonical = stableJson({ id, envelopeId, recipientId: actor.recipientId || null, actorUserId: actor.userId || null, actorType: actor.actorType, eventType, ipAddress: actor.ip || null, userAgent: actor.userAgent || null, metadata, previousHash, createdAt });
  const eventHash = auditDigest(canonical);
  db.prepare(`INSERT INTO esign_audit_events (id,envelope_id,recipient_id,actor_user_id,actor_type,event_type,ip_address,user_agent,metadata_json,previous_hash,event_hash,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, envelopeId, actor.recipientId || null, actor.userId || null, actor.actorType, eventType, actor.ip || null, actor.userAgent || null, stableJson(metadata), previousHash, eventHash, createdAt);
  return eventHash;
}

function readiness(envelopeId: string) {
  const envelope = db.prepare('SELECT * FROM esign_envelopes WHERE id=?').get(envelopeId) as any;
  const documents = db.prepare('SELECT * FROM esign_documents WHERE envelope_id=? ORDER BY position').all(envelopeId) as any[];
  const recipients = db.prepare('SELECT * FROM esign_recipients WHERE envelope_id=? ORDER BY position').all(envelopeId) as any[];
  const fields = db.prepare('SELECT * FROM esign_fields WHERE envelope_id=?').all(envelopeId) as any[];
  const sectionIssues: Record<'documents' | 'recipients' | 'fields' | 'message', string[]> = { documents: [], recipients: [], fields: [], message: [] };
  if (!cleanText(envelope?.title, 180)) sectionIssues.message.push('Add an envelope title.');
  if (!cleanText(envelope?.subject, 250)) sectionIssues.message.push('Add an email subject.');
  if (!String(envelope?.message || '').trim()) sectionIssues.message.push('Add an email message.');
  if (!documents.length) sectionIssues.documents.push('Upload at least one PDF document.');
  if (documents.some((item) => item.state !== 'ready')) sectionIssues.documents.push('Wait for every document to be ready.');
  const actionRecipients = recipients.filter((item) => ACTION_ROLES.has(item.role));
  if (!actionRecipients.length) sectionIssues.recipients.push('Add at least one signer or approver.');
  if (!actionRecipients.length) {
    sectionIssues.fields.push('Add a signer or approver before placing fields.');
  } else if (actionRecipients.some((item) => item.role === 'signer' && !fields.some((field) => field.recipient_id === item.id && ['signature', 'initials'].includes(field.type)))) {
    sectionIssues.fields.push('Assign a signature or initials field to every signer.');
  }
  if (fields.some((field) => !recipients.some((recipient) => recipient.id === field.recipient_id) || !documents.some((document) => document.id === field.document_id))) {
    sectionIssues.fields.push('Resolve fields with a missing document or recipient.');
  }
  const sections = Object.fromEntries(Object.entries(sectionIssues).map(([key, section]) => [key, { key, complete: section.length === 0, issues: section }])) as Record<string, { key: string; complete: boolean; issues: string[] }>;
  const issues = Object.values(sectionIssues).flat();
  return { ready: issues.length === 0, completedSections: Object.values(sections).filter((section) => section.complete).length, totalSections: 4, sections, issues, documentCount: documents.length, recipientCount: recipients.length, fieldCount: fields.length };
}

export function getEnvelopeDetail(id: string, spaceId: string) {
  const envelope = requireSpaceEnvelope(id, spaceId);
  const values = db.prepare(`SELECT v.* FROM esign_field_values v JOIN esign_fields f ON f.id=v.field_id WHERE f.envelope_id=?`).all(id) as any[];
  return {
    envelope: envelopeRow(envelope),
    documents: (db.prepare('SELECT * FROM esign_documents WHERE envelope_id=? ORDER BY position').all(id) as any[]).map(documentRow),
    recipients: (db.prepare('SELECT * FROM esign_recipients WHERE envelope_id=? ORDER BY position').all(id) as any[]).map(recipientRow),
    fields: (db.prepare('SELECT * FROM esign_fields WHERE envelope_id=? ORDER BY document_id,page,tab_order').all(id) as any[]).map((row) => ({ ...fieldRow(row), value: openFieldValue(row.id, values.find((value) => value.field_id === row.id)?.value_json), completedAt: values.find((value) => value.field_id === row.id)?.completed_at || null })),
    artifacts: (db.prepare('SELECT * FROM esign_artifacts WHERE envelope_id=? ORDER BY created_at').all(id) as any[]).map(artifactRow),
    audit: (db.prepare(`SELECT a.*,a.rowid audit_sequence,COALESCE(u.name,r.name) actor_name FROM esign_audit_events a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN esign_recipients r ON r.id=a.recipient_id WHERE a.envelope_id=? ORDER BY a.rowid`).all(id) as any[]).map(auditRow),
    deliveries: (db.prepare(`SELECT d.id,d.envelope_id,d.recipient_id,d.kind,d.state,d.attempt,d.scheduled_at,
      d.provider_message_id,d.provider_status,d.provider_updated_at,d.delivered_at,d.opened_at,d.bounced_at,
      d.error,d.created_at,d.updated_at,d.sent_at,r.name recipient_name,r.email recipient_email
      FROM esign_email_deliveries d JOIN esign_recipients r ON r.id=d.recipient_id
      WHERE d.envelope_id=? ORDER BY d.created_at DESC,d.id DESC`).all(id) as any[]).map(deliveryRow),
    readiness: readiness(id)
  };
}

export function listEnvelopes(spaceId: string, limit = 200) {
  return (db.prepare(`SELECT e.*,
      (SELECT COUNT(*) FROM esign_documents d WHERE d.envelope_id=e.id) document_count,
      (SELECT COUNT(*) FROM esign_recipients r WHERE r.envelope_id=e.id) recipient_count,
      (SELECT COUNT(*) FROM esign_recipients r WHERE r.envelope_id=e.id AND r.role IN ('signer','approver') AND r.status='completed') completed_recipient_count
    FROM esign_envelopes e WHERE e.space_id=? ORDER BY e.updated_at DESC LIMIT ?`).all(spaceId, Math.max(1, Math.min(500, limit))) as any[])
    .map((row) => ({ ...envelopeRow(row), documentCount: Number(row.document_count), recipientCount: Number(row.recipient_count), completedRecipientCount: Number(row.completed_recipient_count) }));
}

export function createEnvelope(spaceId: string, userId: string, input: EnvelopeInput, actor: EsignActor) {
  const id = crypto.randomUUID(); const timestamp = now();
  const days = input.expiresInDays === undefined ? 30 : input.expiresInDays === null ? null : Math.max(1, Math.min(365, Math.floor(input.expiresInDays)));
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO esign_envelopes (id,space_id,created_by_user_id,title,subject,message,status,routing_mode,expires_at,expiration_days,reminder_interval_hours,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?)`).run(id, spaceId, userId, cleanText(input.title, 180), cleanText(input.subject || `Please sign: ${input.title}`, 250), String(input.message || '').trim().slice(0, 5000), input.routingMode || 'sequential', expiresAt, days, input.reminderIntervalHours == null ? 72 : Math.max(1, Math.min(720, Math.floor(input.reminderIntervalHours))), timestamp, timestamp);
    recordEsignAudit(id, 'envelope.created', { ...actor, userId }, { routingMode: input.routingMode || 'sequential' });
  })();
  publishEvent('esign', { envelopeId: id, reason: 'created' }, spaceId);
  return getEnvelopeDetail(id, spaceId);
}

export function updateEnvelope(id: string, spaceId: string, userId: string, input: Partial<EnvelopeInput>, actor: EsignActor) {
  const current = requireEditable(id, spaceId); const timestamp = now();
  const expirationDays = input.expiresInDays === undefined ? current.expiration_days : input.expiresInDays === null ? null : Math.max(1, Math.min(365, Math.floor(input.expiresInDays)));
  const expiresAt = expirationDays == null ? null : new Date(Date.now() + Number(expirationDays) * 86_400_000).toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE esign_envelopes SET title=?,subject=?,message=?,routing_mode=?,expires_at=?,expiration_days=?,reminder_interval_hours=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=?`).run(
      input.title === undefined ? current.title : cleanText(input.title, 180), input.subject === undefined ? current.subject : cleanText(input.subject, 250),
      input.message === undefined ? current.message : String(input.message).trim().slice(0, 5000), input.routingMode || current.routing_mode, expiresAt, expirationDays,
      input.reminderIntervalHours === undefined ? current.reminder_interval_hours : input.reminderIntervalHours === null ? null : Math.max(1, Math.min(720, Math.floor(input.reminderIntervalHours))), timestamp, id, spaceId);
    recordEsignAudit(id, 'envelope.updated', { ...actor, userId }, {});
  })();
  publishEvent('esign', { envelopeId: id, reason: 'updated' }, spaceId);
  return getEnvelopeDetail(id, spaceId);
}

export function deleteEnvelope(id: string, spaceId: string) {
  requireEditable(id, spaceId);
  const files = [
    ...(db.prepare('SELECT storage_key FROM esign_documents WHERE envelope_id=?').all(id) as any[]),
    ...(db.prepare('SELECT storage_key FROM esign_signature_assets WHERE envelope_id=? AND storage_key IS NOT NULL').all(id) as any[]),
    ...(db.prepare('SELECT storage_key FROM esign_artifacts WHERE envelope_id=?').all(id) as any[])
  ].map((item) => String(item.storage_key));
  const changed = db.prepare('DELETE FROM esign_envelopes WHERE id=? AND space_id=? AND status=?').run(id, spaceId, 'draft').changes;
  if (changed) files.forEach(removeProtectedFile);
  return Boolean(changed);
}

function boxesMatch(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }) {
  return ['x', 'y', 'width', 'height'].every((key) => Math.abs(Number(left[key as keyof typeof left]) - Number(right[key as keyof typeof right])) < 0.01);
}

async function canonicalizeUploadedPdf(bytes: Buffer) {
  let source: PDFDocument;
  try { source = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch { throw new EsignError('The PDF is malformed, encrypted, or unsupported.', 400, 'INVALID_PDF'); }
  const pageCount = source.getPageCount();
  if (!pageCount || pageCount > config.esignMaxDocumentPages) throw new EsignError(`PDF documents may contain at most ${config.esignMaxDocumentPages} pages.`);
  for (const page of source.getPages()) {
    const rotation = ((Number(page.getRotation().angle) % 360) + 360) % 360;
    if (rotation !== 0) throw new EsignError('Rotated PDF pages are not supported. Flatten the page rotation before uploading.', 400, 'UNSUPPORTED_PDF_GEOMETRY');
    if (!boxesMatch(page.getMediaBox(), page.getCropBox())) throw new EsignError('Cropped PDF pages are not supported. Flatten the crop box before uploading.', 400, 'UNSUPPORTED_PDF_GEOMETRY');
  }
  try {
    if (source.getForm().getFields().length) source.getForm().flatten({ updateFieldAppearances: true });
  } catch { throw new EsignError('The PDF contains form fields that could not be safely flattened.', 400, 'UNSAFE_PDF'); }

  // Copying into a fresh document drops catalog-level JavaScript, open actions,
  // embedded files, and other active-content entry points. Page annotations and
  // additional actions are explicitly removed as a second boundary.
  const canonical = await PDFDocument.create();
  const copied = await canonical.copyPages(source, source.getPageIndices());
  for (const page of copied) {
    for (const key of ['Annots', 'AA', 'Dur', 'Trans', 'PieceInfo', 'PresSteps']) page.node.delete(PDFName.of(key));
    canonical.addPage(page);
  }
  canonical.setProducer('Seemplify Experience e-sign PDF sanitizer');
  canonical.setCreationDate(new Date()); canonical.setModificationDate(new Date());
  return { bytes: Buffer.from(await canonical.save({ useObjectStreams: true, addDefaultPage: false })), pageCount };
}

export async function addEnvelopeDocument(id: string, spaceId: string, userId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, actor: EsignActor) {
  requireEditable(id, spaceId);
  requireEsignSpaceCapacity(spaceId, file.size * 2);
  if (file.size < 8 || file.size > config.esignMaxDocumentBytes) throw new EsignError(`PDF documents must be smaller than ${Math.floor(config.esignMaxDocumentBytes / 1024 / 1024)} MB.`);
  if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new EsignError('The uploaded file is not a valid PDF.', 400, 'INVALID_PDF');
  const usage = db.prepare('SELECT COUNT(*) document_count,COALESCE(SUM(size_bytes),0) total_bytes FROM esign_documents WHERE envelope_id=?').get(id) as any;
  if (Number(usage.document_count) >= config.esignMaxEnvelopeDocuments) throw new EsignError(`An envelope may contain at most ${config.esignMaxEnvelopeDocuments} documents.`, 409, 'ENVELOPE_DOCUMENT_LIMIT');
  if (Number(usage.total_bytes) + file.size > config.esignMaxEnvelopeBytes) throw new EsignError(`Envelope documents may total at most ${Math.floor(config.esignMaxEnvelopeBytes / 1024 / 1024)} MB.`, 409, 'ENVELOPE_STORAGE_LIMIT');
  const canonical = await canonicalizeUploadedPdf(file.buffer); const pageCount = canonical.pageCount;
  if (Number(usage.total_bytes) + canonical.bytes.length > config.esignMaxEnvelopeBytes) throw new EsignError(`Envelope documents may total at most ${Math.floor(config.esignMaxEnvelopeBytes / 1024 / 1024)} MB.`, 409, 'ENVELOPE_STORAGE_LIMIT');
  const documentId = crypto.randomUUID();
  const stored = writeProtectedFile(canonical.bytes, `esign-document:${documentId}`); const timestamp = now();
  try {
    db.transaction(() => {
      requireEditable(id, spaceId);
      requireEsignSpaceCapacity(spaceId, stored.size * 2);
      const currentUsage = db.prepare('SELECT COUNT(*) document_count,COALESCE(SUM(size_bytes),0) total_bytes FROM esign_documents WHERE envelope_id=?').get(id) as any;
      if (Number(currentUsage.document_count) >= config.esignMaxEnvelopeDocuments) throw new EsignError(`An envelope may contain at most ${config.esignMaxEnvelopeDocuments} documents.`, 409, 'ENVELOPE_DOCUMENT_LIMIT');
      if (Number(currentUsage.total_bytes) + stored.size > config.esignMaxEnvelopeBytes) throw new EsignError(`Envelope documents may total at most ${Math.floor(config.esignMaxEnvelopeBytes / 1024 / 1024)} MB.`, 409, 'ENVELOPE_STORAGE_LIMIT');
      const position = Number((db.prepare('SELECT COALESCE(MAX(position),-1)+1 position FROM esign_documents WHERE envelope_id=?').get(id) as any).position);
      db.prepare(`INSERT INTO esign_documents (id,envelope_id,position,original_name,mime_type,size_bytes,page_count,storage_key,sha256,state,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'ready',?)`).run(documentId, id, position, safeFilename(file.originalname).replace(/\.pdf$/i, '') + '.pdf', 'application/pdf', stored.size, pageCount, stored.storageKey, stored.sha256, timestamp);
      db.prepare('UPDATE esign_envelopes SET revision=revision+1,updated_at=? WHERE id=? AND space_id=?').run(timestamp, id, spaceId);
      recordEsignAudit(id, 'document.uploaded', { ...actor, userId }, { documentId, pageCount, size: stored.size, sha256: stored.sha256, originalSha256: hashBytes(file.buffer), sanitized: true });
    })();
  } catch (error) { removeProtectedFile(stored.storageKey); throw error; }
  publishEvent('esign', { envelopeId: id, reason: 'document-uploaded', documentId }, spaceId);
  return getEnvelopeDetail(id, spaceId);
}

export function removeEnvelopeDocument(envelopeId: string, documentId: string, spaceId: string, userId: string, actor: EsignActor) {
  requireEditable(envelopeId, spaceId);
  const row = db.prepare('SELECT * FROM esign_documents WHERE id=? AND envelope_id=?').get(documentId, envelopeId) as any;
  if (!row) throw new EsignError('Document not found.', 404);
  db.transaction(() => {
    db.prepare('DELETE FROM esign_documents WHERE id=?').run(documentId);
    const remaining = db.prepare('SELECT id FROM esign_documents WHERE envelope_id=? ORDER BY position').all(envelopeId) as any[];
    remaining.forEach((item, position) => db.prepare('UPDATE esign_documents SET position=? WHERE id=?').run(position, item.id));
    db.prepare('UPDATE esign_envelopes SET revision=revision+1,updated_at=? WHERE id=? AND space_id=?').run(now(), envelopeId, spaceId);
    recordEsignAudit(envelopeId, 'document.removed', { ...actor, userId }, { documentId });
  })();
  removeProtectedFile(row.storage_key);
  publishEvent('esign', { envelopeId, reason: 'document-removed', documentId }, spaceId);
}

export function replaceEnvelopeRecipients(envelopeId: string, spaceId: string, userId: string, inputs: RecipientInput[], actor: EsignActor) {
  requireEditable(envelopeId, spaceId);
  const timestamp = now();
  const normalized = inputs.map((input, position) => {
    const email = normalizedEmail(input.email);
    const name = cleanText(input.name, 150); if (name.length < 2) throw new EsignError('Every recipient needs a name.');
    if (!['signer', 'approver', 'cc', 'viewer'].includes(input.role)) throw new EsignError('Unsupported recipient role.');
    return { ...input, name, email, position, routingOrder: Math.max(1, Math.min(100, Math.floor(input.routingOrder || 1))) };
  });
  db.transaction(() => {
    requireEditable(envelopeId, spaceId);
    const existing = db.prepare('SELECT * FROM esign_recipients WHERE envelope_id=?').all(envelopeId) as any[];
    const retained = new Set<string>();
    for (const item of normalized) {
      const current = item.id ? existing.find((row) => row.id === item.id) : null;
      if (item.id && !current) throw new EsignError('Recipient not found.', 404);
      if (current) {
        retained.add(current.id);
        const normalizedCode = item.accessCode == null ? item.accessCode : item.accessCode.trim();
        const accessHash = item.accessCode === undefined ? current.access_code_hash : normalizedCode ? hashAccessCode(normalizedCode) : null;
        db.prepare(`UPDATE esign_recipients SET position=?,routing_order=?,role=?,name=?,email=?,access_code_hash=?,code_failed_attempts=0,code_locked_until=NULL,updated_at=? WHERE id=?`)
          .run(item.position, item.routingOrder, item.role, item.name, item.email, accessHash, timestamp, current.id);
      } else {
        const recipientId = crypto.randomUUID(); const accessToken = randomOpaqueToken(); retained.add(recipientId);
        db.prepare(`INSERT INTO esign_recipients (id,envelope_id,position,routing_order,role,name,email,status,access_token_hash,access_token_enc,access_code_hash,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?,?)`).run(recipientId, envelopeId, item.position, item.routingOrder, item.role, item.name, item.email, hashToken(accessToken), sealText(accessToken, `esign-recipient-token:${recipientId}`), item.accessCode?.trim() ? hashAccessCode(item.accessCode.trim()) : null, timestamp, timestamp);
      }
    }
    for (const current of existing) if (!retained.has(current.id)) db.prepare('DELETE FROM esign_recipients WHERE id=?').run(current.id);
    db.prepare('UPDATE esign_envelopes SET revision=revision+1,updated_at=? WHERE id=? AND space_id=?').run(timestamp, envelopeId, spaceId);
    recordEsignAudit(envelopeId, 'recipients.replaced', { ...actor, userId }, { count: normalized.length, roles: normalized.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.role]: (counts[item.role] || 0) + 1 }), {}) });
  })();
  publishEvent('esign', { envelopeId, reason: 'recipients-updated' }, spaceId);
  return getEnvelopeDetail(envelopeId, spaceId);
}

export function replaceEnvelopeFields(envelopeId: string, spaceId: string, userId: string, inputs: FieldInput[], actor: EsignActor) {
  requireEditable(envelopeId, spaceId); const timestamp = now();
  const documents = new Map((db.prepare('SELECT * FROM esign_documents WHERE envelope_id=?').all(envelopeId) as any[]).map((row) => [row.id, row]));
  const recipients = new Map((db.prepare('SELECT * FROM esign_recipients WHERE envelope_id=?').all(envelopeId) as any[]).map((row) => [row.id, row]));
  const normalized = inputs.map((input, index) => {
    const document = documents.get(input.documentId); const recipient = recipients.get(input.recipientId);
    if (!document) throw new EsignError('A field references a document outside this envelope.');
    if (!recipient) throw new EsignError('A field references a recipient outside this envelope.');
    if (!ACTION_ROLES.has(recipient.role)) throw new EsignError('Fields can be assigned only to signers or approvers.');
    if (!Number.isInteger(input.page) || input.page < 1 || input.page > Number(document.page_count)) throw new EsignError('A field references an invalid document page.');
    for (const [name, value] of Object.entries({ x: input.x, y: input.y, width: input.width, height: input.height })) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new EsignError(`Field ${name} must be a normalized coordinate from 0 to 1.`);
    }
    if (input.width < 0.01 || input.height < 0.01 || input.x + input.width > 1.000001 || input.y + input.height > 1.000001) throw new EsignError('Field bounds must stay inside the page.');
    const options = [...new Set((input.options || []).map((value) => cleanText(value, 200)).filter(Boolean))].slice(0, 50);
    if (['radio', 'dropdown'].includes(input.type) && options.length < 2) throw new EsignError('Radio and dropdown fields need at least two options.');
    return { ...input, id: input.id || crypto.randomUUID(), required: input.required !== false, label: cleanText(input.label || '', 200), placeholder: cleanText(input.placeholder || '', 200), tabOrder: Number.isInteger(input.tabOrder) ? Number(input.tabOrder) : index, options };
  });
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) throw new EsignError('Field identifiers must be unique.');
  db.transaction(() => {
    requireEditable(envelopeId, spaceId);
    db.prepare('DELETE FROM esign_fields WHERE envelope_id=?').run(envelopeId);
    const insert = db.prepare(`INSERT INTO esign_fields (id,envelope_id,document_id,recipient_id,type,page,x,y,width,height,required,label,placeholder,tab_order,options_json,validation_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const item of normalized) insert.run(item.id, envelopeId, item.documentId, item.recipientId, item.type, item.page, item.x, item.y, item.width, item.height, item.required ? 1 : 0, item.label, item.placeholder, item.tabOrder, JSON.stringify(item.options), JSON.stringify(item.validation || {}), timestamp, timestamp);
    db.prepare('UPDATE esign_envelopes SET revision=revision+1,updated_at=? WHERE id=? AND space_id=?').run(timestamp, envelopeId, spaceId);
    recordEsignAudit(envelopeId, 'fields.replaced', { ...actor, userId }, { count: normalized.length });
  })();
  publishEvent('esign', { envelopeId, reason: 'fields-updated' }, spaceId);
  return getEnvelopeDetail(envelopeId, spaceId);
}

function queueEmail(envelopeId: string, recipientId: string, kind: 'invitation' | 'reminder' | 'completed' | 'voided', scheduledAt = now()) {
  const id = crypto.randomUUID(); const timestamp = now();
  db.prepare(`INSERT INTO esign_email_deliveries (id,envelope_id,recipient_id,kind,state,scheduled_at,idempotency_key,created_at,updated_at)
    VALUES (?,?,?,?,'queued',?,?,?,?)`).run(id, envelopeId, recipientId, kind, scheduledAt, id, timestamp, timestamp);
  return id;
}

function activateRecipients(envelopeId: string) {
  const envelope = db.prepare('SELECT * FROM esign_envelopes WHERE id=?').get(envelopeId) as any;
  if (!envelope || !['sent', 'in_progress'].includes(envelope.status)) return 0;
  const outstanding = db.prepare(`SELECT * FROM esign_recipients WHERE envelope_id=? AND role IN ('signer','approver') AND status<>'completed' ORDER BY routing_order,position`).all(envelopeId) as any[];
  const pending = outstanding.filter((item) => item.status === 'waiting');
  if (!pending.length) return 0;
  const order = envelope.routing_mode === 'parallel' ? null : Math.min(...outstanding.map((item) => Number(item.routing_order)));
  if (order !== null && outstanding.some((item) => Number(item.routing_order) === order && item.status !== 'waiting')) return 0;
  const active = pending.filter((item) => order === null || Number(item.routing_order) === order);
  const timestamp = now();
  for (const recipient of active) {
    db.prepare("UPDATE esign_recipients SET status='ready',updated_at=? WHERE id=? AND status='waiting'").run(timestamp, recipient.id);
    queueEmail(envelopeId, recipient.id, 'invitation', timestamp);
  }
  return active.length;
}

export function sendEnvelope(envelopeId: string, spaceId: string, userId: string, actor: EsignActor) {
  const envelope = requireEditable(envelopeId, spaceId); const ready = readiness(envelopeId);
  if (!ready.ready) throw new EsignError(ready.issues[0] || 'Complete the envelope before sending.', 409, 'ENVELOPE_NOT_READY');
  const timestamp = now();
  db.transaction(() => {
    const sendExpiresAt = envelope.expiration_days == null ? null : new Date(Date.now() + Number(envelope.expiration_days) * 86_400_000).toISOString();
    const changed = db.prepare(`UPDATE esign_envelopes SET status='sent',sent_at=?,expires_at=?,updated_at=?,revision=revision+1 WHERE id=? AND space_id=? AND status='draft'`).run(timestamp, sendExpiresAt, timestamp, envelopeId, spaceId).changes;
    if (changed !== 1) throw new EsignError('This envelope has already been sent.', 409);
    db.prepare(`UPDATE esign_recipients SET status=CASE WHEN role IN ('signer','approver') THEN 'waiting' ELSE 'waiting' END,updated_at=? WHERE envelope_id=?`).run(timestamp, envelopeId);
    activateRecipients(envelopeId);
    recordEsignAudit(envelopeId, 'envelope.sent', { ...actor, userId }, { routingMode: envelope.routing_mode, expiresAt: sendExpiresAt, expirationDays: envelope.expiration_days });
  })();
  publishEvent('esign', { envelopeId, reason: 'sent' }, spaceId); void esignWorker.pump();
  return getEnvelopeDetail(envelopeId, spaceId);
}

export function voidEnvelope(envelopeId: string, spaceId: string, userId: string, reason: string, actor: EsignActor) {
  const envelope = requireSpaceEnvelope(envelopeId, spaceId);
  if (FINAL_ENVELOPE.has(envelope.status)) throw new EsignError('This envelope can no longer be voided.', 409);
  const message = cleanText(reason, 1000); if (message.length < 2) throw new EsignError('Add a reason for voiding the envelope.');
  const timestamp = now();
  db.transaction(() => {
    const changed = db.prepare("UPDATE esign_envelopes SET status='voided',voided_at=?,void_reason=?,updated_at=?,revision=revision+1 WHERE id=? AND space_id=? AND status IN ('draft','sent','in_progress')").run(timestamp, message, timestamp, envelopeId, spaceId).changes;
    if (changed !== 1) throw new EsignError('This envelope can no longer be voided.', 409);
    db.prepare('UPDATE esign_signing_sessions SET revoked_at=? WHERE recipient_id IN (SELECT id FROM esign_recipients WHERE envelope_id=?) AND revoked_at IS NULL').run(timestamp, envelopeId);
    db.prepare("UPDATE esign_email_deliveries SET state='cancelled',error='Envelope voided',updated_at=? WHERE envelope_id=? AND state='queued'").run(timestamp, envelopeId);
    const recipients = db.prepare("SELECT id FROM esign_recipients WHERE envelope_id=? AND invitation_sent_at IS NOT NULL").all(envelopeId) as any[];
    recipients.forEach((recipient) => queueEmail(envelopeId, recipient.id, 'voided', timestamp));
    recordEsignAudit(envelopeId, 'envelope.voided', { ...actor, userId }, { reason: message });
  })();
  publishEvent('esign', { envelopeId, reason: 'voided' }, spaceId); void esignWorker.pump();
  return getEnvelopeDetail(envelopeId, spaceId);
}

export function remindEnvelope(envelopeId: string, spaceId: string, userId: string, recipientId: string | undefined, actor: EsignActor) {
  const envelope = requireSpaceEnvelope(envelopeId, spaceId);
  if (!['sent', 'in_progress'].includes(envelope.status)) throw new EsignError('Only an active envelope can send reminders.', 409);
  const recipients = db.prepare(`SELECT * FROM esign_recipients WHERE envelope_id=? AND status IN ('ready','sent','viewed','in_progress','delivery_failed') ${recipientId ? 'AND id=?' : ''}`).all(...(recipientId ? [envelopeId, recipientId] : [envelopeId])) as any[];
  if (!recipients.length) throw new EsignError('No active recipient is available for a reminder.', 409);
  const timestamp = now();
  db.transaction(() => {
    recipients.forEach((recipient) => queueEmail(envelopeId, recipient.id, 'reminder', timestamp));
    db.prepare('UPDATE esign_envelopes SET last_reminder_at=?,updated_at=? WHERE id=? AND space_id=?').run(timestamp, timestamp, envelopeId, spaceId);
    recordEsignAudit(envelopeId, 'envelope.reminded', { ...actor, userId }, { recipientIds: recipients.map((item) => item.id) });
  })();
  publishEvent('esign', { envelopeId, reason: 'reminder-queued' }, spaceId); void esignWorker.pump();
  return { queued: recipients.length };
}

export function retryEnvelopeFinalization(envelopeId: string, spaceId: string, userId: string, actor: EsignActor) {
  const envelope = requireSpaceEnvelope(envelopeId, spaceId);
  if (envelope.status !== 'failed' || !envelope.finalization_error) throw new EsignError('This envelope does not have a failed finalization to retry.', 409, 'FINALIZATION_NOT_RETRYABLE');
  const remaining = Number((db.prepare(`SELECT COUNT(*) count FROM esign_recipients WHERE envelope_id=? AND role IN ('signer','approver') AND status<>'completed'`).get(envelopeId) as any).count);
  if (remaining) throw new EsignError('All signers and approvers must complete before finalization can be retried.', 409, 'FINALIZATION_NOT_READY');
  const timestamp = now();
  db.transaction(() => {
    const changed = db.prepare("UPDATE esign_envelopes SET status='finalizing',finalization_attempt=0,finalization_retry_at=?,finalization_error=NULL,updated_at=? WHERE id=? AND space_id=? AND status='failed'").run(timestamp, timestamp, envelopeId, spaceId).changes;
    if (changed !== 1) throw new EsignError('This envelope is no longer available for retry.', 409);
    recordEsignAudit(envelopeId, 'envelope.finalization_retried', { ...actor, userId }, {});
  })();
  publishEvent('esign', { envelopeId, reason: 'finalization-retried' }, spaceId); void esignWorker.pump();
  return getEnvelopeDetail(envelopeId, spaceId);
}

function publicRecipientByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  return db.prepare(`SELECT r.*,e.status envelope_status,e.expires_at,e.title envelope_title,e.id envelope_id,e.space_id
    FROM esign_recipients r JOIN esign_envelopes e ON e.id=r.envelope_id WHERE r.access_token_hash=?`).get(hashToken(token)) as any;
}

export function exchangeSigningToken(token: string, actor: EsignActor) {
  const recipient = publicRecipientByToken(token);
  if (!recipient || ['draft', 'voided', 'declined', 'expired', 'failed'].includes(recipient.envelope_status)) throw new EsignError('This signing link is invalid or no longer available.', 404, 'SIGNING_LINK_UNAVAILABLE');
  if (recipient.expires_at && Date.parse(recipient.expires_at) <= Date.now()) throw new EsignError('This signing link has expired.', 410, 'SIGNING_LINK_EXPIRED');
  if (recipient.status === 'waiting' && recipient.envelope_status !== 'completed') throw new EsignError('This envelope is waiting for an earlier recipient.', 409, 'RECIPIENT_NOT_READY');
  const rawSession = randomOpaqueToken(); const sessionId = crypto.randomUUID(); const timestamp = now();
  const authenticated = recipient.access_code_hash ? 0 : 1;
  const expiresAt = new Date(Date.now() + config.esignSigningSessionHours * 3_600_000).toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO esign_signing_sessions (id,recipient_id,token_hash,authenticated,expires_at,created_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?)`).run(sessionId, recipient.id, hashToken(rawSession), authenticated, expiresAt, timestamp, timestamp);
    const surplus = db.prepare(`SELECT id FROM esign_signing_sessions WHERE recipient_id=? AND revoked_at IS NULL AND expires_at>?
      ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET 10`).all(recipient.id, timestamp) as any[];
    for (const stale of surplus) db.prepare('UPDATE esign_signing_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(timestamp, stale.id);
    if (ACTIVE_RECIPIENT.has(recipient.status)) {
      db.prepare("UPDATE esign_recipients SET status=CASE WHEN status IN ('ready','sent') THEN 'viewed' ELSE status END,viewed_at=COALESCE(viewed_at,?),authenticated_at=CASE WHEN ?=1 THEN COALESCE(authenticated_at,?) ELSE authenticated_at END,updated_at=? WHERE id=?")
        .run(timestamp, authenticated, timestamp, timestamp, recipient.id);
      db.prepare("UPDATE esign_envelopes SET status=CASE WHEN status='sent' THEN 'in_progress' ELSE status END,updated_at=? WHERE id=?").run(timestamp, recipient.envelope_id);
    }
    recordEsignAudit(recipient.envelope_id, 'recipient.link_opened', { ...actor, actorType: 'recipient', recipientId: recipient.id }, { authenticated: Boolean(authenticated) });
  })();
  publishEvent('esign', { envelopeId: recipient.envelope_id, reason: 'recipient-viewed', recipientId: recipient.id }, recipient.space_id);
  return { sessionToken: rawSession, expiresAt, snapshot: signingSessionSummary(rawSession) };
}

function signingSession(rawToken: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(rawToken)) throw new EsignError('Signing session required.', 401, 'SIGNING_SESSION_REQUIRED');
  const row = db.prepare(`SELECT s.*,r.envelope_id,r.name,r.email,r.role,r.status recipient_status,r.access_code_hash,r.code_locked_until,
      e.status envelope_status,e.expires_at envelope_expires_at,e.title envelope_title,e.space_id
    FROM esign_signing_sessions s JOIN esign_recipients r ON r.id=s.recipient_id JOIN esign_envelopes e ON e.id=r.envelope_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?`).get(hashToken(rawToken), now()) as any;
  if (!row) throw new EsignError('Signing session expired. Open the email link again.', 401, 'SIGNING_SESSION_EXPIRED');
  if (['voided', 'declined', 'expired', 'failed'].includes(row.envelope_status)) throw new EsignError('This envelope is no longer available for signing.', 410, 'ENVELOPE_UNAVAILABLE');
  if (row.envelope_expires_at && Date.parse(row.envelope_expires_at) <= Date.now()) throw new EsignError('This envelope has expired.', 410, 'ENVELOPE_EXPIRED');
  db.prepare('UPDATE esign_signing_sessions SET last_seen_at=? WHERE id=?').run(now(), row.id);
  return row;
}

function signingSessionSummary(rawToken: string) {
  const session = signingSession(rawToken);
  return {
    recipient: { id: session.recipient_id, name: session.name, email: session.email, role: session.role, status: session.recipient_status },
    envelope: { id: session.envelope_id, title: session.envelope_title, status: session.envelope_status, expiresAt: session.envelope_expires_at },
    requiresAccessCode: Boolean(session.access_code_hash), authenticated: Boolean(session.authenticated), consented: Boolean(session.consented_at), sessionExpiresAt: session.expires_at,
    disclosure: { version: ESIGN_DISCLOSURE_VERSION, text: ESIGN_DISCLOSURE_TEXT, sha256: ESIGN_DISCLOSURE_SHA256 }
  };
}

export function getSigningSessionSummary(rawToken: string) { return signingSessionSummary(rawToken); }

export function authenticateSigningAccessCode(rawToken: string, code: string, actor: EsignActor) {
  const session = signingSession(rawToken);
  if (!session.access_code_hash) {
    db.prepare('UPDATE esign_signing_sessions SET authenticated=1 WHERE id=?').run(session.id);
    return signingSessionSummary(rawToken);
  }
  const lockedUntil = session.code_locked_until ? Date.parse(session.code_locked_until) : 0;
  if (lockedUntil > Date.now()) throw new EsignError('Too many incorrect attempts. Try again later.', 429, 'ACCESS_CODE_LOCKED');
  const value = String(code || '').trim(); const valid = value.length >= 4 && value.length <= 64 && verifyAccessCode(value, session.access_code_hash);
  const timestamp = now();
  if (!valid) {
    const attempts = Number((db.prepare('SELECT code_failed_attempts FROM esign_recipients WHERE id=?').get(session.recipient_id) as any).code_failed_attempts) + 1;
    const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    db.prepare('UPDATE esign_recipients SET code_failed_attempts=?,code_locked_until=?,updated_at=? WHERE id=?').run(attempts >= 5 ? 0 : attempts, lock, timestamp, session.recipient_id);
    recordEsignAudit(session.envelope_id, 'recipient.access_code_failed', { ...actor, actorType: 'recipient', recipientId: session.recipient_id }, { locked: Boolean(lock) });
    throw new EsignError(lock ? 'Too many incorrect attempts. Try again in 15 minutes.' : 'The access code is incorrect.', lock ? 429 : 401, lock ? 'ACCESS_CODE_LOCKED' : 'ACCESS_CODE_INVALID');
  }
  db.transaction(() => {
    db.prepare('UPDATE esign_signing_sessions SET authenticated=1 WHERE id=?').run(session.id);
    db.prepare('UPDATE esign_recipients SET code_failed_attempts=0,code_locked_until=NULL,authenticated_at=COALESCE(authenticated_at,?),updated_at=? WHERE id=?').run(timestamp, timestamp, session.recipient_id);
    recordEsignAudit(session.envelope_id, 'recipient.authenticated', { ...actor, actorType: 'recipient', recipientId: session.recipient_id }, { method: 'access_code' });
  })();
  return getPublicEnvelope(rawToken);
}

export function consentToElectronicSigning(rawToken: string, agreed: boolean, actor: EsignActor) {
  const session = signingSession(rawToken);
  if (!session.authenticated) throw new EsignError('Enter the access code first.', 401, 'ACCESS_CODE_REQUIRED');
  if (!agreed) throw new EsignError('Electronic-record and signature consent is required to continue.');
  const timestamp = now();
  db.transaction(() => {
    db.prepare('UPDATE esign_signing_sessions SET consented_at=COALESCE(consented_at,?) WHERE id=?').run(timestamp, session.id);
    db.prepare('UPDATE esign_recipients SET consented_at=COALESCE(consented_at,?),status=CASE WHEN status IN (\'ready\',\'sent\',\'viewed\') THEN \'in_progress\' ELSE status END,updated_at=? WHERE id=?').run(timestamp, timestamp, session.recipient_id);
    recordEsignAudit(session.envelope_id, 'recipient.consented', { ...actor, actorType: 'recipient', recipientId: session.recipient_id }, {
      disclosureVersion: ESIGN_DISCLOSURE_VERSION, disclosureSha256: ESIGN_DISCLOSURE_SHA256, disclosureText: ESIGN_DISCLOSURE_TEXT
    });
  })();
  publishEvent('esign', { envelopeId: session.envelope_id, reason: 'recipient-consented', recipientId: session.recipient_id }, session.space_id);
  return signingSessionSummary(rawToken);
}

function requireSigningAction(rawToken: string) {
  const session = signingSession(rawToken);
  if (!session.authenticated) throw new EsignError('Enter the access code first.', 401, 'ACCESS_CODE_REQUIRED');
  if (!session.consented_at) throw new EsignError('Consent to electronic signing before continuing.', 409, 'CONSENT_REQUIRED');
  if (!ACTIVE_RECIPIENT.has(session.recipient_status)) throw new EsignError('This recipient cannot make further changes.', 409, 'RECIPIENT_NOT_ACTIVE');
  if (!['sent', 'in_progress'].includes(session.envelope_status)) throw new EsignError('This envelope is not accepting signatures.', 409, 'ENVELOPE_NOT_ACTIVE');
  return session;
}

export function getPublicEnvelope(rawToken: string) {
  const session = signingSession(rawToken);
  const mayReadDocuments = Boolean(session.authenticated && session.consented_at);
  const documents = (db.prepare('SELECT * FROM esign_documents WHERE envelope_id=? ORDER BY position').all(session.envelope_id) as any[]).map((row) => ({ ...documentRow(row), contentUrl: mayReadDocuments ? `/api/public/esign/documents/${row.id}/content` : null }));
  const values = db.prepare('SELECT * FROM esign_field_values WHERE recipient_id=?').all(session.recipient_id) as any[];
  const fields = mayReadDocuments ? (db.prepare('SELECT * FROM esign_fields WHERE envelope_id=? AND recipient_id=? ORDER BY document_id,page,tab_order').all(session.envelope_id, session.recipient_id) as any[]).map((row) => {
    const value = values.find((item) => item.field_id === row.id);
    const saved = openFieldValue(row.id, value?.value_json);
    const automatic = row.type === 'name' ? session.name : row.type === 'email' ? session.email : row.type === 'date_signed' ? now().slice(0, 10) : saved;
    return { ...fieldRow(row), value: automatic, hasValue: automatic !== null && automatic !== undefined && automatic !== '', completedAt: value?.completed_at || null };
  }) : [];
  const recipientRows = db.prepare('SELECT * FROM esign_recipients WHERE envelope_id=? ORDER BY routing_order,position').all(session.envelope_id) as any[];
  const recipients = (session.authenticated ? recipientRows : recipientRows.filter((row) => row.id === session.recipient_id)).map((row) => ({ id: row.id, name: row.name, role: row.role, routingOrder: Number(row.routing_order), status: row.status, completedAt: row.completed_at }));
  const artifacts = session.authenticated && session.envelope_status === 'completed' ? (db.prepare('SELECT * FROM esign_artifacts WHERE envelope_id=? ORDER BY created_at').all(session.envelope_id) as any[]).map((row) => ({ ...artifactRow(row), contentUrl: `/api/public/esign/artifacts/${row.id}/content` })) : [];
  return {
    ...signingSessionSummary(rawToken),
    documents, fields, recipients, artifacts,
    locked: session.recipient_status === 'waiting',
    canAct: ACTIVE_RECIPIENT.has(session.recipient_status) && ['sent', 'in_progress'].includes(session.envelope_status)
  };
}

function parseSignatureDataUrl(dataUrl: string) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new EsignError('Upload a PNG or JPEG signature image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new EsignError('Signature images must be smaller than 2 MB.');
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if ((match[1].toLowerCase() === 'image/png' && !png) || (match[1].toLowerCase() === 'image/jpeg' && !jpeg)) throw new EsignError('Signature image contents do not match their declared format.');
  return { mimeType: match[1].toLowerCase(), bytes };
}

export async function savePublicField(rawToken: string, fieldId: string, input: { value?: unknown; signature?: { mode: 'typed' | 'drawn' | 'uploaded'; value?: string; dataUrl?: string } }, actor: EsignActor) {
  const session = requireSigningAction(rawToken);
  const field = db.prepare('SELECT * FROM esign_fields WHERE id=? AND envelope_id=? AND recipient_id=?').get(fieldId, session.envelope_id, session.recipient_id) as any;
  if (!field) throw new EsignError('Field not found.', 404, 'FIELD_NOT_FOUND');
  const timestamp = now(); let value: unknown = input.value; let asset: { id: string; mode: string; mimeType: string | null; displayText: string | null; storageKey: string | null; sha256: string | null } | null = null;
  if (['signature', 'initials'].includes(field.type)) {
    if (!input.signature) throw new EsignError('A signature value is required.');
    if (input.signature.mode === 'typed') {
      const text = cleanText(input.signature.value, field.type === 'initials' ? 12 : 100);
      if (text.length < 1) throw new EsignError('Enter a typed signature.');
      const assetId = crypto.randomUUID();
      asset = { id: assetId, mode: 'typed', mimeType: null, displayText: sealText(text, `esign-signature-text:${assetId}`), storageKey: null, sha256: hashBytes(Buffer.from(text)) };
      value = { mode: 'typed', value: 'Signature saved' };
    } else {
      const image = parseSignatureDataUrl(input.signature.dataUrl || '');
      const probe = await PDFDocument.create();
      try { image.mimeType === 'image/png' ? await probe.embedPng(image.bytes) : await probe.embedJpg(image.bytes); }
      catch { throw new EsignError('The signature image is malformed.'); }
      const assetId = crypto.randomUUID(); const stored = writeProtectedFile(image.bytes, `esign-signature:${assetId}`);
      asset = { id: assetId, mode: input.signature.mode, mimeType: image.mimeType, displayText: null, storageKey: stored.storageKey, sha256: stored.sha256 };
      value = { mode: input.signature.mode, value: 'Signature saved' };
    }
  } else if (field.type === 'checkbox') value = Boolean(value);
  else if (['radio', 'dropdown'].includes(field.type)) {
    value = cleanText(value, 200);
    const options = parseJson<string[]>(field.options_json, []);
    if (value && !options.includes(String(value))) throw new EsignError('Select one of the available field options.');
  } else {
    value = String(value ?? '').trim().slice(0, 4000);
    const validation = parseJson<Record<string, unknown>>(field.validation_json, {});
    const minimum = Math.max(0, Math.min(4000, Number(validation.minLength || 0)));
    const maximum = Math.max(minimum || 1, Math.min(4000, Number(validation.maxLength || 4000)));
    if (String(value).length < minimum || String(value).length > maximum) throw new EsignError(`The field value must contain between ${minimum} and ${maximum} characters.`);
    if (validation.format === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) throw new EsignError('Enter a valid email address.');
  }
  let previousStorageKey: string | null = null;
  try {
    db.transaction(() => {
      const current = db.prepare(`SELECT e.status envelope_status,r.status recipient_status,v.signature_asset_id,a.storage_key previous_storage_key
        FROM esign_envelopes e JOIN esign_recipients r ON r.envelope_id=e.id LEFT JOIN esign_field_values v ON v.recipient_id=r.id AND v.field_id=?
        LEFT JOIN esign_signature_assets a ON a.id=v.signature_asset_id WHERE e.id=? AND r.id=?`).get(field.id, session.envelope_id, session.recipient_id) as any;
      if (!current || !['sent', 'in_progress'].includes(current.envelope_status) || !ACTIVE_RECIPIENT.has(current.recipient_status)) throw new EsignError('This envelope is no longer accepting field changes.', 409);
      previousStorageKey = current.previous_storage_key || null;
      if (asset) db.prepare(`INSERT INTO esign_signature_assets (id,envelope_id,recipient_id,mode,mime_type,display_text,storage_key,sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(asset.id, session.envelope_id, session.recipient_id, asset.mode, asset.mimeType, asset.displayText, asset.storageKey, asset.sha256, timestamp);
      db.prepare(`INSERT INTO esign_field_values (field_id,recipient_id,value_json,signature_asset_id,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(field_id) DO UPDATE SET value_json=excluded.value_json,signature_asset_id=excluded.signature_asset_id,completed_at=NULL,updated_at=excluded.updated_at`)
        .run(field.id, session.recipient_id, sealFieldValue(field.id, value), asset?.id || null, timestamp);
      if (current.signature_asset_id) db.prepare('DELETE FROM esign_signature_assets WHERE id=?').run(current.signature_asset_id);
      recordEsignAudit(session.envelope_id, 'field.updated', { ...actor, actorType: 'recipient', recipientId: session.recipient_id }, { fieldId: field.id, fieldType: field.type, hasValue: value !== '' && value !== false && value != null });
    })();
  } catch (error) { if (asset?.storageKey) removeProtectedFile(asset.storageKey); throw error; }
  if (previousStorageKey) removeProtectedFile(previousStorageKey);
  publishEvent('esign', { envelopeId: session.envelope_id, reason: 'field-updated', recipientId: session.recipient_id, fieldId }, session.space_id);
  return signingSessionSummary(rawToken);
}

function fieldHasValue(field: any, value: any) {
  if (['name', 'email', 'date_signed'].includes(field.type)) return true;
  if (!value) return false;
  if (['signature', 'initials'].includes(field.type)) return Boolean(value.signature_asset_id);
  const parsed = openFieldValue(field.id, value.value_json);
  if (field.type === 'checkbox') return parsed === true;
  return parsed !== null && parsed !== undefined && String(parsed).trim() !== '';
}

export function completePublicSigning(rawToken: string, actor: EsignActor) {
  const session = requireSigningAction(rawToken); const timestamp = now();
  db.transaction(() => {
    const currentEnvelope = db.prepare('SELECT status FROM esign_envelopes WHERE id=?').get(session.envelope_id) as any;
    if (!currentEnvelope || !['sent', 'in_progress'].includes(currentEnvelope.status)) throw new EsignError('This envelope is no longer accepting signatures.', 409);
    const fields = db.prepare(`SELECT f.*,v.value_json,v.signature_asset_id FROM esign_fields f LEFT JOIN esign_field_values v ON v.field_id=f.id
      WHERE f.envelope_id=? AND f.recipient_id=? ORDER BY f.tab_order`).all(session.envelope_id, session.recipient_id) as any[];
    const missing = fields.filter((field) => Boolean(field.required) && !fieldHasValue(field, field));
    if (missing.length) throw new EsignError(`Complete all required fields before finishing. Missing: ${missing.slice(0, 5).map((field) => field.label || field.type).join(', ')}.`, 409, 'REQUIRED_FIELDS_MISSING');
    const changed = db.prepare(`UPDATE esign_recipients SET status='completed',completed_at=?,updated_at=? WHERE id=? AND status IN ('ready','sent','viewed','in_progress')`).run(timestamp, timestamp, session.recipient_id).changes;
    if (changed !== 1) throw new EsignError('This recipient has already completed the envelope.', 409);
    db.prepare('UPDATE esign_field_values SET completed_at=? WHERE recipient_id=?').run(timestamp, session.recipient_id);
    for (const field of fields.filter((item) => ['name', 'email', 'date_signed'].includes(item.type) && !item.value_json)) {
      const automatic = field.type === 'name' ? session.name : field.type === 'email' ? session.email : timestamp.slice(0, 10);
      db.prepare(`INSERT INTO esign_field_values (field_id,recipient_id,value_json,completed_at,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(field_id) DO UPDATE SET value_json=excluded.value_json,completed_at=excluded.completed_at,updated_at=excluded.updated_at`)
        .run(field.id, session.recipient_id, sealFieldValue(field.id, automatic), timestamp, timestamp);
    }
    db.prepare('UPDATE esign_signing_sessions SET revoked_at=? WHERE recipient_id=? AND id<>? AND revoked_at IS NULL').run(timestamp, session.recipient_id, session.id);
    recordEsignAudit(session.envelope_id, 'recipient.completed', { ...actor, actorType: 'recipient', recipientId: session.recipient_id }, { fieldCount: fields.length });
    const remaining = Number((db.prepare(`SELECT COUNT(*) count FROM esign_recipients WHERE envelope_id=? AND role IN ('signer','approver') AND status<>'completed'`).get(session.envelope_id) as any).count);
    if (remaining) activateRecipients(session.envelope_id);
    else {
      db.prepare("UPDATE esign_envelopes SET status='finalizing',finalization_attempt=0,finalization_retry_at=?,finalization_error=NULL,updated_at=? WHERE id=? AND status IN ('sent','in_progress')").run(timestamp, timestamp, session.envelope_id);
    }
  })();
  publishEvent('esign', { envelopeId: session.envelope_id, reason: 'recipient-completed', recipientId: session.recipient_id }, session.space_id); void esignWorker.pump();
  return signingSessionSummary(rawToken);
}

export function declinePublicSigning(rawToken: string, reason: string, actor: EsignActor) {
  const session = requireSigningAction(rawToken); const message = cleanText(reason, 1000);
  if (message.length < 2) throw new EsignError('Add a reason for declining.');
  const timestamp = now();
  db.transaction(() => {
    const changed = db.prepare("UPDATE esign_envelopes SET status='declined',declined_at=?,updated_at=?,revision=revision+1 WHERE id=? AND status IN ('sent','in_progress')").run(timestamp, timestamp, session.envelope_id).changes;
    if (changed !== 1) throw new EsignError('This envelope is no longer accepting a decline response.', 409);
    db.prepare("UPDATE esign_recipients SET status='declined',declined_at=?,decline_reason=?,updated_at=? WHERE id=?").run(timestamp, message, timestamp, session.recipient_id);
    db.prepare('UPDATE esign_signing_sessions SET revoked_at=? WHERE recipient_id IN (SELECT id FROM esign_recipients WHERE envelope_id=?) AND revoked_at IS NULL').run(timestamp, session.envelope_id);
    db.prepare("UPDATE esign_email_deliveries SET state='cancelled',error='Envelope declined',updated_at=? WHERE envelope_id=? AND state='queued'").run(timestamp, session.envelope_id);
    recordEsignAudit(session.envelope_id, 'recipient.declined', { ...actor, actorType: 'recipient', recipientId: session.recipient_id }, { reason: message });
  })();
  publishEvent('esign', { envelopeId: session.envelope_id, reason: 'declined', recipientId: session.recipient_id }, session.space_id);
  return { envelopeId: session.envelope_id, status: 'declined' };
}

export function revokeSigningSession(rawToken: string) {
  if (!rawToken) return;
  db.prepare('UPDATE esign_signing_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(now(), hashToken(rawToken));
}

export function getOwnedDocumentContent(envelopeId: string, documentId: string, spaceId: string) {
  requireSpaceEnvelope(envelopeId, spaceId);
  const row = db.prepare('SELECT * FROM esign_documents WHERE id=? AND envelope_id=?').get(documentId, envelopeId) as any;
  if (!row) throw new EsignError('Document not found.', 404);
  const bytes = readProtectedFile(row.storage_key, `esign-document:${row.id}`);
  if (hashBytes(bytes) !== row.sha256) throw new EsignError('Document integrity verification failed.', 500);
  return { bytes, fileName: row.original_name, mimeType: row.mime_type, sha256: row.sha256 };
}

export function getPublicDocumentContent(rawToken: string, documentId: string) {
  const session = signingSession(rawToken);
  if (!session.authenticated) throw new EsignError('Enter the access code first.', 401, 'ACCESS_CODE_REQUIRED');
  if (!session.consented_at) throw new EsignError('Consent to electronic signing before viewing the document.', 409, 'CONSENT_REQUIRED');
  const row = db.prepare('SELECT * FROM esign_documents WHERE id=? AND envelope_id=?').get(documentId, session.envelope_id) as any;
  if (!row) throw new EsignError('Document not found.', 404);
  const bytes = readProtectedFile(row.storage_key, `esign-document:${row.id}`);
  if (hashBytes(bytes) !== row.sha256) throw new EsignError('Document integrity verification failed.', 500);
  return { bytes, fileName: row.original_name, mimeType: row.mime_type, sha256: row.sha256 };
}

export function getOwnedArtifactContent(envelopeId: string, artifactId: string, spaceId: string) {
  requireSpaceEnvelope(envelopeId, spaceId);
  const row = db.prepare('SELECT * FROM esign_artifacts WHERE id=? AND envelope_id=? AND state=?').get(artifactId, envelopeId, 'ready') as any;
  if (!row) throw new EsignError('Artifact not found.', 404);
  const bytes = readProtectedFile(row.storage_key, `esign-artifact:${row.id}`);
  if (hashBytes(bytes) !== row.sha256) throw new EsignError('Artifact integrity verification failed.', 500);
  return { bytes, fileName: row.file_name, mimeType: row.mime_type, sha256: row.sha256 };
}

export function getPublicArtifactContent(rawToken: string, artifactId: string) {
  const session = signingSession(rawToken);
  if (!session.authenticated) throw new EsignError('Enter the access code first.', 401, 'ACCESS_CODE_REQUIRED');
  if (session.envelope_status !== 'completed') throw new EsignError('Completed documents are not ready.', 409);
  const row = db.prepare('SELECT * FROM esign_artifacts WHERE id=? AND envelope_id=? AND state=?').get(artifactId, session.envelope_id, 'ready') as any;
  if (!row) throw new EsignError('Artifact not found.', 404);
  const bytes = readProtectedFile(row.storage_key, `esign-artifact:${row.id}`);
  if (hashBytes(bytes) !== row.sha256) throw new EsignError('Artifact integrity verification failed.', 500);
  return { bytes, fileName: row.file_name, mimeType: row.mime_type, sha256: row.sha256 };
}

export function listLogModeOutbox(spaceId: string, envelopeId?: string) {
  if (config.emailMode !== 'log') throw new EsignError('The test outbox is available only in log email mode.', 404);
  const rows = db.prepare(`SELECT d.*,r.email,r.name,e.title FROM esign_email_deliveries d
    JOIN esign_envelopes e ON e.id=d.envelope_id JOIN esign_recipients r ON r.id=d.recipient_id
    WHERE e.space_id=? ${envelopeId ? 'AND e.id=?' : ''} ORDER BY d.created_at DESC LIMIT 500`).all(...(envelopeId ? [spaceId, envelopeId] : [spaceId])) as any[];
  return rows.map((row) => ({
    id: row.id, envelopeId: row.envelope_id, recipientId: row.recipient_id, recipientEmail: row.email, recipientName: row.name,
    envelopeTitle: row.title, kind: row.kind, state: row.state, scheduledAt: row.scheduled_at, sentAt: row.sent_at,
    signerUrl: row.debug_link_enc ? openText(row.debug_link_enc, `esign-debug-link:${row.id}`) : null,
    error: row.error
  }));
}

export function cloneEnvelope(envelopeId: string, spaceId: string, userId: string, title: string | undefined, actor: EsignActor) {
  const source = requireSpaceEnvelope(envelopeId, spaceId); const newId = crypto.randomUUID(); const timestamp = now();
  const documents = db.prepare('SELECT * FROM esign_documents WHERE envelope_id=? ORDER BY position').all(envelopeId) as any[];
  const cloneBytes = documents.reduce((total, document) => total + Number(document.size_bytes || 0), 0);
  requireEsignSpaceCapacity(spaceId, cloneBytes * 2);
  const recentClones = Number((db.prepare(`SELECT COUNT(*) count FROM esign_envelopes
    WHERE space_id=? AND created_by_user_id=? AND source_envelope_id IS NOT NULL AND created_at>=?`)
    .get(spaceId, userId, new Date(Date.now() - 60 * 60_000).toISOString()) as any)?.count || 0);
  if (recentClones >= 20) throw new EsignError('Too many agreement copies were created recently. Try again later.', 429, 'CLONE_RATE_LIMIT');
  const recipients = db.prepare('SELECT * FROM esign_recipients WHERE envelope_id=? ORDER BY position').all(envelopeId) as any[];
  const fields = db.prepare('SELECT * FROM esign_fields WHERE envelope_id=? ORDER BY tab_order').all(envelopeId) as any[];
  const createdFiles: string[] = [];
  try {
    db.transaction(() => {
      requireEsignSpaceCapacity(spaceId, cloneBytes * 2);
      const expirationDays = source.expiration_days == null ? null : Number(source.expiration_days);
      const expiresAt = expirationDays == null ? null : new Date(Date.now() + expirationDays * 86_400_000).toISOString();
      db.prepare(`INSERT INTO esign_envelopes (id,space_id,created_by_user_id,source_envelope_id,title,subject,message,status,routing_mode,expires_at,expiration_days,reminder_interval_hours,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?,?,?)`).run(newId, spaceId, userId, envelopeId, cleanText(title || `${source.title} copy`, 180), source.subject, source.message, source.routing_mode, expiresAt, expirationDays, source.reminder_interval_hours, timestamp, timestamp);
      const documentIds = new Map<string, string>();
      for (const document of documents) {
        const id = crypto.randomUUID(); const bytes = readProtectedFile(document.storage_key, `esign-document:${document.id}`); const stored = writeProtectedFile(bytes, `esign-document:${id}`); createdFiles.push(stored.storageKey); documentIds.set(document.id, id);
        db.prepare(`INSERT INTO esign_documents (id,envelope_id,position,original_name,mime_type,size_bytes,page_count,storage_key,sha256,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,'ready',?)`)
          .run(id, newId, document.position, document.original_name, document.mime_type, stored.size, document.page_count, stored.storageKey, stored.sha256, timestamp);
      }
      const recipientIds = new Map<string, string>();
      for (const recipient of recipients) {
        const id = crypto.randomUUID(); const token = randomOpaqueToken(); recipientIds.set(recipient.id, id);
        db.prepare(`INSERT INTO esign_recipients (id,envelope_id,position,routing_order,role,name,email,status,access_token_hash,access_token_enc,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?)`).run(id, newId, recipient.position, recipient.routing_order, recipient.role, recipient.name, recipient.email, hashToken(token), sealText(token, `esign-recipient-token:${id}`), timestamp, timestamp);
      }
      for (const field of fields) db.prepare(`INSERT INTO esign_fields (id,envelope_id,document_id,recipient_id,type,page,x,y,width,height,required,label,placeholder,tab_order,options_json,validation_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), newId, documentIds.get(field.document_id), recipientIds.get(field.recipient_id), field.type, field.page, field.x, field.y, field.width, field.height, field.required, field.label, field.placeholder, field.tab_order, field.options_json, field.validation_json, timestamp, timestamp);
      recordEsignAudit(newId, 'envelope.cloned', { ...actor, userId }, { sourceEnvelopeId: envelopeId });
    })();
  } catch (error) { createdFiles.forEach(removeProtectedFile); throw error; }
  publishEvent('esign', { envelopeId: newId, reason: 'cloned', sourceEnvelopeId: envelopeId }, spaceId);
  return getEnvelopeDetail(newId, spaceId);
}

function displayFieldValue(field: any, value: any, recipient: any) {
  if (field.type === 'name') return recipient.name;
  if (field.type === 'email') return recipient.email;
  if (field.type === 'date_signed') return String(recipient.completed_at || now()).slice(0, 10);
  const parsed = openFieldValue(field.id, value?.value_json) as any;
  if (field.type === 'checkbox') return parsed === true ? 'X' : '';
  if (parsed && typeof parsed === 'object') return String(parsed.text || '');
  return String(parsed ?? '');
}

function drawTextWithin(page: any, text: string, x: number, y: number, width: number, height: number, font: any, color = rgb(0.08, 0.1, 0.09)) {
  const clean = pdfSafe(String(text || '').replace(/[\r\n]+/g, ' ').slice(0, 2000));
  if (!clean) return;
  let size = Math.min(18, Math.max(7, height * 0.55));
  while (size > 7 && font.widthOfTextAtSize(clean, size) > width) size -= 0.5;
  const rendered = font.widthOfTextAtSize(clean, size) > width ? `${clean.slice(0, Math.max(1, Math.floor(clean.length * width / font.widthOfTextAtSize(clean, size)) - 3))}...` : clean;
  page.drawText(rendered, { x: x + 2, y: y + Math.max(1, (height - size) / 2), size, font, color, maxWidth: Math.max(1, width - 4) });
}

async function buildCompletedPdf(envelopeId: string, completedAt: string) {
  const documents = db.prepare('SELECT * FROM esign_documents WHERE envelope_id=? ORDER BY position').all(envelopeId) as any[];
  const fields = db.prepare(`SELECT f.*,v.value_json,v.signature_asset_id,a.mode signature_mode,a.mime_type signature_mime,a.display_text signature_text,a.storage_key signature_storage,
      r.name recipient_name,r.email recipient_email,r.completed_at recipient_completed_at
    FROM esign_fields f LEFT JOIN esign_field_values v ON v.field_id=f.id LEFT JOIN esign_signature_assets a ON a.id=v.signature_asset_id
    JOIN esign_recipients r ON r.id=f.recipient_id WHERE f.envelope_id=? ORDER BY f.document_id,f.page,f.tab_order`).all(envelopeId) as any[];
  const output = await PDFDocument.create();
  for (const document of documents) {
    const bytes = readProtectedFile(document.storage_key, `esign-document:${document.id}`);
    if (hashBytes(bytes) !== document.sha256) throw new Error(`Document integrity check failed for ${document.id}.`);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const regular = await pdf.embedFont(StandardFonts.Helvetica); const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
    for (const field of fields.filter((item) => item.document_id === document.id)) {
      const page = pdf.getPages()[Number(field.page) - 1]; if (!page) continue;
      const pageWidth = page.getWidth(); const pageHeight = page.getHeight();
      const x = Number(field.x) * pageWidth; const width = Number(field.width) * pageWidth;
      const height = Number(field.height) * pageHeight; const y = pageHeight - Number(field.y) * pageHeight - height;
      const recipient = { name: field.recipient_name, email: field.recipient_email, completed_at: field.recipient_completed_at };
      if (['signature', 'initials'].includes(field.type) && field.signature_asset_id) {
        if (field.signature_mode === 'typed') drawTextWithin(page, openText(field.signature_text || '', `esign-signature-text:${field.signature_asset_id}`), x, y, width, height, italic, rgb(0.03, 0.12, 0.3));
        else if (field.signature_storage) {
          const imageBytes = readProtectedFile(field.signature_storage, `esign-signature:${field.signature_asset_id}`);
          const image = field.signature_mime === 'image/png' ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
          const scale = Math.min(width / image.width, height / image.height);
          page.drawImage(image, { x, y: y + (height - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
        }
      } else drawTextWithin(page, displayFieldValue(field, field, recipient), x, y, width, height, regular);
    }
    const copied = await output.copyPages(pdf, pdf.getPageIndices()); copied.forEach((page) => output.addPage(page));
  }
  output.setTitle((db.prepare('SELECT title FROM esign_envelopes WHERE id=?').get(envelopeId) as any).title);
  output.setProducer('Seemplify Experience e-sign'); output.setCreationDate(new Date(completedAt)); output.setModificationDate(new Date(completedAt));
  return Buffer.from(await output.save({ useObjectStreams: true, addDefaultPage: false }));
}

async function buildCertificatePdf(envelopeId: string, completedHash: string, completedAt: string, publicId: string) {
  const envelope = db.prepare('SELECT * FROM esign_envelopes WHERE id=?').get(envelopeId) as any;
  const recipients = db.prepare('SELECT * FROM esign_recipients WHERE envelope_id=? ORDER BY routing_order,position').all(envelopeId) as any[];
  const audit = db.prepare('SELECT * FROM esign_audit_events WHERE envelope_id=? ORDER BY rowid').all(envelopeId) as any[];
  const pdf = await PDFDocument.create(); const page = pdf.addPage([612, 792]); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 742;
  page.drawText('Seemplify completion certificate', { x: 48, y, size: 20, font: bold, color: rgb(0.08, 0.16, 0.12) }); y -= 34;
  const lines = [
    `Envelope: ${String(envelope.title).slice(0, 80)}`,
    `Envelope ID: ${envelopeId}`,
    `Certificate ID: ${publicId}`,
    `Completed: ${completedAt}`,
    `Completed document SHA-256: ${completedHash}`,
    `Audit events recorded: ${audit.length}`,
    '', 'Participants:'
  ];
  for (const line of lines) { page.drawText(pdfSafe(line), { x: 48, y, size: 9, font: line === 'Participants:' ? bold : regular, color: rgb(0.12, 0.14, 0.13) }); y -= 18; }
  for (const recipient of recipients) {
    const line = `${initials(recipient.name) || 'Recipient'} · ${maskEmail(recipient.email)} · ${recipient.role} · ${recipient.status}${recipient.completed_at ? ` · ${recipient.completed_at}` : ''}`;
    page.drawText(pdfSafe(line.slice(0, 100)), { x: 58, y, size: 8, font: regular, color: rgb(0.2, 0.23, 0.21) }); y -= 16;
    if (y < 80) break;
  }
  y -= 12;
  page.drawText('Integrity', { x: 48, y, size: 10, font: bold }); y -= 18;
  page.drawText(`Final audit-chain hash: ${String(audit.at(-1)?.event_hash || 'none')}`, { x: 48, y, size: 8, font: regular }); y -= 18;
  page.drawText('Verify this certificate using its opaque certificate ID in Seemplify Experience.', { x: 48, y, size: 8, font: regular, color: rgb(0.3, 0.34, 0.31) });
  pdf.setTitle('Seemplify completion certificate'); pdf.setProducer('Seemplify Experience e-sign');
  return Buffer.from(await pdf.save());
}

async function buildDetailedCertificatePdf(envelopeId: string, completedHash: string, completedAt: string, publicId: string) {
  const envelope = db.prepare('SELECT * FROM esign_envelopes WHERE id=?').get(envelopeId) as any;
  const recipients = db.prepare('SELECT * FROM esign_recipients WHERE envelope_id=? ORDER BY routing_order,position').all(envelopeId) as any[];
  const audit = db.prepare('SELECT * FROM esign_audit_events WHERE envelope_id=? ORDER BY rowid').all(envelopeId) as any[];
  const pdf = await PDFDocument.create(); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: any; let y = 0; let pageNumber = 0;
  const addPage = () => {
    page = pdf.addPage([612, 792]); y = 744; pageNumber += 1;
    page.drawText('Seemplify completion certificate', { x: 42, y, size: pageNumber === 1 ? 19 : 12, font: bold, color: rgb(0.08, 0.16, 0.12) });
    page.drawText(`Page ${pageNumber}`, { x: 520, y: 746, size: 8, font: regular, color: rgb(0.35, 0.38, 0.36) }); y -= pageNumber === 1 ? 34 : 25;
  };
  const drawLine = (value: unknown, options: { bold?: boolean; indent?: number; color?: any; gap?: number } = {}) => {
    const valueText = pdfSafe(value); const chunks = valueText ? (valueText.match(/.{1,105}(?:\s|$)|.{1,105}/g) || [valueText]).map((part) => part.trimEnd()) : [''];
    for (const chunk of chunks) {
      if (y < 52) addPage();
      page.drawText(chunk, { x: 42 + (options.indent || 0), y, size: 8, font: options.bold ? bold : regular, color: options.color || rgb(0.13, 0.15, 0.14) });
      y -= options.gap || 13;
    }
  };
  addPage();
  for (const line of [
    `Envelope: ${String(envelope.title).slice(0, 180)}`, `Envelope ID: ${envelopeId}`, `Certificate ID: ${publicId}`,
    `Completed: ${completedAt}`, `Completed document SHA-256: ${completedHash}`, `Audit events recorded in certificate: ${audit.length}`
  ]) drawLine(line);
  y -= 8; drawLine('Participants', { bold: true, gap: 17 });
  recipients.forEach((recipient, index) => {
    drawLine(`${index + 1}. ${recipient.name} <${recipient.email}> | role=${recipient.role} | routing order=${recipient.routing_order} | status=${recipient.status}`, { indent: 8 });
    drawLine(`authenticated=${recipient.authenticated_at || 'not recorded'} | consented=${recipient.consented_at || 'not recorded'} | completed=${recipient.completed_at || 'not applicable'} | access code=${recipient.access_code_hash ? 'required' : 'not required'}`, { indent: 18, color: rgb(0.3, 0.33, 0.31) });
  });
  y -= 8; drawLine('Immutable audit evidence', { bold: true, gap: 17 });
  audit.forEach((event, index) => {
    const metadata = stableJson(parseJson(event.metadata_json, {}));
    drawLine(`${index + 1}. ${event.created_at} | ${event.event_type} | actor=${event.actor_type} | recipient=${event.recipient_id || '-'} | user=${event.actor_user_id || '-'}`, { indent: 8 });
    drawLine(`IP=${event.ip_address || '-'} | user-agent=${event.user_agent || '-'} | metadata=${metadata}`, { indent: 18, color: rgb(0.3, 0.33, 0.31) });
    drawLine(`previous=${event.previous_hash || 'genesis'} | event=${event.event_hash}`, { indent: 18, color: rgb(0.3, 0.33, 0.31) });
  });
  y -= 8; drawLine('Integrity', { bold: true, gap: 17 });
  drawLine(`Completion audit checkpoint hash: ${String(audit.at(-1)?.event_hash || 'none')}`);
  drawLine('This checkpoint covers the completed document hash and every audit event listed above. Events created after certificate generation remain verifiable in the live audit chain.');
  drawLine('Verify this certificate using its opaque certificate ID in Seemplify Experience.', { color: rgb(0.3, 0.34, 0.31) });
  pdf.setTitle('Seemplify completion certificate'); pdf.setProducer('Seemplify Experience e-sign'); pdf.setCreationDate(new Date(completedAt)); pdf.setModificationDate(new Date(completedAt));
  return { bytes: Buffer.from(await pdf.save()), pageCount: pdf.getPageCount() };
}

async function finalizeEnvelope(envelopeId: string) {
  const envelope = db.prepare("SELECT * FROM esign_envelopes WHERE id=? AND status='finalizing'").get(envelopeId) as any;
  if (!envelope) return;
  const existing = db.prepare("SELECT 1 FROM esign_artifacts WHERE envelope_id=? AND kind='completed_pdf'").get(envelopeId);
  if (existing) {
    db.prepare("UPDATE esign_envelopes SET status='completed',completed_at=COALESCE(completed_at,?),finalization_attempt=0,finalization_retry_at=NULL,finalization_error=NULL,updated_at=? WHERE id=? AND status='finalizing'").run(now(), now(), envelopeId);
    return;
  }
  const completedAt = String((db.prepare("SELECT MAX(completed_at) completed_at FROM esign_recipients WHERE envelope_id=? AND role IN ('signer','approver')").get(envelopeId) as any)?.completed_at || now());
  const completedBytes = await buildCompletedPdf(envelopeId, completedAt); const completedHash = hashBytes(completedBytes);
  const priorCheckpoint = db.prepare("SELECT metadata_json FROM esign_audit_events WHERE envelope_id=? AND event_type='envelope.completion_checkpoint' ORDER BY rowid DESC LIMIT 1").get(envelopeId) as any;
  const priorCheckpointHash = parseJson<Record<string, unknown>>(priorCheckpoint?.metadata_json, {}).completedDocumentSha256;
  if (priorCheckpointHash !== completedHash) {
    db.transaction(() => recordEsignAudit(envelopeId, 'envelope.completion_checkpoint', { actorType: 'system' }, {
      completedDocumentSha256: completedHash, completedAt,
      actionRecipientCount: Number((db.prepare("SELECT COUNT(*) count FROM esign_recipients WHERE envelope_id=? AND role IN ('signer','approver')").get(envelopeId) as any).count)
    }))();
  }
  const publicId = randomOpaqueToken(18); const certificate = await buildDetailedCertificatePdf(envelopeId, completedHash, completedAt, publicId);
  const completedId = crypto.randomUUID(); const certificateId = crypto.randomUUID();
  const completedStored = writeProtectedFile(completedBytes, `esign-artifact:${completedId}`); const certificateStored = writeProtectedFile(certificate.bytes, `esign-artifact:${certificateId}`);
  try {
    db.transaction(() => {
      const current = db.prepare("SELECT status FROM esign_envelopes WHERE id=?").get(envelopeId) as any;
      if (current?.status !== 'finalizing') throw new Error('Envelope is no longer finalizing.');
      db.prepare(`INSERT INTO esign_artifacts (id,envelope_id,kind,file_name,mime_type,size_bytes,page_count,storage_key,sha256,state,created_at)
        VALUES (?,?, 'completed_pdf',?,'application/pdf',?,?,?,?, 'ready',?)`).run(completedId, envelopeId, `${safeFilename(envelope.title).replace(/\.pdf$/i, '')}-completed.pdf`, completedStored.size, (awaitPageCountPlaceholder(completedBytes)), completedStored.storageKey, completedStored.sha256, completedAt);
      db.prepare(`INSERT INTO esign_artifacts (id,envelope_id,kind,file_name,mime_type,size_bytes,page_count,storage_key,sha256,public_id,state,created_at)
        VALUES (?,?, 'completion_certificate',?,'application/pdf',?,?,?,?,?,'ready',?)`).run(certificateId, envelopeId, `${safeFilename(envelope.title).replace(/\.pdf$/i, '')}-certificate.pdf`, certificateStored.size, certificate.pageCount, certificateStored.storageKey, certificateStored.sha256, publicId, completedAt);
      db.prepare("UPDATE esign_envelopes SET status='completed',completed_at=?,finalization_attempt=0,finalization_retry_at=NULL,finalization_error=NULL,updated_at=?,revision=revision+1 WHERE id=? AND status='finalizing'").run(completedAt, completedAt, envelopeId);
      recordEsignAudit(envelopeId, 'envelope.completed', { actorType: 'system' }, { completedDocumentSha256: completedHash, certificateId: publicId });
      const recipients = db.prepare('SELECT id FROM esign_recipients WHERE envelope_id=?').all(envelopeId) as any[];
      recipients.forEach((recipient) => queueEmail(envelopeId, recipient.id, 'completed', completedAt));
    })();
  } catch (error) { removeProtectedFile(completedStored.storageKey); removeProtectedFile(certificateStored.storageKey); throw error; }
  publishEvent('esign', { envelopeId, reason: 'completed', certificateId: publicId }, envelope.space_id);
}

function scheduleFinalizationRetry(envelopeId: string, caught: unknown) {
  const message = (caught instanceof Error ? caught.message : String(caught)).slice(0, 1000); const timestamp = now();
  let terminal = false; let attempt = 0; let retryAt: string | null = null; let spaceId: string | null = null;
  db.transaction(() => {
    const current = db.prepare("SELECT finalization_attempt,space_id FROM esign_envelopes WHERE id=? AND status='finalizing'").get(envelopeId) as any;
    if (!current) return;
    spaceId = current.space_id;
    attempt = Number(current.finalization_attempt || 0) + 1; terminal = attempt >= 5;
    retryAt = terminal ? null : new Date(Date.now() + Math.min(300, 5 * (2 ** Math.max(0, attempt - 1))) * 1000).toISOString();
    db.prepare(`UPDATE esign_envelopes SET status=?,finalization_attempt=?,finalization_retry_at=?,finalization_error=?,updated_at=?,revision=revision+1
      WHERE id=? AND status='finalizing'`).run(terminal ? 'failed' : 'finalizing', attempt, retryAt, message, timestamp, envelopeId);
    recordEsignAudit(envelopeId, terminal ? 'envelope.finalization_failed' : 'envelope.finalization_retry_scheduled', { actorType: 'system' }, { attempt, retryAt, error: message });
  })();
  if (spaceId) publishEvent('esign', { envelopeId, reason: terminal ? 'finalization-failed' : 'finalization-retry-scheduled', attempt, retryAt, error: message }, spaceId);
}

function awaitPageCountPlaceholder(bytes: Buffer) {
  const count = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  return Math.max(1, count);
}

function auditChainValid(envelopeId: string) {
  const rows = db.prepare('SELECT * FROM esign_audit_events WHERE envelope_id=? ORDER BY rowid').all(envelopeId) as any[];
  let previousHash: string | null = null;
  for (const row of rows) {
    if ((row.previous_hash || null) !== previousHash) return false;
    const metadata = parseJson(row.metadata_json, {});
    const canonical = stableJson({ id: row.id, envelopeId: row.envelope_id, recipientId: row.recipient_id || null, actorUserId: row.actor_user_id || null, actorType: row.actor_type, eventType: row.event_type, ipAddress: row.ip_address || null, userAgent: row.user_agent || null, metadata, previousHash, createdAt: row.created_at });
    if (auditDigest(canonical) !== row.event_hash) return false;
    previousHash = row.event_hash;
  }
  return rows.length > 0;
}

export function verifyPublicCertificate(publicId: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(publicId)) throw new EsignError('Certificate not found.', 404);
  const certificate = db.prepare(`SELECT a.*,e.status envelope_status,e.completed_at FROM esign_artifacts a JOIN esign_envelopes e ON e.id=a.envelope_id
    WHERE a.public_id=? AND a.kind='completion_certificate' AND a.state='ready'`).get(publicId) as any;
  if (!certificate) throw new EsignError('Certificate not found.', 404);
  const completed = db.prepare("SELECT * FROM esign_artifacts WHERE envelope_id=? AND kind='completed_pdf' AND state='ready'").get(certificate.envelope_id) as any;
  let certificateIntegrity = false; let documentIntegrity = false;
  try { certificateIntegrity = hashBytes(readProtectedFile(certificate.storage_key, `esign-artifact:${certificate.id}`)) === certificate.sha256; } catch { /* invalid */ }
  try { documentIntegrity = Boolean(completed) && hashBytes(readProtectedFile(completed.storage_key, `esign-artifact:${completed.id}`)) === completed.sha256; } catch { /* invalid */ }
  const participants = (db.prepare('SELECT name,email,role,status,completed_at FROM esign_recipients WHERE envelope_id=? ORDER BY routing_order,position').all(certificate.envelope_id) as any[]).map((item) => ({ initials: initials(item.name), maskedEmail: maskEmail(item.email), role: item.role, status: item.status, completedAt: item.completed_at }));
  const valid = certificate.envelope_status === 'completed' && certificateIntegrity && documentIntegrity && auditChainValid(certificate.envelope_id);
  return { valid, certificateId: publicId, envelopeId: certificate.envelope_id, status: certificate.envelope_status, completedAt: certificate.completed_at, documentHash: completed?.sha256 || null, certificateHash: certificate.sha256, participants };
}

const claimEmailDelivery = db.transaction(() => {
  const timestamp = now();
  const row = db.prepare("SELECT * FROM esign_email_deliveries WHERE state='queued' AND scheduled_at<=? ORDER BY scheduled_at,created_at LIMIT 1").get(timestamp) as any;
  if (!row) return null;
  const changed = db.prepare("UPDATE esign_email_deliveries SET state='sending',attempt=attempt+1,updated_at=? WHERE id=? AND state='queued'").run(timestamp, row.id).changes;
  return changed ? db.prepare('SELECT * FROM esign_email_deliveries WHERE id=?').get(row.id) as any : null;
});

async function processEmailDelivery(delivery: any) {
  const row = db.prepare(`SELECT d.*,e.title,e.subject,e.message,e.status envelope_status,e.void_reason,e.space_id,r.name,r.email,r.role recipient_role,r.access_token_enc,r.status recipient_status
    FROM esign_email_deliveries d JOIN esign_envelopes e ON e.id=d.envelope_id JOIN esign_recipients r ON r.id=d.recipient_id WHERE d.id=?`).get(delivery.id) as any;
  if (!row) return;
  if (row.kind !== 'voided' && row.kind !== 'completed' && !['sent', 'in_progress'].includes(row.envelope_status)) {
    db.prepare("UPDATE esign_email_deliveries SET state='cancelled',error='Envelope is no longer active',updated_at=? WHERE id=?").run(now(), row.id); return;
  }
  const rawToken = openText(row.access_token_enc, `esign-recipient-token:${row.recipient_id}`);
  const signerUrl = `${config.publicUrl}/sign?token=${encodeURIComponent(rawToken)}`;
  let subject = row.subject || `Please sign: ${row.title}`; let heading = 'Your signature is requested'; let action = 'Review and sign';
  let text = `${row.name},\n\n${row.message || `Please review and sign “${row.title}”.`}\n\n${signerUrl}`;
  if (row.kind === 'reminder') { subject = `Reminder: ${subject}`; heading = 'Signature reminder'; }
  if (row.kind === 'completed') { subject = `Completed: ${row.title}`; heading = 'Envelope completed'; action = 'View completed documents'; text = `${row.name},\n\n“${row.title}” has been completed.\n\n${signerUrl}`; }
  if (row.kind === 'voided') { subject = `Voided: ${row.title}`; heading = 'Envelope voided'; action = ''; text = `${row.name},\n\n“${row.title}” was voided.${row.void_reason ? ` Reason: ${row.void_reason}` : ''}`; }
  const actionHtml = action ? `<p><a href="${escapeHtml(signerUrl)}" style="display:inline-block;background:#26352e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">${escapeHtml(action)}</a></p><p style="font-size:12px;color:#69716c;word-break:break-all">${escapeHtml(signerUrl)}</p>` : '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#20211f;line-height:1.6;max-width:620px;margin:auto"><h2>${escapeHtml(heading)}</h2><p>Hello ${escapeHtml(row.name)},</p><p>${escapeHtml(row.kind === 'voided' ? `“${row.title}” was voided.${row.void_reason ? ` Reason: ${row.void_reason}` : ''}` : row.kind === 'completed' ? `“${row.title}” has been completed.` : row.message || `Please review and sign “${row.title}”.`)}</p>${actionHtml}<p style="font-size:12px;color:#69716c">Signing activity is recorded in the envelope audit trail. Do not forward a signing link.</p></div>`;
  try {
    const result = await sendTransactionalEmail({ to: row.email, name: row.name, subject, html, text, idempotencyKey: row.idempotency_key, correlation: `esign_delivery:${row.id}` });
    const timestamp = now(); const debug = config.emailMode === 'log' && action ? sealText(signerUrl, `esign-debug-link:${row.id}`) : null;
    db.transaction(() => {
      db.prepare("UPDATE esign_email_deliveries SET state='sent',provider_message_id=?,debug_link_enc=?,error=NULL,sent_at=?,updated_at=? WHERE id=? AND state='sending'")
        .run((result as any).messageId || '', debug, timestamp, timestamp, row.id);
      if (['invitation', 'reminder'].includes(row.kind)) db.prepare("UPDATE esign_recipients SET status=CASE WHEN status IN ('ready','delivery_failed') THEN 'sent' ELSE status END,invitation_sent_at=COALESCE(invitation_sent_at,?),updated_at=? WHERE id=?").run(timestamp, timestamp, row.recipient_id);
      if (row.kind === 'completed' && ['cc', 'viewer'].includes(row.recipient_role)) db.prepare("UPDATE esign_recipients SET status='notified',invitation_sent_at=COALESCE(invitation_sent_at,?),updated_at=? WHERE id=? AND status='waiting'").run(timestamp, timestamp, row.recipient_id);
      recordEsignAudit(row.envelope_id, `email.${row.kind}_sent`, { actorType: 'system', recipientId: row.recipient_id }, { deliveryId: row.id, providerMessageId: (result as any).messageId || null });
    })();
    publishEvent('esign', { envelopeId: row.envelope_id, reason: 'email-sent', kind: row.kind, recipientId: row.recipient_id }, row.space_id);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000); const timestamp = now(); const attempt = Number(row.attempt);
    if (attempt >= Number(row.max_attempts)) db.prepare("UPDATE esign_email_deliveries SET state='failed',error=?,updated_at=? WHERE id=?").run(message, timestamp, row.id);
    else {
      const delayMinutes = Math.min(8, 2 ** Math.max(0, attempt - 1));
      db.prepare("UPDATE esign_email_deliveries SET state='queued',scheduled_at=?,error=?,updated_at=? WHERE id=?").run(new Date(Date.now() + delayMinutes * 60_000).toISOString(), message, timestamp, row.id);
    }
    publishEvent('esign', { envelopeId: row.envelope_id, reason: 'email-failed', kind: row.kind, recipientId: row.recipient_id }, row.space_id);
  }
}

function expireDueEnvelopes() {
  const timestamp = now(); const rows = db.prepare("SELECT id,space_id FROM esign_envelopes WHERE status IN ('sent','in_progress') AND expires_at IS NOT NULL AND expires_at<=?").all(timestamp) as any[];
  for (const row of rows) {
    db.transaction(() => {
      db.prepare("UPDATE esign_envelopes SET status='expired',updated_at=?,revision=revision+1 WHERE id=? AND status IN ('sent','in_progress')").run(timestamp, row.id);
      db.prepare('UPDATE esign_signing_sessions SET revoked_at=? WHERE recipient_id IN (SELECT id FROM esign_recipients WHERE envelope_id=?) AND revoked_at IS NULL').run(timestamp, row.id);
      db.prepare("UPDATE esign_email_deliveries SET state='cancelled',error='Envelope expired',updated_at=? WHERE envelope_id=? AND state='queued'").run(timestamp, row.id);
      recordEsignAudit(row.id, 'envelope.expired', { actorType: 'system' }, {});
    })();
    publishEvent('esign', { envelopeId: row.id, reason: 'expired' }, row.space_id);
  }
}

function queueAutomaticReminders() {
  const timestamp = now();
  const envelopes = db.prepare(`SELECT * FROM esign_envelopes WHERE status IN ('sent','in_progress') AND reminder_interval_hours IS NOT NULL
    AND datetime(COALESCE(last_reminder_at,sent_at), '+' || reminder_interval_hours || ' hours')<=datetime(?)`).all(timestamp) as any[];
  for (const envelope of envelopes) {
    db.transaction(() => {
      const claimed = db.prepare(`UPDATE esign_envelopes SET last_reminder_at=?,updated_at=? WHERE id=? AND status IN ('sent','in_progress')
        AND reminder_interval_hours IS NOT NULL AND datetime(COALESCE(last_reminder_at,sent_at), '+' || reminder_interval_hours || ' hours')<=datetime(?)`).run(timestamp, timestamp, envelope.id, timestamp).changes;
      if (claimed !== 1) return;
      const recipients = db.prepare("SELECT id FROM esign_recipients WHERE envelope_id=? AND status IN ('ready','sent','viewed','in_progress')").all(envelope.id) as any[];
      recipients.forEach((recipient) => queueEmail(envelope.id, recipient.id, 'reminder', timestamp));
      recordEsignAudit(envelope.id, 'envelope.automatic_reminder_queued', { actorType: 'system' }, { count: recipients.length });
    })();
  }
}

export class EsignWorker {
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private stopped = true;
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const timestamp = now(); const safeAfter = new Date(Date.now() - config.brevoIdempotencyTtlMinutes * 60_000).toISOString();
    db.prepare("UPDATE esign_email_deliveries SET state='failed',error='Delivery state is unknown outside the provider idempotency window; it was not resent.',updated_at=? WHERE state='sending' AND updated_at<?").run(timestamp, safeAfter);
    db.prepare("UPDATE esign_email_deliveries SET state='queued',error=COALESCE(error,'Recovered after restart'),updated_at=? WHERE state='sending'").run(timestamp);
    db.prepare('DELETE FROM esign_signing_sessions WHERE expires_at<? OR revoked_at IS NOT NULL AND revoked_at<?').run(now(), new Date(Date.now() - 7 * 86_400_000).toISOString());
    this.timer = setInterval(() => void this.pump(), config.esignWorkerPollMs); this.timer.unref(); void this.pump();
  }
  async stop(timeoutMs = 10_000) {
    this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null;
    if (!this.active) return true;
    return Promise.race([this.active.then(() => true), new Promise<boolean>((resolve) => { const timer = setTimeout(() => resolve(false), timeoutMs); timer.unref(); })]);
  }
  pump() {
    if (this.stopped) return Promise.resolve(); if (this.active) return this.active;
    const running = this.run().catch((error) => console.error('E-sign worker failed:', error instanceof Error ? error.message : String(error)));
    this.active = running; void running.finally(() => { if (this.active === running) this.active = null; }); return running;
  }
  private async run() {
    expireDueEnvelopes(); queueAutomaticReminders();
    const finalizing = db.prepare("SELECT id FROM esign_envelopes WHERE status='finalizing' AND (finalization_retry_at IS NULL OR finalization_retry_at<=?) ORDER BY COALESCE(finalization_retry_at,updated_at) LIMIT 5").all(now()) as any[];
    for (const envelope of finalizing) {
      try { await finalizeEnvelope(envelope.id); }
      catch (error) { scheduleFinalizationRetry(envelope.id, error); console.error(`E-sign finalization failed for ${envelope.id}:`, error instanceof Error ? error.message : String(error)); }
    }
    for (let count = 0; count < 25 && !this.stopped; count += 1) { const delivery = claimEmailDelivery(); if (!delivery) break; await processEmailDelivery(delivery); }
  }
}

export const esignWorker = new EsignWorker();
