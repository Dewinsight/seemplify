import crypto from 'node:crypto';
import type { Journey, JourneyStage } from './types.js';

/** Journey Map 2.0 domain contract.
 *
 * Pure functions only. This module owns terminology, deterministic identity,
 * the default lane catalogue, evidence-state rules, structural limits, and the
 * legacy-to-v2 converter. Persistence, transport, and permissions live
 * elsewhere so the same rules can be replayed against any store or snapshot. */

export const JOURNEY_MAP_SCHEMA_VERSION = 2;

export const journeyExperienceTypes = ['customer', 'employee', 'citizen', 'patient', 'partner', 'custom'] as const;
export type JourneyExperienceType = typeof journeyExperienceTypes[number];

export const journeyMapTypes = ['current_state', 'future_state', 'ideal_state', 'service_blueprint'] as const;
export type JourneyMapType = typeof journeyMapTypes[number];

/** A designed map is a hypothesis. It only becomes evidence-backed when links
 * exist, and connected when observed events inform it. Never inferred from
 * presentation state. */
export const journeyModes = ['designed', 'evidence_backed', 'connected'] as const;
export type JourneyMode = typeof journeyModes[number];

export const journeyDefinitionStatuses = ['draft', 'published', 'archived'] as const;
export type JourneyDefinitionStatus = typeof journeyDefinitionStatuses[number];

export const journeyVersionStates = ['draft', 'published', 'superseded'] as const;
export type JourneyVersionState = typeof journeyVersionStates[number];

export const journeyLaneTypes = [
  'stage_goal', 'customer_actions', 'touchpoints', 'expectations', 'emotions',
  'evidence', 'metrics', 'pain_points', 'opportunities', 'initiatives',
  'frontstage', 'backstage', 'supporting_systems', 'policies', 'handoffs'
] as const;
export type JourneyLaneType = typeof journeyLaneTypes[number];

/** User-defined lane keys are persisted in the existing `lane_type` column.
 * They use a reserved prefix so they can never impersonate a built-in lane,
 * and remain stable when the lane is renamed, reordered, published, or copied
 * into the next draft. */
export const journeyCustomLaneKeyPattern = /^custom_[a-z0-9](?:[a-z0-9_-]{0,54}[a-z0-9])?$/u;
export type JourneyLaneKey = string;

export function isCustomJourneyLaneKey(value: unknown): value is JourneyLaneKey {
  return typeof value === 'string' && journeyCustomLaneKeyPattern.test(value);
}

/** Every user-defined lane shares note-only semantics. There is deliberately
 * no literal `custom` key: multiple custom lanes must never share one cell. */
export function isCustomJourneyLane(value: unknown): value is JourneyLaneKey {
  return isCustomJourneyLaneKey(value);
}

export function isJourneyLaneKey(value: unknown): value is JourneyLaneKey {
  return typeof value === 'string'
    && (journeyLaneTypes.includes(value as JourneyLaneType) || isCustomJourneyLaneKey(value));
}

/** Produces a readable candidate. Persistence owns collision suffixes because
 * only the selected version can say whether a key is already in use. */
