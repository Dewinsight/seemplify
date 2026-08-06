/** First-party ("native") journey metric source adapters.
 *
 * These read Seemplify's own service-recovery and social systems of record and
 * derive *only* the deterministic aggregate observations that
 * `journeyOperationalMeasures` already knows how to calculate. Nothing here
 * copies source content: no ticket title, notes or owner, no `ticket_events`
 * detail diff, no mention content, author, URL, sentiment score, emotions,
 * themes or summary. The projections feed the existing observation/rebuild
 * pipeline, so there is no second raw analytics store.
 *
 * Tenancy: `tickets` and `ticket_events` carry no `space_id`
 * (`database.ts`, `platformSchema.ts`), so every ticket read goes through the
 * single `ticketScopeJoin` helper that joins `surveys` and filters on
 * `surveys.space_id`. A direct read of either table would be a cross-tenant
 * defect with no foreign key to catch it. `social_mentions.space_id` exists
 * only through the `spaces.ts` backfill, so the space filter is always paired
 * with an authorised-connection semi-join.
 *
 * Re-identification: lineage never publishes a raw source identity.
 * `xIntegration` derives a mention ID as an *unkeyed* `sha256("x:{space}:{post}")`,
 * so anyone holding a public post ID could confirm that a specific author's
 * post is counted. Every `sourceRecordId` and `subjectId` below is therefore an
 * HMAC under the journey identity key, matching the import path, which points
 * its lineage at the internal import row rather than the external record.
 */
import crypto from 'node:crypto';
import { db } from './database.js';
import type {
  JourneyOperationalMeasureDefinition, JourneyOperationalObservation, JourneySentiment
} from './journeyOperationalMeasures.js';
import {
  assertJourneyNativeMeasureSupported, JourneyNativeMetricSourceError, journeyNativeMetricLineageFor,
  journeyNativeMetricResearchSourceType, JOURNEY_NATIVE_SOCIAL_EVENTS, JOURNEY_NATIVE_TICKET_EVENTS,
  type JourneyNativeMetricSource
} from './journeyNativeMetricSources.js';

/** Hard ceiling on a single native scan. Silent truncation would publish a
 * wrong denominator, which is the worst failure mode available here, so an
 * oversized scope fails the rebuild loudly instead. */
export const JOURNEY_NATIVE_METRIC_MAX_ROWS = 20_000;

export type JourneyNativeMetricSourceChoice = { id: string; name: string; adapter: JourneyNativeMetricSource['adapter'] };

export type JourneyNativeSourceProjection = {
  sourceType: 'operational_import'; sourceRecordId: string; sourceRevisionSha256: string;
  occurredAt: string; included: boolean; exclusionCode: string | null;
};

export type JourneyNativeProjection =
  | { state: 'available'; observations: JourneyOperationalObservation[]; sources: JourneyNativeSourceProjection[] }
  | { state: 'retracted'; warning: string };

