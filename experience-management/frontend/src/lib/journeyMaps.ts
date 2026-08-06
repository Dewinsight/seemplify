import { activeSpaceId, api, ApiError, json } from '@/lib/api';

export type JourneyMapType = 'current_state' | 'future_state' | 'ideal_state' | 'service_blueprint';
export type JourneyMode = 'designed' | 'evidence_backed' | 'connected';
export type JourneyExperienceType = 'customer' | 'employee' | 'citizen' | 'patient' | 'partner' | 'custom';
export type JourneyMapExportFormat = 'json' | 'csv' | 'pdf' | 'png' | 'pptx';
export type JourneyEvidenceState =
  | 'hypothesis' | 'anecdotal' | 'supported' | 'strongly_supported' | 'contradicted' | 'stale' | 'invalidated';
export type PersonaLifecycleState = 'draft' | 'in_review' | 'active' | 'retired';
export type EvidenceAssessment = 'supports' | 'contradicts' | 'neutral';
export type JourneyEvidenceSnapshotField =
  | 'sourceLabel' | 'excerpt' | 'population' | 'sampleSize'
  | 'collectedAt' | 'windowStart' | 'windowEnd' | 'sourceUpdatedAt';
export const discoverableEvidenceSourceTypes = [
  'knowledge_document', 'survey_response', 'survey_analysis', 'social_mention',
  'social_intelligence', 'ticket', 'assistant_artifact', 'agreement'
] as const;
export type DiscoverableEvidenceSourceType = typeof discoverableEvidenceSourceTypes[number];

export interface JourneyEvidenceSummary {
  state: JourneyEvidenceState;
  supporting: number;
  contradicting: number;
  neutral: number;
  stale: number;
  inaccessible: number;
  reason: string;
}

export interface JourneyMapCard {
  id: string;
  stageKey: string;
  laneType: string;
  kind: string;
  title: string;
  content: string;
  ordinal: number;
  personaId: string | null;
  status: 'draft' | 'active' | 'retired';
  origin: 'legacy_import' | 'workspace' | 'ai_suggestion' | 'template';
  evidence: JourneyEvidenceSummary;
  evidenceLinkCount: number;
}

export interface JourneyMapStage {
  id: string; stageKey: string; name: string; goal: string; description: string; ordinal: number;
}

export interface JourneyMapLane {
  id: string; laneType: string; title: string; description: string; ordinal: number; visible: boolean;
}

export interface JourneyPersona {
  id: string;
  name: string;
  summary: string;
  lifecycleState: PersonaLifecycleState;
  ownerUserId: string | null;
  source: 'workspace' | 'legacy_audience_draft' | 'ai_draft';
  attributes: Record<string, string>;
  goals: string[];
  behaviours: string[];
  needs: string[];
  barriers: string[];
  reviewAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  linkedJourneyCount?: number;
  evidenceState?: JourneyEvidenceState;
}

export interface JourneyDefinitionSummary {
  id: string;
  legacyJourneyId: string | null;
  name: string;
  purpose: string;
  experienceType: JourneyExperienceType;
  mapType: JourneyMapType;
  mode: JourneyMode;
  status: 'draft' | 'published' | 'archived';
  currentVersionId: string | null;
  publishedVersionId: string | null;
  revision: number;
  stageCount: number;
  cardCount: number;
  evidenceLinkCount: number;
  personaCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyMapVersion {
  id: string;
  versionNumber: number;
  schemaVersion: number;
  state: 'draft' | 'published' | 'superseded';
  publishedAt: string | null;
  createdAt: string;
  mapType: JourneyMapType;
  mode: JourneyMode;
  experienceType: JourneyExperienceType;
  objective: string;
  industry: string;
  summary: string;
  legacyAudience: string;
}

export interface JourneyResearchGap {
  stageKey: string; stageName: string; laneType: string; cardId: string; cardTitle: string;
  state: JourneyEvidenceState; reason: string;
}

export interface JourneyMapReadModel {
  definition: JourneyDefinitionSummary;
  version: JourneyMapVersion;
  stages: JourneyMapStage[];
  lanes: JourneyMapLane[];
  cards: JourneyMapCard[];
  personas: JourneyPersona[];
  versions: Array<Pick<JourneyMapVersion, 'id' | 'versionNumber' | 'state' | 'publishedAt' | 'createdAt'>>;
  researchGaps: JourneyResearchGap[];
  evidenceSummary: Partial<Record<JourneyEvidenceState, number>>;
}

export interface JourneyCardMoveAffectedCellsResponse {
  responseMode: 'affected_cells';
  definitionId: string;
  versionId: string;
  cardId: string;
  revision: number;
  updatedAt: string;
  cardsPerCellLimit: number;
  affectedCells: Array<{
    stageKey: string;
    laneType: string;
    cards: JourneyMapCard[];
  }>;
}

export class JourneyCompactMoveResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JourneyCompactMoveResponseError';
  }
}

