import { db } from './database.js';
import type { EvidenceSourceType } from './journeyDomain.js';
import type { JourneyEvidenceResolution, JourneyEvidenceSourceCurrent } from './journeyEvidenceLifecycle.js';
import { assertSubscriptionFeature, SubscriptionEntitlementError, type SubscriptionFeature } from './subscriptionEntitlements.js';

/** Authoritative journey-evidence source contract.
 *
 * Adapters resolve one immutable record identity inside the authenticated space
 * and return only bounded display metadata. The resolver never trusts a caller
 * supplied label, excerpt, sample, population, or date. Those values are
 * derived from the current system-of-record row and become a snapshot when the
 * evidence link is attached. */
export type JourneyEvidenceSourceView = {
  sourceType: EvidenceSourceType;
  sourceRef: string;
  sourceId: string;
  label: string;
  excerpt: string;
  collectedAt: string | null;
  sampleSize: number | null;
  population: string;
  windowStart: string | null;
  windowEnd: string | null;
  state: string;
  updatedAt: string | null;
  path: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type JourneyEvidenceSourceContext = {
  spaceId: string;
  userId: string;
};

/** Only source types with a current, permission-aware system-of-record adapter
 * are discoverable. Interview, observation, and event aggregates remain in the
 * domain vocabulary for future migrations, but must not appear as selectable
 * records until their authoritative stores exist. */
export const discoverableJourneyEvidenceSourceTypes = [
  'knowledge_document', 'survey_response', 'survey_analysis', 'social_mention',
  'social_intelligence', 'ticket', 'assistant_artifact', 'agreement'
] as const satisfies readonly EvidenceSourceType[];
export type DiscoverableJourneyEvidenceSourceType = typeof discoverableJourneyEvidenceSourceTypes[number];

export interface JourneyEvidenceSourceAdapter {
  sourceType: EvidenceSourceType;
  feature: SubscriptionFeature;
  prefixes: readonly string[];
  canonicalPrefix: string;
  resolve(context: JourneyEvidenceSourceContext, sourceId: string): JourneyEvidenceSourceView | null;
}

export class JourneyEvidenceSourceError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_EVIDENCE_SOURCE_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyEvidenceSourceError';
  }
}

const labelLimit = 200;
const excerptLimit = 2_000;
const populationLimit = 200;
const referenceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function safeText(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function safeIdReference(value: unknown, adapter: JourneyEvidenceSourceAdapter) {
  let candidate = String(value ?? '').trim();
  for (const prefix of adapter.prefixes) {
    if (candidate.startsWith(prefix)) {
      candidate = candidate.slice(prefix.length);
      break;
    }
  }
  if (!referenceIdPattern.test(candidate)) {
    throw new JourneyEvidenceSourceError(
      'Use the source record ID or its canonical source reference.',
      400, 'JOURNEY_EVIDENCE_SOURCE_REFERENCE_INVALID', { sourceType: adapter.sourceType }
    );
  }
  return candidate;
}

function scalarPreview(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return safeText(value, 500);
  }
  if (Array.isArray(value)) return value.slice(0, 6).map(scalarPreview).filter(Boolean).join(', ');
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  for (const key of ['text', 'value', 'answer', 'label', 'name', 'title']) {
    const preview = scalarPreview(object[key]);
    if (preview) return preview;
  }
  return '';
}

function answerExcerpt(answersJson: unknown, surveyId: string) {
  const answers = parseJson<Record<string, unknown>>(answersJson, {});
  const questions = db.prepare('SELECT id,title FROM questions WHERE survey_id=? ORDER BY page,position,id')
    .all(surveyId) as Array<{ id: string; title: string }>;
  const titleById = new Map(questions.map((question) => [question.id, safeText(question.title, 160)]));
  const parts: string[] = [];
  for (const [questionId, value] of Object.entries(answers).slice(0, 8)) {
    const answer = scalarPreview(value);
    if (!answer) continue;
    parts.push(`${titleById.get(questionId) || 'Response'}: ${answer}`);
    if (parts.join(' · ').length >= excerptLimit) break;
  }
  return safeText(parts.join(' · ') || 'Completed survey response.', excerptLimit);
}