export function journeyCustomLaneKey(title: unknown): JourneyLaneKey {
  const slug = String(title ?? '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 48);
  return `custom_${slug || 'lane'}`;
}

export const journeyCardKinds = [
  'goal', 'action', 'decision', 'touchpoint', 'expectation', 'emotion', 'evidence_note',
  'proposed_measure', 'metric', 'pain_point', 'moment_of_truth', 'opportunity', 'solution',
  'initiative', 'process', 'system', 'policy', 'handoff', 'note'
] as const;
export type JourneyCardKind = typeof journeyCardKinds[number];

/** Ordered from weakest to strongest support, then the disqualifying states.
 * `stale` and `invalidated` are terminal for display: they must never be
 * presented as support regardless of how many links exist. */
export const journeyEvidenceStates = [
  'hypothesis', 'anecdotal', 'supported', 'strongly_supported', 'contradicted', 'stale', 'invalidated'
] as const;
export type JourneyEvidenceState = typeof journeyEvidenceStates[number];

export const evidenceAssessments = ['supports', 'contradicts', 'neutral'] as const;
export type EvidenceAssessment = typeof evidenceAssessments[number];

/** Qualitative sources can only ever reach `anecdotal` or `supported` on their
 * own. `strongly_supported` additionally requires a quantitative source, which
 * is what "triangulated" means in the programme plan. */
export const evidenceSourceTypes = [
  'knowledge_document', 'survey_response', 'survey_analysis', 'social_mention', 'social_intelligence',
  'ticket', 'assistant_artifact', 'agreement', 'interview', 'observation', 'event_aggregate'
] as const;
export type EvidenceSourceType = typeof evidenceSourceTypes[number];

const quantitativeSourceTypes = new Set<EvidenceSourceType>([
  'survey_analysis', 'social_intelligence', 'event_aggregate'
]);

export const personaLifecycleStates = ['draft', 'in_review', 'active', 'retired'] as const;
export type PersonaLifecycleState = typeof personaLifecycleStates[number];

/** Structural budgets. Enforced by the API before persistence so a single map
 * can never grow past the sizes the editor, exports, and tests are built for. */
export const journeyMapLimits = {
  stages: 50,
  lanes: 24,
  cards: 500,
  cardsPerCell: 40,
  titleChars: 200,
  contentChars: 2000,
  personaAttributes: 40
} as const;

/** Evidence older than this is `stale` unless the link declares its own policy. */
export const defaultEvidenceFreshnessDays = 365;

export type JourneyLaneDefinition = {
  laneType: JourneyLaneKey;
  title: string;
  description: string;
  ordinal: number;
  blueprintOnly: boolean;
};

/** Section 13.2 default lanes, then the blueprint-only lanes appended after
 * them so a blueprint keeps the customer-facing lanes above the visibility
 * lines rather than replacing them. */
export const defaultJourneyLanes: readonly JourneyLaneDefinition[] = [
  { laneType: 'stage_goal', title: 'Stage goal and customer job', description: 'What the participant is trying to accomplish.', ordinal: 0, blueprintOnly: false },
  { laneType: 'customer_actions', title: 'Customer actions and decisions', description: 'What the participant actually does.', ordinal: 1, blueprintOnly: false },
  { laneType: 'touchpoints', title: 'Touchpoints and channels', description: 'Where the interaction happens.', ordinal: 2, blueprintOnly: false },
  { laneType: 'expectations', title: 'Expectations and needs', description: 'What good looks like to the participant.', ordinal: 3, blueprintOnly: false },
  { laneType: 'emotions', title: 'Emotional curve', description: 'Felt experience, with evidence where available.', ordinal: 4, blueprintOnly: false },
  { laneType: 'evidence', title: 'Evidence and verbatim excerpts', description: 'Authorised references supporting this stage.', ordinal: 5, blueprintOnly: false },
  { laneType: 'metrics', title: 'Metrics', description: 'Proposed and observed measures for this stage.', ordinal: 6, blueprintOnly: false },
  { laneType: 'pain_points', title: 'Pain points and moments of truth', description: 'Where the experience breaks or matters most.', ordinal: 7, blueprintOnly: false },
  { laneType: 'opportunities', title: 'Opportunities and solutions', description: 'Outcome-oriented areas for improvement.', ordinal: 8, blueprintOnly: false },
  { laneType: 'initiatives', title: 'Initiatives and owners', description: 'Owned, measurable delivery efforts.', ordinal: 9, blueprintOnly: false },
  { laneType: 'frontstage', title: 'Frontstage activity', description: 'Employee and partner activity the participant can see.', ordinal: 10, blueprintOnly: true },
  { laneType: 'backstage', title: 'Backstage processes', description: 'Work the participant never sees.', ordinal: 11, blueprintOnly: true },
  { laneType: 'supporting_systems', title: 'Supporting systems', description: 'Systems, vendors, and data the process depends on.', ordinal: 12, blueprintOnly: true },
  { laneType: 'policies', title: 'Policies and business rules', description: 'Constraints that shape what is possible.', ordinal: 13, blueprintOnly: true },
  { laneType: 'handoffs', title: 'Handoffs, SLAs, and failure points', description: 'Where responsibility moves and where it fails.', ordinal: 14, blueprintOnly: true }
] as const;

export function lanesForMapType(mapType: JourneyMapType): JourneyLaneDefinition[] {
  return defaultJourneyLanes
    .filter((lane) => mapType === 'service_blueprint' || !lane.blueprintOnly)
    .map((lane, index) => ({ ...lane, ordinal: index }));
}

const laneForCardKind: Partial<Record<JourneyCardKind, JourneyLaneType>> = {
  goal: 'stage_goal', action: 'customer_actions', decision: 'customer_actions', touchpoint: 'touchpoints',
  expectation: 'expectations', emotion: 'emotions', evidence_note: 'evidence', proposed_measure: 'metrics',
  metric: 'metrics', pain_point: 'pain_points', moment_of_truth: 'pain_points', opportunity: 'opportunities',
  solution: 'opportunities', initiative: 'initiatives', process: 'backstage', system: 'supporting_systems',
  policy: 'policies', handoff: 'handoffs'
};

export function defaultLaneForCardKind(kind: JourneyCardKind): JourneyLaneType | null {
  return laneForCardKind[kind] || null;
}

/** Deterministic RFC 4122 v5-shaped identifier. Backfill, dual write, and
 * reconciliation must produce byte-identical IDs on every run and on every
 * node, so identity is derived from stable business keys and never random. */
const journeyIdNamespace = 'seemplify.journey-map.v2';

export function deterministicJourneyId(...parts: Array<string | number>): string {
  const digest = crypto.createHash('sha256')
    .update([journeyIdNamespace, ...parts.map((part) => String(part))].join(''))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function journeyVersionId(journeyId: string, versionNumber: number) {
  return deterministicJourneyId('version', journeyId, versionNumber);
}
export function journeyStageId(versionId: string, stageKey: string) {
  return deterministicJourneyId('stage', versionId, stageKey);
}
export function journeyLaneId(versionId: string, laneType: string, ordinal: number) {
  return deterministicJourneyId('lane', versionId, laneType, ordinal);
}
export function journeyCardId(versionId: string, stageKey: string, laneType: string, ordinal: number) {
  return deterministicJourneyId('card', versionId, stageKey, laneType, ordinal);
}

/** Stage keys survive renames, reordering, and republication, so links and
 * evidence stay attached to the same stage across versions. */
export function journeyStageKey(ordinal: number, name: string) {
  const slug = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40);
  return `s${String(ordinal + 1).padStart(2, '0')}${slug ? `-${slug}` : ''}`;
}

export type JourneyCardDraft = {
  id: string;
  stageKey: string;
  laneType: JourneyLaneKey;
  kind: JourneyCardKind;
  title: string;
  content: string;
  ordinal: number;
  personaKey: string | null;
  status: 'draft' | 'active' | 'retired';
  /** Provenance of the card itself, not of any evidence attached to it. */
  origin: 'legacy_import' | 'workspace' | 'ai_suggestion' | 'template';
};

export type JourneyStageDraft = {
  id: string;
  stageKey: string;
  name: string;
  goal: string;
  description: string;
  ordinal: number;
};

export type JourneyLaneDraft = {
  id: string;
  laneType: JourneyLaneKey;
  title: string;
  description: string;
  ordinal: number;
};

export type JourneyMapVersionDraft = {
  versionId: string;
  journeyId: string;
  versionNumber: number;
  schemaVersion: number;
  mapType: JourneyMapType;
  mode: JourneyMode;
  experienceType: JourneyExperienceType;
  name: string;
  objective: string;
  industry: string;
  summary: string;
  /** Legacy free-text audience. Never presented as a validated persona; the
   * user must explicitly convert it through the persona draft action. */
  legacyAudience: string;
  stages: JourneyStageDraft[];
  lanes: JourneyLaneDraft[];
  cards: JourneyCardDraft[];
};

/** A legacy projection must fail closed when its shape cannot fit Map 2.0.
 * Silently slicing a source array would make a successful backfill look safer
 * than it is and would make rollback/export reconciliation impossible. */
export class LegacyJourneyConversionError extends Error {
  readonly code = 'JOURNEY_LEGACY_CONVERSION_UNSAFE';

  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'LegacyJourneyConversionError';
  }
}

