import { api, json } from '@/lib/api';
import type { JourneyEvidenceState, JourneyMapReadModel } from '@/lib/journeyMaps';
import type { JourneyMetricPrivacy } from '@/lib/journeyMetrics';

export type JourneySavedViewVisibility = 'private' | 'space';
export type JourneySavedViewBindingPolicy = 'exact' | 'follows_current';

export interface JourneySavedViewFilters {
  personaIds: string[];
  segmentIds: string[];
  cohortIds: string[];
  channelIds: string[];
  evidenceLinkIds: string[];
  evidenceStates: JourneyEvidenceState[];
  cardKinds: string[];
  laneKeys: string[];
  timeWindow: { from: string; to: string; timezone: string } | null;
}

export interface JourneySavedViewConfiguration {
  schemaVersion: 1;
  binding: { policy: JourneySavedViewBindingPolicy; versionId: string | null };
  filters: JourneySavedViewFilters;
  comparisonTarget: { definitionId: string; versionId: string } | null;
  presentation: {
    density: 'comfortable' | 'compact';
    showEvidenceLegend: boolean;
    showResearchGaps: boolean;
    showEmptyLanes: boolean;
    title: string;
  };
}

export interface JourneySavedView {
  id: string;
  definitionId: string;
  name: string;
  visibility: JourneySavedViewVisibility;
  ownerUserId: string;
  revision: number;
  schemaVersion: number;
  checksum: string;
  state: 'active' | 'deleted';
  config: JourneySavedViewConfiguration;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  retentionExpiresAt: string | null;
  availability?: never;
}

export interface JourneySavedViewUnavailable extends Omit<JourneySavedView, 'config' | 'checksum' | 'availability'> {
  config: null;
  checksum: null;
  availability: 'unavailable';
}

export interface JourneySavedViewAnalyticsContext {
  applied: {
    segmentIds: string[];
    cohortIds: string[];
    timeWindow: JourneySavedViewFilters['timeWindow'];
  };
  segments: Array<{ id: string; name: string; revision: number }>;
  observations: Array<{
    id: string; metricDefinitionId: string; metricName: string; segmentId: string | null;
    revision: number; status: string; value: number | null; unit: string; sampleSize: number | null;
    period: { from: string; to: string; timezone: string };
    freshnessStatus: string; minimumSampleWarning: boolean;
    privacy: JourneyMetricPrivacy;
  }>;
  truncated: boolean;
}

export interface JourneySavedViewResolved {
  view: JourneySavedView;
  map: JourneyMapReadModel;
  comparisonMap: JourneyMapReadModel | null;
  analytics: JourneySavedViewAnalyticsContext;
}

export interface JourneySavedViewList {
  views: Array<JourneySavedView | JourneySavedViewUnavailable>;
  selected: { viewId: string; viewRevision: number; revision: number; updatedAt: string } | null;
  unavailableCount: number;
  settings: { enabled: boolean; retentionDays: number; revision: number; updatedAt: string | null };
  limits: {
    nameCharacters: number; referencesPerKind: number; configurationBytes: number;
    presentationTitleCharacters: number; retentionDays: { minimum: number; maximum: number };
  };
}

export interface JourneySavedViewEvidenceOption {
  id: string;
  targetType: 'definition' | 'stage' | 'card' | 'persona';
  targetId: string;
  targetLabel: string;
  sourceType: string;
  sourceLabel: string;
  assessment: 'supports' | 'contradicts' | 'neutral';
}