export type CompactMoveExpectation = {
  versionId: string;
  source: { stageKey: string; laneType: string };
  target: { stageKey: string; laneType: string; ordinal?: number };
  limits: { cardsPerCell: number; titleChars: number; contentChars: number };
};

const compactCardKinds = new Set([
  'goal', 'action', 'decision', 'touchpoint', 'expectation', 'emotion', 'evidence_note',
  'proposed_measure', 'metric', 'pain_point', 'moment_of_truth', 'opportunity', 'solution',
  'initiative', 'process', 'system', 'policy', 'handoff', 'note'
]);
const compactEvidenceStates = new Set<JourneyEvidenceState>([
  'hypothesis', 'anecdotal', 'supported', 'strongly_supported', 'contradicted', 'stale', 'invalidated'
]);

function compactMoveError(message: string): never {
  throw new JourneyCompactMoveResponseError(`Invalid authoritative move response: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCompactCard(
  value: unknown,
  stageKey: string,
  laneType: string,
  limits: CompactMoveExpectation['limits']
): JourneyMapCard {
  if (!isRecord(value)) compactMoveError('a card is not an object');
  const stringFields = ['id', 'stageKey', 'laneType', 'kind', 'title', 'content'] as const;
  for (const field of stringFields) {
    if (typeof value[field] !== 'string') compactMoveError(`card.${field} is not a string`);
  }
  if (!(value.id as string).length || (value.stageKey as string).length > 80 || (value.laneType as string).length > 80) {
    compactMoveError('card identity or cell coordinates exceed their bounds');
  }
  if (!(value.title as string).length || (value.title as string).length > limits.titleChars
    || (value.content as string).length > limits.contentChars) {
    compactMoveError('card title or content exceeds the loaded server bounds');
  }
  if (!compactCardKinds.has(value.kind as string)) compactMoveError('card.kind is invalid');
  if (value.stageKey !== stageKey || value.laneType !== laneType) compactMoveError('a card is outside its declared cell');
  if (!Number.isInteger(value.ordinal) || Number(value.ordinal) < 0) compactMoveError('card.ordinal is not a non-negative integer');
  if (value.personaId !== null && typeof value.personaId !== 'string') compactMoveError('card.personaId is invalid');
  if (!['draft', 'active', 'retired'].includes(String(value.status))) compactMoveError('card.status is invalid');
  if (!['legacy_import', 'workspace', 'ai_suggestion', 'template'].includes(String(value.origin))) {
    compactMoveError('card.origin is invalid');
  }
  if (!Number.isInteger(value.evidenceLinkCount) || Number(value.evidenceLinkCount) < 0) {
    compactMoveError('card.evidenceLinkCount is invalid');
  }
  if (!isRecord(value.evidence) || typeof value.evidence.state !== 'string'
    || !compactEvidenceStates.has(value.evidence.state as JourneyEvidenceState)
    || typeof value.evidence.reason !== 'string' || value.evidence.reason.length > limits.contentChars) {
    compactMoveError('card.evidence is invalid');
  }
  for (const field of ['supporting', 'contradicting', 'neutral', 'stale', 'inaccessible'] as const) {
    if (!Number.isInteger(value.evidence[field]) || Number(value.evidence[field]) < 0) {
      compactMoveError(`card.evidence.${field} is invalid`);
    }
  }
  return value as unknown as JourneyMapCard;
}

function parseCompactMoveResponse(
  value: unknown,
  definitionId: string,
  expectedRevision: number,
  cardId: string,
  expectation: CompactMoveExpectation
): JourneyCardMoveAffectedCellsResponse {
  if (!isRecord(value) || value.responseMode !== 'affected_cells') compactMoveError('responseMode is missing');
  if (value.definitionId !== definitionId || value.versionId !== expectation.versionId || value.cardId !== cardId) {
    compactMoveError('the response identity does not match the request');
  }
  if (value.revision !== expectedRevision + 1) compactMoveError('the response revision is not the next authoritative revision');
  if (typeof value.updatedAt !== 'string' || !value.updatedAt) compactMoveError('updatedAt is missing');
  if (!Number.isInteger(value.cardsPerCellLimit) || Number(value.cardsPerCellLimit) <= 0
    || value.cardsPerCellLimit !== expectation.limits.cardsPerCell) {
    compactMoveError('cardsPerCellLimit does not match the loaded server configuration');
  }
  if (!Array.isArray(value.affectedCells) || value.affectedCells.length < 1 || value.affectedCells.length > 2) {
    compactMoveError('affectedCells must contain one or two cells');
  }
  const expectedKeys = new Set([
    `${expectation.source.stageKey}|${expectation.source.laneType}`,
    `${expectation.target.stageKey}|${expectation.target.laneType}`
  ]);
  const actualKeys = new Set<string>();
  const cardIds = new Set<string>();
  let movedCardCount = 0;
  const affectedCells = value.affectedCells.map((rawCell) => {
    if (!isRecord(rawCell) || typeof rawCell.stageKey !== 'string' || typeof rawCell.laneType !== 'string'
      || !Array.isArray(rawCell.cards)) compactMoveError('an affected cell is malformed');
    const key = `${rawCell.stageKey}|${rawCell.laneType}`;
    if (actualKeys.has(key)) compactMoveError('an affected cell is duplicated');
    actualKeys.add(key);
    if (rawCell.cards.length > expectation.limits.cardsPerCell) compactMoveError('an affected cell exceeds its configured limit');
    const cards = rawCell.cards.map((rawCard, ordinal) => {
      const card = parseCompactCard(rawCard, rawCell.stageKey as string, rawCell.laneType as string, expectation.limits);
      if (card.ordinal !== ordinal) compactMoveError('card ordinals are not contiguous and exact');
      if (cardIds.has(card.id)) compactMoveError('a card identifier is duplicated across affected cells');
      cardIds.add(card.id);
      if (card.id === cardId) movedCardCount += 1;
      return card;
    });
    return { stageKey: rawCell.stageKey, laneType: rawCell.laneType, cards };
  });
  if (actualKeys.size !== expectedKeys.size || [...expectedKeys].some((key) => !actualKeys.has(key))) {
    compactMoveError('the authoritative source/destination cell set is incomplete');
  }
  const movedCard = affectedCells.flatMap((cell) => cell.cards).find((card) => card.id === cardId);
  if (movedCardCount !== 1 || !movedCard || movedCard.stageKey !== expectation.target.stageKey
    || movedCard.laneType !== expectation.target.laneType
    || (expectation.target.ordinal !== undefined && movedCard.ordinal !== expectation.target.ordinal)) {
    compactMoveError('the moved card is not present exactly once in its destination');
  }
  return {
    responseMode: 'affected_cells', definitionId, versionId: expectation.versionId, cardId,
    revision: value.revision as number, updatedAt: value.updatedAt as string,
    cardsPerCellLimit: value.cardsPerCellLimit as number, affectedCells
  };
}

export interface JourneyMapIndex {
  journeyMaps: JourneyDefinitionSummary[];
  personas: JourneyPersona[];
  limits: { stages: number; lanes: number; cards: number; cardsPerCell: number; titleChars: number; contentChars: number };
  catalog: {
    mapTypes: JourneyMapType[];
    experienceTypes: JourneyExperienceType[];
    laneTypes: string[];
    cardKinds: string[];
    evidenceSourceTypes: string[];
    evidenceAssessments: EvidenceAssessment[];
    personaLifecycleStates: PersonaLifecycleState[];
  };
}

/** Evidence vocabulary shown to people. Every state carries an explanation
 * because a badge alone would imply a judgement the rules did not make. */
export const evidenceStateLabels: Record<JourneyEvidenceState, { label: string; tone: string; description: string }> = {
  hypothesis: {
    label: 'Hypothesis', tone: 'border-amber-300 bg-amber-50 text-amber-900',
    description: 'No evidence is attached. This is a design assumption, not an observation.'
  },
  anecdotal: {
    label: 'Anecdotal', tone: 'border-orange-300 bg-orange-50 text-orange-900',
    description: 'One weak qualitative source supports this claim.'
  },
  supported: {
    label: 'Supported', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    description: 'Multiple or sufficiently strong sources support this claim for the declared population.'
  },
  strongly_supported: {
    label: 'Strongly supported', tone: 'border-emerald-500 bg-emerald-100 text-emerald-900',
    description: 'Triangulated qualitative and quantitative evidence with an adequate sample.'
  },
  contradicted: {
    label: 'Contradicted', tone: 'border-red-300 bg-red-50 text-red-900',
    description: 'Credible evidence conflicts with this claim.'
  },
  stale: {
    label: 'Stale', tone: 'border-slate-300 bg-slate-100 text-slate-700',
    description: 'Supporting evidence is outside its freshness policy and needs review.'
  },
  invalidated: {
    label: 'Invalidated', tone: 'border-slate-400 bg-slate-200 text-slate-700',
    description: 'A reviewer or source correction has made this claim unusable.'
  }
};

export const journeyModeLabels: Record<JourneyMode, { label: string; description: string }> = {
  designed: { label: 'Designed', description: 'A planning hypothesis. Nothing here is an observed measurement.' },
  evidence_backed: { label: 'Evidence-backed', description: 'Claims on this map cite authorised research evidence.' },
  connected: { label: 'Connected', description: 'This map is informed by observed events from connected systems.' }
};

export const laneLabels: Record<string, string> = {
  stage_goal: 'Stage goal', customer_actions: 'Customer actions', touchpoints: 'Touchpoints',
  expectations: 'Expectations', emotions: 'Emotions', evidence: 'Evidence', metrics: 'Metrics',
  pain_points: 'Pain points', opportunities: 'Opportunities', initiatives: 'Initiatives',
  frontstage: 'Frontstage', backstage: 'Backstage', supporting_systems: 'Supporting systems',
  policies: 'Policies', handoffs: 'Handoffs'
};

/** Card kinds offered per lane. Keeping the mapping in one place stops the
 * editor from creating cards a lane cannot meaningfully hold. */
export const laneCardKinds: Record<string, string[]> = {
  stage_goal: ['goal'],
  customer_actions: ['action', 'decision'],
  touchpoints: ['touchpoint'],
  expectations: ['expectation'],
  emotions: ['emotion'],
  evidence: ['evidence_note'],
  metrics: ['proposed_measure', 'metric'],
  pain_points: ['pain_point', 'moment_of_truth'],
  opportunities: ['opportunity', 'solution'],
  initiatives: ['initiative'],
  frontstage: ['action', 'note'],
  backstage: ['process', 'note'],
  supporting_systems: ['system'],
  policies: ['policy'],
  handoffs: ['handoff']
};

export const cardKindLabels: Record<string, string> = {
  goal: 'Goal', action: 'Action', decision: 'Decision', touchpoint: 'Touchpoint', expectation: 'Expectation',
  emotion: 'Emotion', evidence_note: 'Evidence note', proposed_measure: 'Proposed measure', metric: 'Metric',
  pain_point: 'Pain point', moment_of_truth: 'Moment of truth', opportunity: 'Opportunity', solution: 'Solution',
  initiative: 'Initiative', process: 'Process', system: 'System', policy: 'Policy', handoff: 'Handoff', note: 'Note'
};

export const evidenceSourceLabels: Record<string, string> = {
  knowledge_document: 'Knowledge document', survey_response: 'Survey response', survey_analysis: 'Survey analysis',
  social_mention: 'Social mention', social_intelligence: 'Social intelligence', ticket: 'Recovery ticket',
  assistant_artifact: 'Assistant artefact', agreement: 'Agreement', interview: 'Interview',
  observation: 'Observation', event_aggregate: 'Event aggregate'
};

export function listJourneyMaps() {
  return api<JourneyMapIndex>('/api/journey-maps');
}

export function readJourneyMap(definitionId: string, versionId?: string) {
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}${query}`);
}