function trimmed(value: unknown, max: number) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function legacyText(value: unknown, max: number, field: string) {
  const source = String(value ?? '');
  if (source.length > max) {
    throw new LegacyJourneyConversionError(`Legacy ${field} exceeds the safe Map 2.0 projection limit.`, {
      field, maximum: max, actual: source.length
    });
  }
  return source;
}

function legacyCardText(value: unknown, field: string) {
  const source = legacyText(value, journeyMapLimits.contentChars, field);
  const title = trimmed(source, journeyMapLimits.titleChars);
  if (!title) {
    throw new LegacyJourneyConversionError(`Legacy ${field} contains an empty card.`, { field });
  }
  // `title` remains bounded for the editor. `content` carries the exact legacy
  // value whenever title normalisation would otherwise lose whitespace or text.
  return { title, content: source === title ? '' : source };
}

/** Legacy stage arrays map onto lanes one-to-one. Metric strings become
 * `proposed_measure` cards rather than observations, and nothing gains
 * evidence: a converted map stays a hypothesis until a link is attached. */
const legacyStageFields: ReadonlyArray<{
  field: keyof Pick<JourneyStage, 'customerActions' | 'touchpoints' | 'emotions' | 'metrics' | 'painPoints' | 'opportunities' | 'recommendedActions'>;
  laneType: JourneyLaneType;
  kind: JourneyCardKind;
  status: JourneyCardDraft['status'];
}> = [
  { field: 'customerActions', laneType: 'customer_actions', kind: 'action', status: 'active' },
  { field: 'touchpoints', laneType: 'touchpoints', kind: 'touchpoint', status: 'active' },
  { field: 'emotions', laneType: 'emotions', kind: 'emotion', status: 'active' },
  { field: 'metrics', laneType: 'metrics', kind: 'proposed_measure', status: 'draft' },
  { field: 'painPoints', laneType: 'pain_points', kind: 'pain_point', status: 'draft' },
  { field: 'opportunities', laneType: 'opportunities', kind: 'opportunity', status: 'draft' },
  { field: 'recommendedActions', laneType: 'initiatives', kind: 'initiative', status: 'draft' }
];