const evidenceStates = new Set([
  'hypothesis', 'anecdotal', 'supported', 'strongly_supported', 'contradicted', 'stale', 'invalidated'
]);
const privacyReasons = [
  'PRIVACY_SUPPRESSED_SOURCE', 'SMALL_SAMPLE_SUPPRESSED', 'DEFINITION_VERSION_UNAVAILABLE'
] as const;
const cardKinds = new Set([
  'goal', 'action', 'decision', 'touchpoint', 'expectation', 'emotion', 'evidence_note', 'proposed_measure',
  'metric', 'pain_point', 'moment_of_truth', 'opportunity', 'solution', 'initiative', 'process', 'system',
  'policy', 'handoff', 'note'
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} response.`);
  return value as Record<string, unknown>;
}
function exactRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = []
) {
  const item = record(value, label);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(item, key))
    || Object.keys(item).some((key) => !allowed.has(key))) {
    throw new Error(`Invalid ${label} response shape.`);
  }
  return item;
}
function text(value: unknown, label: string, max = 32_768) {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`Invalid ${label} response.`);
  return value;
}
function plainText(value: unknown, label: string, max = 32_768) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${label} response.`);
  return value;
}
function nullableText(value: unknown, label: string) {
  return value === null ? null : text(value, label);
}
function integer(value: unknown, label: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`Invalid ${label} response.`);
  return Number(value);
}
function bool(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label} response.`);
  return value;
}
function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${label} response.`);
  return value;
}
function oneOf<T extends string>(value: unknown, label: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Invalid ${label} response.`);
  return value as T;
}
function orderedStrings(value: unknown, label: string, allowed?: ReadonlySet<string>) {
  if (!Array.isArray(value) || value.length > 50) throw new Error(`Invalid ${label} response.`);
  const result = value.map((item) => text(item, label, 256));
  if (new Set(result).size !== result.length || (allowed && result.some((item) => !allowed.has(item)))) {
    throw new Error(`Invalid ${label} response.`);
  }
  return result;
}

function parseTimeWindow(value: unknown) {
  if (value === null) return null;
  const item = exactRecord(value, 'time window', ['from', 'to', 'timezone']);
  const from = text(item.from, 'time-window start', 40);
  const to = text(item.to, 'time-window end', 40);
  const timezone = text(item.timezone, 'time-window timezone', 80);
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
    throw new Error('Invalid time window response.');
  }
  return { from, to, timezone };
}

export function parseJourneySavedViewConfiguration(value: unknown): JourneySavedViewConfiguration {
  const item = exactRecord(value, 'saved-view configuration',
    ['schemaVersion', 'binding', 'filters', 'comparisonTarget', 'presentation']);
  if (item.schemaVersion !== 1) throw new Error('Unsupported saved-view schema version.');
  const binding = exactRecord(item.binding, 'saved-view binding', ['policy', 'versionId']);
  const policy = binding.policy;
  if (policy !== 'exact' && policy !== 'follows_current') throw new Error('Invalid saved-view binding response.');
  const versionId = binding.versionId === null ? null : text(binding.versionId, 'saved-view version', 128);
  if ((policy === 'exact') !== Boolean(versionId)) throw new Error('Invalid saved-view binding shape.');
  const filters = exactRecord(item.filters, 'saved-view filters', [
    'personaIds', 'segmentIds', 'cohortIds', 'channelIds', 'evidenceLinkIds',
    'evidenceStates', 'cardKinds', 'laneKeys', 'timeWindow'
  ]);
  const comparison = item.comparisonTarget === null ? null : exactRecord(
    item.comparisonTarget, 'comparison target', ['definitionId', 'versionId']
  );
  const presentation = exactRecord(item.presentation, 'saved-view presentation', [
    'density', 'showEvidenceLegend', 'showResearchGaps', 'showEmptyLanes', 'title'
  ]);
  if (presentation.density !== 'comfortable' && presentation.density !== 'compact') {
    throw new Error('Invalid saved-view density response.');
  }
  return {
    schemaVersion: 1,
    binding: { policy, versionId },
    filters: {
      personaIds: orderedStrings(filters.personaIds, 'persona filters'),
      segmentIds: orderedStrings(filters.segmentIds, 'segment filters'),
      cohortIds: orderedStrings(filters.cohortIds, 'cohort filters'),
      channelIds: orderedStrings(filters.channelIds, 'channel filters'),
      evidenceLinkIds: orderedStrings(filters.evidenceLinkIds, 'evidence-link filters'),
      evidenceStates: orderedStrings(filters.evidenceStates, 'evidence-state filters', evidenceStates) as JourneyEvidenceState[],
      cardKinds: orderedStrings(filters.cardKinds, 'card-kind filters', cardKinds),
      laneKeys: orderedStrings(filters.laneKeys, 'lane filters'),
      timeWindow: parseTimeWindow(filters.timeWindow)
    },
    comparisonTarget: comparison ? {
      definitionId: text(comparison.definitionId, 'comparison definition', 128),
      versionId: text(comparison.versionId, 'comparison version', 128)
    } : null,
    presentation: {
      density: presentation.density,
      showEvidenceLegend: bool(presentation.showEvidenceLegend, 'evidence-legend setting'),
      showResearchGaps: bool(presentation.showResearchGaps, 'research-gap setting'),
      showEmptyLanes: bool(presentation.showEmptyLanes, 'empty-lane setting'),
      title: plainText(presentation.title, 'presentation title', 200)
    }
  };
}

function parseView(value: unknown): JourneySavedView | JourneySavedViewUnavailable {
  const raw = record(value, 'saved view');
  const unavailable = raw.availability === 'unavailable';
  const item = exactRecord(value, 'saved view', [
    'id', 'definitionId', 'name', 'visibility', 'ownerUserId', 'revision', 'schemaVersion', 'checksum',
    'state', 'config', 'createdAt', 'updatedAt', 'deletedAt', 'retentionExpiresAt',
    ...(unavailable ? ['availability'] : [])
  ]);
  const common = {
    id: text(item.id, 'saved-view ID', 128), definitionId: text(item.definitionId, 'journey definition ID', 128),
    name: text(item.name, 'saved-view name', 160),
    visibility: item.visibility === 'private' || item.visibility === 'space' ? item.visibility : (() => { throw new Error('Invalid saved-view visibility.'); })(),
    ownerUserId: text(item.ownerUserId, 'saved-view owner', 128), revision: integer(item.revision, 'saved-view revision', 1),
    schemaVersion: integer(item.schemaVersion, 'saved-view schema version', 1),
    state: item.state === 'active' || item.state === 'deleted' ? item.state : (() => { throw new Error('Invalid saved-view state.'); })(),
    createdAt: text(item.createdAt, 'saved-view created time', 50), updatedAt: text(item.updatedAt, 'saved-view updated time', 50),
    deletedAt: nullableText(item.deletedAt, 'saved-view deleted time'),
    retentionExpiresAt: nullableText(item.retentionExpiresAt, 'saved-view retention time')
  } as const;
  if (unavailable) {
    if (item.config !== null || item.checksum !== null) throw new Error('Unavailable saved view leaked configuration.');
    return { ...common, availability: 'unavailable', config: null, checksum: null };
  }
  return {
    ...common, config: parseJourneySavedViewConfiguration(item.config),
    checksum: text(item.checksum, 'saved-view checksum', 64)
  };
}

function isAvailableView(view: JourneySavedView | JourneySavedViewUnavailable): view is JourneySavedView {
  return view.config !== null;
}

export function parseJourneySavedViewList(value: unknown): JourneySavedViewList {
  const item = exactRecord(value, 'saved-view list', ['views', 'selected', 'unavailableCount', 'settings', 'limits']);
  if (!Array.isArray(item.views)) throw new Error('Invalid saved-view list response.');
  const selection = item.selected === null ? null : exactRecord(
    item.selected, 'saved-view selection', ['viewId', 'viewRevision', 'revision', 'updatedAt']
  );
  const settings = exactRecord(item.settings, 'saved-view settings', ['enabled', 'retentionDays', 'revision', 'updatedAt']);
  const limits = exactRecord(item.limits, 'saved-view limits', [
    'nameCharacters', 'referencesPerKind', 'configurationBytes', 'presentationTitleCharacters', 'retentionDays'
  ]);
  const retention = exactRecord(limits.retentionDays, 'saved-view retention limits', ['minimum', 'maximum']);
  return {
    views: item.views.map(parseView),
    selected: selection ? {
      viewId: text(selection.viewId, 'selected view ID', 128),
      viewRevision: integer(selection.viewRevision, 'selected view revision', 1),
      revision: integer(selection.revision, 'selection revision', 1),
      updatedAt: text(selection.updatedAt, 'selection update time', 50)
    } : null,
    unavailableCount: integer(item.unavailableCount, 'unavailable-view count'),
    settings: {
      enabled: bool(settings.enabled, 'saved-view enabled setting'),
      retentionDays: integer(settings.retentionDays, 'saved-view retention setting', 1),
      revision: integer(settings.revision, 'saved-view settings revision'),
      updatedAt: settings.updatedAt === null ? null : text(settings.updatedAt, 'saved-view settings update time', 50)
    },
    limits: {
      nameCharacters: integer(limits.nameCharacters, 'saved-view name limit', 1),
      referencesPerKind: integer(limits.referencesPerKind, 'saved-view reference limit', 1),
      configurationBytes: integer(limits.configurationBytes, 'saved-view configuration limit', 1),
      presentationTitleCharacters: integer(limits.presentationTitleCharacters, 'presentation-title limit', 1),
      retentionDays: { minimum: integer(retention.minimum, 'retention minimum', 1),
        maximum: integer(retention.maximum, 'retention maximum', 1) }
    }
  };
}

const mapTypes = ['current_state', 'future_state', 'ideal_state', 'service_blueprint'] as const;
const mapModes = ['designed', 'evidence_backed', 'connected'] as const;
const experienceTypes = ['customer', 'employee', 'citizen', 'patient', 'partner', 'custom'] as const;
const evidenceStateValues = [...evidenceStates] as JourneyEvidenceState[];

function parseStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 200) throw new Error(`Invalid ${label} response.`);
  return value.map((entry) => plainText(entry, label, 2_000));
}

function parseAttributes(value: unknown) {
  const item = record(value, 'persona attributes');
  if (Object.keys(item).length > 100) throw new Error('Invalid persona attributes response.');
  return Object.fromEntries(Object.entries(item).map(([key, entry]) => [
    text(key, 'persona attribute key', 160), plainText(entry, 'persona attribute value', 2_000)
  ]));
}

function parseEvidenceSummary(value: unknown) {
  const item = exactRecord(value, 'card evidence', [
    'state', 'supporting', 'contradicting', 'neutral', 'stale', 'inaccessible', 'reason'
  ]);
  return {
    state: oneOf(item.state, 'card evidence state', evidenceStateValues),
    supporting: integer(item.supporting, 'supporting evidence count'),
    contradicting: integer(item.contradicting, 'contradicting evidence count'),
    neutral: integer(item.neutral, 'neutral evidence count'),
    stale: integer(item.stale, 'stale evidence count'),
    inaccessible: integer(item.inaccessible, 'inaccessible evidence count'),
    reason: plainText(item.reason, 'card evidence reason', 2_000)
  };
}

/** Parse the complete saved-view map envelope without trusting compile-time casts.
 * Server-only tenancy/provenance fields are accepted only at their documented
 * locations and are deliberately not returned to view components. */
export function parseJourneySavedViewMap(value: unknown): JourneyMapReadModel {
  const item = exactRecord(value, 'saved-view map', [
    'definition', 'version', 'stages', 'lanes', 'cards', 'personas', 'versions', 'researchGaps', 'evidenceSummary'
  ]);
  const definition = exactRecord(item.definition, 'saved-view map definition', [
    'id', 'spaceId', 'legacyJourneyId', 'name', 'purpose', 'experienceType', 'mapType', 'mode', 'status',
    'ownerUserId', 'currentVersionId', 'publishedVersionId', 'reviewCadenceDays', 'revision', 'stageCount',
    'cardCount', 'evidenceLinkCount', 'personaCount', 'createdAt', 'updatedAt'
  ]);
  const version = exactRecord(item.version, 'saved-view map version', [
    'id', 'versionNumber', 'schemaVersion', 'state', 'authorUserId', 'sourceJobId', 'publishedAt', 'createdAt',
    'mapType', 'mode', 'experienceType', 'objective', 'industry', 'summary', 'legacyAudience', 'provenance'
  ]);
  if (!Array.isArray(item.stages) || !Array.isArray(item.lanes) || !Array.isArray(item.cards)
    || !Array.isArray(item.personas) || !Array.isArray(item.versions) || !Array.isArray(item.researchGaps)) {
    throw new Error('Invalid saved-view map collections response.');
  }
  const stages = item.stages.map((raw) => {
    const stage = exactRecord(raw, 'saved-view stage', ['id', 'stageKey', 'name', 'goal', 'description', 'ordinal']);
    return {
      id: text(stage.id, 'stage ID', 128), stageKey: text(stage.stageKey, 'stage key', 160),
      name: text(stage.name, 'stage name', 500), goal: plainText(stage.goal, 'stage goal'),
      description: plainText(stage.description, 'stage description'), ordinal: integer(stage.ordinal, 'stage ordinal')
    };
  });
  const lanes = item.lanes.map((raw) => {
    const lane = exactRecord(raw, 'saved-view lane', ['id', 'laneType', 'title', 'description', 'ordinal', 'visible']);
    return {
      id: text(lane.id, 'lane ID', 128), laneType: text(lane.laneType, 'lane key', 160),
      title: text(lane.title, 'lane title', 500), description: plainText(lane.description, 'lane description'),
      ordinal: integer(lane.ordinal, 'lane ordinal'), visible: bool(lane.visible, 'lane visibility')
    };
  });
  const cards = item.cards.map((raw) => {
    const card = exactRecord(raw, 'saved-view card', [
      'id', 'stageKey', 'laneType', 'kind', 'title', 'content', 'ordinal', 'personaId', 'status', 'origin',
      'evidence', 'evidenceLinkCount', 'createdAt', 'updatedAt'
    ]);
    return {
      id: text(card.id, 'card ID', 128), stageKey: text(card.stageKey, 'card stage key', 160),
      laneType: text(card.laneType, 'card lane key', 160), kind: text(card.kind, 'card kind', 160),
      title: text(card.title, 'card title', 2_000), content: plainText(card.content, 'card content'),
      ordinal: integer(card.ordinal, 'card ordinal'), personaId: nullableText(card.personaId, 'card persona ID'),
      status: oneOf(card.status, 'card status', ['draft', 'active', 'retired'] as const),
      origin: oneOf(card.origin, 'card origin', ['legacy_import', 'workspace', 'ai_suggestion', 'template'] as const),
      evidence: parseEvidenceSummary(card.evidence),
      evidenceLinkCount: integer(card.evidenceLinkCount, 'card evidence-link count')
    };
  });
  const personas = item.personas.map((raw) => {
    const persona = exactRecord(raw, 'saved-view persona', [
      'id', 'name', 'summary', 'lifecycleState', 'ownerUserId', 'source', 'attributes', 'goals', 'behaviours',
      'needs', 'barriers', 'reviewAt', 'revision', 'createdAt', 'updatedAt'
    ], ['linkedJourneyCount', 'evidenceState', 'personaVersionId', 'personaVersionNumber', 'reviewState', 'versionPinned']);
    const result = {
      id: text(persona.id, 'persona ID', 128), name: text(persona.name, 'persona name', 500),
      summary: plainText(persona.summary, 'persona summary'),
      lifecycleState: oneOf(persona.lifecycleState, 'persona lifecycle', ['draft', 'in_review', 'active', 'retired'] as const),
      ownerUserId: nullableText(persona.ownerUserId, 'persona owner'),
      source: oneOf(persona.source, 'persona source', ['workspace', 'legacy_audience_draft', 'ai_draft'] as const),
      attributes: parseAttributes(persona.attributes), goals: parseStringArray(persona.goals, 'persona goals'),
      behaviours: parseStringArray(persona.behaviours, 'persona behaviours'), needs: parseStringArray(persona.needs, 'persona needs'),
      barriers: parseStringArray(persona.barriers, 'persona barriers'), reviewAt: nullableText(persona.reviewAt, 'persona review time'),
      revision: integer(persona.revision, 'persona revision', 1), createdAt: text(persona.createdAt, 'persona created time', 50),
      updatedAt: text(persona.updatedAt, 'persona updated time', 50)
    } as JourneyMapReadModel['personas'][number];
    if (Object.prototype.hasOwnProperty.call(persona, 'linkedJourneyCount')) {
      result.linkedJourneyCount = integer(persona.linkedJourneyCount, 'linked-journey count');
    }
    if (Object.prototype.hasOwnProperty.call(persona, 'evidenceState')) {
      result.evidenceState = oneOf(persona.evidenceState, 'persona evidence state', evidenceStateValues);
    }
    return result;
  });
  const versions = item.versions.map((raw) => {
    const entry = exactRecord(raw, 'saved-view version summary', [
      'id', 'versionNumber', 'schemaVersion', 'state', 'authorUserId', 'sourceJobId', 'publishedAt', 'createdAt'
    ]);
    return {
      id: text(entry.id, 'version ID', 128), versionNumber: integer(entry.versionNumber, 'version number', 1),
      state: oneOf(entry.state, 'version state', ['draft', 'published', 'superseded'] as const),
      publishedAt: nullableText(entry.publishedAt, 'version published time'),
      createdAt: text(entry.createdAt, 'version created time', 50)
    };
  });
  const researchGaps = item.researchGaps.map((raw) => {
    const gap = exactRecord(raw, 'saved-view research gap', [
      'stageKey', 'stageName', 'laneType', 'cardId', 'cardTitle', 'state', 'reason'
    ]);
    return {
      stageKey: text(gap.stageKey, 'gap stage key', 160), stageName: text(gap.stageName, 'gap stage name', 500),
      laneType: text(gap.laneType, 'gap lane key', 160), cardId: text(gap.cardId, 'gap card ID', 128),
      cardTitle: text(gap.cardTitle, 'gap card title', 2_000),
      state: oneOf(gap.state, 'gap evidence state', evidenceStateValues),
      reason: plainText(gap.reason, 'gap reason', 2_000)
    };
  });
  const rawEvidenceSummary = record(item.evidenceSummary, 'map evidence summary');
  if (Object.keys(rawEvidenceSummary).some((key) => !evidenceStates.has(key))) {
    throw new Error('Invalid map evidence summary response shape.');
  }
  const mapEvidenceSummary = Object.fromEntries(Object.entries(rawEvidenceSummary).map(([key, count]) => [
    key, integer(count, 'map evidence-state count')
  ]));
  // Parse documented server-only fields as part of the exact envelope, but
  // return only the browser's public journey-map contract.
  text(definition.spaceId, 'map space ID', 128);
  nullableText(definition.ownerUserId, 'map owner');
  integer(definition.reviewCadenceDays, 'review cadence');
  nullableText(version.authorUserId, 'version author');
  nullableText(version.sourceJobId, 'version source job');
  record(version.provenance, 'version provenance');
  return {
    definition: {
      id: text(definition.id, 'map definition ID', 128),
      legacyJourneyId: nullableText(definition.legacyJourneyId, 'legacy journey ID'),
      name: text(definition.name, 'map name', 500), purpose: plainText(definition.purpose, 'map purpose'),
      experienceType: oneOf(definition.experienceType, 'experience type', experienceTypes),
      mapType: oneOf(definition.mapType, 'map type', mapTypes), mode: oneOf(definition.mode, 'map mode', mapModes),
      status: oneOf(definition.status, 'map status', ['draft', 'published', 'archived'] as const),
      currentVersionId: nullableText(definition.currentVersionId, 'current version ID'),
      publishedVersionId: nullableText(definition.publishedVersionId, 'published version ID'),
      revision: integer(definition.revision, 'map revision', 1), stageCount: integer(definition.stageCount, 'stage count'),
      cardCount: integer(definition.cardCount, 'card count'), evidenceLinkCount: integer(definition.evidenceLinkCount, 'evidence-link count'),
      personaCount: integer(definition.personaCount, 'persona count'), createdAt: text(definition.createdAt, 'map created time', 50),
      updatedAt: text(definition.updatedAt, 'map updated time', 50)
    },
    version: {
      id: text(version.id, 'map version ID', 128), versionNumber: integer(version.versionNumber, 'map version number', 1),
      schemaVersion: integer(version.schemaVersion, 'map schema version', 1),
      state: oneOf(version.state, 'map version state', ['draft', 'published', 'superseded'] as const),
      publishedAt: nullableText(version.publishedAt, 'map published time'), createdAt: text(version.createdAt, 'map version created time', 50),
      mapType: oneOf(version.mapType, 'version map type', mapTypes), mode: oneOf(version.mode, 'version map mode', mapModes),
      experienceType: oneOf(version.experienceType, 'version experience type', experienceTypes),
      objective: plainText(version.objective, 'map objective'), industry: plainText(version.industry, 'map industry'),
      summary: plainText(version.summary, 'map summary'), legacyAudience: plainText(version.legacyAudience, 'map legacy audience')
    }, stages, lanes, cards, personas, versions, researchGaps,
    evidenceSummary: mapEvidenceSummary
  };
}

function parseJourneySavedViewAnalytics(value: unknown): JourneySavedViewAnalyticsContext {
  const item = exactRecord(value, 'saved-view analytics', ['applied', 'segments', 'observations', 'truncated']);
  const applied = exactRecord(item.applied, 'saved-view analytics filters', ['segmentIds', 'cohortIds', 'timeWindow']);
  if (!Array.isArray(item.segments) || !Array.isArray(item.observations)) {
    throw new Error('Invalid saved-view analytics collections response.');
  }
  return {
    applied: {
      segmentIds: orderedStrings(applied.segmentIds, 'applied segment filters'),
      cohortIds: orderedStrings(applied.cohortIds, 'applied cohort filters'),
      timeWindow: parseTimeWindow(applied.timeWindow)
    },
    segments: item.segments.map((raw) => {
      const segment = exactRecord(raw, 'saved-view segment', ['id', 'name', 'revision']);
      return { id: text(segment.id, 'segment ID', 128), name: text(segment.name, 'segment name', 500),
        revision: integer(segment.revision, 'segment revision', 1) };
    }),
    observations: item.observations.map((raw) => {
      const observation = exactRecord(raw, 'saved-view metric observation', [
        'id', 'metricDefinitionId', 'metricName', 'segmentId', 'revision', 'status', 'value', 'unit',
        'sampleSize', 'period', 'freshnessStatus', 'minimumSampleWarning', 'privacy'
      ]);
      const period = exactRecord(observation.period, 'metric observation period', ['from', 'to', 'timezone']);
      const privacyRow = exactRecord(observation.privacy, 'metric observation privacy',
        ['suppressed', 'reasonCode', 'minimumSampleSize', 'privacyVersion']);
      const privacy: JourneyMetricPrivacy = {
        suppressed: bool(privacyRow.suppressed, 'metric observation suppression'),
        reasonCode: privacyRow.reasonCode === null ? null
          : oneOf(privacyRow.reasonCode, 'metric observation privacy reason', privacyReasons),
        minimumSampleSize: integer(privacyRow.minimumSampleSize, 'metric observation minimum sample size'),
        privacyVersion: integer(privacyRow.privacyVersion, 'metric observation privacy version', 1)
      };
      const parsed = {
        id: text(observation.id, 'observation ID', 128),
        metricDefinitionId: text(observation.metricDefinitionId, 'metric definition ID', 128),
        metricName: text(observation.metricName, 'metric name', 500),
        segmentId: nullableText(observation.segmentId, 'metric segment ID'),
        revision: integer(observation.revision, 'metric observation revision', 1),
        status: text(observation.status, 'metric observation status', 100),
        value: observation.value === null ? null : finiteNumber(observation.value, 'metric observation value'),
        unit: plainText(observation.unit, 'metric observation unit', 100),
        sampleSize: observation.sampleSize === null ? null
          : integer(observation.sampleSize, 'metric observation sample size'),
        period: {
          from: text(period.from, 'metric period start', 50), to: text(period.to, 'metric period end', 50),
          timezone: text(period.timezone, 'metric period timezone', 80)
        },
        freshnessStatus: text(observation.freshnessStatus, 'metric freshness status', 100),
        minimumSampleWarning: bool(observation.minimumSampleWarning, 'minimum-sample warning'),
        privacy
      };
      // Fail closed in the browser too: a response that claims suppression while
      // still carrying a value or a sample is a backend regression, and rendering
      // it would disclose exactly what the decision promised to withhold.
      if (privacy.suppressed && (parsed.value !== null || parsed.sampleSize !== null)) {
        throw new Error('Invalid saved-view metric observation response shape.');
      }
      return parsed;
    }),
    truncated: bool(item.truncated, 'analytics truncation')
  };
}

export function parseJourneySavedViewResolved(value: unknown): JourneySavedViewResolved {
  const item = exactRecord(value, 'resolved saved view', ['view', 'map', 'comparisonMap', 'analytics']);
  const view = parseView(item.view);
  if (!isAvailableView(view)) throw new Error('A resolved saved view cannot be unavailable.');
  return {
    view,
    map: parseJourneySavedViewMap(item.map),
    comparisonMap: item.comparisonMap === null ? null : parseJourneySavedViewMap(item.comparisonMap),
    analytics: parseJourneySavedViewAnalytics(item.analytics)
  };
}

export function parseJourneySavedViewEvidenceOptions(value: unknown) {
  const item = exactRecord(value, 'saved-view evidence options', ['evidence']);
  if (!Array.isArray(item.evidence)) throw new Error('Invalid saved-view evidence options response.');
  return item.evidence.map((raw): JourneySavedViewEvidenceOption => {
    const option = exactRecord(raw, 'saved-view evidence option', [
      'id', 'targetType', 'targetId', 'targetLabel', 'sourceType', 'sourceLabel', 'assessment'
    ]);
    return {
      id: text(option.id, 'evidence-link ID', 128),
      targetType: oneOf(option.targetType, 'evidence target type', ['definition', 'stage', 'card', 'persona'] as const),
      targetId: text(option.targetId, 'evidence target ID', 128), targetLabel: text(option.targetLabel, 'evidence target label', 500),
      sourceType: text(option.sourceType, 'evidence source type', 100), sourceLabel: text(option.sourceLabel, 'evidence source label', 500),
      assessment: oneOf(option.assessment, 'evidence assessment', ['supports', 'contradicts', 'neutral'] as const)
    };
  });
}

function mutationOptions(method: string, body: unknown, idempotencyKey: string): RequestInit {
  return { ...json(method, body), headers: { 'Idempotency-Key': idempotencyKey } };
}

function parseViewMutation(value: unknown) {
  const item = exactRecord(value, 'saved-view mutation', ['view', 'replayed']);
  const view = parseView(item.view);
  if (!isAvailableView(view)) throw new Error('A saved-view mutation returned unavailable content.');
  return { view, replayed: bool(item.replayed, 'saved-view mutation replay flag') };
}

export const emptyJourneySavedViewFilters = (): JourneySavedViewFilters => ({
  personaIds: [], segmentIds: [], cohortIds: [], channelIds: [], evidenceLinkIds: [],
  evidenceStates: [], cardKinds: [], laneKeys: [], timeWindow: null
});

export function listJourneySavedViews(definitionId: string) {
  return api<unknown>(`/api/journey-maps/${encodeURIComponent(definitionId)}/saved-views`).then(parseJourneySavedViewList);
}

export function listJourneySavedViewEvidenceOptions(definitionId: string, versionId: string) {
  const query = new URLSearchParams({ versionId });
  return api<unknown>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/saved-views/evidence-options?${query}`
  ).then(parseJourneySavedViewEvidenceOptions);
}