const journeyExportMimes: Record<JourneyMapExportFormat, string> = {
  json: 'application/json', csv: 'text/csv', pdf: 'application/pdf', png: 'image/png',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

function safeExportFilename(value: string, fallback: string) {
  const safe = value.replace(/[\\/\u0000-\u001f\u007f]/gu, '_').trim();
  return safe || fallback;
}

export function journeyExportFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) return fallback;
  const encoded = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/iu)?.[1]?.trim().replace(/^"|"$/gu, '');
  if (encoded) {
    try { return safeExportFilename(decodeURIComponent(encoded), fallback); }
    catch { /* Use the ASCII filename when the extended value is malformed. */ }
  }
  const quoted = contentDisposition.match(/filename\s*=\s*"([^"]+)"/iu)?.[1];
  const plain = contentDisposition.match(/filename\s*=\s*([^;]+)/iu)?.[1]?.trim();
  return safeExportFilename(quoted || plain || fallback, fallback);
}

export async function requestJourneyMapExport(
  definitionId: string,
  versionId: string | undefined,
  format: JourneyMapExportFormat,
  selectedView?: { id: string; revision: number }
) {
  const idempotencyKey = crypto.randomUUID();
  const headers = new Headers({
    accept: journeyExportMimes[format],
    'Idempotency-Key': idempotencyKey
  });
  const selectedSpace = activeSpaceId();
  if (selectedSpace) headers.set('x-seemplify-space', selectedSpace);
  const query = new URLSearchParams();
  if (versionId) query.set('versionId', versionId);
  if (selectedView) {
    query.set('viewId', selectedView.id);
    query.set('viewRevision', String(selectedView.revision));
  }
  const response = await fetch(
    `/api/journey-maps/${encodeURIComponent(definitionId)}/export.${format}?${query.toString()}`,
    { method: 'GET', headers, credentials: 'same-origin', cache: 'no-store' }
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: string; code?: string; details?: unknown };
    throw new ApiError(detail.error || `Export failed with ${response.status}.`, response.status, detail.details, detail.code);
  }
  const fallback = `journey-map.${format}`;
  return {
    blob: await response.blob(),
    filename: journeyExportFilename(response.headers.get('content-disposition'), fallback),
    idempotencyKey
  };
}

