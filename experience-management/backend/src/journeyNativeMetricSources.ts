/** Version-pinned configuration contract for first-party ("native") journey
 * metric sources.
 *
 * Storage boundary, stated once here because every reader needs it: the pinned
 * runtime schema constrains `journey_metric_definition_versions.source_kind` to
 * `('survey','operational_import')` and
 * `journey_metric_observation_sources.source_type` to
 * `('survey_response','operational_import')`
 * (`journeyMetricSchema.ts`, `0021_journey_metric_observations.sql`). A native
 * definition therefore *stores* `operational_import` and carries its real
 * identity in this discriminator, which lives inside the already
 * content-hashed `configuration` document. That mirrors the precedent set by
 * `journeyMetricPrivacy.journeyMetricPrivacyMinimumSampleSize` and the export's
 * audit note in `journeyMetrics.ts`. Public reads derive the native identity
 * back out of the observation's own immutable definition version, so no read or
 * UI ever describes a native aggregate as an operational import — a caller
 * would otherwise go looking for a `journey_metric_imports` row that does not
 * exist. Raw SQL readers still see `operational_import`; widening those CHECK
 * sets is a migration and is deliberately out of this package.
 *
 * This module is pure: it never touches the database. Authorisation of the
 * pinned scope against the same-space source of record lives in
 * `journeyNativeMetricAdapters.ts`.
 */
import type {
  JourneyOperationalMeasureDefinition, JourneyOperationalSourceLineage
} from './journeyOperationalMeasures.js';

export const JOURNEY_NATIVE_METRIC_SOURCE_VERSION = 'journey-native-metric-source/v1' as const;
export const JOURNEY_NATIVE_METRIC_PROJECTION_VERSION = 'journey-native-projection/1' as const;
export const JOURNEY_NATIVE_METRIC_ADAPTER_VERSION = '1' as const;
export const JOURNEY_NATIVE_METRIC_MAX_SOURCES = 20;

export const journeyNativeMetricAdapters = ['service_recovery_tickets', 'social_mentions'] as const;
export type JourneyNativeMetricAdapter = typeof journeyNativeMetricAdapters[number];

export type JourneyNativeMetricStageAssociation = { stageId: string; via: 'research_link' };

export type JourneyNativeMetricSource = {
  configVersion: typeof JOURNEY_NATIVE_METRIC_SOURCE_VERSION;
  adapter: JourneyNativeMetricAdapter;
  adapterVersion: typeof JOURNEY_NATIVE_METRIC_ADAPTER_VERSION;
  /** Exact authorised same-space source-of-record identities: survey IDs for the
   * ticket adapter, X connection IDs for the social adapter. */
  sourceIds: string[];
  stageAssociation: JourneyNativeMetricStageAssociation | null;
};

export class JourneyNativeMetricSourceError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_METRIC_NATIVE_CONFIG_INVALID') {
    super(message);
    this.name = 'JourneyNativeMetricSourceError';
  }
}

/** The adapter, not the caller, owns the event vocabulary. A caller-supplied
 * event map would let an owner point a governed measure at arbitrary event
 * names through `configuration`, which `versionSchema` accepts as a free-form
 * JSON record. */
export const JOURNEY_NATIVE_TICKET_EVENTS = {
  population: 'survey.response_completed',
  opened: 'ticket.opened',
  contact: 'ticket.contact',
  recovered: 'ticket.recovered'
} as const;
export const JOURNEY_NATIVE_SOCIAL_EVENTS = { sentiment: 'social.sentiment_observed' } as const;

type SupportedMeasure = {
  kind: JourneyOperationalMeasureDefinition['kind'];
  subjectType: JourneyOperationalMeasureDefinition['subjectType'];
  eventFields: Record<string, string>;
};

/** The exhaustive set of measures the source facts actually support.
 *
 * `ticket_rate` counts distinct respondents in the authorised survey scope, so
 * its subject is the respondent behind a completed response — the only customer
 * identity the recovery tables carry (`tickets.response_id` → `responses`).
 * `repeat_contact_rate` and `recovery_rate` are keyed on the ticket itself and
 * are derived purely from the append-only `ticket_events` log, so neither
 * invents a cross-ticket customer identity that the source of record does not
 * hold. Everything else fails closed. */