function collectNarrative(value: unknown, output: string[], depth = 0) {
  if (output.join(' ').length >= excerptLimit || depth > 4 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    const text = safeText(value, 800);
    if (text) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) collectNarrative(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const priority = ['summary', 'executiveSummary', 'overview', 'answer', 'analysis', 'finding', 'findings', 'body', 'content', 'recommendation'];
  const visited = new Set<string>();
  for (const key of priority) {
    if (!(key in record)) continue;
    visited.add(key);
    collectNarrative(record[key], output, depth + 1);
  }
  for (const [key, item] of Object.entries(record)) {
    if (visited.has(key) || /(?:token|secret|password|runtime|recipient|email|citation|sourceRef)/iu.test(key)) continue;
    collectNarrative(item, output, depth + 1);
    if (output.join(' ').length >= excerptLimit) break;
  }
}

function narrativeExcerpt(value: unknown, fallback: string) {
  const output: string[] = [];
  collectNarrative(value, output);
  return safeText(output.join(' · ') || fallback, excerptLimit);
}

function boundedSample(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(0, Math.min(1_000_000_000, number)) : null;
}

function sourceIds(sql: string, parameters: unknown[]) {
  return (db.prepare(sql).all(...parameters) as Array<{ id: unknown }>).map((row) => String(row.id));
}

/** Build a parameterised, case-insensitive substring predicate. Column names
 * come only from the static adapter catalogue below; search text is always a
 * bound value. */
function searchPredicate(columns: readonly string[], query: string) {
  if (!query) return { sql: '', parameters: [] as string[] };
  const pattern = `%${query.toLocaleLowerCase('en-GB')}%`;
  return {
    sql: ` AND (${columns.map((column) => `LOWER(COALESCE(${column}, '')) LIKE ?`).join(' OR ')})`,
    parameters: columns.map(() => pattern)
  };
}

function finalise(view: JourneyEvidenceSourceView): JourneyEvidenceSourceView {
  return {
    ...view,
    sourceRef: safeText(view.sourceRef, 400),
    sourceId: safeText(view.sourceId, 200),
    label: safeText(view.label, labelLimit) || 'Untitled evidence source',
    excerpt: safeText(view.excerpt, excerptLimit),
    population: safeText(view.population, populationLimit),
    state: safeText(view.state, 80),
    path: safeText(view.path, 400),
    sampleSize: boundedSample(view.sampleSize),
    metadata: Object.fromEntries(Object.entries(view.metadata).slice(0, 20).map(([key, value]) => [
      safeText(key, 80), typeof value === 'number' || typeof value === 'boolean' || value === null
        ? value : safeText(value, 300)
    ]))
  };
}

function observationWindow(snapshotJson: unknown) {
  const snapshot = parseJson<Array<Record<string, unknown>>>(snapshotJson, []);
  const timestamps = snapshot.map((item) => String(item.publishedAt || item.published_at || ''))
    .filter((value) => Number.isFinite(Date.parse(value))).sort();
  return { start: timestamps[0] || null, end: timestamps.at(-1) || null };
}

const knowledgeDocumentAdapter: JourneyEvidenceSourceAdapter = {
  sourceType: 'knowledge_document', feature: 'knowledgeBases',
  prefixes: ['knowledge-document:'], canonicalPrefix: 'knowledge-document:',
  resolve(context, sourceId) {
    const row = db.prepare(`SELECT document.*,base.name knowledge_base_name,base.privacy knowledge_base_privacy
      FROM knowledge_documents document
      JOIN knowledge_bases base ON base.id=document.knowledge_base_id AND base.space_id=document.space_id
      WHERE document.id=? AND document.space_id=? AND document.deleted_at IS NULL AND base.deleted_at IS NULL
        AND (base.privacy='space' OR base.created_by=?)`)
      .get(sourceId, context.spaceId, context.userId) as any;
    if (!row) return null;
    const detail = [row.state, row.page_count ? `${row.page_count} page(s)` : '', row.chunk_count ? `${row.chunk_count} indexed chunk(s)` : '']
      .filter(Boolean).join(' · ');
    return finalise({
      sourceType: 'knowledge_document', sourceRef: `knowledge-document:${row.id}`, sourceId: row.id,
      label: row.original_name, excerpt: detail || `Document in ${row.knowledge_base_name}.`,
      collectedAt: row.indexed_at || row.updated_at || row.created_at, sampleSize: null,
      population: row.knowledge_base_name, windowStart: null, windowEnd: null,
      state: row.state, updatedAt: row.updated_at, path: `/knowledge-bases/${row.knowledge_base_id}`,
      metadata: { knowledgeBaseId: row.knowledge_base_id, knowledgeBase: row.knowledge_base_name,
        mimeType: row.mime_type, sha256: row.sha256, privacy: row.knowledge_base_privacy }
    });
  }
};

const surveyResponseAdapter: JourneyEvidenceSourceAdapter = {
  sourceType: 'survey_response', feature: 'surveys',
  prefixes: ['survey-response:'], canonicalPrefix: 'survey-response:',
  resolve(context, sourceId) {
    const row = db.prepare(`SELECT response.*,survey.title survey_title
      FROM responses response JOIN surveys survey ON survey.id=response.survey_id
      WHERE response.id=? AND survey.space_id=? AND response.status='completed'`)
      .get(sourceId, context.spaceId) as any;
    if (!row) return null;
    return finalise({
      sourceType: 'survey_response', sourceRef: `survey-response:${row.id}`, sourceId: row.id,
      label: `${row.survey_title} · completed response`, excerpt: answerExcerpt(row.answers_json, row.survey_id),
      collectedAt: row.completed_at || row.started_at, sampleSize: 1, population: row.survey_title,
      windowStart: row.started_at, windowEnd: row.completed_at || row.started_at,
      state: row.status, updatedAt: row.analyzed_at || row.completed_at || row.started_at,
      path: `/surveys/${row.survey_id}`, metadata: { surveyId: row.survey_id, collectorId: row.collector_id,
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds), analyzed: Boolean(row.analyzed_at) }
    });
  }
};