function sha(value: unknown) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
function placeholders(values: readonly string[]) { return values.map(() => '?').join(','); }
function instant(value: unknown) {
  const parsed = new Date(String(value ?? ''));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

/** Single tenancy path for every ticket read. `tickets` has no `space_id`. */
const ticketScopeJoin = `FROM tickets ticket
  JOIN surveys survey ON survey.id=ticket.survey_id AND survey.space_id=?`;

/** Connection statuses that still authorise a native social read. A connection
 * awaiting re-authorisation keeps its already-collected mentions authorised —
 * that is a freshness problem, not an authorisation one. A disconnected or
 * unverified connection is not authorised and retracts the measure rather than
 * quietly computing over the surviving subset. */
const AUTHORISED_CONNECTION_STATUSES = ['connected', 'reauthorization_required'] as const;

function authorisedSurveyIds(spaceId: string, surveyIds: readonly string[]) {
  if (!surveyIds.length) return new Set<string>();
  return new Set((db.prepare(`SELECT id FROM surveys WHERE space_id=? AND id IN (${placeholders(surveyIds)})`)
    .all(spaceId, ...surveyIds) as Array<{ id: string }>).map((row) => String(row.id)));
}
function authorisedConnectionIds(spaceId: string, connectionIds: readonly string[]) {
  if (!connectionIds.length) return new Set<string>();
  return new Set((db.prepare(`SELECT id FROM x_connections WHERE space_id=? AND id IN (${placeholders(connectionIds)})
    AND status IN (${placeholders(AUTHORISED_CONNECTION_STATUSES)})`)
    .all(spaceId, ...connectionIds, ...AUTHORISED_CONNECTION_STATUSES) as Array<{ id: string }>)
    .map((row) => String(row.id)));
}

function resolveScope(spaceId: string, source: JourneyNativeMetricSource) {
  return source.adapter === 'service_recovery_tickets'
    ? authorisedSurveyIds(spaceId, source.sourceIds)
    : authorisedConnectionIds(spaceId, source.sourceIds);
}

/** Owner/admin picker options. Only same-space, currently authorised sources
 * are ever offered, so a configuration can never be assembled from an
 * identity the space does not hold. */
export function listJourneyNativeMetricSourceChoices(spaceId: string) {
  const tickets = (db.prepare(`SELECT survey.id,survey.title FROM surveys survey
    WHERE survey.space_id=? ORDER BY survey.updated_at DESC,survey.id LIMIT 200`)
    .all(spaceId) as Array<{ id: string; title: string }>).map((row) => ({ id: String(row.id),
      name: String(row.title || `Survey ${String(row.id).slice(0, 8)}`),
      adapter: 'service_recovery_tickets' as const }));
  const social = (db.prepare(`SELECT id,username,display_name FROM x_connections
    WHERE space_id=? AND status IN (${placeholders(AUTHORISED_CONNECTION_STATUSES)})
    ORDER BY updated_at DESC,id LIMIT 200`)
    .all(spaceId, ...AUTHORISED_CONNECTION_STATUSES) as Array<{ id: string; username: string | null;
      display_name: string | null }>).map((row) => ({ id: String(row.id),
      name: String(row.display_name || row.username || `Connection ${String(row.id).slice(0, 8)}`),
      adapter: 'social_mentions' as const }));
  return { tickets, social };
}

/** A stage-targeted native measure needs an *explicit* governed association.
 * The only one this product has is an active Journey Research Hub link from a
 * source of the matching type to that exact stage. Without it the mapping would
 * be an unguided inference, so it is refused. */
export function assertJourneyNativeStageAssociation(input: { spaceId: string; journeyDefinitionId: string;
  source: JourneyNativeMetricSource }) {
  const stageId = input.source.stageAssociation?.stageId;
  if (!stageId) return;
  const stage = db.prepare(`SELECT stage.id FROM journey_map_stages stage
    JOIN journey_map_versions version ON version.id=stage.version_id AND version.space_id=stage.space_id
    WHERE stage.id=? AND stage.space_id=? AND version.definition_id=?`)
    .get(stageId, input.spaceId, input.journeyDefinitionId) as { id?: string } | undefined;
  if (!stage?.id) throw new JourneyNativeMetricSourceError(
    'The native stage association does not belong to this journey.', 404, 'JOURNEY_METRIC_NATIVE_STAGE_NOT_FOUND');
  const link = db.prepare(`SELECT link.id FROM journey_research_links link
    JOIN journey_research_sources source ON source.id=link.source_id AND source.space_id=link.space_id
    WHERE link.space_id=? AND link.state='active' AND link.target_type='stage' AND link.target_id=?
      AND source.state='active' AND source.source_type=? LIMIT 1`)
    .get(input.spaceId, stageId, journeyNativeMetricResearchSourceType(input.source)) as { id?: string } | undefined;
  if (!link?.id) throw new JourneyNativeMetricSourceError(
    'Stage targeting requires an active governed research link from this source type to the stage.', 409,
    'JOURNEY_METRIC_NATIVE_STAGE_UNGOVERNED');
}

/** Create-time authorisation. Every pinned identity must resolve inside this
 * space; an unknown, foreign, revoked or deleted identity is a 404 rather than
 * a silently narrowed scope that would read as "no data". */
export function authoriseJourneyNativeMetricSource(input: { spaceId: string; journeyDefinitionId: string;
  source: JourneyNativeMetricSource }) {
  const resolved = resolveScope(input.spaceId, input.source);
  const missing = input.source.sourceIds.filter((id) => !resolved.has(id));
  if (missing.length) {
    throw new JourneyNativeMetricSourceError(
      input.source.adapter === 'service_recovery_tickets'
        ? 'A selected survey is unavailable in this space.'
        : 'A selected social connection is unavailable, revoked or not connected in this space.',
      404, 'JOURNEY_METRIC_NATIVE_SOURCE_NOT_FOUND');
  }
  assertJourneyNativeStageAssociation(input);
}

function retracted(warning: string): JourneyNativeProjection { return { state: 'retracted', warning }; }

function assertRowCap(count: number) {
  if (count > JOURNEY_NATIVE_METRIC_MAX_ROWS) {
    throw new JourneyNativeMetricSourceError(
      `The native source scope resolves more than ${JOURNEY_NATIVE_METRIC_MAX_ROWS} records for this window. `
      + 'Narrow the scope or window; the measure is not published rather than truncated.', 409,
      'JOURNEY_METRIC_NATIVE_SCOPE_TOO_LARGE');
  }
  return count;
}

type Emit = {
  observations: JourneyOperationalObservation[];
  sources: JourneyNativeSourceProjection[];
};

function push(emit: Emit, entry: { recordKey: string; revisionParts: unknown; occurredAt: string;
  observation: JourneyOperationalObservation | null; exclusionCode: string | null }) {
  emit.sources.push({ sourceType: 'operational_import', sourceRecordId: entry.recordKey,
    sourceRevisionSha256: sha(entry.revisionParts), occurredAt: entry.occurredAt,
    included: entry.observation !== null && entry.exclusionCode === null, exclusionCode: entry.exclusionCode });
  if (entry.observation) emit.observations.push(entry.observation);
}

function ticketProjection(input: { spaceId: string; source: JourneyNativeMetricSource;
  definition: JourneyOperationalMeasureDefinition; earliest: string; end: string;
  identityHmac: (value: string) => string }): JourneyNativeProjection {
  const scope = [...input.source.sourceIds];
  const authorised = authorisedSurveyIds(input.spaceId, scope);
  if (scope.some((id) => !authorised.has(id))) {
    return retracted('A pinned survey source is no longer available in this space. '
      + 'Historical observations remain immutable and no partial measure is published.');
  }
  const stageId = input.source.stageAssociation?.stageId ?? null;
  // Stage targeting restricts the ticket population to the exact tickets a
  // governed research link attaches to that stage. Nothing is inferred.
  const stageClause = stageId ? ` AND EXISTS (SELECT 1 FROM journey_research_links link
    JOIN journey_research_sources research ON research.id=link.source_id AND research.space_id=link.space_id
    WHERE link.space_id=survey.space_id AND link.state='active' AND link.target_type='stage' AND link.target_id=?
      AND research.state='active' AND research.source_type='ticket'
      AND research.source_ref=('recovery-ticket:' || ticket.id))` : '';
  const stageValues = stageId ? [stageId] : [];
  const emit: Emit = { observations: [], sources: [] };
  const lineage = (surveyId: string) => journeyNativeMetricLineageFor(input.source, surveyId);

  if (input.definition.kind === 'ticket_rate') {
    // Population: distinct respondents behind completed responses in scope.
    const responses = db.prepare(`SELECT response.id,response.survey_id,response.respondent_token,response.completed_at
      FROM responses response JOIN surveys survey ON survey.id=response.survey_id AND survey.space_id=?
      WHERE survey.id IN (${placeholders(scope)}) AND response.status='completed'
        AND response.completed_at IS NOT NULL AND response.completed_at>=? AND response.completed_at<?
      ORDER BY response.id`).all(input.spaceId, ...scope, input.earliest, input.end) as Array<{
        id: string; survey_id: string; respondent_token: string; completed_at: unknown }>;
    const tickets = db.prepare(`SELECT event.id event_id,event.created_at,ticket.id ticket_id,ticket.survey_id,
      response.respondent_token
      ${ticketScopeJoin}
      JOIN ticket_events event ON event.ticket_id=ticket.id
      LEFT JOIN responses response ON response.id=ticket.response_id
      WHERE survey.id IN (${placeholders(scope)}) AND event.event_type='created'
        AND event.created_at>=? AND event.created_at<?${stageClause}
      ORDER BY event.created_at,event.id`)
      .all(input.spaceId, ...scope, input.earliest, input.end, ...stageValues) as Array<{
        event_id: string; created_at: unknown; ticket_id: string; survey_id: string;
        respondent_token: string | null }>;
    assertRowCap(responses.length + tickets.length);
    for (const row of responses) {
      const occurredAt = instant(row.completed_at);
      const recordKey = input.identityHmac(`native:response:${row.id}`);
      if (!occurredAt) {
        push(emit, { recordKey, revisionParts: ['response', recordKey], occurredAt: input.earliest,
          observation: null, exclusionCode: 'SOURCE_TIMESTAMP_INVALID' });
        continue;
      }
      const subjectId = input.identityHmac(`native:respondent:${row.survey_id}:${row.respondent_token}`);
      push(emit, { recordKey, revisionParts: ['response', recordKey, occurredAt], occurredAt,
        exclusionCode: null,
        observation: { observationId: `r.${recordKey}`, revision: 1, sourceLineage: lineage(String(row.survey_id)),
          sourceRecordId: recordKey, subjectId, subjectType: 'profile',
          eventType: JOURNEY_NATIVE_TICKET_EVENTS.population, occurredAt, stageId, sentiment: null } });
    }
    for (const row of tickets) {
      const occurredAt = instant(row.created_at);
      const recordKey = input.identityHmac(`native:ticket-event:${row.event_id}`);
      if (!occurredAt) {
        push(emit, { recordKey, revisionParts: ['ticket-event', recordKey], occurredAt: input.earliest,
          observation: null, exclusionCode: 'SOURCE_TIMESTAMP_INVALID' });
        continue;
      }
      // A ticket raised outside a governed response cannot join the population,
      // so it is recorded as an explicit exclusion rather than dropped.
      if (!row.respondent_token) {
        push(emit, { recordKey, revisionParts: ['ticket-event', recordKey, occurredAt], occurredAt,
          observation: null, exclusionCode: 'TICKET_WITHOUT_SOURCE_RESPONSE' });
        continue;
      }
      const subjectId = input.identityHmac(`native:respondent:${row.survey_id}:${row.respondent_token}`);
      push(emit, { recordKey, revisionParts: ['ticket-event', recordKey, occurredAt], occurredAt,
        exclusionCode: null,
        observation: { observationId: `e.${recordKey}`, revision: 1, sourceLineage: lineage(String(row.survey_id)),
          sourceRecordId: recordKey, subjectId, subjectType: 'profile',
          eventType: JOURNEY_NATIVE_TICKET_EVENTS.opened, occurredAt, stageId, sentiment: null } });
    }
    return { state: 'available', observations: emit.observations, sources: emit.sources };
  }

  // `repeat_contact_rate` and `recovery_rate` are keyed on the ticket itself and
  // read only the append-only lifecycle log. `tickets.updated_at` is deliberately
  // never used: `recovery.ts` bumps it on any field edit, so it would fabricate
  // recovery timestamps.
  const eventTypes = input.definition.kind === 'repeat_contact_rate'
    ? ['created', 'reopened'] : ['created', 'closed'];
  const rows = db.prepare(`SELECT event.id event_id,event.event_type,event.created_at,ticket.id ticket_id,ticket.survey_id
    ${ticketScopeJoin}
    JOIN ticket_events event ON event.ticket_id=ticket.id
    WHERE survey.id IN (${placeholders(scope)}) AND event.event_type IN (${placeholders(eventTypes)})
      AND event.created_at>=? AND event.created_at<?${stageClause}
    ORDER BY event.created_at,event.id`)
    .all(input.spaceId, ...scope, ...eventTypes, input.earliest, input.end, ...stageValues) as Array<{
      event_id: string; event_type: string; created_at: unknown; ticket_id: string; survey_id: string }>;
  assertRowCap(rows.length);
  for (const row of rows) {
    const occurredAt = instant(row.created_at);
    const recordKey = input.identityHmac(`native:ticket-event:${row.event_id}`);
    if (!occurredAt) {
      push(emit, { recordKey, revisionParts: ['ticket-event', recordKey], occurredAt: input.earliest,
        observation: null, exclusionCode: 'SOURCE_TIMESTAMP_INVALID' });
      continue;
    }
    const eventType = input.definition.kind === 'repeat_contact_rate'
      ? JOURNEY_NATIVE_TICKET_EVENTS.contact
      : row.event_type === 'closed' ? JOURNEY_NATIVE_TICKET_EVENTS.recovered : JOURNEY_NATIVE_TICKET_EVENTS.opened;
    push(emit, { recordKey, revisionParts: ['ticket-event', recordKey, eventType, occurredAt], occurredAt,
      exclusionCode: null,
      observation: { observationId: `e.${recordKey}`, revision: 1, sourceLineage: lineage(String(row.survey_id)),
        sourceRecordId: recordKey, subjectId: input.identityHmac(`native:ticket:${row.ticket_id}`),
        subjectType: 'ticket', eventType, occurredAt, stageId, sentiment: null } });
  }
  return { state: 'available', observations: emit.observations, sources: emit.sources };
}

/** Deterministic sentiment mapping.
 *
 * The mention analyser emits `negative|neutral|positive|mixed` (`aiSchemas.ts`)
 * while the calculator's vocabulary is `negative|neutral|positive|unknown`
 * (`journeyOperationalMeasures.ts`). `mixed` is a *classified* result, so it
 * maps to `unknown` — the calculator's counted bucket for "analysed, but no
 * single polarity". Excluding it instead would shrink the denominator and
 * silently inflate every remaining share. An absent or unrecognised analysis is
 * not a classification at all and is excluded, which the calculator counts as
 * `INVALID_SENTIMENT`; the lineage records which of the two it was.
 */
function sentimentOf(analysis: unknown): { sentiment: JourneySentiment | null; exclusionCode: string | null } {
  let parsed: unknown = analysis;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { parsed = null; } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { sentiment: null, exclusionCode: 'SENTIMENT_UNCLASSIFIED' };
  }
  const value = (parsed as Record<string, unknown>).sentiment;
  if (value === undefined || value === null) return { sentiment: null, exclusionCode: 'SENTIMENT_UNCLASSIFIED' };
  if (value === 'negative' || value === 'neutral' || value === 'positive') {
    return { sentiment: value, exclusionCode: null };
  }
  if (value === 'mixed') return { sentiment: 'unknown', exclusionCode: null };
  return { sentiment: null, exclusionCode: 'SENTIMENT_INVALID' };
}