const SUPPORTED_MEASURES: Record<JourneyNativeMetricAdapter, SupportedMeasure[]> = {
  service_recovery_tickets: [
    { kind: 'ticket_rate', subjectType: 'profile',
      eventFields: { populationEventType: JOURNEY_NATIVE_TICKET_EVENTS.population,
        ticketEventType: JOURNEY_NATIVE_TICKET_EVENTS.opened } },
    { kind: 'repeat_contact_rate', subjectType: 'ticket',
      eventFields: { contactEventType: JOURNEY_NATIVE_TICKET_EVENTS.contact } },
    { kind: 'recovery_rate', subjectType: 'ticket',
      eventFields: { eligibleEventType: JOURNEY_NATIVE_TICKET_EVENTS.opened,
        successEventType: JOURNEY_NATIVE_TICKET_EVENTS.recovered } }
  ],
  social_mentions: [
    { kind: 'sentiment_distribution', subjectType: 'social_post',
      eventFields: { sentimentEventType: JOURNEY_NATIVE_SOCIAL_EVENTS.sentiment } },
    { kind: 'sentiment_trend', subjectType: 'social_post',
      eventFields: { sentimentEventType: JOURNEY_NATIVE_SOCIAL_EVENTS.sentiment } }
  ]
};

const ADAPTER_FEATURE: Record<JourneyNativeMetricAdapter, 'serviceRecovery' | 'socialListening'> = {
  service_recovery_tickets: 'serviceRecovery', social_mentions: 'socialListening'
};
const ADAPTER_PUBLIC_SOURCE_TYPE = {
  service_recovery_tickets: 'native_service_recovery_ticket', social_mentions: 'native_social_mention'
} as const;
const ADAPTER_LABEL: Record<JourneyNativeMetricAdapter, string> = {
  service_recovery_tickets: 'Native service recovery tickets (aggregate)',
  social_mentions: 'Native social mentions (aggregate)'
};
const ADAPTER_RESEARCH_SOURCE_TYPE: Record<JourneyNativeMetricAdapter, 'ticket' | 'social_mention'> = {
  service_recovery_tickets: 'ticket', social_mentions: 'social_mention'
};

export type JourneyNativeMetricPublicSourceType = typeof ADAPTER_PUBLIC_SOURCE_TYPE[JourneyNativeMetricAdapter];
export const journeyNativeMetricPublicSourceTypes = Object.values(ADAPTER_PUBLIC_SOURCE_TYPE);

export function journeyNativeMetricFeature(source: JourneyNativeMetricSource) {
  return ADAPTER_FEATURE[source.adapter];
}
export function journeyNativeMetricPublicSourceType(source: JourneyNativeMetricSource) {
  return ADAPTER_PUBLIC_SOURCE_TYPE[source.adapter];
}
export function journeyNativeMetricLabel(source: JourneyNativeMetricSource) {
  return ADAPTER_LABEL[source.adapter];
}
export function journeyNativeMetricResearchSourceType(source: JourneyNativeMetricSource) {
  return ADAPTER_RESEARCH_SOURCE_TYPE[source.adapter];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function fail(message: string, status = 400, code = 'JOURNEY_METRIC_NATIVE_CONFIG_INVALID'): never {
  throw new JourneyNativeMetricSourceError(message, status, code);
}

function identifier(value: unknown, label: string) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(`A valid native ${label} is required.`);
  return value;
}

/** The exact lineage the adapter is allowed to assert. It is derived, never
 * accepted from the caller, so a definition can neither widen its own scope nor
 * mix a `journey-event:` ingest lineage into a native measure. */
export function journeyNativeMetricLineages(source: JourneyNativeMetricSource): JourneyOperationalSourceLineage[] {
  return source.sourceIds.map((sourceId) => ({
    sourceRef: `seemplify-native:${source.adapter}:${sourceId}`,
    sourceVersion: source.adapterVersion,
    schemaVersion: source.configVersion,
    projectionVersion: JOURNEY_NATIVE_METRIC_PROJECTION_VERSION,
    journeyId: null, journeyVersion: null, ruleSetVersion: null
  }));
}

export function journeyNativeMetricLineageFor(source: JourneyNativeMetricSource, sourceId: string) {
  const lineage = journeyNativeMetricLineages(source).find((entry) =>
    entry.sourceRef === `seemplify-native:${source.adapter}:${sourceId}`);
  if (!lineage) fail('The native lineage is not authorised by this definition version.', 409,
    'JOURNEY_METRIC_NATIVE_SOURCE_NOT_AUTHORISED');
  return lineage;
}