const surveyAnalysisAdapter: JourneyEvidenceSourceAdapter = {
  sourceType: 'survey_analysis', feature: 'surveys',
  prefixes: ['survey-insight:', 'survey-analysis:'], canonicalPrefix: 'survey-insight:',
  resolve(context, sourceId) {
    const row = db.prepare(`SELECT insight.*,survey.title survey_title,
        (SELECT COUNT(*) FROM responses response WHERE response.survey_id=survey.id AND response.status='completed') sample_size,
        (SELECT MIN(response.completed_at) FROM responses response WHERE response.survey_id=survey.id AND response.status='completed') window_start,
        (SELECT MAX(response.completed_at) FROM responses response WHERE response.survey_id=survey.id AND response.status='completed') window_end
      FROM insights insight JOIN surveys survey ON survey.id=insight.survey_id
      WHERE insight.id=? AND survey.space_id=? AND insight.kind IN ('ai_insights','executive_report')`)
      .get(sourceId, context.spaceId) as any;
    if (!row) return null;
    const payload = parseJson(row.payload_json, {} as Record<string, unknown>);
    const kind = row.kind === 'executive_report' ? 'Executive report' : 'Survey intelligence';
    return finalise({
      sourceType: 'survey_analysis', sourceRef: `survey-insight:${row.id}`, sourceId: row.id,
      label: `${row.survey_title} · ${kind}`, excerpt: narrativeExcerpt(payload, `${kind} for ${row.survey_title}.`),
      collectedAt: row.created_at, sampleSize: Number(row.sample_size || 0), population: row.survey_title,
      windowStart: row.window_start || null, windowEnd: row.window_end || null,
      state: 'saved', updatedAt: row.created_at, path: `/surveys/${row.survey_id}`,
      metadata: { surveyId: row.survey_id, kind: row.kind }
    });
  }
};