export function readJourneySavedView(definitionId: string, viewId: string, revision: number) {
  const query = new URLSearchParams({ revision: String(revision) });
  return api<unknown>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/saved-views/${encodeURIComponent(viewId)}?${query}`
  ).then(parseJourneySavedViewResolved);
}

export function createJourneySavedView(definitionId: string, input: {
  name: string; visibility: JourneySavedViewVisibility; config: JourneySavedViewConfiguration;
}, idempotencyKey = crypto.randomUUID()) {
  return api<unknown>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/saved-views`, mutationOptions('POST', input, idempotencyKey)
  ).then(parseViewMutation);
}

export function updateJourneySavedView(definitionId: string, viewId: string, input: {
  expectedRevision: number; name: string; visibility: JourneySavedViewVisibility; config: JourneySavedViewConfiguration;
}, idempotencyKey = crypto.randomUUID()) {
  return api<unknown>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/saved-views/${encodeURIComponent(viewId)}`,
    mutationOptions('PATCH', input, idempotencyKey)
  ).then(parseViewMutation);
}

export function duplicateJourneySavedView(definitionId: string, view: JourneySavedView,
  input: { name?: string; visibility?: JourneySavedViewVisibility } = {}, idempotencyKey = crypto.randomUUID()) {
  return api<unknown>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/saved-views/${encodeURIComponent(view.id)}/duplicate`,
    mutationOptions('POST', { expectedRevision: view.revision, ...input }, idempotencyKey)
  ).then(parseViewMutation);
}