export function createJourneyMap(input: {
  name: string; mapType?: JourneyMapType; experienceType?: JourneyExperienceType;
  objective?: string; industry?: string; stageNames?: string[];
}) {
  return api<JourneyDefinitionSummary>('/api/journey-maps', json('POST', input));
}

export function addStage(definitionId: string, expectedRevision: number, input: { name: string; goal?: string }) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/stages`, json('POST', { expectedRevision, ...input }));
}

export function moveStage(definitionId: string, expectedRevision: number, stageKey: string, toOrdinal: number) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/stages/${encodeURIComponent(stageKey)}/move`,
    json('POST', { expectedRevision, toOrdinal }));
}

export function removeStage(definitionId: string, expectedRevision: number, stageKey: string) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/stages/${encodeURIComponent(stageKey)}`,
    json('DELETE', { expectedRevision }));
}

export function addLane(definitionId: string, expectedRevision: number, input: {
  title: string; description?: string; laneKey?: string;
}) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/lanes`,
    json('POST', { expectedRevision, ...input }));
}

export function updateLane(definitionId: string, expectedRevision: number, laneKey: string, input: {
  title?: string; description?: string;
}) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/lanes/${encodeURIComponent(laneKey)}`,
    json('PATCH', { expectedRevision, ...input }));
}

export function moveLane(definitionId: string, expectedRevision: number, laneKey: string, toOrdinal: number) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/lanes/${encodeURIComponent(laneKey)}/move`,
    json('POST', { expectedRevision, toOrdinal }));
}

