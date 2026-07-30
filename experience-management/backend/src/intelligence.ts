import crypto from 'node:crypto';
import type { SessionUser } from './auth.js';
import type { KnowledgeBaseRef } from './knowledgeRepository.js';
import { createJob, db, getJob, listSocialMentionsByIdsForSpace } from './database.js';
import { publishEvent } from './events.js';
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

export function validateSocialListeningEvidence(sources: Array<{ sourceRef: string; content: string }>, result: any) {
  const expected = new Map(sources.map((source) => [String(source.sourceRef), normalizedEvidence(source.content)]));
  const returned = Array.isArray(result?.mentions) ? result.mentions.map((mention: any) => String(mention.mentionId)) : [];
  if (returned.length !== expected.size || new Set(returned).size !== expected.size || returned.some((mentionId: string) => !expected.has(mentionId))) {
    throw new IntelligenceError('Terra did not return exactly one analysis for every saved source.', 400);
  }
  const sentimentTotal = ['negative', 'neutral', 'positive', 'mixed'].reduce((total, key) => total + Number(result?.sentiment?.[key] || 0), 0);
  if (sentimentTotal !== expected.size) throw new IntelligenceError('Terra returned sentiment counts that do not match the saved dataset.', 400);
  const sourceBodies = [...expected.values()];
  const excerptIsGrounded = (value: unknown, exactSource?: string) => {
    const excerpt = cleanText(value, 1000).toLocaleLowerCase('en-US');
    const candidates = exactSource === undefined ? sourceBodies : [exactSource];
    return candidates.some((body) => {
      const minimum = Math.min(12, body.length);
      return minimum > 0 && excerpt.length >= minimum && body.includes(excerpt);
    });
  };
  const evidence = [
    ...(result?.themes || []).flatMap((item: any) => item.evidence || []),
    ...(result?.emergingTrends || []).flatMap((item: any) => item.evidence || []),
    ...(result?.risks || []).flatMap((item: any) => item.evidence || []),
    ...(result?.opportunities || []).flatMap((item: any) => item.evidence || [])
  ];
  for (const excerpt of evidence) {
    if (!excerptIsGrounded(excerpt)) throw new IntelligenceError('Terra returned evidence that was not present in the saved sources.', 400);
  }
  for (const mention of result.mentions || []) {
    const source = expected.get(String(mention.mentionId));
    if (!source || !excerptIsGrounded(mention.evidence, source)) {
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

function rowReplyDraft(row: any) {
  const job = artifactJob(row);
  return {
    id: row.id, mentionId: row.mention_id, connectionId: row.connection_id, tone: row.tone, instructions: row.instructions,
    state: job?.state === 'failed' ? 'failed' : row.state, generatedContent: row.generated_content, content: row.content,
    rationale: row.rationale, safetyFlags: parseJson<string[]>(row.safety_flags_json, []), runtime: parseJson(row.runtime_json, null),
    aiJobId: row.ai_job_id, error: job?.error || row.error, createdAt: row.created_at, completedAt: row.completed_at, updatedAt: row.updated_at
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
  if (current && ['ready', 'edited', 'archived'].includes(current.state) && current.generated_content) return rowReplyDraft(current);
  const timestamp = now();
  const changed = db.prepare(`UPDATE social_reply_drafts SET state='ready',generated_content=?,content=?,rationale=?,safety_flags_json=?,runtime_json=?,error=NULL,
    completed_at=?,updated_at=? WHERE id=? AND state='queued'`).run(output.reply, output.reply, output.rationale, JSON.stringify(output.safetyFlags), JSON.stringify(runtime), timestamp, timestamp, id).changes;
  if (!changed) throw new IntelligenceError('Reply draft changed while Terra was generating it.', 409);
  publishEvent('data-changed', { reason: 'social-reply-draft-ready', draftId: id }, current.space_id);
  return rowReplyDraft(db.prepare('SELECT * FROM social_reply_drafts WHERE id=?').get(id));
}

function rowSocialReport(row: any) {
  const job = artifactJob(row);
  const knowledgeBaseIds = (Array.isArray(job?.input.knowledgeBaseRefs) ? job.input.knowledgeBaseRefs : [])
    .map((ref: any) => String(ref?.id || '')).filter(Boolean);
  return { id: row.id, connectionId: row.connection_id, title: row.title, mentionIds: parseJson<string[]>(row.mention_ids_json, []),
    knowledgeBaseIds,
    state: job?.state === 'failed' ? 'failed' : row.state, result: parseJson(row.result_json, null), runtime: parseJson(row.runtime_json, null),
    aiJobId: row.ai_job_id, error: job?.error || row.error, createdAt: row.created_at, completedAt: row.completed_at, updatedAt: row.updated_at };
}

export function listSocialIntelligenceReports(_user: SessionUser, spaceId: string, connectionId?: string) {
  const parameters: unknown[] = [spaceId]; let connectionFilter = '';
  if (connectionId) { if (!spaceOwnsConnection(spaceId, connectionId)) throw new IntelligenceError('X connection not found.', 404); parameters.push(connectionId); connectionFilter = ' AND r.connection_id=?'; }
  return (db.prepare(`SELECT r.* FROM social_intelligence_reports r WHERE r.space_id=?${connectionFilter} ORDER BY r.created_at DESC LIMIT 100`).all(...parameters) as any[]).map(rowSocialReport);
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
  const mentions = listSocialMentionsByIdsForSpace(ids, spaceId);
  const snapshot = mentions.map((mention) => ({ sourceRef: `x-post:${mention.id}`, author: cleanText(mention.author, 200), content: cleanText(mention.content, 1200),
    publishedAt: mention.publishedAt, analysis: mention.analysis ? {
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
  return { id: row.id, title: row.title, mentions: parseJson<Array<{
    sourceRef: string; author: string; content: string; publishedAt: string; analysis: Record<string, unknown> | null;
  }>>(row.source_snapshot_json, []) };
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

export type IntelligenceSource = { ref: string; type: 'survey' | 'social'; title: string; kind: string; createdAt: string; preview: string; payload?: unknown };
function availableSources(spaceId: string, withPayload = false): IntelligenceSource[] {
  const surveys = (db.prepare(`SELECT i.id,i.kind,i.payload_json,i.created_at,s.title survey_title FROM insights i JOIN surveys s ON s.id=i.survey_id
    WHERE s.space_id=? AND i.kind IN ('ai_insights','executive_report') ORDER BY i.created_at DESC LIMIT 200`).all(spaceId) as any[]).map((row) => {
      const payload = parseJson(row.payload_json, {}); return { ref: `survey-insight:${row.id}`, type: 'survey' as const,
      title: `${row.survey_title} · ${row.kind === 'executive_report' ? 'Executive report' : 'AI insights'}`, kind: row.kind,
        createdAt: row.created_at, preview: preview(payload), ...(withPayload ? { payload } : {}) };
    });
  const social = (db.prepare(`SELECT * FROM social_intelligence_reports WHERE space_id=? AND state='completed' ORDER BY created_at DESC LIMIT 200`).all(spaceId) as any[]).map((row) => {
    const payload = parseJson(row.result_json, {}); return { ref: `social-report:${row.id}`, type: 'social' as const,
      title: row.title, kind: 'social_report', createdAt: row.completed_at || row.created_at, preview: preview(payload), ...(withPayload ? { payload } : {}) };
  });
  return [...surveys, ...social].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
export function listIntelligenceSources(_user: SessionUser, spaceId: string) { return availableSources(spaceId, false); }

export function resolveIntelligenceSourceSnapshots(spaceId: string, sourceRefs: string[]) {
  const requested = [...new Set(sourceRefs)];
  const byRef = new Map(availableSources(spaceId, true).map((source) => [source.ref, source]));
  const selected = requested.map((ref) => byRef.get(ref));
  if (selected.some((source) => !source)) throw new IntelligenceError('One or more selected reports are unavailable.', 404);
  return selected as IntelligenceSource[];
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
  if (requested.length < 2) throw new IntelligenceError('Select at least two historical reports to synthesize.');
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
  return { id: row.id, title: row.title, objective: row.objective, sources: parseJson<Array<{ ref: string; type: string; title: string; payload: unknown }>>(row.source_snapshot_json, []) };
}
export function completeIntelligenceReport(id: string, output: any, runtime: unknown, spaceId?: string) {
  const current = spaceId
    ? db.prepare('SELECT * FROM intelligence_reports WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM intelligence_reports WHERE id=?').get(id) as any;
  if (!current) throw new IntelligenceError('Intelligence report was deleted.', 404);
  if (current?.state === 'completed' && current.result_json) return rowIntelligenceReport(current);
  const input = intelligenceExecutionInput(id, spaceId); const sources = new Map(input.sources.map((source) => [source.ref, { body: normalizedEvidence(source.payload), type: source.type }]));
  const findings = [...(output.themes || []), ...(output.convergence || []), ...(output.divergence || []), ...(output.risks || []),
    ...(output.opportunities || []), ...(output.recommendations || [])];
  for (const finding of findings) for (const evidence of finding.evidence || []) {
    const source = sources.get(String(evidence.sourceRef));
    if (!source) throw new IntelligenceError(`Terra cited an unknown report: ${String(evidence.sourceRef)}`);
    const excerpt = cleanText(evidence.excerpt, 1000).toLocaleLowerCase('en-US');
    if (excerpt.length < 12 || !source.body.includes(excerpt)) {
      throw new IntelligenceError(`Terra returned evidence that was not present in ${String(evidence.sourceRef)}.`);
    }
  }
  const selectedTypes = new Set(input.sources.map((source) => source.type));
  for (const finding of [...(output.convergence || []), ...(output.divergence || [])]) {
    const references = new Set<string>((finding.evidence || []).map((evidence: any) => String(evidence.sourceRef)));
    if (references.size < 2) throw new IntelligenceError('Convergence and divergence findings must cite at least two selected reports.');
    if (selectedTypes.size > 1) {
      const evidenceTypes = new Set([...references].map((reference) => sources.get(reference)?.type).filter(Boolean));
      if (evidenceTypes.size < 2) throw new IntelligenceError('Cross-source convergence and divergence must cite both survey and social evidence.');
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