const socialMentionAdapter: JourneyEvidenceSourceAdapter = {
  sourceType: 'social_mention', feature: 'socialListening',
  prefixes: ['social-mention:', 'x-post:'], canonicalPrefix: 'social-mention:',
  resolve(context, sourceId) {
    const row = db.prepare('SELECT * FROM social_mentions WHERE id=? AND space_id=?').get(sourceId, context.spaceId) as any;
    if (!row) return null;
    return finalise({
      sourceType: 'social_mention', sourceRef: `social-mention:${row.id}`, sourceId: row.id,
      label: row.author ? `Post by ${row.author}` : `${row.source} post`, excerpt: row.content,
      collectedAt: row.published_at, sampleSize: 1, population: row.source,
      windowStart: row.published_at, windowEnd: row.published_at, state: 'collected', updatedAt: row.created_at,
      path: '/social-listening', metadata: { source: row.source, externalId: row.external_id || null,
        language: row.language || null, url: row.url || null }
    });
  }
};

const socialIntelligenceAdapter: JourneyEvidenceSourceAdapter = {
  sourceType: 'social_intelligence', feature: 'socialListening',
  prefixes: ['social-report:', 'social-intelligence:'], canonicalPrefix: 'social-report:',
  resolve(context, sourceId) {
    const row = db.prepare(`SELECT * FROM social_intelligence_reports
      WHERE id=? AND space_id=? AND state='completed' AND result_json IS NOT NULL`)
      .get(sourceId, context.spaceId) as any;
    if (!row) return null;
    const mentionIds = parseJson<string[]>(row.mention_ids_json, []);
    const window = observationWindow(row.source_snapshot_json);
    return finalise({
      sourceType: 'social_intelligence', sourceRef: `social-report:${row.id}`, sourceId: row.id,
      label: row.title, excerpt: narrativeExcerpt(parseJson(row.result_json, {}), 'Completed social intelligence report.'),
      collectedAt: row.completed_at || row.updated_at || row.created_at, sampleSize: mentionIds.length,
      population: 'Collected social posts and mentions', windowStart: window.start, windowEnd: window.end,
      state: row.state, updatedAt: row.updated_at, path: '/social-listening',
      metadata: { connectionId: row.connection_id || null, mentionCount: mentionIds.length }
    });
  }
};

const ticketAdapter: JourneyEvidenceSourceAdapter = {
  sourceType: 'ticket', feature: 'serviceRecovery',
  prefixes: ['recovery-ticket:', 'ticket:'], canonicalPrefix: 'recovery-ticket:',
  resolve(context, sourceId) {
    const row = db.prepare(`SELECT ticket.*,survey.title survey_title
      FROM tickets ticket JOIN surveys survey ON survey.id=ticket.survey_id
      WHERE ticket.id=? AND survey.space_id=?`).get(sourceId, context.spaceId) as any;
    if (!row) return null;
    return finalise({
      sourceType: 'ticket', sourceRef: `recovery-ticket:${row.id}`, sourceId: row.id,
      label: row.title, excerpt: row.notes || `${row.priority} priority · ${row.status}`,
      collectedAt: row.created_at, sampleSize: 1, population: row.survey_title,
      windowStart: row.created_at, windowEnd: row.updated_at, state: row.status, updatedAt: row.updated_at,
      path: '/tickets', metadata: { surveyId: row.survey_id, responseId: row.response_id || null,
        priority: row.priority, owner: row.owner || null }
    });
  }
};