export function convertLegacyJourney(journey: Journey, versionNumber = 1): JourneyMapVersionDraft {
  const versionId = journeyVersionId(journey.id, versionNumber);
  const lanes = lanesForMapType('current_state').map((lane) => ({
    id: journeyLaneId(versionId, lane.laneType, lane.ordinal),
    laneType: lane.laneType, title: lane.title, description: lane.description, ordinal: lane.ordinal
  }));
  const stages: JourneyStageDraft[] = [];
  const cards: JourneyCardDraft[] = [];
  const legacyStages = Array.isArray(journey.stages) ? journey.stages : [];
  if (legacyStages.length > journeyMapLimits.stages) {
    throw new LegacyJourneyConversionError('Legacy journey has too many stages for Map 2.0.', {
      maximum: journeyMapLimits.stages, actual: legacyStages.length
    });
  }
  for (const [index, stage] of legacyStages.entries()) {
    const sourceName = legacyText(stage?.name || `Stage ${index + 1}`, journeyMapLimits.titleChars, `stage[${index}].name`);
    const sourceGoal = legacyText(stage?.goal, journeyMapLimits.contentChars, `stage[${index}].goal`);
    const stageKey = journeyStageKey(index, sourceName);
    stages.push({
      id: journeyStageId(versionId, stageKey),
      stageKey,
      name: sourceName,
      goal: sourceGoal,
      description: '',
      ordinal: index
    });
    if (sourceGoal) {
      const goal = legacyCardText(sourceGoal, `stage[${index}].goal`);
      cards.push({
        id: journeyCardId(versionId, stageKey, 'stage_goal', 0),
        stageKey, laneType: 'stage_goal', kind: 'goal',
        title: goal.title, content: goal.content, ordinal: 0,
        personaKey: null, status: 'active', origin: 'legacy_import'
      });
      if (cards.length > journeyMapLimits.cards) {
        throw new LegacyJourneyConversionError('Legacy journey has too many cards for Map 2.0.', {
          maximum: journeyMapLimits.cards, actual: cards.length
        });
      }
    }
    for (const mapping of legacyStageFields) {
      const values = Array.isArray(stage?.[mapping.field]) ? stage[mapping.field] : [];
      if (values.length > journeyMapLimits.cardsPerCell) {
        throw new LegacyJourneyConversionError('Legacy journey cell has too many cards for Map 2.0.', {
          stage: index, field: mapping.field, maximum: journeyMapLimits.cardsPerCell, actual: values.length
        });
      }
      for (const [ordinal, value] of values.entries()) {
        const card = legacyCardText(value, `stage[${index}].${mapping.field}[${ordinal}]`);
        cards.push({
          id: journeyCardId(versionId, stageKey, mapping.laneType, ordinal),
          stageKey, laneType: mapping.laneType, kind: mapping.kind, title: card.title, content: card.content, ordinal,
          personaKey: null, status: mapping.status, origin: 'legacy_import'
        });
        if (cards.length > journeyMapLimits.cards) {
          throw new LegacyJourneyConversionError('Legacy journey has too many cards for Map 2.0.', {
            maximum: journeyMapLimits.cards, actual: cards.length
          });
        }
      }
    }
  }
  return {
    versionId,
    journeyId: journey.id,
    versionNumber,
    schemaVersion: JOURNEY_MAP_SCHEMA_VERSION,
    mapType: 'current_state',
    mode: 'designed',
    experienceType: 'customer',
    name: legacyText(journey.name, journeyMapLimits.titleChars, 'name'),
    objective: legacyText(journey.objective, journeyMapLimits.contentChars, 'objective'),
    industry: legacyText(journey.industry, journeyMapLimits.titleChars, 'industry'),
    // The v1 API allowed 5,000 summary characters. The normalised column is
    // unbounded text, so migration preserves that historical contract even
    // though newly authored Map 2.0 summaries use the tighter editor budget.
    summary: legacyText(journey.summary, 5_000, 'summary'),
    legacyAudience: legacyText(journey.audience, 500, 'audience'),
    stages,
    lanes,
    cards
  };
}