function lineageKey(lineage: JourneyOperationalSourceLineage) {
  return JSON.stringify([lineage.sourceRef, lineage.sourceVersion, lineage.schemaVersion,
    lineage.projectionVersion, lineage.journeyId, lineage.journeyVersion, lineage.ruleSetVersion]);
}

/** Reads the discriminator out of an operational `configuration` document.
 *
 * Absent means an ordinary governed operational import and returns `null`, so
 * existing definitions keep byte-identical behaviour. Present but malformed
 * throws: it must never fall through to the ordinary import path, because the
 * native path asserts a *different* (and on the Team plan, weaker) entitlement.
 */
export function parseJourneyNativeMetricSource(value: unknown): JourneyNativeMetricSource | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    fail('The native metric source configuration must be an object.');
  }
  const row = value as Record<string, unknown>;
  const allowed = new Set(['configVersion', 'adapter', 'adapterVersion', 'sourceIds', 'stageAssociation']);
  const extra = Object.keys(row).filter((key) => !allowed.has(key));
  if (extra.length) fail(`The native metric source configuration contains unsupported field ${extra[0]}.`);
  if (row.configVersion !== JOURNEY_NATIVE_METRIC_SOURCE_VERSION) {
    fail(`The native metric source configuration must declare ${JOURNEY_NATIVE_METRIC_SOURCE_VERSION}.`, 400,
      'JOURNEY_METRIC_NATIVE_CONFIG_VERSION_UNSUPPORTED');
  }
  if (typeof row.adapter !== 'string'
    || !(journeyNativeMetricAdapters as readonly string[]).includes(row.adapter)) {
    fail('The native metric source adapter is not supported.', 400, 'JOURNEY_METRIC_NATIVE_ADAPTER_UNSUPPORTED');
  }
  if (row.adapterVersion !== JOURNEY_NATIVE_METRIC_ADAPTER_VERSION) {
    fail('The native metric source adapter version is not supported.', 400,
      'JOURNEY_METRIC_NATIVE_ADAPTER_UNSUPPORTED');
  }
  if (!Array.isArray(row.sourceIds) || !row.sourceIds.length
    || row.sourceIds.length > JOURNEY_NATIVE_METRIC_MAX_SOURCES) {
    fail(`A native metric source needs between one and ${JOURNEY_NATIVE_METRIC_MAX_SOURCES} exact source identities.`);
  }
  const sourceIds = [...new Set(row.sourceIds.map((entry) => identifier(entry, 'source identity')))].sort();
  if (sourceIds.length !== row.sourceIds.length) fail('Native metric source identities must be unique.');
  let stageAssociation: JourneyNativeMetricStageAssociation | null = null;
  if (row.stageAssociation !== undefined && row.stageAssociation !== null) {
    if (typeof row.stageAssociation !== 'object' || Array.isArray(row.stageAssociation)) {
      fail('The native stage association must be an object.');
    }
    const stage = row.stageAssociation as Record<string, unknown>;
    const stageKeys = Object.keys(stage).filter((key) => !['stageId', 'via'].includes(key));
    if (stageKeys.length) fail(`The native stage association contains unsupported field ${stageKeys[0]}.`);
    if (stage.via !== 'research_link') {
      fail('A native stage association is only supported through a governed research link.', 409,
        'JOURNEY_METRIC_NATIVE_STAGE_UNGOVERNED');
    }
    stageAssociation = { stageId: identifier(stage.stageId, 'stage identity'), via: 'research_link' };
  }
  return { configVersion: JOURNEY_NATIVE_METRIC_SOURCE_VERSION,
    adapter: row.adapter as JourneyNativeMetricAdapter,
    adapterVersion: JOURNEY_NATIVE_METRIC_ADAPTER_VERSION, sourceIds, stageAssociation };
}

/** Fails closed on any measure the source facts cannot support, on any drift in
 * the adapter-owned event vocabulary, and on any lineage the adapter did not
 * derive. Called before the version is hashed and stored, and again at rebuild
 * time, because entitlements and sources can be revoked in between. */