const assistantArtifactAdapter: JourneyEvidenceSourceAdapter = {
  sourceType: 'assistant_artifact', feature: 'terra',
  prefixes: ['assistant-run:', 'assistant-artifact:'], canonicalPrefix: 'assistant-run:',
  resolve(context, sourceId) {
    const row = db.prepare(`SELECT * FROM assistant_runs
      WHERE id=? AND space_id=? AND requested_by=? AND state='completed'`)
      .get(sourceId, context.spaceId, context.userId) as any;
    if (!row) return null;
    const output = parseJson(row.output_json, {} as Record<string, unknown>);
    const body = row.draft_body || row.generated_body || narrativeExcerpt(output, 'Completed assistant work product.');
    return finalise({
      sourceType: 'assistant_artifact', sourceRef: `assistant-run:${row.id}`, sourceId: row.id,
      label: row.title || row.draft_subject || row.generated_subject || String(row.kind).replaceAll('_', ' '),
      excerpt: body, collectedAt: row.completed_at || row.updated_at, sampleSize: null,
      population: 'Authorised assistant workspace', windowStart: row.started_at || row.created_at,
      windowEnd: row.completed_at || row.updated_at, state: row.state, updatedAt: row.updated_at,
      path: '/assistant', metadata: { kind: row.kind, documentType: row.document_type || null,
        draftRevision: Number(row.draft_revision || 0) }
    });
  }
};

const agreementAdapter: JourneyEvidenceSourceAdapter = {
  sourceType: 'agreement', feature: 'agreements',
  prefixes: ['agreement:'], canonicalPrefix: 'agreement:',
  resolve(context, sourceId) {
    const row = db.prepare(`SELECT envelope.*,
        (SELECT COUNT(*) FROM esign_recipients recipient WHERE recipient.envelope_id=envelope.id) recipient_count
      FROM esign_envelopes envelope
      WHERE envelope.id=? AND envelope.space_id=? AND envelope.status='completed'`)
      .get(sourceId, context.spaceId) as any;
    if (!row) return null;
    return finalise({
      sourceType: 'agreement', sourceRef: `agreement:${row.id}`, sourceId: row.id,
      label: row.title, excerpt: row.subject || row.message || 'Completed signed agreement.',
      collectedAt: row.completed_at || row.updated_at, sampleSize: Number(row.recipient_count || 0),
      population: 'Agreement participants', windowStart: row.sent_at || row.created_at,
      windowEnd: row.completed_at || row.updated_at, state: row.status, updatedAt: row.updated_at,
      path: `/agreements/${row.id}`, metadata: { routingMode: row.routing_mode,
        recipientCount: Number(row.recipient_count || 0), completedAt: row.completed_at || null }
    });
  }
};

type EvidenceDiscoveryQuery = (
  context: JourneyEvidenceSourceContext,
  query: string,
  limit: number,
  offset: number
) => string[];

/** Discovery queries return record identities only. Every candidate is passed
 * through the corresponding authoritative resolver afterwards, so discovery
 * and direct attachment cannot drift into different permission rules. */