export type EvidenceLinkFacts = {
  sourceType: EvidenceSourceType;
  assessment: EvidenceAssessment;
  /** Collection time of the underlying source, not the link creation time. */
  collectedAt: string | null;
  /** Respondents, mentions, or documents behind the source, when it is known. */
  sampleSize: number | null;
  freshnessDays?: number | null;
  invalidated?: boolean;
  /** Set when the source was deleted or the reader lost access to it. */
  inaccessible?: boolean;
};

export type EvidenceStateResult = {
  state: JourneyEvidenceState;
  supporting: number;
  contradicting: number;
  neutral: number;
  stale: number;
  inaccessible: number;
  /** Machine-readable justification. The UI must show this rather than
   * implying the state was a judgement call. */
  reason: string;
};

function isStale(link: EvidenceLinkFacts, now: number) {
  if (!link.collectedAt) return false;
  const collected = Date.parse(link.collectedAt);
  if (!Number.isFinite(collected)) return false;
  const days = Number(link.freshnessDays ?? defaultEvidenceFreshnessDays);
  const window = Number.isFinite(days) && days > 0 ? days : defaultEvidenceFreshnessDays;
  return now - collected > window * 86_400_000;
}

/** Section 8.2 states, computed from transparent rules only. An AI recommendation
 * can never reach `strongly_supported` through this function: that requires both
 * a quantitative source with a real sample and a corroborating qualitative one. */