export function assertJourneyNativeMeasureSupported(source: JourneyNativeMetricSource,
  definition: JourneyOperationalMeasureDefinition) {
  const supported = SUPPORTED_MEASURES[source.adapter].find((entry) => entry.kind === definition.kind);
  if (!supported) {
    fail(`The ${source.adapter} adapter does not support the ${definition.kind} measure.`, 422,
      'JOURNEY_METRIC_NATIVE_MEASURE_UNSUPPORTED');
  }
  if (definition.subjectType !== supported.subjectType) {
    fail(`The ${definition.kind} native measure must use the ${supported.subjectType} subject type.`, 422,
      'JOURNEY_METRIC_NATIVE_MEASURE_UNSUPPORTED');
  }
  for (const [field, expected] of Object.entries(supported.eventFields)) {
    if ((definition as unknown as Record<string, unknown>)[field] !== expected) {
      fail(`The native ${definition.kind} measure must use the adapter event ${expected} for ${field}.`, 422,
        'JOURNEY_METRIC_NATIVE_EVENT_MAP_INVALID');
    }
  }
  const expectedLineages = journeyNativeMetricLineages(source).map(lineageKey).sort();
  const actualLineages = (Array.isArray(definition.sourceLineages) ? definition.sourceLineages : [])
    .map((lineage) => lineageKey(lineage)).sort();
  if (expectedLineages.length !== actualLineages.length
    || expectedLineages.some((entry, index) => entry !== actualLineages[index])) {
    fail('Native measure lineage must be exactly the adapter-derived source lineage.', 422,
      'JOURNEY_METRIC_NATIVE_LINEAGE_INVALID');
  }
  return supported;
}

/** Completes a native measure configuration from the adapter contract.
 *
 * The subject type, event vocabulary and source lineage are *derived*, never
 * accepted, because `versionSchema` takes `configuration` as a free-form JSON
 * record: a caller who could assert those fields could point a governed measure
 * at arbitrary events or widen its own scope. A caller may still send them, but
 * only if they match exactly — a conflicting value is refused rather than
 * silently overwritten, so an ordinary operational import can never be
 * reshaped into a native one by accident. */
export function completeJourneyNativeMeasureConfiguration(source: JourneyNativeMetricSource,
  raw: Record<string, unknown>) {
  const kind = raw.kind as JourneyOperationalMeasureDefinition['kind'];
  const supported = SUPPORTED_MEASURES[source.adapter].find((entry) => entry.kind === kind);
  if (!supported) {
    fail(`The ${source.adapter} adapter does not support the ${String(kind)} measure.`, 422,
      'JOURNEY_METRIC_NATIVE_MEASURE_UNSUPPORTED');
  }
  if (raw.subjectType !== undefined && raw.subjectType !== supported.subjectType) {
    fail(`The ${String(kind)} native measure must use the ${supported.subjectType} subject type.`, 422,
      'JOURNEY_METRIC_NATIVE_MEASURE_UNSUPPORTED');
  }
  for (const [field, expected] of Object.entries(supported.eventFields)) {
    if (raw[field] !== undefined && raw[field] !== expected) {
      fail(`The native ${String(kind)} measure must use the adapter event ${expected} for ${field}.`, 422,
        'JOURNEY_METRIC_NATIVE_EVENT_MAP_INVALID');
    }
  }
  const lineages = journeyNativeMetricLineages(source);
  if (Array.isArray(raw.sourceLineages) && raw.sourceLineages.length) {
    const supplied = (raw.sourceLineages as JourneyOperationalSourceLineage[])
      .map((lineage) => lineageKey(lineage)).sort();
    const derived = lineages.map(lineageKey).sort();
    if (supplied.length !== derived.length || supplied.some((entry, index) => entry !== derived[index])) {
      fail('Native measure lineage must be exactly the adapter-derived source lineage.', 422,
        'JOURNEY_METRIC_NATIVE_LINEAGE_INVALID');
    }
  }
  return { ...raw, subjectType: supported.subjectType, ...supported.eventFields, sourceLineages: lineages,
    ...(kind === 'repeat_contact_rate'
      ? { repeatThreshold: Number.isInteger(raw.repeatThreshold) ? raw.repeatThreshold : 2 } : {}),
    nativeSource: source };
}

/** Content-free descriptor published on the version read model and rendered by
 * the workspace. It carries identities and counts, never source content. */
export function journeyNativeMetricPublic(source: JourneyNativeMetricSource) {
  return { configVersion: source.configVersion, adapter: source.adapter, adapterVersion: source.adapterVersion,
    sourceType: journeyNativeMetricPublicSourceType(source), label: journeyNativeMetricLabel(source),
    sourceIds: [...source.sourceIds], sourceCount: source.sourceIds.length,
    stageId: source.stageAssociation?.stageId ?? null,
    stageAssociationVia: source.stageAssociation?.via ?? null };
}