export function setLaneVisibility(definitionId: string, expectedRevision: number, laneKey: string, visible: boolean) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/lanes/${encodeURIComponent(laneKey)}/visibility`,
    json('POST', { expectedRevision, visible }));
}

export function removeLane(definitionId: string, expectedRevision: number, laneKey: string) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/lanes/${encodeURIComponent(laneKey)}`,
    json('DELETE', { expectedRevision }));
}

export function addCard(definitionId: string, expectedRevision: number, input: {
  stageKey: string; laneType: string; kind: string; title: string; content?: string; personaId?: string | null;
  status?: JourneyMapCard['status'];
}) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/cards`, json('POST', { expectedRevision, ...input }));
}

export function updateCard(definitionId: string, expectedRevision: number, cardId: string, input: {
  kind?: string; title?: string; content?: string; personaId?: string | null;
  status?: JourneyMapCard['status'];
}) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/cards/${cardId}`,
    json('PATCH', { expectedRevision, ...input }));
}

export function bulkPatchCards(definitionId: string, expectedRevision: number, input: {
  cardIds: string[];
  patch: {
    status?: JourneyMapCard['status'];
    personaId?: string | null;
    stageKey?: string;
    laneType?: string;
  };
}) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/cards/bulk`,
    json('POST', { expectedRevision, ...input }));
}

export function moveCard(definitionId: string, expectedRevision: number, cardId: string, target: {
  stageKey?: string; laneType?: string; ordinal?: number;
}) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/cards/${cardId}/move`,
    json('POST', { expectedRevision, ...target }));
}