export function computeEvidenceState(
  links: readonly EvidenceLinkFacts[],
  options: { now?: number; minimumStrongSample?: number } = {}
): EvidenceStateResult {
  const now = options.now ?? Date.now();
  const minimumStrongSample = options.minimumStrongSample ?? 30;
  if (!links.length) {
    return { state: 'hypothesis', supporting: 0, contradicting: 0, neutral: 0, stale: 0, inaccessible: 0, reason: 'no_evidence_attached' };
  }
  const invalidated = links.filter((link) => link.invalidated === true).length;
  const inaccessible = links.filter((link) => link.inaccessible === true).length;
  const usable = links.filter((link) => link.invalidated !== true && link.inaccessible !== true);
  const supportingLinks = usable.filter((link) => link.assessment === 'supports');
  const contradicting = usable.filter((link) => link.assessment === 'contradicts').length;
  const neutral = usable.filter((link) => link.assessment === 'neutral').length;
  const stale = supportingLinks.filter((link) => isStale(link, now)).length;
  const fresh = supportingLinks.filter((link) => !isStale(link, now));
  const counts = { supporting: supportingLinks.length, contradicting, neutral, stale, inaccessible };

  if (invalidated && invalidated === links.length) {
    return { ...counts, state: 'invalidated', reason: 'all_links_invalidated' };
  }
  if (!usable.length) {
    return { ...counts, state: 'hypothesis', reason: inaccessible ? 'all_links_inaccessible' : 'no_usable_links' };
  }
  if (contradicting > 0 && contradicting >= fresh.length) {
    return { ...counts, state: 'contradicted', reason: 'contradicting_evidence_not_outweighed' };
  }
  if (!fresh.length) {
    return { ...counts, state: supportingLinks.length ? 'stale' : 'hypothesis', reason: supportingLinks.length ? 'all_supporting_links_stale' : 'no_supporting_links' };
  }
  const quantitative = fresh.filter((link) => quantitativeSourceTypes.has(link.sourceType)
    && Number(link.sampleSize ?? 0) >= minimumStrongSample);
  const qualitative = fresh.filter((link) => !quantitativeSourceTypes.has(link.sourceType));
  if (quantitative.length && qualitative.length) {
    return { ...counts, state: 'strongly_supported', reason: 'triangulated_qualitative_and_quantitative' };
  }
  if (fresh.length >= 2 || quantitative.length) {
    return { ...counts, state: 'supported', reason: quantitative.length ? 'quantitative_source' : 'multiple_supporting_sources' };
  }
  return { ...counts, state: 'anecdotal', reason: 'single_qualitative_source' };
}

/** A map is only evidence-backed once real links exist. Connected additionally
 * requires observed events, which Phase 5 supplies; until then this function
 * can never return `connected` from designed content alone. */
export function computeJourneyMode(input: {
  evidenceLinkCount: number;
  observedEventCount?: number;
}): JourneyMode {
  if (Number(input.observedEventCount ?? 0) > 0) return 'connected';
  return input.evidenceLinkCount > 0 ? 'evidence_backed' : 'designed';
}

export type ResearchGap = {
  stageKey: string;
  stageName: string;
  laneType: JourneyLaneKey;
  cardId: string;
  cardTitle: string;
  state: JourneyEvidenceState;
  reason: string;
};

/** Claims that assert something about participants need evidence. Structural
 * cards (a stage goal, a touchpoint name) are design statements, so listing
 * them as research gaps would drown the real ones. */
const claimCardKinds = new Set<JourneyCardKind>([
  'emotion', 'pain_point', 'moment_of_truth', 'expectation', 'metric', 'opportunity'
]);

export function isClaimCardKind(kind: JourneyCardKind) {
  return claimCardKinds.has(kind);
}

export function researchGaps(input: {
  stages: ReadonlyArray<{ stageKey: string; name: string }>;
  cards: ReadonlyArray<{ id: string; stageKey: string; laneType: JourneyLaneKey; kind: JourneyCardKind; title: string }>;
  evidenceStateByCardId: ReadonlyMap<string, EvidenceStateResult>;
}): ResearchGap[] {
  const stageNames = new Map(input.stages.map((stage) => [stage.stageKey, stage.name]));
  const gaps: ResearchGap[] = [];
  for (const card of input.cards) {
    if (!claimCardKinds.has(card.kind)) continue;
    const computed = input.evidenceStateByCardId.get(card.id)
      || { state: 'hypothesis' as const, reason: 'no_evidence_attached' };
    if (computed.state === 'supported' || computed.state === 'strongly_supported') continue;
    gaps.push({
      stageKey: card.stageKey,
      stageName: stageNames.get(card.stageKey) || card.stageKey,
      laneType: card.laneType,
      cardId: card.id,
      cardTitle: card.title,
      state: computed.state,
      reason: computed.reason
    });
  }
  return gaps;
}

export type JourneyStructuralIssue = { code: string; message: string; detail?: Record<string, unknown> };

/** Structural validation applied before any write. Returns every issue rather
 * than throwing on the first so the editor can show a complete list. */