export function deleteJourneySavedView(definitionId: string, view: JourneySavedView, reason: string,
  idempotencyKey = crypto.randomUUID()) {
  return api<unknown>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/saved-views/${encodeURIComponent(view.id)}`,
    mutationOptions('DELETE', { expectedRevision: view.revision, reason }, idempotencyKey)
  ).then((value) => {
    const item = exactRecord(value, 'saved-view deletion', ['viewId', 'deleted', 'revision', 'replayed']);
    return {
      viewId: text(item.viewId, 'deleted view ID', 128), deleted: bool(item.deleted, 'saved-view deletion flag'),
      revision: integer(item.revision, 'deleted view revision', 1), replayed: bool(item.replayed, 'deletion replay flag')
    };
  });
}

export function selectDefaultJourneySavedView(definitionId: string, view: JourneySavedView,
  idempotencyKey = crypto.randomUUID()) {
  return api<unknown>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/saved-views/${encodeURIComponent(view.id)}/default`,
    mutationOptions('PUT', { expectedViewRevision: view.revision }, idempotencyKey)
  ).then((value) => {
    const item = exactRecord(value, 'saved-view default selection', ['viewId', 'viewRevision', 'selected', 'replayed']);
    return {
      viewId: text(item.viewId, 'default view ID', 128), viewRevision: integer(item.viewRevision, 'default view revision', 1),
      selected: bool(item.selected, 'default selection flag'), replayed: bool(item.replayed, 'default-selection replay flag')
    };
  });
}

export function resetJourneySavedView(definitionId: string, idempotencyKey = crypto.randomUUID()) {
  return api<unknown>(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/saved-view-default`,
    mutationOptions('DELETE', undefined, idempotencyKey)
  ).then((value) => {
    const item = exactRecord(value, 'saved-view default reset', ['reset', 'replayed']);
    return { reset: bool(item.reset, 'default reset flag'), replayed: bool(item.replayed, 'default-reset replay flag') };
  });
}