export async function moveCardAffectedCells(
  definitionId: string,
  expectedRevision: number,
  cardId: string,
  target: { stageKey?: string; laneType?: string; ordinal?: number },
  expectation: CompactMoveExpectation
) {
  const value = await api<unknown>(`/api/journey-maps/${definitionId}/cards/${cardId}/move`,
    json('POST', { expectedRevision, ...target, responseMode: 'affected_cells' }));
  return parseCompactMoveResponse(value, definitionId, expectedRevision, cardId, expectation);
}

export function removeCard(definitionId: string, expectedRevision: number, cardId: string) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/cards/${cardId}`, json('DELETE', { expectedRevision }));
}

export function publishJourneyMap(definitionId: string, expectedRevision: number) {
  return api<{ publishedVersionId: string; draftVersionId: string; journeyMap: JourneyMapReadModel }>(
    `/api/journey-maps/${definitionId}/publish`, json('POST', { expectedRevision })
  );
}

export function draftPersonaFromLegacyAudience(definitionId: string) {
  return api<{ persona: JourneyPersona; journeyMap: JourneyMapReadModel }>(
    `/api/journey-maps/${definitionId}/personas/from-legacy-audience`, json('POST', {})
  );
}

export function linkPersona(definitionId: string, personaId: string) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/personas`, json('POST', { personaId }));
}

