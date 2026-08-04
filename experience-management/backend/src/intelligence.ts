import crypto from 'node:crypto';
import { socialListeningResultFor } from './aiSchemas.js';
import type { SessionUser } from './auth.js';
import {
  auditKnowledge, createKnowledgeMarkdownDocument, getKnowledgeBase, getKnowledgeContext, getKnowledgeDocument, getKnowledgeJob,
  listKnowledgeBases,
  type KnowledgeBaseRef, type KnowledgeDocumentRecord, type KnowledgeJobRecord
} from './knowledgeRepository.js';
import { createJob, db, getJob, getJobProviderResult, listSocialMentionsByIdsForSpace } from './database.js';
import { publishEvent } from './events.js';
import { assertCanQueueAiAction } from './subscriptionEntitlements.js';
import './spaces.js';

if (db.provider === 'sqlite') {
  const intelligenceColumns = new Set((db.prepare('PRAGMA table_info(intelligence_reports)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!intelligenceColumns.has('knowledge_refs_json')) {
    db.exec("ALTER TABLE intelligence_reports ADD COLUMN knowledge_refs_json TEXT NOT NULL DEFAULT '[]'");
  }
  db.exec(`DROP INDEX IF EXISTS intelligence_reports_one_active_request;
    CREATE UNIQUE INDEX intelligence_reports_one_active_request
      ON intelligence_reports(space_id,user_id,title,objective,source_refs_json,knowledge_refs_json) WHERE state='queued'`);
}

export class IntelligenceError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = 'IntelligenceError'; this.status = status; }
}

const now = () => new Date().toISOString();
function parseJson<T>(value: unknown, fallback: T): T { try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; } }
function cleanText(value: unknown, maximum: number) { return String(value || '').trim().replace(/\s+/gu, ' ').slice(0, maximum); }
function sha256(value: string) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }

function canonicalEvidenceSourceRef(value: unknown, sources: Map<string, unknown>) {
  const original = String(value || '').trim();
  if (sources.has(original)) return original;
  let candidate = original;
  const wrappers: Array<[string, string]> = [['[', ']'], ['`', '`'], ['"', '"'], ["'", "'"]];
  for (let depth = 0; depth < 3; depth += 1) {
    const wrapper = wrappers.find(([start, end]) => candidate.startsWith(start) && candidate.endsWith(end));
    if (!wrapper || candidate.length <= wrapper[0].length + wrapper[1].length) break;
    candidate = candidate.slice(wrapper[0].length, -wrapper[1].length).trim();
    if (sources.has(candidate)) return candidate;
  }
  return original;
}

export type SocialObservationWindow = {
  periodStart: string | null;
  periodEnd: string | null;
  asOf: string | null;
  postCount: number;
  breakdown: { accountPosts: number; mentions: number; searchResults: number; unclassified: number };
};

type SocialSnapshotItem = {
  sourceRef?: unknown; publishedAt?: unknown; streams?: unknown; ingestionKind?: unknown;
  author?: unknown; content?: unknown; analysis?: unknown;
};