const evidenceDiscoveryQueries: Record<DiscoverableJourneyEvidenceSourceType, EvidenceDiscoveryQuery> = {
  knowledge_document(context, query, limit, offset) {
    const search = searchPredicate(['document.id', 'document.original_name', 'base.name'], query);
    return sourceIds(`SELECT document.id
      FROM knowledge_documents document
      JOIN knowledge_bases base ON base.id=document.knowledge_base_id AND base.space_id=document.space_id
      WHERE document.space_id=? AND document.deleted_at IS NULL AND base.deleted_at IS NULL
        AND (base.privacy='space' OR base.created_by=?)${search.sql}
      ORDER BY COALESCE(document.updated_at,document.created_at) DESC,document.id DESC LIMIT ? OFFSET ?`,
    [context.spaceId, context.userId, ...search.parameters, limit, offset]);
  },
  survey_response(context, query, limit, offset) {
    const search = searchPredicate(['response.id', 'survey.title'], query);
    return sourceIds(`SELECT response.id
      FROM responses response JOIN surveys survey ON survey.id=response.survey_id
      WHERE survey.space_id=? AND response.status='completed'${search.sql}
      ORDER BY COALESCE(response.completed_at,response.started_at) DESC,response.id DESC LIMIT ? OFFSET ?`,
    [context.spaceId, ...search.parameters, limit, offset]);
  },
  survey_analysis(context, query, limit, offset) {
    const search = searchPredicate(['insight.id', 'survey.title', 'insight.kind'], query);
    return sourceIds(`SELECT insight.id
      FROM insights insight JOIN surveys survey ON survey.id=insight.survey_id
      WHERE survey.space_id=? AND insight.kind IN ('ai_insights','executive_report')${search.sql}
      ORDER BY insight.created_at DESC,insight.id DESC LIMIT ? OFFSET ?`,
    [context.spaceId, ...search.parameters, limit, offset]);
  },
  social_mention(context, query, limit, offset) {
    const search = searchPredicate(['mention.id', 'mention.author', 'mention.external_id'], query);
    return sourceIds(`SELECT mention.id FROM social_mentions mention
      WHERE mention.space_id=?${search.sql}
      ORDER BY COALESCE(mention.published_at,mention.created_at) DESC,mention.id DESC LIMIT ? OFFSET ?`,
    [context.spaceId, ...search.parameters, limit, offset]);
  },
  social_intelligence(context, query, limit, offset) {
    const search = searchPredicate(['report.id', 'report.title'], query);
    return sourceIds(`SELECT report.id FROM social_intelligence_reports report
      WHERE report.space_id=? AND report.state='completed' AND report.result_json IS NOT NULL${search.sql}
      ORDER BY COALESCE(report.completed_at,report.updated_at,report.created_at) DESC,report.id DESC LIMIT ? OFFSET ?`,
    [context.spaceId, ...search.parameters, limit, offset]);
  },
  ticket(context, query, limit, offset) {
    const search = searchPredicate(['ticket.id', 'ticket.title', 'survey.title'], query);
    return sourceIds(`SELECT ticket.id
      FROM tickets ticket JOIN surveys survey ON survey.id=ticket.survey_id
      WHERE survey.space_id=?${search.sql}
      ORDER BY ticket.updated_at DESC,ticket.id DESC LIMIT ? OFFSET ?`,
    [context.spaceId, ...search.parameters, limit, offset]);
  },
  assistant_artifact(context, query, limit, offset) {
    const search = searchPredicate([
      'run.id', 'run.title', 'run.draft_subject', 'run.generated_subject', 'run.kind'
    ], query);
    return sourceIds(`SELECT run.id FROM assistant_runs run
      WHERE run.space_id=? AND run.requested_by=? AND run.state='completed'${search.sql}
      ORDER BY run.updated_at DESC,run.id DESC LIMIT ? OFFSET ?`,
    [context.spaceId, context.userId, ...search.parameters, limit, offset]);
  },
  agreement(context, query, limit, offset) {
    const search = searchPredicate(['envelope.id', 'envelope.title', 'envelope.subject'], query);
    return sourceIds(`SELECT envelope.id FROM esign_envelopes envelope
      WHERE envelope.space_id=? AND envelope.status='completed'${search.sql}
      ORDER BY envelope.updated_at DESC,envelope.id DESC LIMIT ? OFFSET ?`,
    [context.spaceId, ...search.parameters, limit, offset]);
  }
};

export const journeyEvidenceSourceAdapters: ReadonlyMap<EvidenceSourceType, JourneyEvidenceSourceAdapter> = new Map([
  knowledgeDocumentAdapter, surveyResponseAdapter, surveyAnalysisAdapter, socialMentionAdapter,
  socialIntelligenceAdapter, ticketAdapter, assistantArtifactAdapter, agreementAdapter
].map((adapter) => [adapter.sourceType, adapter]));