export function unlinkPersona(definitionId: string, personaId: string) {
  return api<JourneyMapReadModel>(`/api/journey-maps/${definitionId}/personas/${personaId}`, json('DELETE'));
}

export interface JourneyPersonaWriteInput {
  name: string;
  summary?: string;
  lifecycleState?: PersonaLifecycleState;
  attributes?: Record<string, string>;
  goals?: string[];
  behaviours?: string[];
  needs?: string[];
  barriers?: string[];
  reviewAt?: string | null;
}

export function createPersona(input: JourneyPersonaWriteInput) {
  return api<JourneyPersona>('/api/journey-personas', json('POST', input));
}

export function readPersona(personaId: string) {
  return api<{ persona: JourneyPersona; evidence: JourneyEvidenceLink[] }>(`/api/journey-personas/${personaId}`);
}

export function updatePersona(personaId: string, expectedRevision: number, input: Partial<JourneyPersonaWriteInput>) {
  return api<JourneyPersona>(`/api/journey-personas/${personaId}`,
    json('PATCH', { expectedRevision, ...input }));
}

export interface JourneyEvidenceLink {
  id: string;
  targetType: string;
  targetId: string;
  sourceType: string;
  sourceRef: string;
  sourceLabel: string;
  excerpt: string;
  assessment: EvidenceAssessment;
  confidence: number;
  population: string;
  sampleSize: number | null;
  collectedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  freshnessDays: number | null;
  sourceUpdatedAt: string | null;
  lastValidatedAt: string | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  sourceAccess: 'available' | 'inaccessible';
  refreshStatus: 'current' | 'changed' | 'unavailable';
  changedFields: JourneyEvidenceSnapshotField[];
  snapshotFingerprint: string;
}

export interface JourneyEvidenceAuditEvent {
  id: string;
  evidenceLinkId: string;
  actorUserId: string | null;
  action: 'refreshed' | 'journey.evidence.refreshed';
  changedFields: JourneyEvidenceSnapshotField[];
  beforeFingerprint: string;
  afterFingerprint: string;
  createdAt: string;
}

export interface JourneyEvidenceSourceView {
  sourceType: DiscoverableEvidenceSourceType;
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
}

export function listEvidence(targetType: string, targetId: string) {
  return api<{ links: JourneyEvidenceLink[] }>(
    `/api/journey-evidence?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`
  );
}

export function searchEvidenceSources(
  sourceType: DiscoverableEvidenceSourceType,
  query = '',
  limit = 20
) {
  const search = new URLSearchParams({ sourceType, query, limit: String(limit) });
  return api<{
    sources: JourneyEvidenceSourceView[];
    supportedSourceTypes: DiscoverableEvidenceSourceType[];
    limit: number;
  }>(`/api/journey-evidence/sources?${search.toString()}`);
}

export function readEvidenceSource(linkId: string) {
  return api<{ source: JourneyEvidenceSourceView }>(`/api/journey-evidence/${linkId}/source`);
}

export function listEvidenceAudit(linkId: string, limit = 50) {
  const search = new URLSearchParams({ limit: String(limit) });
  return api<{ events: JourneyEvidenceAuditEvent[] }>(
    `/api/journey-evidence/${encodeURIComponent(linkId)}/audit?${search.toString()}`
  );
}

export function refreshEvidence(linkId: string, expectedFingerprint: string) {
  return api<JourneyEvidenceLink>(
    `/api/journey-evidence/${encodeURIComponent(linkId)}/refresh`,
    json('POST', { expectedFingerprint })
  );
}

export function attachEvidence(input: {
  targetType: string;
  targetId: string;
  sourceType: DiscoverableEvidenceSourceType;
  sourceRef: string;
  assessment?: EvidenceAssessment;
  confidence?: number;
  freshnessDays?: number | null;
}) {
  return api<JourneyEvidenceLink>('/api/journey-evidence', json('POST', input));
}

export function detachEvidence(linkId: string) {
  return api<void>(`/api/journey-evidence/${linkId}`, json('DELETE'));
}