function validIsoTimestamp(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/** Deterministic facts only: no model-generated values participate. */
export function socialObservationWindow(snapshotValue: unknown): SocialObservationWindow {
  const snapshot = Array.isArray(snapshotValue) ? snapshotValue as SocialSnapshotItem[] : [];
  const timestamps = snapshot.map((item) => validIsoTimestamp(item?.publishedAt)).filter((item): item is string => Boolean(item)).sort();
  let accountPosts = 0; let mentions = 0; let searchResults = 0; let unclassified = 0;
  for (const item of snapshot) {
    const supplied = Array.isArray(item?.streams) ? item.streams.map(String) : [];
    const streams = new Set(supplied.length ? supplied : item?.ingestionKind ? [String(item.ingestionKind)] : []);
    if (streams.has('account_post')) accountPosts += 1;
    if (streams.has('mention')) mentions += 1;
    if (streams.has('search')) searchResults += 1;
    if (![...streams].some((stream) => ['account_post', 'mention', 'search'].includes(stream))) unclassified += 1;
  }
  const periodStart = timestamps[0] || null;
  const periodEnd = timestamps.at(-1) || null;
  return { periodStart, periodEnd, asOf: periodEnd, postCount: snapshot.length,
    breakdown: { accountPosts, mentions, searchResults, unclassified } };
}
function preview(payload: unknown) {
  if (payload && typeof payload === 'object') {
    const value = payload as Record<string, unknown>;
    return cleanText(value.executiveSummary || value.summary || value.title || JSON.stringify(payload), 240);
  }
  return cleanText(payload, 240);
}
function normalizedEvidence(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return cleanText(value, 100_000).toLocaleLowerCase('en-US');
  if (Array.isArray(value)) return value.map(normalizedEvidence).filter(Boolean).join('\n');
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map(normalizedEvidence).filter(Boolean).join('\n');
  return '';
}

function canonicalSocialEvidence(value: unknown, maximum = 100_000): string {
  return cleanText(value, maximum)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/["'`´‘’‚‛“”„‟«»‹›]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function orderedEllipsisIsGrounded(value: unknown, sourceBody: string): boolean {
  const raw = cleanText(value, 1000).normalize('NFKC');
  if (!/(?:…|\.{3,})/u.test(raw)) return false;
  const fragments = raw.split(/(?:…|\.{3,})/u).map((fragment) => canonicalSocialEvidence(fragment, 1000)).filter(Boolean);
  if (fragments.length < 2 || fragments.length > 3 || fragments.some((fragment) => fragment.length < 12)) return false;
  let cursor = 0;
  for (const fragment of fragments) {
    const index = sourceBody.indexOf(fragment, cursor);
    if (index < 0) return false;
    cursor = index + fragment.length;
  }
  return true;
}

export function validateSocialListeningEvidence(sources: Array<{ sourceRef: string; content: string }>, result: any) {
  const expected = new Map(sources.map((source) => [String(source.sourceRef), canonicalSocialEvidence(source.content)]));
  const returned = Array.isArray(result?.mentions) ? result.mentions.map((mention: any) => String(mention.mentionId)) : [];
  if (returned.length !== expected.size || new Set(returned).size !== expected.size || returned.some((mentionId: string) => !expected.has(mentionId))) {
    throw new IntelligenceError('Terra did not return exactly one analysis for every saved source.', 400);
  }
  const sentimentTotal = ['negative', 'neutral', 'positive', 'mixed'].reduce((total, key) => total + Number(result?.sentiment?.[key] || 0), 0);
  if (sentimentTotal !== expected.size) throw new IntelligenceError('Terra returned sentiment counts that do not match the saved dataset.', 400);
  const sourceBodies = [...expected.values()];
  const evidenceIsGrounded = (value: unknown, exactSourceRef?: string) => {
    const sourceRef = cleanText(value, 1000);
    if (expected.has(sourceRef)) return exactSourceRef === undefined || sourceRef === exactSourceRef;
    const excerpt = canonicalSocialEvidence(value, 1000);
    const candidates = exactSourceRef === undefined ? sourceBodies : [expected.get(exactSourceRef) || ''];
    return candidates.some((body) => {
      const minimum = Math.min(12, body.length);
      if (minimum <= 0 || excerpt.length < minimum) return false;
      return body.includes(excerpt) || orderedEllipsisIsGrounded(value, body);
    });
  };
  const evidence = [
    ...(result?.themes || []).flatMap((item: any) => item.evidence || []),
    ...(result?.emergingTrends || []).flatMap((item: any) => item.evidence || []),
    ...(result?.risks || []).flatMap((item: any) => item.evidence || []),
    ...(result?.opportunities || []).flatMap((item: any) => item.evidence || [])
  ];
  for (const excerpt of evidence) {
    if (!evidenceIsGrounded(excerpt)) throw new IntelligenceError('Terra returned evidence that was not present in the saved sources.', 400);
  }
  for (const mention of result.mentions || []) {
    const sourceRef = String(mention.mentionId);
    if (!expected.has(sourceRef) || !evidenceIsGrounded(mention.evidence, sourceRef)) {
      throw new IntelligenceError(`Terra returned ungrounded evidence for ${String(mention.mentionId)}.`, 400);
    }
  }
}

function spaceOwnsConnection(spaceId: string, connectionId: string) {
  return Boolean(db.prepare('SELECT 1 FROM x_connections WHERE id=? AND space_id=?').get(connectionId, spaceId));
}
function ownedXMention(spaceId: string, mentionId: string) {
  return db.prepare(`SELECT m.* FROM social_mentions m JOIN x_connection_mentions cm ON cm.mention_id=m.id
    JOIN x_connections c ON c.id=cm.connection_id WHERE m.id=? AND m.source='x' AND c.space_id=? LIMIT 1`).get(mentionId, spaceId) as any;
}

function artifactJob(row: any) {
  const job = row?.ai_job_id ? getJob(row.ai_job_id) : null;
  return job && job.spaceId === row.space_id ? job : null;
}

function replyPublicationForDraft(row: any) {
  if (row.state !== 'published') return null;
  const receipt = db.prepare(`SELECT after_json,created_at FROM platform_audit_events
    WHERE space_id=? AND target_type='social_reply_draft' AND target_id=? AND action='social_reply.published'
    ORDER BY created_at DESC,id DESC LIMIT 1`).get(row.space_id, row.id) as { after_json: string; created_at: string } | undefined;
  if (!receipt) return null;
  const detail = parseJson<Record<string, unknown>>(receipt.after_json, {});
  return { tweetId: String(detail.tweetId || ''), url: String(detail.url || ''),
    postedBy: String(detail.postedBy || ''), postedAt: receipt.created_at };
}

function rowReplyDraft(row: any) {
  const job = artifactJob(row);
  return {
    id: row.id, mentionId: row.mention_id, connectionId: row.connection_id, tone: row.tone, instructions: row.instructions,
    state: job?.state === 'failed' ? 'failed' : row.state, generatedContent: row.generated_content, content: row.content,
    rationale: row.rationale, safetyFlags: parseJson<string[]>(row.safety_flags_json, []), runtime: parseJson(row.runtime_json, null),
    aiJobId: row.ai_job_id, error: job?.error || row.error, publication: replyPublicationForDraft(row),
    createdAt: row.created_at, completedAt: row.completed_at, updatedAt: row.updated_at
  };
}

export function listSocialReplyDrafts(_user: SessionUser, spaceId: string, mentionId?: string) {
  const parameters: unknown[] = [spaceId]; let mentionFilter = '';
  if (mentionId) { parameters.push(mentionId); mentionFilter = ' AND d.mention_id=?'; }
  return (db.prepare(`SELECT d.* FROM social_reply_drafts d WHERE d.space_id=?${mentionFilter}
    ORDER BY d.created_at DESC LIMIT 200`).all(...parameters) as any[]).map(rowReplyDraft);
}

export function createSocialReplyDraft(user: SessionUser, spaceId: string, input: { mentionId: string; tone: string; instructions?: string; idempotencyKey?: string }) {
  const mention = ownedXMention(spaceId, input.mentionId);
  if (!mention) throw new IntelligenceError('X post not found for this account.', 404);
  const connection = db.prepare(`SELECT c.* FROM x_connections c JOIN x_connection_mentions cm ON cm.connection_id=c.id
    WHERE cm.mention_id=? AND c.space_id=? LIMIT 1`).get(input.mentionId, spaceId) as any;
  const id = crypto.randomUUID(); const timestamp = now(); const instructions = cleanText(input.instructions, 1000);
  const source = { mentionId: mention.id, author: mention.author, content: mention.content, url: mention.url,
    publishedAt: mention.published_at, analysis: parseJson(mention.analysis_json, null) };
  const created = db.transaction(() => {
    if (input.idempotencyKey) {
      const replay = db.prepare('SELECT * FROM social_reply_drafts WHERE space_id=? AND requested_by=? AND idempotency_key=?').get(spaceId, user.id, input.idempotencyKey) as any;
      if (replay) {
        if (replay.mention_id !== mention.id || replay.tone !== input.tone || replay.instructions !== instructions) throw new IntelligenceError('This idempotency key was already used for a different reply request.', 409);
        const job = artifactJob(replay);
        if (!job) throw new IntelligenceError('The original idempotent reply request is no longer available.', 409);
        return { draft: rowReplyDraft(replay), job, created: false };
      }
    }
    const existing = db.prepare(`SELECT * FROM social_reply_drafts WHERE space_id=? AND requested_by=? AND mention_id=? AND tone=? AND instructions=? AND state='queued'
      ORDER BY created_at LIMIT 1`).get(spaceId, user.id, mention.id, input.tone, instructions) as any;
    if (existing) {
      const job = artifactJob(existing);
      if (job && ['queued', 'processing'].includes(job.state)) return { draft: rowReplyDraft(existing), job, created: false };
      db.prepare("UPDATE social_reply_drafts SET state='failed',error='The previous queue record was no longer active.',updated_at=? WHERE id=?")
        .run(timestamp, existing.id);
    }
    assertCanQueueAiAction(spaceId);
    db.prepare(`INSERT INTO social_reply_drafts (id,space_id,mention_id,connection_id,requested_by,tone,instructions,source_snapshot_json,state,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'queued',?,?,?)`).run(id, spaceId, mention.id, connection.id, user.id, input.tone, instructions, JSON.stringify(source), input.idempotencyKey || null, timestamp, timestamp);
    const job = createJob('social.reply_draft', { draftId: id }, spaceId, null, null, user.id);
    db.prepare('UPDATE social_reply_drafts SET ai_job_id=? WHERE id=?').run(job.id, id);
    return { draft: rowReplyDraft(db.prepare('SELECT * FROM social_reply_drafts WHERE id=?').get(id)), job, created: true };
  })();
  publishEvent('data-changed', { reason: 'social-reply-draft-created', draftId: id }, spaceId);
  return created;
}

export function updateSocialReplyDraft(_user: SessionUser, spaceId: string, id: string, input: { content?: string; archived?: boolean }) {
  const row = db.prepare('SELECT * FROM social_reply_drafts WHERE id=? AND space_id=?').get(id, spaceId) as any;
  if (!row) throw new IntelligenceError('Reply draft not found.', 404);
  if (row.state === 'queued') throw new IntelligenceError('Wait for Terra to finish before editing or archiving this draft.', 409);
  if (['publishing', 'published', 'publish_unknown'].includes(row.state)) {
    throw new IntelligenceError('A reply cannot be edited after publication has started.', 409);
  }
  if (input.content !== undefined && !cleanText(input.content, 280)) throw new IntelligenceError('A reply draft cannot be empty.');
  const state = input.archived ? 'archived' : input.content !== undefined ? 'edited' : row.state;
  db.prepare('UPDATE social_reply_drafts SET content=?,state=?,updated_at=? WHERE id=?')
    .run(input.content === undefined ? row.content : cleanText(input.content, 280), state, now(), id);
  publishEvent('data-changed', { reason: 'social-reply-draft-updated', draftId: id }, spaceId);
  return rowReplyDraft(db.prepare('SELECT * FROM social_reply_drafts WHERE id=?').get(id));
}

export function replyDraftExecutionInput(id: string, spaceId?: string) {
  const row = spaceId
    ? db.prepare('SELECT * FROM social_reply_drafts WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM social_reply_drafts WHERE id=?').get(id) as any;
  if (!row) throw new IntelligenceError('Reply draft was deleted.', 404);
  return { id: row.id, tone: row.tone, instructions: row.instructions, source: parseJson(row.source_snapshot_json, {}) };
}

export function completeSocialReplyDraft(id: string, output: { reply: string; rationale: string; safetyFlags: string[] }, runtime: unknown, spaceId?: string) {
  const current = spaceId
    ? db.prepare('SELECT * FROM social_reply_drafts WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM social_reply_drafts WHERE id=?').get(id) as any;
  if (!current) throw new IntelligenceError('Reply draft was deleted.', 404);
  if (current && ['ready', 'edited', 'archived', 'publishing', 'published', 'publish_failed', 'publish_unknown'].includes(current.state) && current.generated_content) return rowReplyDraft(current);
  const timestamp = now();
  const changed = db.prepare(`UPDATE social_reply_drafts SET state='ready',generated_content=?,content=?,rationale=?,safety_flags_json=?,runtime_json=?,error=NULL,
    completed_at=?,updated_at=? WHERE id=? AND state='queued'`).run(output.reply, output.reply, output.rationale, JSON.stringify(output.safetyFlags), JSON.stringify(runtime), timestamp, timestamp, id).changes;
  if (!changed) throw new IntelligenceError('Reply draft changed while Terra was generating it.', 409);
  publishEvent('data-changed', { reason: 'social-reply-draft-ready', draftId: id }, current.space_id);
  return rowReplyDraft(db.prepare('SELECT * FROM social_reply_drafts WHERE id=?').get(id));
}

function rowSocialPublication(row: any) {
  const documentState = String(row.document_state || 'queued');
  const jobState = String(row.job_state || '');
  const state = row.document_deleted_at || row.knowledge_base_deleted_at || ['deleted', 'deleting'].includes(documentState) ? 'deleted'
    : documentState === 'ready' ? 'ready'
    : documentState === 'failed' || jobState === 'failed' ? 'failed' : 'indexing';
  return {
    reportId: row.report_id, knowledgeBaseId: row.knowledge_base_id, knowledgeBaseName: row.knowledge_base_name,
    documentId: row.document_id, jobId: row.job_id, state, reviewStatus: 'reviewed' as const,
    sourceRequestedBy: row.source_requested_by, publishedBy: row.published_by, publishedAt: row.created_at,
    sourceSnapshotSha256: row.source_snapshot_sha256, artifactSha256: row.artifact_sha256
  };
}

function socialPublications(spaceId: string, reportId?: string, viewerUserId?: string) {
  const privacy = viewerUserId ? " AND (b.privacy='space' OR b.created_by=?)" : '';
  const parameters = [spaceId, ...(reportId ? [reportId] : []), ...(viewerUserId ? [viewerUserId] : [])];
  const rows = db.prepare(`SELECT p.*,b.name knowledge_base_name,b.deleted_at knowledge_base_deleted_at,
      d.state document_state,d.deleted_at document_deleted_at,j.state job_state
    FROM social_intelligence_publications p
    JOIN knowledge_bases b ON b.id=p.knowledge_base_id AND b.space_id=p.space_id
    JOIN knowledge_documents d ON d.id=p.document_id AND d.space_id=p.space_id
    LEFT JOIN knowledge_jobs j ON j.id=p.job_id
    WHERE p.space_id=?${reportId ? ' AND p.report_id=?' : ''}${privacy}
    ORDER BY p.created_at DESC`).all(...parameters) as any[];
  return rows.map(rowSocialPublication);
}

function rowSocialReport(row: any, suppliedPublications: ReturnType<typeof socialPublications> = []) {
  const job = artifactJob(row);
  const knowledgeBaseIds = (Array.isArray(job?.input.knowledgeBaseRefs) ? job.input.knowledgeBaseRefs : [])
    .map((ref: any) => String(ref?.id || '')).filter(Boolean);
  const sourceSnapshotJson = String(row.source_snapshot_json || '[]');
  const snapshot = parseJson<SocialSnapshotItem[]>(sourceSnapshotJson, []);
  return { id: row.id, connectionId: row.connection_id, title: row.title, mentionIds: parseJson<string[]>(row.mention_ids_json, []),
    knowledgeBaseIds, observationWindow: socialObservationWindow(snapshot), sourceSnapshotSha256: sha256(sourceSnapshotJson),
    publications: suppliedPublications,
    state: job?.state === 'failed' ? 'failed' : row.state, result: parseJson(row.result_json, null), runtime: parseJson(row.runtime_json, null),
    aiJobId: row.ai_job_id, error: job?.error || row.error, createdAt: row.created_at, completedAt: row.completed_at, updatedAt: row.updated_at };
}

export function listSocialIntelligenceReports(user: SessionUser, spaceId: string, connectionId?: string) {
  const parameters: unknown[] = [spaceId]; let connectionFilter = '';
  if (connectionId) { if (!spaceOwnsConnection(spaceId, connectionId)) throw new IntelligenceError('X connection not found.', 404); parameters.push(connectionId); connectionFilter = ' AND r.connection_id=?'; }
  const publications = socialPublications(spaceId, undefined, user.id);
  const byReport = new Map<string, typeof publications>();
  for (const publication of publications) {
    const list = byReport.get(publication.reportId) || [];
    list.push(publication); byReport.set(publication.reportId, list);
  }
  return (db.prepare(`SELECT r.* FROM social_intelligence_reports r WHERE r.space_id=?${connectionFilter} ORDER BY r.created_at DESC LIMIT 100`).all(...parameters) as any[])
    .map((row) => rowSocialReport(row, byReport.get(row.id) || []));
}

export function createSocialIntelligenceReport(user: SessionUser, spaceId: string, input: {
  connectionId: string; title: string; mentionIds?: string[]; knowledgeBaseRefs?: KnowledgeBaseRef[]; idempotencyKey?: string;
}) {
  if (!spaceOwnsConnection(spaceId, input.connectionId)) throw new IntelligenceError('X connection not found.', 404);
  if ((input.mentionIds || []).length > 200) throw new IntelligenceError('Select no more than 200 X posts for one report.');
  let ids = [...new Set(input.mentionIds || [])].slice(0, 200);
  if (!ids.length) ids = (db.prepare(`SELECT cm.mention_id id FROM x_connection_mentions cm
      JOIN social_mentions m ON m.id=cm.mention_id WHERE cm.connection_id=?
      ORDER BY m.published_at DESC,m.created_at DESC,m.id DESC LIMIT 50`)
    .all(input.connectionId) as Array<{ id: string }>).map((row) => row.id);
  if (!ids.length) throw new IntelligenceError('Collect at least one X post before generating intelligence.', 409);
  const allowed = new Set((db.prepare(`SELECT mention_id id FROM x_connection_mentions WHERE connection_id=? AND mention_id IN (${ids.map(() => '?').join(',')})`)
    .all(input.connectionId, ...ids) as Array<{ id: string }>).map((row) => row.id));
  if (allowed.size !== ids.length) throw new IntelligenceError('One or more selected X posts do not belong to this account.', 404);
  const streamRows = db.prepare(`SELECT mention_id,streams_json FROM x_connection_mentions
    WHERE connection_id=? AND mention_id IN (${ids.map(() => '?').join(',')})`).all(input.connectionId, ...ids) as Array<{ mention_id: string; streams_json: string }>;
  const streamsByMention = new Map(streamRows.map((row) => [row.mention_id,
    [...new Set(parseJson<string[]>(row.streams_json, []).filter((stream) => ['account_post', 'mention', 'search'].includes(stream)))].sort()]));
  const mentions = listSocialMentionsByIdsForSpace(ids, spaceId);
  const snapshot = mentions.map((mention) => ({ sourceRef: `x-post:${mention.id}`, author: cleanText(mention.author, 200), content: cleanText(mention.content, 1200),
    publishedAt: mention.publishedAt, streams: streamsByMention.get(mention.id) || [], ingestionKind: mention.ingestionKind || null,
    analysis: mention.analysis ? {
      sentiment: (mention.analysis as any).sentiment, sentimentScore: (mention.analysis as any).sentimentScore,
      emotions: Array.isArray((mention.analysis as any).emotions) ? (mention.analysis as any).emotions.slice(0, 12) : [],
      themes: Array.isArray((mention.analysis as any).themes) ? (mention.analysis as any).themes.slice(0, 12) : [],
      summary: cleanText((mention.analysis as any).summary, 600), risk: (mention.analysis as any).risk
    } : null }));
  const snapshotJson = JSON.stringify(snapshot);
  if (Buffer.byteLength(snapshotJson, 'utf8') > 350 * 1024) throw new IntelligenceError('The selected X post set is too large. Choose fewer posts.', 413);
  ids = [...ids].sort();
  const title = cleanText(input.title, 180) || 'X listening report';
  const idsJson = JSON.stringify(ids); const id = crypto.randomUUID(); const timestamp = now();
  const knowledgeRefsJson = JSON.stringify((input.knowledgeBaseRefs || []).slice()
    .sort((left, right) => left.id.localeCompare(right.id)));
  const jobKnowledgeRefsJson = (job: ReturnType<typeof artifactJob>) => JSON.stringify(
    (Array.isArray(job?.input.knowledgeBaseRefs) ? job.input.knowledgeBaseRefs : []).slice()
      .sort((left: any, right: any) => String(left?.id || '').localeCompare(String(right?.id || '')))
  );
  const created = db.transaction(() => {
    if (input.idempotencyKey) {
      const replay = db.prepare('SELECT * FROM social_intelligence_reports WHERE space_id=? AND user_id=? AND idempotency_key=?').get(spaceId, user.id, input.idempotencyKey) as any;
      if (replay) {
        if (replay.connection_id !== input.connectionId || replay.title !== title || replay.mention_ids_json !== idsJson) throw new IntelligenceError('This idempotency key was already used for a different social report.', 409);
        const job = artifactJob(replay);
        if (!job) throw new IntelligenceError('The original idempotent social report is no longer available.', 409);
        if (jobKnowledgeRefsJson(job) !== knowledgeRefsJson) throw new IntelligenceError('This idempotency key was already used with a different knowledge selection.', 409);
        return { report: rowSocialReport(replay), job, created: false };
      }
    }
    const existing = db.prepare(`SELECT * FROM social_intelligence_reports WHERE space_id=? AND user_id=? AND connection_id=? AND title=? AND mention_ids_json=? AND state='queued'
      ORDER BY created_at LIMIT 1`).get(spaceId, user.id, input.connectionId, title, idsJson) as any;
    if (existing) {
      const job = artifactJob(existing);
      if (job && ['queued', 'processing'].includes(job.state)) {
        if (jobKnowledgeRefsJson(job) === knowledgeRefsJson) return { report: rowSocialReport(existing), job, created: false };
        throw new IntelligenceError('An active report for this post selection uses a different knowledge selection.', 409);
      }
      db.prepare("UPDATE social_intelligence_reports SET state='failed',error='The previous queue record was no longer active.',updated_at=? WHERE id=?")
        .run(timestamp, existing.id);
    }
    assertCanQueueAiAction(spaceId);
    db.prepare(`INSERT INTO social_intelligence_reports (id,space_id,user_id,connection_id,title,mention_ids_json,source_snapshot_json,state,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'queued',?,?,?)`).run(id, spaceId, user.id, input.connectionId, title, idsJson, snapshotJson, input.idempotencyKey || null, timestamp, timestamp);
    const job = createJob('social.report', {
      reportId: id, ...(input.knowledgeBaseRefs?.length ? { knowledgeBaseRefs: input.knowledgeBaseRefs } : {})
    }, spaceId, null, null, user.id);
    db.prepare('UPDATE social_intelligence_reports SET ai_job_id=? WHERE id=?').run(job.id, id);
    return { report: rowSocialReport(db.prepare('SELECT * FROM social_intelligence_reports WHERE id=?').get(id)), job, created: true };
  })();
  publishEvent('data-changed', { reason: 'social-intelligence-report-created', reportId: id }, spaceId);
  return created;
}

export function socialReportExecutionInput(id: string, spaceId?: string) {
  const row = spaceId
    ? db.prepare('SELECT * FROM social_intelligence_reports WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM social_intelligence_reports WHERE id=?').get(id) as any;
  if (!row) throw new IntelligenceError('Social intelligence report was deleted.', 404);
  const sourceSnapshotJson = String(row.source_snapshot_json || '[]');
  const mentions = parseJson<Array<{
    sourceRef: string; author: string; content: string; publishedAt: string; streams?: string[];
    ingestionKind?: string | null; analysis: Record<string, unknown> | null;
  }>>(sourceSnapshotJson, []);
  return { id: row.id, title: row.title, mentions,
    observationWindow: socialObservationWindow(mentions), sourceSnapshotSha256: sha256(sourceSnapshotJson) };
}

export function retrySocialIntelligenceReport(_user: SessionUser, spaceId: string, id: string) {
  const retried = db.transaction(() => {
    const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT * FROM social_intelligence_reports WHERE id=? AND space_id=?${lock}`).get(id, spaceId) as any;
    if (!row) throw new IntelligenceError('Social intelligence report not found.', 404);
    const job = artifactJob(row);
    if (!job || job.kind !== 'social.report') throw new IntelligenceError('The durable job for this report is unavailable.', 409);
    if (row.state === 'completed' || job.state === 'completed') throw new IntelligenceError('This report is already complete.', 409);
    if (row.state === 'queued' && ['queued', 'processing'].includes(job.state)) {
      return { report: rowSocialReport(row), job, restarted: false, journalReused: false };
    }
    if (row.state !== 'failed' || job.state !== 'failed') throw new IntelligenceError('Only a failed report can be retried.', 409);

    const execution = socialReportExecutionInput(id, spaceId);
    const journaled = getJobProviderResult(job.id);
    let journalReused = false;
    let retainedJournal: typeof journaled = null;
    if (journaled?.activity === 'experience.social_listening' && journaled.schemaName === 'experience_social_listening_report') {
      const parsed = socialListeningResultFor(execution.mentions.map((mention) => String(mention.sourceRef)))
        .safeParse(journaled.output);
      if (parsed.success) {
        try {
          validateSocialListeningEvidence(
            execution.mentions.map((mention) => ({ sourceRef: String(mention.sourceRef), content: String(mention.content || '') })),
            parsed.data
          );
          retainedJournal = { ...journaled, output: parsed.data };
          journalReused = true;
        } catch {
          journalReused = false;
        }
      }
    }

    const recordedGeneration = Number(job.input.terraExecutionGeneration ?? 0);
    const currentGeneration = Number.isSafeInteger(recordedGeneration) && recordedGeneration >= 0
      ? recordedGeneration
      : 0;
    if (currentGeneration >= Number.MAX_SAFE_INTEGER) {
      throw new IntelligenceError('This report has exhausted its safe Terra retry identities.', 409);
    }
    const nextInput = {
      ...job.input,
      terraExecutionGeneration: currentGeneration + 1,
      terraExecutionReason: 'manual_retry',
      terraCorrectionRequired: false,
      terraSemanticCorrectionCount: 0
    };
    const timestamp = now();
    const jobChanged = db.prepare(`UPDATE ai_jobs SET state='queued',stage='queued',progress=0,attempt=0,result_json=NULL,error=NULL,
      retry_at=NULL,started_at=NULL,completed_at=NULL,provider_result_json=?,input_json=?,updated_at=?
      WHERE id=? AND space_id=? AND kind='social.report' AND state='failed'`)
      .run(retainedJournal ? JSON.stringify(retainedJournal) : null, JSON.stringify(nextInput), timestamp, job.id, spaceId).changes;
    const reportChanged = db.prepare(`UPDATE social_intelligence_reports SET state='queued',result_json=NULL,runtime_json=NULL,error=NULL,
      completed_at=NULL,updated_at=? WHERE id=? AND space_id=? AND state='failed'`)
      .run(timestamp, id, spaceId).changes;
    if (!jobChanged || !reportChanged) throw new IntelligenceError('The report changed while it was being retried.', 409);
    const refreshed = db.prepare('SELECT * FROM social_intelligence_reports WHERE id=? AND space_id=?').get(id, spaceId) as any;
    return { report: rowSocialReport(refreshed), job: getJob(job.id)!, restarted: true, journalReused };
  })();
  publishEvent('data-changed', { reason: 'social-intelligence-report-retried', reportId: id }, spaceId);
  return retried;
}

export function completeSocialIntelligenceReport(id: string, output: unknown, runtime: unknown, spaceId?: string) {
  const current = spaceId
    ? db.prepare('SELECT * FROM social_intelligence_reports WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM social_intelligence_reports WHERE id=?').get(id) as any;
  if (!current) throw new IntelligenceError('Social intelligence report was deleted.', 404);
  if (current?.state === 'completed' && current.result_json) return rowSocialReport(current);
  const input = socialReportExecutionInput(id, spaceId);
  const result = output as any;
  validateSocialListeningEvidence(input.mentions.map((mention: any) => ({ sourceRef: String(mention.sourceRef), content: String(mention.content || '') })), result);
  const timestamp = now();
  if (!db.prepare(`UPDATE social_intelligence_reports SET state='completed',result_json=?,runtime_json=?,error=NULL,completed_at=?,updated_at=?
    WHERE id=? AND state='queued'`).run(JSON.stringify(output), JSON.stringify(runtime), timestamp, timestamp, id).changes) {
    throw new IntelligenceError('Social report changed while Terra was generating it.', 409);
  }
  publishEvent('data-changed', { reason: 'social-intelligence-report-ready', reportId: id }, current.space_id);
  return rowSocialReport(db.prepare('SELECT * FROM social_intelligence_reports WHERE id=?').get(id));
}

function markdownList(values: unknown[], render: (value: any) => string) {
  if (!values.length) return '- None recorded for this bounded snapshot.';
  return values.map((value) => `- ${render(value)}`).join('\n');
}

function evidenceRefs(value: unknown, allowed: Set<string>) {
  // Older completed reports could contain grounded excerpts rather than exact
  // source references. Never copy those excerpts into a derived KB artifact.
  const refs = Array.isArray(value)
    ? [...new Set(value.map((item) => cleanText(item, 300)).filter((item) => allowed.has(item)))] : [];
  return refs.length ? refs.map((ref) => `\`${ref}\``).join(', ') : 'No source references recorded';
}

function normalizedWords(value: unknown) {
  return cleanText(value, 40_000).normalize('NFKC').toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}@#'_’-]+/gu) || [];
}

function rawSourceNgrams(snapshot: SocialSnapshotItem[]) {
  const ngrams = new Set<string>();
  for (const item of snapshot) {
    const words = normalizedWords(item.content);
    for (let index = 0; index <= words.length - 6; index += 1) {
      const phrase = words.slice(index, index + 6).join(' ');
      if (phrase.length >= 36) ngrams.add(phrase);
    }
  }
  return ngrams;
}

function derivedText(value: unknown, maximum: number, sourceNgrams: Set<string>) {
  const text = cleanText(value, maximum);
  const words = normalizedWords(text);
  for (let index = 0; index <= words.length - 6; index += 1) {
    const phrase = words.slice(index, index + 6).join(' ');
    if (phrase.length >= 36 && sourceNgrams.has(phrase)) {
      return '[Generated wording withheld because it substantially reproduced source text.]';
    }
  }
  return text;
}

function socialReportMarkdown(row: any) {
  const sourceSnapshotJson = String(row.source_snapshot_json || '[]');
  const snapshot = parseJson<SocialSnapshotItem[]>(sourceSnapshotJson, []);
  const window = socialObservationWindow(snapshot);
  const result = parseJson<any>(row.result_json, {});
  const runtime = parseJson<Record<string, unknown>>(row.runtime_json, {});
  const sourceRefs = [...new Set(snapshot.map((item) => cleanText(item.sourceRef, 300)).filter(Boolean))].sort();
  const allowedSourceRefs = new Set(sourceRefs);
  const sourceNgrams = rawSourceNgrams(snapshot);
  const sourceSnapshotSha256 = sha256(sourceSnapshotJson);
  const model = cleanText(runtime.model, 300) || 'Not reported';
  const provider = cleanText(runtime.providerLabel || runtime.provider, 300) || 'Not reported';
  const observedRange = window.periodStart && window.periodEnd
    ? `${window.periodStart} to ${window.periodEnd}` : 'Unavailable in the retained snapshot';
  const overlapNote = 'Stream counts are independent discovery labels and may overlap; unclassified covers legacy snapshots without retained stream labels.';
  const markdown = [
    `# ${cleanText(row.title, 300) || 'Social intelligence report'}`,
    '',
    '> **Derived, reviewed intelligence.** This document contains reviewed generated conclusions and provenance, not the retained raw-post snapshot. Substantial exact source-wording overlap is withheld. It is not primary evidence.',
    '',
    '## Provenance',
    '',
    `- Source report ID: \`${row.id}\``,
    `- Source snapshot SHA-256: \`${sourceSnapshotSha256}\``,
    `- Report completed: ${row.completed_at || 'Not reported'}`,
    `- Observation period: ${observedRange}`,
    `- As of: ${window.asOf || 'Unavailable'}`,
    `- Posts in immutable snapshot: ${window.postCount}`,
    `- Discovery breakdown: ${window.breakdown.accountPosts} account posts; ${window.breakdown.mentions} mentions; ${window.breakdown.searchResults} search results; ${window.breakdown.unclassified} unclassified`,
    `- Runtime: ${provider} / ${model}`,
    '',
    overlapNote,
    '',
    '## Source references',
    '',
    sourceRefs.length ? sourceRefs.map((ref) => `- \`${ref}\``).join('\n') : '- No source references retained.',
    '',
    '## Executive summary',
    '',
    derivedText(result.executiveSummary, 20_000, sourceNgrams) || 'No executive summary was generated.',
    '',
    '## Model-classified sentiment counts',
    '',
    `- Negative: ${Number(result?.sentiment?.negative || 0)}`,
    `- Neutral: ${Number(result?.sentiment?.neutral || 0)}`,
    `- Positive: ${Number(result?.sentiment?.positive || 0)}`,
    `- Mixed: ${Number(result?.sentiment?.mixed || 0)}`,
    '',
    '## Themes',
    '',
    markdownList(Array.isArray(result.themes) ? result.themes : [], (item) =>
      `**${derivedText(item?.name, 1000, sourceNgrams)}** — ${Number(item?.mentions || 0)} mentions; sentiment: ${derivedText(item?.sentiment, 300, sourceNgrams) || 'not reported'}; evidence: ${evidenceRefs(item?.evidence, allowedSourceRefs)}`),
    '',
    '## Emerging signals',
    '',
    markdownList(Array.isArray(result.emergingTrends) ? result.emergingTrends : [], (item) =>
      `**${derivedText(item?.trend, 1500, sourceNgrams)}** — tentative direction: ${derivedText(item?.direction, 100, sourceNgrams) || 'not reported'}; evidence: ${evidenceRefs(item?.evidence, allowedSourceRefs)}`),
    '',
    '## Risks',
    '',
    markdownList(Array.isArray(result.risks) ? result.risks : [], (item) =>
      `**${derivedText(item?.issue, 1500, sourceNgrams)}** — severity: ${derivedText(item?.severity, 100, sourceNgrams) || 'not reported'}; action: ${derivedText(item?.action, 3000, sourceNgrams) || 'none'}; evidence: ${evidenceRefs(item?.evidence, allowedSourceRefs)}`),
    '',
    '## Opportunities',
    '',
    markdownList(Array.isArray(result.opportunities) ? result.opportunities : [], (item) =>
      `**${derivedText(item?.opportunity, 1500, sourceNgrams)}** — action: ${derivedText(item?.action, 3000, sourceNgrams) || 'none'}; evidence: ${evidenceRefs(item?.evidence, allowedSourceRefs)}`),
    '',
    '## Limitations',
    '',
    '- This is a bounded snapshot, not a platform-wide or population-level measurement.',
    '- Publication records a human review decision; it does not convert generated conclusions into primary facts.',
    '- A single snapshot does not provide a defensible prior-period baseline. Any rising, stable, or falling direction is tentative until compared with an equivalent earlier window.',
    '- Source references identify the retained evidence chain. If the underlying retained history is removed, this derived artifact contains no raw post text to recover it.',
    '',
    '## Runtime record',
    '',
    '```json',
    JSON.stringify(runtime, null, 2),
    '```',
    ''
  ].join('\n');
  return { markdown, sourceSnapshotSha256, window, sourceRefs, runtime, model, provider };
}

export function publishSocialIntelligenceReport(user: SessionUser, spaceId: string, reportId: string, input: {
  knowledgeBaseId: string; reviewed: true;
}): {
  report: ReturnType<typeof rowSocialReport>; publication: ReturnType<typeof rowSocialPublication>;
  document: KnowledgeDocumentRecord; job: KnowledgeJobRecord | null; deduplicated: boolean;
} {
  if (input.reviewed !== true) throw new IntelligenceError('Confirm review before publishing derived intelligence.', 400);
  const row = db.prepare('SELECT * FROM social_intelligence_reports WHERE id=? AND space_id=?').get(reportId, spaceId) as any;
  if (!row) throw new IntelligenceError('Social intelligence report not found.', 404);
  if (row.state !== 'completed' || !row.result_json || !row.completed_at) {
    throw new IntelligenceError('Only a completed social intelligence report can be reviewed and published.', 409);
  }
  const knowledgeBase = getKnowledgeBase(input.knowledgeBaseId, spaceId, false, user.id);
  if (!knowledgeBase) throw new IntelligenceError('Knowledge base not found in this space.', 404);
  const existing = socialPublications(spaceId, reportId, user.id).find((item) => item.knowledgeBaseId === knowledgeBase.id);
  if (existing) {
    const document = getKnowledgeDocument(existing.documentId, knowledgeBase.id, spaceId, true);
    if (!document || existing.state === 'deleted') {
      throw new IntelligenceError('This reviewed report was already published to that knowledge base and the derived document was deleted. Create a new report version before publishing again.', 409);
    }
    return { report: rowSocialReport(row, socialPublications(spaceId, reportId, user.id)), publication: existing, document,
      job: existing.jobId ? getKnowledgeJob(existing.jobId, spaceId) : null, deduplicated: true };
  }

  const artifact = socialReportMarkdown(row);
  const created = createKnowledgeMarkdownDocument({
    spaceId, knowledgeBaseId: knowledgeBase.id, userId: user.id,
    originalName: `Social intelligence ${row.id}.md`, markdown: artifact.markdown,
    metadata: {
      artifactType: 'derived_social_intelligence', trustStatus: 'human_reviewed_derived',
      sourceReportId: row.id, sourceSnapshotSha256: artifact.sourceSnapshotSha256,
      periodStart: artifact.window.periodStart, periodEnd: artifact.window.periodEnd, asOf: artifact.window.asOf,
      sourcePostCount: artifact.window.postCount, accountPostCount: artifact.window.breakdown.accountPosts,
      mentionCount: artifact.window.breakdown.mentions, searchResultCount: artifact.window.breakdown.searchResults,
      runtimeProvider: artifact.provider, runtimeModel: artifact.model, reviewedBy: user.id
    }
  });
  const publishedAt = now();
  const publicationInserted = db.prepare(`INSERT INTO social_intelligence_publications
    (report_id,space_id,knowledge_base_id,document_id,job_id,source_requested_by,published_by,review_status,source_snapshot_sha256,artifact_sha256,created_at)
    VALUES (?,?,?,?,?,?,?,'reviewed',?,?,?) ON CONFLICT(report_id,knowledge_base_id) DO NOTHING`)
    .run(row.id, spaceId, knowledgeBase.id, created.document.id, created.job?.id || null, row.user_id, user.id,
      artifact.sourceSnapshotSha256, created.sha256, publishedAt).changes === 1;
  const publication = socialPublications(spaceId, reportId, user.id).find((item) => item.knowledgeBaseId === knowledgeBase.id);
  if (!publication) throw new IntelligenceError('The reviewed publication could not be recorded.', 500);
  if (publicationInserted) {
    auditKnowledge({ spaceId, knowledgeBaseId: knowledgeBase.id, documentId: publication.documentId,
      jobId: publication.jobId, aiJobId: row.ai_job_id, actorUserId: user.id,
      action: 'social_intelligence.reviewed_and_published', detail: {
        reportId: row.id, reviewStatus: 'reviewed', sourceSnapshotSha256: artifact.sourceSnapshotSha256,
        artifactSha256: publication.artifactSha256, observationWindow: artifact.window,
        sourceRequestedBy: row.user_id, sourceRefCount: artifact.sourceRefs.length, containsRetainedRawPostSnapshot: false
      } });
    publishEvent('data-changed', { reason: 'social-intelligence-report-published', reportId: row.id,
      knowledgeBaseId: knowledgeBase.id, documentId: publication.documentId }, spaceId);
  }
  return { report: rowSocialReport(row, socialPublications(spaceId, reportId, user.id)), publication,
    document: getKnowledgeDocument(publication.documentId, knowledgeBase.id, spaceId) || created.document,
    job: publication.jobId ? getKnowledgeJob(publication.jobId, spaceId) : created.job,
    deduplicated: created.deduplicated || !publicationInserted };
}

export type HistoricalIntelligenceSource = {
  ref: string;
  type: 'survey' | 'social';
  title: string;
  kind: string;
  createdAt: string;
  preview: string;
  payload?: unknown;
};
export type IntelligenceSource = HistoricalIntelligenceSource | {
  ref: string;
  type: 'knowledge';
  title: string;
  kind: 'knowledge_base';
  createdAt: string;
  preview: string;
  available?: boolean;
  disabledReason?: string;
  knowledgeBaseId?: string;
  documentCount?: number;
  terraContextEnabled?: boolean;
};
function availableSources(spaceId: string, withPayload = false): HistoricalIntelligenceSource[] {
  const surveys = (db.prepare(`SELECT i.id,i.kind,i.payload_json,i.created_at,s.title survey_title FROM insights i JOIN surveys s ON s.id=i.survey_id
    WHERE s.space_id=? AND i.kind IN ('ai_insights','executive_report') ORDER BY i.created_at DESC LIMIT 200`).all(spaceId) as any[]).map((row) => {
      const payload = parseJson(row.payload_json, {}); return { ref: `survey-insight:${row.id}`, type: 'survey' as const,
      title: `${row.survey_title} · ${row.kind === 'executive_report' ? 'Executive report' : 'AI insights'}`, kind: row.kind,
        createdAt: row.created_at, preview: preview(payload), ...(withPayload ? { payload } : {}) };
    });
  const social = (db.prepare(`SELECT * FROM social_intelligence_reports WHERE space_id=? AND state='completed' ORDER BY created_at DESC LIMIT 200`).all(spaceId) as any[]).map((row) => {
    const result = parseJson<Record<string, unknown>>(row.result_json, {});
    const sourceSnapshotJson = String(row.source_snapshot_json || '[]');
    const payload = { ...result, observationWindow: socialObservationWindow(parseJson(sourceSnapshotJson, [])),
      sourceSnapshotSha256: sha256(sourceSnapshotJson) };
    return { ref: `social-report:${row.id}`, type: 'social' as const,
      title: row.title, kind: 'social_report', createdAt: row.completed_at || row.created_at, preview: preview(payload), ...(withPayload ? { payload } : {}) };
  });
  return [...surveys, ...social].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
export function listIntelligenceSources(user: SessionUser, spaceId: string) {
  const reports = availableSources(spaceId, false);
  const knowledge = listKnowledgeBases(spaceId, false, user.id).map((base): IntelligenceSource => {
    const ready = ['ready', 'indexing', 'degraded'].includes(base.status)
      && base.currentVersion > 0 && base.readyDocumentCount > 0;
    const shareable = base.privacy === 'space';
    const available = ready && shareable && base.allowTerraContext;
    const disabledReason = !ready
      ? 'Index at least one document before using this knowledge base.'
      : !shareable
        ? 'Private knowledge can be chatted with inside its workspace, but cannot be attached to a shared analysis.'
        : !base.allowTerraContext
          ? 'Enable Terra context in knowledge-base settings to use this source.'
          : undefined;
    return {
      ref: `knowledge-base:${base.id}`,
      type: 'knowledge',
      kind: 'knowledge_base',
      title: base.name,
      createdAt: base.updatedAt,
      preview: base.description || `${base.readyDocumentCount} ready document${base.readyDocumentCount === 1 ? '' : 's'} with ${base.chunkCount} indexed chunks.`,
      available,
      ...(disabledReason ? { disabledReason } : {}),
      knowledgeBaseId: base.id,
      documentCount: base.documentCount,
      terraContextEnabled: base.allowTerraContext
    };
  });
  return [...reports, ...knowledge].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function resolveIntelligenceSourceSnapshots(spaceId: string, sourceRefs: string[]) {
  const requested = [...new Set(sourceRefs)];
  const byRef = new Map(availableSources(spaceId, true).map((source) => [source.ref, source]));
  const selected = requested.map((ref) => byRef.get(ref));
  if (selected.some((source) => !source)) throw new IntelligenceError('One or more selected reports are unavailable.', 404);
  return selected as HistoricalIntelligenceSource[];
}

function rowIntelligenceReport(row: any) {
  const job = artifactJob(row);
  const knowledgeBaseIds = parseJson<Array<{ id?: string }>>(row.knowledge_refs_json, [])
    .map((ref) => String(ref?.id || '')).filter(Boolean);
  return { id: row.id, title: row.title, objective: row.objective, sourceRefs: parseJson<{ survey: string[]; social: string[] }>(row.source_refs_json, { survey: [], social: [] }),
    knowledgeBaseIds,
    state: job?.state === 'failed' ? 'failed' : row.state, result: parseJson(row.result_json, null), runtime: parseJson(row.runtime_json, null),
    aiJobId: row.ai_job_id, error: job?.error || row.error, createdAt: row.created_at, completedAt: row.completed_at, updatedAt: row.updated_at };
}
export function listIntelligenceReports(_user: SessionUser, spaceId: string) {
  return (db.prepare('SELECT * FROM intelligence_reports WHERE space_id=? ORDER BY created_at DESC LIMIT 100').all(spaceId) as any[]).map(rowIntelligenceReport);
}
export function getIntelligenceReport(_user: SessionUser, spaceId: string, id: string) {
  const row = db.prepare('SELECT * FROM intelligence_reports WHERE id=? AND space_id=?').get(id, spaceId) as any;
  if (!row) throw new IntelligenceError('Intelligence report not found.', 404);
  return rowIntelligenceReport(row);
}
export function createIntelligenceReport(user: SessionUser, spaceId: string, input: {
  title: string; objective?: string; sourceRefs: string[]; knowledgeBaseRefs?: KnowledgeBaseRef[]; idempotencyKey?: string;
}) {
  const requested = [...new Set(input.sourceRefs)].slice(0, 12).sort();
  const knowledgeSourceCount = new Set((input.knowledgeBaseRefs || []).map((ref) => ref.id)).size;
  if (requested.length + knowledgeSourceCount < 2) {
    throw new IntelligenceError('Select at least two evidence sources to synthesize.');
  }
  if (requested.length + knowledgeSourceCount > 12) {
    throw new IntelligenceError('Choose no more than twelve evidence sources.');
  }
  const selected = resolveIntelligenceSourceSnapshots(spaceId, requested);
  const snapshot = selected.map((source) => ({ ref: source!.ref, type: source!.type, title: source!.title, kind: source!.kind,
    createdAt: source!.createdAt, payload: source!.payload }));
  const snapshotJson = JSON.stringify(snapshot);
  if (Buffer.byteLength(snapshotJson, 'utf8') > 400 * 1024) throw new IntelligenceError('The selected report set is too large. Choose fewer reports.', 413);
  const refs = { survey: snapshot.filter((source) => source.type === 'survey').map((source) => source.ref),
    social: snapshot.filter((source) => source.type === 'social').map((source) => source.ref) };
  const title = cleanText(input.title, 180) || 'Combined intelligence'; const objective = cleanText(input.objective, 1000);
  const refsJson = JSON.stringify(refs);
  const knowledgeRefsJson = JSON.stringify((input.knowledgeBaseRefs || []).slice().sort((left, right) => left.id.localeCompare(right.id)));
  const jobKnowledgeRefsJson = (job: ReturnType<typeof artifactJob>) => JSON.stringify(
    (Array.isArray(job?.input.knowledgeBaseRefs) ? job.input.knowledgeBaseRefs : []).slice()
      .sort((left: any, right: any) => String(left?.id || '').localeCompare(String(right?.id || '')))
  );
  const id = crypto.randomUUID(); const timestamp = now();
  const created = db.transaction(() => {
    if (input.idempotencyKey) {
      const replay = db.prepare('SELECT * FROM intelligence_reports WHERE space_id=? AND user_id=? AND idempotency_key=?').get(spaceId, user.id, input.idempotencyKey) as any;
      if (replay) {
        if (replay.title !== title || replay.objective !== objective || replay.source_refs_json !== refsJson) throw new IntelligenceError('This idempotency key was already used for a different intelligence report.', 409);
        const job = artifactJob(replay);
        if (!job) throw new IntelligenceError('The original idempotent intelligence report is no longer available.', 409);
        if (jobKnowledgeRefsJson(job) !== knowledgeRefsJson) throw new IntelligenceError('This idempotency key was already used with a different knowledge selection.', 409);
        return { report: rowIntelligenceReport(replay), job, created: false };
      }
    }
    const existing = db.prepare(`SELECT * FROM intelligence_reports WHERE space_id=? AND user_id=? AND title=? AND objective=? AND source_refs_json=?
      AND knowledge_refs_json=? AND state='queued' ORDER BY created_at LIMIT 1`)
      .get(spaceId, user.id, title, objective, refsJson, knowledgeRefsJson) as any;
    if (existing) {
      const job = artifactJob(existing);
      if (job && ['queued', 'processing'].includes(job.state)) return { report: rowIntelligenceReport(existing), job, created: false };
      db.prepare("UPDATE intelligence_reports SET state='failed',error='The previous queue record was no longer active.',updated_at=? WHERE id=?")
        .run(timestamp, existing.id);
    }
    assertCanQueueAiAction(spaceId);
    db.prepare(`INSERT INTO intelligence_reports (id,space_id,user_id,title,objective,source_refs_json,source_snapshot_json,knowledge_refs_json,state,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'queued',?,?,?)`).run(id, spaceId, user.id, title, objective, refsJson, snapshotJson,
        knowledgeRefsJson, input.idempotencyKey || null, timestamp, timestamp);
    const job = createJob('intelligence.synthesize', {
      reportId: id, ...(input.knowledgeBaseRefs?.length ? { knowledgeBaseRefs: input.knowledgeBaseRefs } : {})
    }, spaceId, null, null, user.id);
    db.prepare('UPDATE intelligence_reports SET ai_job_id=? WHERE id=?').run(job.id, id);
    return { report: rowIntelligenceReport(db.prepare('SELECT * FROM intelligence_reports WHERE id=?').get(id)), job, created: true };
  })();
  publishEvent('data-changed', { reason: 'intelligence-report-created', reportId: id }, spaceId);
  return created;
}

export function intelligenceExecutionInput(id: string, spaceId?: string) {
  const row = spaceId
    ? db.prepare('SELECT * FROM intelligence_reports WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM intelligence_reports WHERE id=?').get(id) as any;
  if (!row) throw new IntelligenceError('Intelligence report was deleted.', 404);
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    sources: parseJson<Array<{ ref: string; type: string; title: string; payload: unknown }>>(row.source_snapshot_json, []),
    knowledgeBaseIds: parseJson<Array<{ id?: string }>>(row.knowledge_refs_json, [])
      .map((ref) => String(ref?.id || '')).filter(Boolean)
  };
}
export function completeIntelligenceReport(id: string, output: any, runtime: unknown, spaceId?: string) {
  const current = spaceId
    ? db.prepare('SELECT * FROM intelligence_reports WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM intelligence_reports WHERE id=?').get(id) as any;
  if (!current) throw new IntelligenceError('Intelligence report was deleted.', 404);
  if (current?.state === 'completed' && current.result_json) return rowIntelligenceReport(current);
  const input = intelligenceExecutionInput(id, spaceId);
  const sources = new Map(input.sources.map((source) => [source.ref, {
    body: normalizedEvidence(source.payload), type: source.type, groupRef: source.ref
  }]));
  const knowledgeContext = current.ai_job_id ? getKnowledgeContext(String(current.ai_job_id), String(current.space_id)) : null;
  for (const citation of knowledgeContext?.citations || []) {
    sources.set(citation.sourceRef, {
      body: normalizedEvidence(citation.excerpt), type: 'knowledge', groupRef: `knowledge-base:${citation.knowledgeBaseId}`
    });
  }
  const findings = [...(output.themes || []), ...(output.convergence || []), ...(output.divergence || []), ...(output.risks || []),
    ...(output.opportunities || []), ...(output.recommendations || [])];
  for (const finding of findings) for (const evidence of finding.evidence || []) {
    const sourceRef = canonicalEvidenceSourceRef(evidence.sourceRef, sources);
    evidence.sourceRef = sourceRef;
    const source = sources.get(sourceRef);
    if (!source) throw new IntelligenceError(`Terra cited an unknown report: ${String(evidence.sourceRef)}`);
    const excerpt = cleanText(evidence.excerpt, 1000).toLocaleLowerCase('en-US');
    if (excerpt.length < 12 || !source.body.includes(excerpt)) {
      throw new IntelligenceError(`Terra returned evidence that was not present in ${sourceRef}.`);
    }
  }
  const selectedTypes = new Set([...sources.values()].map((source) => source.type));
  for (const finding of [...(output.convergence || []), ...(output.divergence || [])]) {
    const references = new Set<string>((finding.evidence || []).map((evidence: any) => String(evidence.sourceRef)));
    const sourceGroups = new Set([...references].map((reference) => sources.get(reference)?.groupRef).filter(Boolean));
    if (sourceGroups.size < 2) throw new IntelligenceError('Convergence and divergence findings must cite at least two selected evidence sources.');
    if (selectedTypes.size > 1) {
      const evidenceTypes = new Set([...references].map((reference) => sources.get(reference)?.type).filter(Boolean));
      if (evidenceTypes.size < 2) throw new IntelligenceError('Cross-source convergence and divergence must cite more than one selected source type.');
    }
  }
  const timestamp = now();
  if (!db.prepare(`UPDATE intelligence_reports SET state='completed',result_json=?,runtime_json=?,error=NULL,completed_at=?,updated_at=?
    WHERE id=? AND state='queued'`).run(JSON.stringify(output), JSON.stringify(runtime), timestamp, timestamp, id).changes) {
    throw new IntelligenceError('Intelligence report changed while Terra was generating it.', 409);
  }
  publishEvent('data-changed', { reason: 'intelligence-report-ready', reportId: id }, current.space_id);
  return rowIntelligenceReport(db.prepare('SELECT * FROM intelligence_reports WHERE id=?').get(id));
}

export function appliedIntelligenceArtifact(kind: string, input: Record<string, unknown>, spaceId?: string) {
  if (kind === 'social.reply_draft' && input.draftId) {
    const row = spaceId
      ? db.prepare('SELECT * FROM social_reply_drafts WHERE id=? AND space_id=?').get(String(input.draftId), spaceId) as any
      : db.prepare('SELECT * FROM social_reply_drafts WHERE id=?').get(String(input.draftId)) as any;
    if (row && ['ready', 'edited', 'archived'].includes(row.state) && row.generated_content) return { output: rowReplyDraft(row), runtime: parseJson(row.runtime_json, null) };
  }
  if (kind === 'social.report' && input.reportId) {
    const row = spaceId
      ? db.prepare('SELECT * FROM social_intelligence_reports WHERE id=? AND space_id=?').get(String(input.reportId), spaceId) as any
      : db.prepare('SELECT * FROM social_intelligence_reports WHERE id=?').get(String(input.reportId)) as any;
    if (row?.state === 'completed' && row.result_json) return { output: rowSocialReport(row), runtime: parseJson(row.runtime_json, null) };
  }
  if (kind === 'intelligence.synthesize' && input.reportId) {
    const row = spaceId
      ? db.prepare('SELECT * FROM intelligence_reports WHERE id=? AND space_id=?').get(String(input.reportId), spaceId) as any
      : db.prepare('SELECT * FROM intelligence_reports WHERE id=?').get(String(input.reportId)) as any;
    if (row?.state === 'completed' && row.result_json) return { output: rowIntelligenceReport(row), runtime: parseJson(row.runtime_json, null) };
  }
  return null;
}

export function failIntelligenceArtifact(kind: string, input: Record<string, unknown>, message: string, spaceId?: string) {
  const timestamp = now(); const error = message.slice(0, 1000);
  if (kind === 'social.reply_draft' && input.draftId) db.prepare("UPDATE social_reply_drafts SET state='failed',error=?,updated_at=? WHERE id=? AND state='queued' AND (? IS NULL OR space_id=?)")
    .run(error, timestamp, String(input.draftId), spaceId || null, spaceId || null);
  if (kind === 'social.report' && input.reportId) db.prepare("UPDATE social_intelligence_reports SET state='failed',error=?,updated_at=? WHERE id=? AND state='queued' AND (? IS NULL OR space_id=?)")
    .run(error, timestamp, String(input.reportId), spaceId || null, spaceId || null);
  if (kind === 'intelligence.synthesize' && input.reportId) db.prepare("UPDATE intelligence_reports SET state='failed',error=?,updated_at=? WHERE id=? AND state='queued' AND (? IS NULL OR space_id=?)")
    .run(error, timestamp, String(input.reportId), spaceId || null, spaceId || null);
}