export const unavailableJourneyEvidenceSourceTypes = ['interview', 'observation', 'event_aggregate'] as const;

export function searchJourneyEvidenceSources(input: JourneyEvidenceSourceContext & {
  sourceType: DiscoverableJourneyEvidenceSourceType;
  query?: string;
  limit?: number;
  offset?: number;
}): JourneyEvidenceSourceView[] {
  const adapter = journeyEvidenceSourceAdapters.get(input.sourceType);
  if (!adapter) {
    throw new JourneyEvidenceSourceError(
      'This evidence source type is not available for discovery.',
      422, 'JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE', { sourceType: input.sourceType }
    );
  }
  assertSubscriptionFeature(input.spaceId, adapter.feature);
  const query = safeText(input.query, 120);
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(input.limit) || 20)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(Number(input.offset) || 0)));
  const candidateIds = evidenceDiscoveryQueries[input.sourceType](input, query, limit, offset);
  const sources: JourneyEvidenceSourceView[] = [];
  for (const sourceId of candidateIds) {
    const source = adapter.resolve(input, sourceId);
    if (source) sources.push(source);
    if (sources.length >= limit) break;
  }
  return sources;
}

export function resolveJourneyEvidenceSource(input: JourneyEvidenceSourceContext & {
  sourceType: EvidenceSourceType;
  sourceRef: string;
}): JourneyEvidenceSourceView {
  const adapter = journeyEvidenceSourceAdapters.get(input.sourceType);
  if (!adapter) {
    throw new JourneyEvidenceSourceError(
      'This evidence source type does not yet have an authoritative system of record.',
      422, 'JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE', { sourceType: input.sourceType }
    );
  }
  assertSubscriptionFeature(input.spaceId, adapter.feature);
  const sourceId = safeIdReference(input.sourceRef, adapter);
  const resolved = adapter.resolve({ spaceId: input.spaceId, userId: input.userId }, sourceId);
  if (!resolved) {
    // Missing, cross-space, deleted, incomplete, private, or otherwise
    // inaccessible sources deliberately share one response to avoid existence
    // disclosure across tenants and private assistant/knowledge records.
    throw new JourneyEvidenceSourceError(
      'Evidence source not found or not available to this account.',
      404, 'JOURNEY_EVIDENCE_SOURCE_NOT_FOUND', { sourceType: input.sourceType }
    );
  }
  return resolved;
}

function lifecycleSource(view: JourneyEvidenceSourceView): JourneyEvidenceSourceCurrent {
  return {
    sourceType: view.sourceType,
    sourceRef: view.sourceRef,
    label: view.label,
    excerpt: view.excerpt,
    population: view.population,
    sampleSize: view.sampleSize,
    collectedAt: view.collectedAt,
    windowStart: view.windowStart,
    windowEnd: view.windowEnd,
    updatedAt: view.updatedAt
  };
}

/** Resolve evidence for a read model without turning current access failures
 * into an existence oracle. The lifecycle layer can show that a stored link is
 * unavailable while redacting its old source identity and snapshot. */
export function resolveJourneyEvidenceLifecycle(input: JourneyEvidenceSourceContext & {
  sourceType: EvidenceSourceType;
  sourceRef: string;
}): JourneyEvidenceResolution {
  try {
    return { kind: 'available', source: lifecycleSource(resolveJourneyEvidenceSource(input)) };
  } catch (error) {
    if (error instanceof SubscriptionEntitlementError) {
      return { kind: 'inaccessible', reason: 'feature_disabled' };
    }
    if (error instanceof JourneyEvidenceSourceError) {
      return {
        kind: 'inaccessible',
        reason: error.code === 'JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE'
          ? 'source_adapter_unavailable'
          : 'not_found_or_not_authorised'
      };
    }
    throw error;
  }
}