export function validateJourneyStructure(input: {
  stages: ReadonlyArray<{ stageKey: string; name: string; ordinal: number }>;
  lanes: ReadonlyArray<{ laneType: string; ordinal: number }>;
  cards: ReadonlyArray<{ stageKey: string; laneType: string; title: string; content?: string }>;
}): JourneyStructuralIssue[] {
  const issues: JourneyStructuralIssue[] = [];
  if (input.stages.length > journeyMapLimits.stages) {
    issues.push({ code: 'JOURNEY_STAGE_LIMIT', message: `A journey map supports at most ${journeyMapLimits.stages} stages.` });
  }
  if (input.lanes.length > journeyMapLimits.lanes) {
    issues.push({ code: 'JOURNEY_LANE_LIMIT', message: `A journey map supports at most ${journeyMapLimits.lanes} lanes.` });
  }
  if (input.cards.length > journeyMapLimits.cards) {
    issues.push({ code: 'JOURNEY_CARD_LIMIT', message: `A journey map supports at most ${journeyMapLimits.cards} cards.` });
  }
  const stageKeys = new Set<string>();
  for (const stage of input.stages) {
    if (!stage.stageKey) issues.push({ code: 'JOURNEY_STAGE_KEY_REQUIRED', message: 'Every stage requires a stable key.' });
    else if (stageKeys.has(stage.stageKey)) {
      issues.push({ code: 'JOURNEY_STAGE_KEY_DUPLICATE', message: 'Stage keys must be unique within a version.', detail: { stageKey: stage.stageKey } });
    } else stageKeys.add(stage.stageKey);
    if (!String(stage.name || '').trim()) {
      issues.push({ code: 'JOURNEY_STAGE_NAME_REQUIRED', message: 'Every stage requires a name.', detail: { stageKey: stage.stageKey } });
    }
  }
  const laneTypes = new Set<string>();
  for (const lane of input.lanes) {
    if (!isJourneyLaneKey(lane.laneType)) {
      issues.push({ code: 'JOURNEY_LANE_KEY_INVALID', message: 'Every lane requires a valid built-in or custom key.', detail: { laneType: lane.laneType } });
    } else if (laneTypes.has(lane.laneType)) {
      // Cells are addressed by lane key, not row id. Duplicate keys would make
      // the two visible rows render and mutate the same set of cards.
      issues.push({ code: 'JOURNEY_LANE_DUPLICATE', message: 'Lane keys must be unique within a version.', detail: { laneType: lane.laneType } });
    } else laneTypes.add(lane.laneType);
  }
  const laneTypeSet = new Set(input.lanes.map((lane) => lane.laneType));
  const perCell = new Map<string, number>();
  for (const card of input.cards) {
    if (!stageKeys.has(card.stageKey)) {
      issues.push({ code: 'JOURNEY_CARD_STAGE_UNKNOWN', message: 'A card references a stage that does not exist.', detail: { stageKey: card.stageKey } });
    }
    if (!laneTypeSet.has(card.laneType)) {
      issues.push({ code: 'JOURNEY_CARD_LANE_UNKNOWN', message: 'A card references a lane that does not exist.', detail: { laneType: card.laneType } });
    }
    if (!String(card.title || '').trim()) {
      issues.push({ code: 'JOURNEY_CARD_TITLE_REQUIRED', message: 'Every card requires a title.', detail: { stageKey: card.stageKey, laneType: card.laneType } });
    }
    if (String(card.title || '').length > journeyMapLimits.titleChars) {
      issues.push({ code: 'JOURNEY_CARD_TITLE_LENGTH', message: `Card titles are limited to ${journeyMapLimits.titleChars} characters.` });
    }
    if (String(card.content || '').length > journeyMapLimits.contentChars) {
      issues.push({ code: 'JOURNEY_CARD_CONTENT_LENGTH', message: `Card content is limited to ${journeyMapLimits.contentChars} characters.` });
    }
    const cell = `${card.stageKey}${card.laneType}`;
    const count = (perCell.get(cell) || 0) + 1;
    perCell.set(cell, count);
    if (count === journeyMapLimits.cardsPerCell + 1) {
      issues.push({
        code: 'JOURNEY_CELL_CARD_LIMIT',
        message: `A single stage and lane cell supports at most ${journeyMapLimits.cardsPerCell} cards.`,
        detail: { stageKey: card.stageKey, laneType: card.laneType }
      });
    }
  }
  return issues;
}

/** Reordering helper shared by drag-and-drop and the keyboard move controls so
 * both produce identical ordinals. */
export function moveOrdinal<Item>(items: readonly Item[], from: number, to: number): Item[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(to, 0), next.length - 1);
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}