function socialProjection(input: { spaceId: string; source: JourneyNativeMetricSource;
  earliest: string; end: string; identityHmac: (value: string) => string }): JourneyNativeProjection {
  const scope = [...input.source.sourceIds];
  const authorised = authorisedConnectionIds(input.spaceId, scope);
  if (scope.some((id) => !authorised.has(id))) {
    return retracted('A pinned social connection is no longer authorised in this space. '
      + 'Historical observations remain immutable and no partial measure is published.');
  }
  const stageId = input.source.stageAssociation?.stageId ?? null;
  const stageClause = stageId ? ` AND EXISTS (SELECT 1 FROM journey_research_links link
    JOIN journey_research_sources research ON research.id=link.source_id AND research.space_id=link.space_id
    WHERE link.space_id=mention.space_id AND link.state='active' AND link.target_type='stage' AND link.target_id=?
      AND research.state='active' AND research.source_type='social_mention'
      AND research.source_ref=('social-mention:' || mention.id))` : '';
  const stageValues = stageId ? [stageId] : [];
  // A semi-join, never a join: one mention can be discovered by several
  // connections, and a fan-out would inflate the denominator.
  const rows = db.prepare(`SELECT mention.id,mention.published_at,mention.analysis_json
    FROM social_mentions mention
    WHERE mention.space_id=? AND EXISTS (SELECT 1 FROM x_connection_mentions link
      WHERE link.mention_id=mention.id AND link.connection_id IN (${placeholders(scope)}))
      AND mention.published_at>=? AND mention.published_at<?${stageClause}
    ORDER BY mention.published_at,mention.id`)
    .all(input.spaceId, ...scope, input.earliest, input.end, ...stageValues) as Array<{
      id: string; published_at: unknown; analysis_json: unknown }>;
  assertRowCap(rows.length);
  // Every authorised connection contributes the same aggregate lineage, so the
  // first pinned identity carries it; per-connection attribution would require
  // the fan-out the semi-join exists to avoid.
  const lineage = journeyNativeMetricLineageFor(input.source, scope[0]!);
  const emit: Emit = { observations: [], sources: [] };
  for (const row of rows) {
    const occurredAt = instant(row.published_at);
    const recordKey = input.identityHmac(`native:social-mention:${row.id}`);
    if (!occurredAt) {
      push(emit, { recordKey, revisionParts: ['mention', recordKey], occurredAt: input.earliest,
        observation: null, exclusionCode: 'SOURCE_TIMESTAMP_INVALID' });
      continue;
    }
    const decision = sentimentOf(row.analysis_json);
    // Mention analysis is rewritten in place with no revision column, so this
    // fingerprints the *derived* aggregate fact rather than claiming a source
    // revision the table does not carry.
    push(emit, { recordKey, revisionParts: ['mention', recordKey, occurredAt, decision.sentiment], occurredAt,
      exclusionCode: decision.exclusionCode,
      observation: { observationId: `m.${recordKey}`, revision: 1, sourceLineage: lineage,
        sourceRecordId: recordKey, subjectId: recordKey, subjectType: 'social_post',
        eventType: JOURNEY_NATIVE_SOCIAL_EVENTS.sentiment, occurredAt,
        // A social mention is never attributed to an individual customer path.
        // `stageId` only ever repeats the governed stage association above.
        stageId, sentiment: decision.sentiment } });
  }
  return { state: 'available', observations: emit.observations, sources: emit.sources };
}

/** Re-validates the pinned configuration against the measure and then projects.
 * The re-validation matters: the version was authorised when it was written,
 * but a source can be revoked or deleted before the rebuild runs. */
export function projectJourneyNativeObservations(input: { spaceId: string; source: JourneyNativeMetricSource;
  definition: JourneyOperationalMeasureDefinition; earliest: string; end: string;
  identityHmac: (value: string) => string }): JourneyNativeProjection {
  assertJourneyNativeMeasureSupported(input.source, input.definition);
  return input.source.adapter === 'service_recovery_tickets'
    ? ticketProjection(input)
    : socialProjection({ spaceId: input.spaceId, source: input.source, earliest: input.earliest,
      end: input.end, identityHmac: input.identityHmac });
}
