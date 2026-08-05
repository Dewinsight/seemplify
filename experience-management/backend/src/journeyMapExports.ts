import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import type {
  JourneyEvidenceState, JourneyLaneKey, JourneyMode
} from './journeyDomain.js';
import type { JourneyMapReadModel } from './journeyMaps.js';
import type { JourneyRichMapSnapshot } from './journeyRichCards.js';

export const JOURNEY_MAP_EXPORT_SCHEMA = 'seemplify.journey-map.export/v1' as const;

export const journeyEvidenceLegend: ReadonlyArray<{
  state: JourneyEvidenceState;
  label: string;
  description: string;
}> = [
  { state: 'hypothesis', label: 'Hypothesis', description: 'No accessible evidence currently supports this card.' },
  { state: 'anecdotal', label: 'Anecdotal', description: 'A single accessible qualitative source supports this card.' },
  { state: 'supported', label: 'Supported', description: 'Multiple sources or a sufficient quantitative source support this card.' },
  { state: 'strongly_supported', label: 'Strongly supported', description: 'Accessible qualitative and sufficient quantitative evidence agree.' },
  { state: 'contradicted', label: 'Contradicted', description: 'Accessible contradictory evidence is not outweighed by support.' },
  { state: 'stale', label: 'Stale', description: 'Supporting evidence is outside its freshness window.' },
  { state: 'invalidated', label: 'Invalidated', description: 'All attached evidence has been explicitly invalidated.' }
] as const;

export type JourneyMapExportFormat = 'json' | 'csv' | 'pdf' | 'png' | 'pptx';

export type JourneyMapExportArtifact = {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  pageCount?: number;
  slideCount?: number;
};

export type JourneyMapExportViewContext = {
  id: string;
  name: string;
  revision: number;
  visibility: 'private' | 'space';
  schemaVersion: number;
  checksum: string;
  bindingPolicy: 'exact' | 'follows_current';
  filters: Record<string, unknown>;
  comparisonTarget: { definitionId: string; versionId: string } | null;
  presentation: Record<string, unknown>;
  analytics: Record<string, unknown>;
};

type SafeEvidence = {
  state: JourneyEvidenceState;
  reason: string;
  supporting: number;
  contradicting: number;
  neutral: number;
  stale: number;
  accessibleLinkCount: number;
};

type SafeJourneyCard = {
  stageKey: string;
  laneType: JourneyLaneKey;
  ordinal: number;
  kind: string;
  title: string;
  content: string;
  status: string;
  origin: string;
  personaName: string | null;
  evidence: SafeEvidence;
  rich: null | {
    blocks: Array<{
      type: 'paragraph' | 'heading' | 'bullet' | 'ordered' | 'quote';
      text: string;
      marks: Array<{ type: 'bold' | 'italic' | 'code' | 'link'; start: number; end: number }>;
    }>;
    plainText: string;
    emotion: { valence: number; intensity: number; label: string } | null;
    touchpoints: Array<{
      name: string;
      versionNumber: number;
      channel: { name: string; category: string; versionNumber: number };
    }>;
    assets: Array<{
      kind: 'image' | 'attachment';
      sourceKind: 'upload' | 'external_url';
      displayName: string;
      mimeType: string;
      byteSize: number;
      altText: string;
      caption: string;
    }>;
  };
};

export type SafeJourneyMapExport = {
  definition: {
    id: string;
    name: string;
    purpose: string;
    experienceType: string;
    mapType: string;
    mode: JourneyMode;
    status: string;
    reviewCadenceDays: number;
    stageCount: number;
    laneCount: number;
    cardCount: number;
    personaCount: number;
    accessibleEvidenceLinkCount: number;
    createdAt: string;
    updatedAt: string;
  };
  version: {
    versionNumber: number;
    schemaVersion: number;
    state: string;
    mapType: string;
    mode: JourneyMode;
    experienceType: string;
    objective: string;
    industry: string;
    summary: string;
    publishedAt: string | null;
    createdAt: string;
  };
  stages: Array<{
    stageKey: string;
    ordinal: number;
    name: string;
    goal: string;
    description: string;
  }>;
  lanes: Array<{
    laneType: JourneyLaneKey;
    ordinal: number;
    title: string;
    description: string;
    visible: boolean;
  }>;
  cards: SafeJourneyCard[];
  personas: Array<{
    name: string;
    summary: string;
    lifecycleState: string;
    source: string;
    attributes: Record<string, string>;
    goals: string[];
    behaviours: string[];
    needs: string[];
    barriers: string[];
    reviewAt: string | null;
  }>;
  emotionalCurve: Array<{
    stageKey: string;
    stageName: string;
    stageOrdinal: number;
    cardOrdinal: number;
    valence: number;
    intensity: number;
    label: string;
  }>;
  evidenceSummary: Record<JourneyEvidenceState, number>;
};

export type JourneyMapExportMetadata = {
  exportSchema: typeof JOURNEY_MAP_EXPORT_SCHEMA;
  generatedAt: string;
  mapId: string;
  name: string;
  mode: JourneyMode;
  mapType: string;
  experienceType: string;
  versionNumber: number;
  versionState: string;
  schemaVersion: number;
  stageCount: number;
  laneCount: number;
  cardCount: number;
  personaCount: number;
  accessibleEvidenceLinkCount: number;
  richCardCount: number;
  exactEmotionPointCount: number;
  evidenceSummary: Record<JourneyEvidenceState, number>;
  evidenceLegend: typeof journeyEvidenceLegend;
  notice: string;
  selectedView?: JourneyMapExportViewContext;
};

const exportMimes: Record<JourneyMapExportFormat, string> = {
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  png: 'image/png',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

const MAX_EXPORT_TEXT = Object.freeze({
  name: 200,
  purpose: 2_000,
  summary: 4_000,
  stage: 2_000,
  cardTitle: 200,
  cardContent: 2_000,
  personaSummary: 2_000,
  personaList: 40,
  personaValue: 500
});

function safeText(value: unknown, max: number, multiline = false) {
  const raw = String(value ?? '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
  const normalized = multiline
    ? raw.replace(/[ \t]+$/gmu, '').trim()
    : raw.replace(/\s+/gu, ' ').trim();
  return normalized.slice(0, max);
}

function safeList(value: readonly string[], maxItems = MAX_EXPORT_TEXT.personaList) {
  return value.slice(0, maxItems)
    .map((item) => safeText(item, MAX_EXPORT_TEXT.personaValue))
    .filter(Boolean);
}

function selectedViewFilterLabel(view?: JourneyMapExportViewContext) {
  if (!view) return '';
  const filters = view.filters || {};
  const analytics = view.analytics || {};
  const applied = analytics.applied && typeof analytics.applied === 'object'
    ? analytics.applied as Record<string, unknown> : {};
  const segments = Array.isArray(analytics.segments)
    ? analytics.segments.map((segment) => segment && typeof segment === 'object'
      ? safeText((segment as Record<string, unknown>).name, 80) : '').filter(Boolean) : [];
  const parts: string[] = [];
  const count = (key: string) => Array.isArray(filters[key]) ? (filters[key] as unknown[]).length : 0;
  if (count('personaIds')) parts.push(`${count('personaIds')} persona${count('personaIds') === 1 ? '' : 's'}`);
  if (segments.length) parts.push(`segments: ${segments.join(', ')}`);
  if (count('channelIds')) parts.push(`${count('channelIds')} channel${count('channelIds') === 1 ? '' : 's'}`);
  if (count('evidenceStates')) parts.push(`evidence: ${(filters.evidenceStates as string[]).join(', ').replaceAll('_', ' ')}`);
  if (count('cardKinds')) parts.push(`card kinds: ${(filters.cardKinds as string[]).join(', ').replaceAll('_', ' ')}`);
  if (count('laneKeys')) parts.push(`${count('laneKeys')} lane${count('laneKeys') === 1 ? '' : 's'}`);
  const window = applied.timeWindow && typeof applied.timeWindow === 'object'
    ? applied.timeWindow as Record<string, unknown> : null;
  if (window) parts.push(`window ${safeText(window.from, 40)} to ${safeText(window.to, 40)} (${safeText(window.timezone, 80)})`);
  return parts.length ? parts.join(' | ') : 'No filters';
}

function safeAttributes(attributes: Record<string, string>) {
  const entries = Object.entries(attributes)
    .slice(0, MAX_EXPORT_TEXT.personaList)
    .map(([key, value]) => [safeText(key, 120), safeText(value, MAX_EXPORT_TEXT.personaValue)] as const)
    .filter(([key]) => Boolean(key));
  return Object.fromEntries(entries);
}

function safeEvidence(card: JourneyMapReadModel['cards'][number]): SafeEvidence {
  // Inaccessible links are deliberately omitted from every export field. A
  // recipient may learn the state of evidence they can read, never that a
  // private or deleted source exists or how many such links were attached.
  const accessibleLinkCount = Math.max(0,
    Number(card.evidence.supporting || 0)
    + Number(card.evidence.contradicting || 0)
    + Number(card.evidence.neutral || 0));
  return {
    state: card.evidence.state,
    reason: card.evidence.reason === 'all_links_inaccessible'
      ? 'no_accessible_evidence'
      : safeText(card.evidence.reason, 120),
    supporting: Math.max(0, Number(card.evidence.supporting || 0)),
    contradicting: Math.max(0, Number(card.evidence.contradicting || 0)),
    neutral: Math.max(0, Number(card.evidence.neutral || 0)),
    stale: Math.max(0, Number(card.evidence.stale || 0)),
    accessibleLinkCount
  };
}

export function sanitizeJourneyMapForExport(map: JourneyMapReadModel, richMap?: JourneyRichMapSnapshot | null): SafeJourneyMapExport {
  const indexedStages = map.stages.map((stage, index) => ({ stage, index }))
    .sort((left, right) => left.stage.ordinal - right.stage.ordinal || left.index - right.index);
  const indexedLanes = map.lanes.map((lane, index) => ({ lane, index }))
    .sort((left, right) => left.lane.ordinal - right.lane.ordinal || left.index - right.index);
  const stageRank = new Map(indexedStages.map(({ stage }, index) => [stage.stageKey, index]));
  const laneRank = new Map(indexedLanes.map(({ lane }, index) => [lane.laneType, index]));
  const personaName = new Map(map.personas.map((persona) => [persona.id, safeText(persona.name, MAX_EXPORT_TEXT.name)]));
  const richDetail = new Map((richMap?.cards || []).map((detail) => [detail.cardId, detail]));
  const exportCardIds = new Set(map.cards.map((card) => card.id));
  const cards = map.cards.map((card, index) => ({ card, index }))
    .sort((left, right) => {
      const leftStage = stageRank.get(left.card.stageKey) ?? Number.MAX_SAFE_INTEGER;
      const rightStage = stageRank.get(right.card.stageKey) ?? Number.MAX_SAFE_INTEGER;
      const leftLane = laneRank.get(left.card.laneType) ?? Number.MAX_SAFE_INTEGER;
      const rightLane = laneRank.get(right.card.laneType) ?? Number.MAX_SAFE_INTEGER;
      return leftStage - rightStage || leftLane - rightLane
        || left.card.ordinal - right.card.ordinal || left.index - right.index;
    })
    .map(({ card }): SafeJourneyCard => {
      const detail = richDetail.get(card.id);
      return {
      stageKey: safeText(card.stageKey, 100),
      laneType: card.laneType,
      ordinal: card.ordinal,
      kind: safeText(card.kind, 80),
      title: safeText(card.title, MAX_EXPORT_TEXT.cardTitle),
      content: safeText(card.content, MAX_EXPORT_TEXT.cardContent, true),
      status: safeText(card.status, 40),
      origin: safeText(card.origin, 40),
      personaName: card.personaId ? personaName.get(card.personaId) || null : null,
      evidence: safeEvidence(card),
      rich: detail ? {
        blocks: detail.richText.blocks.map((block) => ({
          type: block.type,
          text: safeText(block.text, MAX_EXPORT_TEXT.cardContent, true),
          // Link destinations are deliberately omitted. The export preserves
          // structure and emphasis without disclosing a signed or private URL.
          marks: block.marks.map((mark) => ({ type: mark.type, start: mark.start, end: mark.end }))
        })),
        plainText: safeText(detail.plainText, MAX_EXPORT_TEXT.cardContent, true),
        emotion: detail.emotion ? {
          valence: Math.max(-5, Math.min(5, Math.trunc(detail.emotion.valence))),
          intensity: Math.max(0, Math.min(5, Math.trunc(detail.emotion.intensity))),
          label: safeText(detail.emotion.label, 200)
        } : null,
        touchpoints: detail.touchpoints.map((touchpoint) => ({
          name: safeText(touchpoint.name, MAX_EXPORT_TEXT.name),
          versionNumber: Math.max(1, Math.trunc(touchpoint.versionNumber)),
          channel: {
            name: safeText(touchpoint.channel.name, MAX_EXPORT_TEXT.name),
            category: safeText(touchpoint.channel.category, 80),
            versionNumber: Math.max(1, Math.trunc(touchpoint.channel.versionNumber))
          }
        })),
        assets: detail.assets.filter((asset) => asset.state === 'active').map((asset) => ({
          kind: asset.kind,
          sourceKind: asset.sourceKind,
          displayName: safeText(asset.displayName, MAX_EXPORT_TEXT.name),
          mimeType: safeText(asset.mimeType, 160),
          byteSize: Math.max(0, Math.trunc(asset.byteSize)),
          altText: safeText(asset.altText, 500),
          caption: safeText(asset.caption, 1_000, true)
        }))
      } : null
    };
    });

  const evidenceSummary = Object.fromEntries(journeyEvidenceLegend.map(({ state }) => [
    state, cards.filter((card) => card.evidence.state === state).length
  ])) as Record<JourneyEvidenceState, number>;

  return {
    definition: {
      id: safeText(map.definition.id, 100),
      name: safeText(map.definition.name, MAX_EXPORT_TEXT.name),
      purpose: safeText(map.definition.purpose, MAX_EXPORT_TEXT.purpose, true),
      experienceType: safeText(map.definition.experienceType, 80),
      mapType: safeText(map.definition.mapType, 80),
      mode: map.definition.mode,
      status: safeText(map.definition.status, 40),
      reviewCadenceDays: Math.max(0, Number(map.definition.reviewCadenceDays || 0)),
      stageCount: indexedStages.length,
      laneCount: indexedLanes.length,
      cardCount: cards.length,
      personaCount: map.personas.length,
      accessibleEvidenceLinkCount: Math.max(0, Number(map.definition.evidenceLinkCount || 0)),
      createdAt: safeText(map.definition.createdAt, 40),
      updatedAt: safeText(map.definition.updatedAt, 40)
    },
    version: {
      versionNumber: map.version.versionNumber,
      schemaVersion: map.version.schemaVersion,
      state: safeText(map.version.state, 40),
      mapType: safeText(map.version.mapType, 80),
      mode: map.version.mode,
      experienceType: safeText(map.version.experienceType, 80),
      objective: safeText(map.version.objective, MAX_EXPORT_TEXT.summary, true),
      industry: safeText(map.version.industry, MAX_EXPORT_TEXT.name),
      summary: safeText(map.version.summary, MAX_EXPORT_TEXT.summary, true),
      publishedAt: map.version.publishedAt ? safeText(map.version.publishedAt, 40) : null,
      createdAt: safeText(map.version.createdAt, 40)
    },
    stages: indexedStages.map(({ stage }) => ({
      stageKey: safeText(stage.stageKey, 100), ordinal: stage.ordinal,
      name: safeText(stage.name, MAX_EXPORT_TEXT.name),
      goal: safeText(stage.goal, MAX_EXPORT_TEXT.name),
      description: safeText(stage.description, MAX_EXPORT_TEXT.stage, true)
    })),
    lanes: indexedLanes.map(({ lane }) => ({
      laneType: lane.laneType, ordinal: lane.ordinal,
      title: safeText(lane.title, MAX_EXPORT_TEXT.name),
      description: safeText(lane.description, MAX_EXPORT_TEXT.stage, true),
      visible: Boolean(lane.visible)
    })),
    cards,
    personas: map.personas.map((persona) => ({
      name: safeText(persona.name, MAX_EXPORT_TEXT.name),
      summary: safeText(persona.summary, MAX_EXPORT_TEXT.personaSummary, true),
      lifecycleState: safeText(persona.lifecycleState, 40),
      source: safeText(persona.source, 60),
      attributes: safeAttributes(persona.attributes),
      goals: safeList(persona.goals),
      behaviours: safeList(persona.behaviours),
      needs: safeList(persona.needs),
      barriers: safeList(persona.barriers),
      reviewAt: persona.reviewAt ? safeText(persona.reviewAt, 40) : null
    })),
    emotionalCurve: (richMap?.emotionalCurve || []).filter((point) => exportCardIds.has(point.cardId)).map((point) => ({
      stageKey: safeText(point.stageKey, 100), stageName: safeText(point.stageName, MAX_EXPORT_TEXT.name),
      stageOrdinal: Math.max(0, Math.trunc(point.stageOrdinal)), cardOrdinal: Math.max(0, Math.trunc(point.cardOrdinal)),
      valence: Math.max(-5, Math.min(5, Math.trunc(point.valence))),
      intensity: Math.max(0, Math.min(5, Math.trunc(point.intensity))), label: safeText(point.label, 200)
    })),
    evidenceSummary
  };
}

export function journeyMapExportMetadata(
  map: SafeJourneyMapExport,
  generatedAt = new Date().toISOString(),
  selectedView?: JourneyMapExportViewContext
): JourneyMapExportMetadata {
  const safeGeneratedAt = Number.isFinite(Date.parse(generatedAt))
    ? new Date(generatedAt).toISOString()
    : new Date().toISOString();
  return {
    exportSchema: JOURNEY_MAP_EXPORT_SCHEMA,
    generatedAt: safeGeneratedAt,
    mapId: map.definition.id,
    name: map.definition.name,
    mode: map.definition.mode,
    mapType: map.version.mapType,
    experienceType: map.version.experienceType,
    versionNumber: map.version.versionNumber,
    versionState: map.version.state,
    schemaVersion: map.version.schemaVersion,
    stageCount: map.definition.stageCount,
    laneCount: map.definition.laneCount,
    cardCount: map.definition.cardCount,
    personaCount: map.definition.personaCount,
    accessibleEvidenceLinkCount: map.definition.accessibleEvidenceLinkCount,
    richCardCount: map.cards.filter((card) => card.rich !== null).length,
    exactEmotionPointCount: map.emotionalCurve.length,
    evidenceSummary: map.evidenceSummary,
    evidenceLegend: journeyEvidenceLegend,
    notice: map.definition.mode === 'designed'
      ? 'This map is a designed hypothesis. Cards without accessible evidence are not observed facts.'
      : map.definition.mode === 'connected'
        ? 'This connected map combines designed content with observed measures. Review each card evidence state and measurement window.'
        : 'Evidence-backed cards reflect sources authorised for the exporting user. Metrics without a sample and window are proposed measures.',
    ...(selectedView ? { selectedView } : {})
  };
}

export function journeyMapExportFilename(
  map: SafeJourneyMapExport,
  format: JourneyMapExportFormat,
  selectedView?: JourneyMapExportViewContext
) {
  const id = map.definition.id.replace(/[^a-zA-Z0-9-]/gu, '').slice(0, 100) || 'map';
  const version = Math.max(1, Math.trunc(Number(map.version.versionNumber || 1)));
  const view = selectedView
    ? `-view-${selectedView.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || selectedView.id.slice(0, 12)}-r${selectedView.revision}`
    : '';
  return `journey-map-${id}-v${version}${view}.${format}`;
}

function legacyCompatibleMap(map: SafeJourneyMapExport) {
  const cards = new Map<string, string[]>();
  for (const card of map.cards) {
    const key = `${card.stageKey}\u001f${card.laneType}`;
    const entries = cards.get(key) || [];
    entries.push(card.title);
    cards.set(key, entries);
  }
  const cell = (stageKey: string, laneType: string) => cards.get(`${stageKey}\u001f${laneType}`) || [];
  return {
    id: map.definition.id,
    name: map.definition.name,
    audience: '',
    objective: map.version.objective,
    industry: map.version.industry,
    summary: map.version.summary,
    stages: map.stages.map((stage) => ({
      name: stage.name,
      goal: stage.goal,
      touchpoints: cell(stage.stageKey, 'touchpoints'),
      customerActions: cell(stage.stageKey, 'customer_actions'),
      emotions: cell(stage.stageKey, 'emotions'),
      painPoints: cell(stage.stageKey, 'pain_points'),
      metrics: cell(stage.stageKey, 'metrics'),
      opportunities: cell(stage.stageKey, 'opportunities'),
      recommendedActions: cell(stage.stageKey, 'initiatives')
    })),
    provenance: {
      exportSchema: JOURNEY_MAP_EXPORT_SCHEMA,
      mode: map.definition.mode,
      versionNumber: map.version.versionNumber
    },
    createdAt: map.definition.createdAt,
    updatedAt: map.definition.updatedAt
  };
}

/** Spreadsheet applications may evaluate formula-like strings even when they
 * are quoted CSV fields. Prefix every formula candidate after leading control
 * or whitespace characters, including the leading-line-feed case. */
export function formulaSafeCsvCell(value: unknown) {
  const raw = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
  const protectedValue = /^[\s]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function richStructuredText(card: SafeJourneyCard) {
  if (!card.rich?.blocks.length) return card.rich?.plainText || card.content;
  return card.rich.blocks.map((block, index) => {
    if (block.type === 'bullet') return `• ${block.text}`;
    if (block.type === 'ordered') return `${index + 1}. ${block.text}`;
    if (block.type === 'quote') return `“${block.text}”`;
    return block.text;
  }).filter(Boolean).join('\n');
}

function presentationCardContent(card: SafeJourneyCard) {
  const detail: string[] = [];
  const structured = richStructuredText(card);
  if (structured) detail.push(structured);
  if (card.rich?.emotion) detail.push(
    `Emotion: ${card.rich.emotion.label || 'Unlabelled'} | valence ${card.rich.emotion.valence} | intensity ${card.rich.emotion.intensity}`
  );
  if (card.rich?.touchpoints.length) detail.push(`Touchpoints: ${card.rich.touchpoints.map((touchpoint) =>
    `${touchpoint.name} (${touchpoint.channel.name}, v${touchpoint.versionNumber})`).join('; ')}`);
  if (card.rich?.assets.length) detail.push(`Media: ${card.rich.assets.map((asset) =>
    `${asset.displayName} [${asset.kind}, ${asset.mimeType}, ${asset.byteSize} bytes]`).join('; ')}`);
  return safeText(detail.join('\n'), MAX_EXPORT_TEXT.cardContent, true);
}

function buildJson(map: SafeJourneyMapExport, metadata: JourneyMapExportMetadata) {
  return Buffer.from(`${JSON.stringify({
    // Keep the original top-level metadata keys during the compatibility
    // window while new clients adopt the versioned metadata object.
    mode: metadata.mode,
    mapType: metadata.mapType,
    versionNumber: metadata.versionNumber,
    versionState: metadata.versionState,
    schemaVersion: metadata.schemaVersion,
    generatedAt: metadata.generatedAt,
    evidenceSummary: metadata.evidenceSummary,
    evidenceLegend: metadata.evidenceLegend,
    notice: metadata.notice,
    metadata,
    journeyMap: map,
    legacyCompatible: legacyCompatibleMap(map)
  }, null, 2)}\n`, 'utf8');
}

function buildCsv(map: SafeJourneyMapExport, metadata: JourneyMapExportMetadata) {
  const columns = [
    'stageOrdinal', 'stage', 'stageGoal', 'laneOrdinal', 'lane', 'laneType',
    'cardOrdinal', 'kind', 'title', 'content', 'status', 'evidenceState',
    'evidenceReason', 'accessibleEvidenceLinks', 'emotionLabel', 'emotionValence', 'emotionIntensity',
    'touchpoints', 'governedAssets'
  ];
  const stages = new Map(map.stages.map((stage) => [stage.stageKey, stage]));
  const lanes = new Map(map.lanes.map((lane) => [lane.laneType, lane]));
  const rows = map.cards.map((card) => {
    const stage = stages.get(card.stageKey);
    const lane = lanes.get(card.laneType);
    return [
      stage?.ordinal ?? '', stage?.name ?? card.stageKey, stage?.goal ?? '',
      lane?.ordinal ?? '', lane?.title ?? card.laneType, card.laneType,
      card.ordinal, card.kind, card.title, presentationCardContent(card), card.status,
      card.evidence.state, card.evidence.reason, card.evidence.accessibleLinkCount,
      card.rich?.emotion?.label || '', card.rich?.emotion?.valence ?? '', card.rich?.emotion?.intensity ?? '',
      card.rich?.touchpoints.map((touchpoint) => `${touchpoint.name} (${touchpoint.channel.name})`).join('; ') || '',
      card.rich?.assets.map((asset) => `${asset.displayName} [${asset.kind}]`).join('; ') || ''
    ].map(formulaSafeCsvCell).join(',');
  });
  // Emit the metadata comment as one quoted, formula-safe cell. Free text that
  // reaches this line (the map name, and now a saved-view name or presentation
  // title) contains commas, and an unquoted line lets a spreadsheet split it
  // into cells whose leading '=' is then evaluated.
  const safeMetadata = JSON.stringify(metadata).replace(/[\r\n]/gu, ' ');
  const metadataLine = formulaSafeCsvCell(`# ${safeMetadata}`);
  return Buffer.from(`${metadataLine}\r\n${columns.map(formulaSafeCsvCell).join(',')}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`, 'utf8');
}

type PngRow = {
  kind: 'stage' | 'lane' | 'card' | 'empty';
  height: number;
  title: string[];
  detail: string[];
  evidence?: string;
};

function xmlText(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapPngText(value: string, maxCharacters: number, maxLines: number) {
  const words = safeText(value, MAX_EXPORT_TEXT.cardContent, true).replace(/\s+/gu, ' ').split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const chunks = word.length > maxCharacters
      ? Array.from({ length: Math.ceil(word.length / maxCharacters) }, (_, index) =>
        word.slice(index * maxCharacters, (index + 1) * maxCharacters))
      : [word];
    for (const chunk of chunks) {
      const candidate = line ? `${line} ${chunk}` : chunk;
      if (line && candidate.length > maxCharacters) {
        lines.push(line);
        line = chunk;
      } else line = candidate;
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(' ').length;
  if (lines.length === maxLines && consumed < words.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  }
  return lines;
}

function pngRows(map: SafeJourneyMapExport): PngRow[] {
  if (!map.stages.length) return [{
    kind: 'empty', height: 92, title: ['No stages in this version'],
    detail: ['Add stages and cards, then export this journey again.']
  }];
  const rows: PngRow[] = [];
  for (const [stageIndex, stage] of map.stages.entries()) {
    rows.push({
      kind: 'stage', height: stage.goal ? 78 : 58,
      title: wrapPngText(`Stage ${stageIndex + 1} · ${stage.name || 'Untitled stage'}`, 45, 2),
      detail: stage.goal ? wrapPngText(`Goal: ${stage.goal}`, 55, 1) : []
    });
    const stageCards = map.cards.filter((card) => card.stageKey === stage.stageKey);
    if (!stageCards.length) {
      rows.push({ kind: 'empty', height: 56, title: ['No cards'], detail: [] });
      continue;
    }
    for (const lane of map.lanes) {
      const cards = stageCards.filter((card) => card.laneType === lane.laneType);
      if (!cards.length) continue;
      rows.push({
        kind: 'lane', height: 40,
        title: [lane.visible ? lane.title || lane.laneType : `${lane.title || lane.laneType} (hidden lane)`], detail: []
      });
      for (const card of cards) {
        const title = wrapPngText(card.title || 'Untitled card', 43, 2);
        const detail = wrapPngText(presentationCardContent(card), 52, 3);
        rows.push({
          kind: 'card', height: 32 + title.length * 19 + detail.length * 16,
          title, detail,
          evidence: `${card.kind.replaceAll('_', ' ')} · ${card.status} · ${card.evidence.state.replaceAll('_', ' ')}`
        });
      }
    }
  }
  return rows;
}

/** Render a portable PNG without a browser process or remote assets. The SVG
 * intermediary contains only escaped text from the already-sanitized export
 * model and is rasterized inside this process with strict pixel bounds. */
async function buildPng(map: SafeJourneyMapExport, metadata: JourneyMapExportMetadata) {
  const columnWidth = 438;
  const columnGap = 18;
  const contentHeight = 3_500;
  const padding = 36;
  const headerHeight = 280;
  const columns: Array<{ rows: PngRow[]; height: number }> = [];
  for (const row of pngRows(map)) {
    let column = columns.at(-1);
    if (!column || (column.rows.length && column.height + row.height > contentHeight)) {
      column = { rows: [], height: 0 };
      columns.push(column);
    }
    column.rows.push(row);
    column.height += row.height;
  }
  if (!columns.length) columns.push({ rows: [], height: 0 });
  const width = Math.max(1_200, padding * 2 + columns.length * columnWidth + (columns.length - 1) * columnGap);
  const height = headerHeight + Math.max(300, ...columns.map((column) => column.height)) + padding;
  if (width * height > 60_000_000) throw new Error('Journey map is too large for a bounded PNG export.');

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#f7faf8"/>',
    `<text x="${padding}" y="58" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#172b26">${xmlText(map.definition.name || 'Journey map')}</text>`,
    `<text x="${padding}" y="91" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#147a54">Version ${metadata.versionNumber} · ${xmlText(metadata.versionState)} · ${xmlText(metadata.mode.replaceAll('_', ' '))} · ${xmlText(metadata.mapType.replaceAll('_', ' '))}</text>`,
    `<text x="${padding}" y="121" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#596c66">${xmlText(`${metadata.selectedView ? `View ${metadata.selectedView.name} r${metadata.selectedView.revision} · ${selectedViewFilterLabel(metadata.selectedView)} · ` : ''}Generated ${metadata.generatedAt} · ${metadata.stageCount} stages · ${metadata.cardCount} cards · ${metadata.personaCount} personas`)}</text>`
  ];
  const notice = wrapPngText(metadata.notice, 130, 2);
  notice.forEach((line, index) => parts.push(
    `<text x="${padding}" y="${154 + index * 18}" font-family="Arial, Helvetica, sans-serif" font-size="14" font-style="italic" fill="#596c66">${xmlText(line)}</text>`
  ));
  const legendY = 210;
  const legendWidth = Math.max(132, Math.floor((width - padding * 2) / journeyEvidenceLegend.length));
  journeyEvidenceLegend.forEach((entry, index) => {
    const x = padding + index * legendWidth;
    parts.push(`<circle cx="${x + 6}" cy="${legendY - 5}" r="5" fill="#147a54"/>`);
    parts.push(`<text x="${x + 18}" y="${legendY}" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="#29423a">${xmlText(`${entry.label} (${metadata.evidenceSummary[entry.state] || 0})`)}</text>`);
  });
  parts.push(`<line x1="${padding}" y1="250" x2="${width - padding}" y2="250" stroke="#cad7d2" stroke-width="1"/>`);

  columns.forEach((column, columnIndex) => {
    const x = padding + columnIndex * (columnWidth + columnGap);
    let y = headerHeight;
    for (const row of column.rows) {
      if (row.kind === 'stage') {
        parts.push(`<rect x="${x}" y="${y}" width="${columnWidth}" height="${row.height - 4}" rx="8" fill="#172b26"/>`);
        row.title.forEach((line, index) => parts.push(`<text x="${x + 16}" y="${y + 25 + index * 19}" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" fill="#ffffff">${xmlText(line)}</text>`));
        row.detail.forEach((line, index) => parts.push(`<text x="${x + 16}" y="${y + row.height - 16 + index * 16}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#d9e6e1">${xmlText(line)}</text>`));
      } else if (row.kind === 'lane') {
        parts.push(`<text x="${x + 4}" y="${y + 25}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="#147a54">${xmlText(row.title[0])}</text>`);
        parts.push(`<line x1="${x}" y1="${y + 34}" x2="${x + columnWidth}" y2="${y + 34}" stroke="#cad7d2" stroke-width="1"/>`);
      } else {
        parts.push(`<rect x="${x}" y="${y + 3}" width="${columnWidth}" height="${row.height - 7}" rx="6" fill="#ffffff" stroke="#dce5e1"/>`);
        row.title.forEach((line, index) => parts.push(`<text x="${x + 14}" y="${y + 25 + index * 19}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="#172b26">${xmlText(line)}</text>`));
        const detailStart = y + 25 + row.title.length * 19;
        row.detail.forEach((line, index) => parts.push(`<text x="${x + 14}" y="${detailStart + index * 16}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#596c66">${xmlText(line)}</text>`));
        if (row.evidence) parts.push(`<text x="${x + 14}" y="${y + row.height - 12}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#147a54">${xmlText(row.evidence)}</text>`);
      }
      y += row.height;
    }
  });
  parts.push('</svg>');
  const bytes = await sharp(Buffer.from(parts.join(''), 'utf8'), { limitInputPixels: 60_000_000 })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
  return { bytes };
}

const pdfColours = {
  ink: rgb(0.09, 0.17, 0.15),
  muted: rgb(0.34, 0.43, 0.40),
  accent: rgb(0.08, 0.48, 0.33),
  line: rgb(0.83, 0.88, 0.86),
  pale: rgb(0.96, 0.98, 0.97)
};

function pdfAscii(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^\x20-\x7E\n]/gu, '?')
    .replace(/[\t\r]+/gu, ' ');
}

function splitLongWord(word: string, font: PDFFont, size: number, width: number) {
  const chunks: string[] = [];
  let current = '';
  for (const character of word) {
    if (current && font.widthOfTextAtSize(current + character, size) > width) {
      chunks.push(current); current = character;
    } else current += character;
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapPdfText(value: string, font: PDFFont, size: number, width: number) {
  const output: string[] = [];
  for (const paragraph of pdfAscii(value).split('\n')) {
    if (!paragraph) { output.push(''); continue; }
    let line = '';
    for (const token of paragraph.split(/\s+/u).flatMap((word) =>
      font.widthOfTextAtSize(word, size) > width ? splitLongWord(word, font, size, width) : [word])) {
      const candidate = line ? `${line} ${token}` : token;
      if (line && font.widthOfTextAtSize(candidate, size) > width) {
        output.push(line); line = token;
      } else line = candidate;
    }
    output.push(line);
  }
  return output;
}

async function buildPdf(map: SafeJourneyMapExport, metadata: JourneyMapExportMetadata) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  const width = 842;
  const height = 595;
  const margin = 44;
  const bottom = 38;
  let page!: PDFPage;
  let y = 0;
  let stageHeading = '';

  const addPage = (heading = '') => {
    page = document.addPage([width, height]);
    y = height - margin;
    stageHeading = heading;
    if (heading) {
      page.drawText(pdfAscii(heading), { x: margin, y, size: 17, font: bold, color: pdfColours.ink, maxWidth: width - margin * 2 });
      y -= 28;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.8, color: pdfColours.line });
      y -= 15;
    }
    return page;
  };

  const ensure = (required: number) => {
    if (y - required >= bottom) return;
    addPage(stageHeading ? `${stageHeading} (continued)` : 'Journey map (continued)');
  };

  const drawLines = (lines: string[], options: { font: PDFFont; size: number; colour?: ReturnType<typeof rgb>; indent?: number; gap?: number }) => {
    const lineHeight = options.size * 1.28;
    for (const line of lines) {
      ensure(lineHeight + 2);
      if (line) page.drawText(line, {
        x: margin + (options.indent || 0), y: y - options.size,
        size: options.size, font: options.font, color: options.colour || pdfColours.ink,
        maxWidth: width - margin * 2 - (options.indent || 0)
      });
      y -= lineHeight;
    }
    y -= options.gap || 0;
  };

  addPage();
  drawLines(wrapPdfText(map.definition.name || 'Untitled journey map', bold, 28, width - margin * 2), { font: bold, size: 28, gap: 8 });
  drawLines([
    `${metadata.mapType.replaceAll('_', ' ')} | ${metadata.experienceType.replaceAll('_', ' ')} | ${metadata.mode.replaceAll('_', ' ')}`,
    `Version ${metadata.versionNumber} (${metadata.versionState}) | Generated ${metadata.generatedAt}`,
    ...(metadata.selectedView
      ? [`Selected view: ${metadata.selectedView.name} (revision ${metadata.selectedView.revision}, ${metadata.selectedView.bindingPolicy.replaceAll('_', ' ')})`,
        `Applied filters: ${selectedViewFilterLabel(metadata.selectedView)}`]
      : [])
  ], { font: regular, size: 10, colour: pdfColours.muted, gap: 12 });
  if (map.version.summary) {
    drawLines(wrapPdfText(map.version.summary, regular, 11, width - margin * 2), { font: regular, size: 11, gap: 12 });
  }
  ensure(56);
  page.drawRectangle({ x: margin, y: y - 42, width: width - margin * 2, height: 42, color: pdfColours.pale, borderColor: pdfColours.line, borderWidth: 0.5 });
  page.drawText(pdfAscii(metadata.notice), { x: margin + 12, y: y - 25, size: 9.5, font: italic, color: pdfColours.ink, maxWidth: width - margin * 2 - 24 });
  y -= 58;
  drawLines(['Evidence legend'], { font: bold, size: 14, gap: 4 });
  for (const entry of journeyEvidenceLegend) {
    const count = metadata.evidenceSummary[entry.state] || 0;
    drawLines(wrapPdfText(`${entry.label} (${count} cards): ${entry.description}`, regular, 8.5, width - margin * 2), {
      font: regular, size: 8.5, colour: pdfColours.muted, gap: 1
    });
  }
  if (map.emotionalCurve.length) {
    drawLines(['Exact emotional curve values'], { font: bold, size: 14, gap: 4 });
    for (const point of map.emotionalCurve) {
      drawLines(wrapPdfText(
        `${point.stageName}: ${point.label || 'Unlabelled'} | valence ${point.valence} | intensity ${point.intensity}`,
        regular, 8.5, width - margin * 2
      ), { font: regular, size: 8.5, colour: pdfColours.muted, gap: 1 });
    }
  }

  if (!map.stages.length) {
    addPage('Journey map');
    drawLines(['No stages have been added to this version.'], { font: regular, size: 12, colour: pdfColours.muted });
  }

  for (const [stageIndex, stage] of map.stages.entries()) {
    const heading = `Stage ${stageIndex + 1} - ${stage.name || 'Untitled stage'}`;
    addPage(heading);
    if (stage.goal) drawLines(wrapPdfText(`Goal: ${stage.goal}`, italic, 10, width - margin * 2), { font: italic, size: 10, gap: 8 });
    if (stage.description) drawLines(wrapPdfText(stage.description, regular, 9, width - margin * 2), { font: regular, size: 9, colour: pdfColours.muted, gap: 8 });
    const stageCards = map.cards.filter((card) => card.stageKey === stage.stageKey);
    if (!stageCards.length) {
      drawLines(['No cards have been added to this stage.'], { font: regular, size: 10, colour: pdfColours.muted });
      continue;
    }
    for (const lane of map.lanes) {
      const laneCards = stageCards.filter((card) => card.laneType === lane.laneType);
      if (!laneCards.length) continue;
      ensure(42);
      page.drawRectangle({ x: margin, y: y - 22, width: width - margin * 2, height: 24, color: pdfColours.pale });
      page.drawText(pdfAscii(`${lane.title || lane.laneType}${lane.visible ? '' : ' (hidden lane)'}`), {
        x: margin + 8, y: y - 14, size: 10, font: bold, color: pdfColours.accent
      });
      y -= 32;
      for (const card of laneCards) {
        const cardDetail = presentationCardContent(card);
        ensure(48);
        drawLines(wrapPdfText(card.title || 'Untitled card', bold, 10.5, width - margin * 2 - 12), {
          font: bold, size: 10.5, indent: 12, gap: 1
        });
        drawLines(wrapPdfText(
          `${card.kind.replaceAll('_', ' ')} | ${card.status} | evidence: ${card.evidence.state.replaceAll('_', ' ')} (${card.evidence.accessibleLinkCount} accessible)`,
          regular, 8, width - margin * 2 - 12
        ), { font: regular, size: 8, colour: pdfColours.muted, indent: 12, gap: cardDetail ? 2 : 7 });
        if (cardDetail) {
          drawLines(wrapPdfText(cardDetail, regular, 9, width - margin * 2 - 12), {
            font: regular, size: 9, indent: 12, gap: 8
          });
        }
      }
    }
  }

  const pages = document.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 26 }, end: { x: width - margin, y: 26 }, thickness: 0.5, color: pdfColours.line });
    item.drawText(pdfAscii(`${map.definition.name} | v${metadata.versionNumber} | ${metadata.mode.replaceAll('_', ' ')}`), {
      x: margin, y: 12, size: 7, font: regular, color: pdfColours.muted, maxWidth: width - margin * 2 - 45
    });
    item.drawText(`${index + 1} / ${pages.length}`, { x: width - margin - 35, y: 12, size: 7, font: regular, color: pdfColours.muted });
  });
  document.setTitle(pdfAscii(map.definition.name || 'Journey map'));
  document.setAuthor('Seemplify Experience Management');
  document.setSubject(`Journey map export, version ${metadata.versionNumber}${metadata.selectedView
    ? `, view ${metadata.selectedView.name} revision ${metadata.selectedView.revision}` : ''}`);
  document.setProducer('Seemplify Experience Management');
  const exportDate = new Date(metadata.generatedAt);
  document.setCreationDate(exportDate);
  document.setModificationDate(exportDate);
  return { bytes: Buffer.from(await document.save()), pageCount: pages.length };
}

const pptxColours = {
  ink: '17332D', muted: '61736C', accent: '147A55', line: 'D8E1DD', pale: 'F4F7F5', white: 'FFFFFF'
};

function pptxSnippet(value: string, max: number) {
  const text = safeText(value, max, true).replace(/\s*\n\s*/gu, ' ');
  return text.length < max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

async function buildPptx(map: SafeJourneyMapExport, metadata: JourneyMapExportMetadata) {
  // PptxGenJS 4 publishes a correct runtime default export but its conditional
  // type export is exposed as a module namespace under NodeNext. Keep that
  // packaging mismatch at this single boundary rather than weakening types in
  // the rest of the export model.
  const importedPptx = PptxGenJS as unknown as { default?: unknown } | (new () => any);
  const PptxConstructor = (typeof importedPptx === 'function'
    ? importedPptx
    : importedPptx.default) as new () => any;
  const pptx = new PptxConstructor();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Seemplify Experience Management';
  pptx.company = 'Seemplify';
  pptx.subject = `Journey map export, version ${metadata.versionNumber}${metadata.selectedView
    ? `, view ${metadata.selectedView.name} revision ${metadata.selectedView.revision}` : ''}`;
  pptx.title = map.definition.name || 'Journey map';
  pptx.lang = 'en-GB';
  pptx.theme = {
    headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'en-GB'
  };
  pptx.defineSlideMaster({
    title: 'SEEMPLIFY_JOURNEY',
    background: { color: pptxColours.white },
    objects: [
      { line: { x: 0.6, y: 7.08, w: 12.13, h: 0, line: { color: pptxColours.line, width: 0.8 } } }
    ],
    slideNumber: { x: 12.05, y: 7.12, w: 0.65, h: 0.2, fontFace: 'Aptos', fontSize: 9, color: pptxColours.muted, align: 'right' }
  });
  const slides: any[] = [];
  const addSlide = () => {
    const slide = pptx.addSlide({ masterName: 'SEEMPLIFY_JOURNEY' });
    slide.addText(`${map.definition.name} | v${metadata.versionNumber} | ${metadata.mode.replaceAll('_', ' ')}`, {
      x: 0.6, y: 7.12, w: 10.8, h: 0.2, fontFace: 'Aptos', fontSize: 9, color: pptxColours.muted, margin: 0
    });
    slide.addNotes('[Sources]\n- No external sources. Generated from the authorised Seemplify Journey Map read model.');
    slides.push(slide);
    return slide;
  };

  let slide = addSlide();
  slide.addText(map.definition.name || 'Untitled journey map', {
    x: 0.75, y: 1.15, w: 11.8, h: 1.2, fontFace: 'Aptos Display', fontSize: 50,
    bold: true, color: pptxColours.ink, margin: 0, breakLine: false, fit: 'shrink'
  });
  slide.addText(`${metadata.mapType.replaceAll('_', ' ')}  |  ${metadata.experienceType.replaceAll('_', ' ')}  |  ${metadata.mode.replaceAll('_', ' ')}`, {
    x: 0.75, y: 2.55, w: 11.8, h: 0.45, fontFace: 'Aptos', fontSize: 20, color: pptxColours.accent, margin: 0
  });
  if (map.version.summary) slide.addText(pptxSnippet(map.version.summary, 520), {
    x: 0.75, y: 3.25, w: 10.8, h: 1.45, fontFace: 'Aptos', fontSize: 18,
    color: pptxColours.ink, margin: 0, breakLine: false, valign: 'top', fit: 'shrink'
  });
  slide.addText(`Version ${metadata.versionNumber} (${metadata.versionState})\nGenerated ${metadata.generatedAt}`, {
    x: 0.75, y: 5.85, w: 6.2, h: 0.65, fontFace: 'Aptos', fontSize: 16, color: pptxColours.muted, margin: 0
  });
  if (metadata.selectedView) slide.addText(
    `Selected view: ${metadata.selectedView.name} · revision ${metadata.selectedView.revision} · ${metadata.selectedView.bindingPolicy.replaceAll('_', ' ')}\n${selectedViewFilterLabel(metadata.selectedView)}`,
    { x: 0.75, y: 6.4, w: 10.8, h: 0.48, fontFace: 'Aptos', fontSize: 10, color: pptxColours.muted, margin: 0 }
  );

  slide = addSlide();
  slide.addText('How to read the evidence states', {
    x: 0.75, y: 0.55, w: 11.8, h: 0.55, fontFace: 'Aptos Display', fontSize: 35,
    bold: true, color: pptxColours.ink, margin: 0
  });
  slide.addText(metadata.notice, {
    x: 0.75, y: 1.25, w: 11.8, h: 0.5, fontFace: 'Aptos', fontSize: 16,
    italic: true, color: pptxColours.muted, margin: 0, fit: 'shrink'
  });
  journeyEvidenceLegend.forEach((entry, index) => {
    const yPosition = 1.95 + index * 0.68;
    slide.addShape(pptx.ShapeType.line, { x: 0.75, y: yPosition + 0.48, w: 11.75, h: 0, line: { color: pptxColours.line, width: 0.7 } });
    slide.addText(`${entry.label}  (${metadata.evidenceSummary[entry.state] || 0})`, {
      x: 0.75, y: yPosition, w: 2.65, h: 0.35, fontFace: 'Aptos', fontSize: 17,
      bold: true, color: pptxColours.accent, margin: 0
    });
    slide.addText(entry.description, {
      x: 3.45, y: yPosition, w: 8.95, h: 0.38, fontFace: 'Aptos', fontSize: 16,
      color: pptxColours.ink, margin: 0, fit: 'shrink'
    });
  });

  if (map.emotionalCurve.length) {
    slide = addSlide();
    slide.addText('Exact emotional curve values', {
      x: 0.75, y: 0.55, w: 11.8, h: 0.55, fontFace: 'Aptos Display', fontSize: 35,
      bold: true, color: pptxColours.ink, margin: 0
    });
    slide.addText('Only values recorded on emotion cards are included. No average or inferred score is added.', {
      x: 0.75, y: 1.2, w: 11.8, h: 0.4, fontFace: 'Aptos', fontSize: 15,
      color: pptxColours.muted, margin: 0
    });
    map.emotionalCurve.slice(0, 12).forEach((point, index) => {
      const yPosition = 1.85 + index * 0.39;
      slide.addText(point.stageName, { x: 0.75, y: yPosition, w: 3.0, h: 0.26,
        fontFace: 'Aptos', fontSize: 14, bold: true, color: pptxColours.ink, margin: 0, fit: 'shrink' });
      slide.addText(point.label || 'Unlabelled', { x: 3.9, y: yPosition, w: 4.7, h: 0.26,
        fontFace: 'Aptos', fontSize: 14, color: pptxColours.ink, margin: 0, fit: 'shrink' });
      slide.addText(`Valence ${point.valence}  |  Intensity ${point.intensity}`, { x: 8.75, y: yPosition, w: 3.6, h: 0.26,
        fontFace: 'Aptos', fontSize: 13, color: pptxColours.accent, margin: 0, align: 'right' });
    });
  }

  const newStageSlide = (stageIndex: number, stage: SafeJourneyMapExport['stages'][number], continuation: boolean) => {
    const next = addSlide();
    next.addText(`Stage ${stageIndex + 1} - ${stage.name || 'Untitled stage'}`, {
      x: 0.75, y: 0.5, w: continuation ? 9.8 : 11.8, h: 0.65, fontFace: 'Aptos Display', fontSize: 35,
      bold: true, color: pptxColours.ink, margin: 0, fit: 'shrink'
    });
    if (continuation) next.addText('Continued', {
      x: 10.75, y: 0.62, w: 1.65, h: 0.3, fontFace: 'Aptos', fontSize: 16,
      color: pptxColours.muted, margin: 0, align: 'right'
    });
    if (stage.goal) next.addText(`Goal: ${pptxSnippet(stage.goal, 180)}`, {
      x: 0.75, y: 1.22, w: 11.8, h: 0.38, fontFace: 'Aptos', fontSize: 16,
      italic: true, color: pptxColours.muted, margin: 0, fit: 'shrink'
    });
    return next;
  };

  if (!map.stages.length) {
    slide = addSlide();
    slide.addText('This version has no journey stages yet', {
      x: 0.75, y: 1.4, w: 11.8, h: 0.8, fontFace: 'Aptos Display', fontSize: 35,
      bold: true, color: pptxColours.ink, margin: 0
    });
    slide.addText('Add stages and cards in Experience Manager, then export this version again.', {
      x: 0.75, y: 2.55, w: 10.8, h: 0.7, fontFace: 'Aptos', fontSize: 20,
      color: pptxColours.muted, margin: 0
    });
  }

  for (const [stageIndex, stage] of map.stages.entries()) {
    let stageSlide = newStageSlide(stageIndex, stage, false);
    let yPosition = 1.82;
    const stageCards = map.cards.filter((card) => card.stageKey === stage.stageKey);
    if (!stageCards.length) {
      stageSlide.addText('No cards have been added to this stage.', {
        x: 0.75, y: yPosition + 0.4, w: 10.5, h: 0.5, fontFace: 'Aptos', fontSize: 20,
        color: pptxColours.muted, margin: 0
      });
      continue;
    }
    for (const lane of map.lanes) {
      const laneCards = stageCards.filter((card) => card.laneType === lane.laneType);
      if (!laneCards.length) continue;
      if (yPosition > 5.75) { stageSlide = newStageSlide(stageIndex, stage, true); yPosition = 1.82; }
      stageSlide.addText(`${lane.title || lane.laneType}${lane.visible ? '' : ' (hidden lane)'}`, {
        x: 0.75, y: yPosition, w: 11.8, h: 0.32, fontFace: 'Aptos', fontSize: 18,
        bold: true, color: pptxColours.accent, margin: 0
      });
      stageSlide.addShape(pptx.ShapeType.line, { x: 0.75, y: yPosition + 0.39, w: 11.75, h: 0, line: { color: pptxColours.line, width: 0.8 } });
      yPosition += 0.52;
      for (const card of laneCards) {
        const content = pptxSnippet(presentationCardContent(card), 300);
        const cardHeight = content ? 0.98 : 0.65;
        if (yPosition + cardHeight > 6.78) {
          stageSlide = newStageSlide(stageIndex, stage, true);
          yPosition = 1.82;
          stageSlide.addText(`${lane.title || lane.laneType} (continued)`, {
            x: 0.75, y: yPosition, w: 11.8, h: 0.32, fontFace: 'Aptos', fontSize: 18,
            bold: true, color: pptxColours.accent, margin: 0
          });
          stageSlide.addShape(pptx.ShapeType.line, { x: 0.75, y: yPosition + 0.39, w: 11.75, h: 0, line: { color: pptxColours.line, width: 0.8 } });
          yPosition += 0.52;
        }
        stageSlide.addText(pptxSnippet(card.title || 'Untitled card', 140), {
          x: 0.95, y: yPosition, w: 8.55, h: 0.3, fontFace: 'Aptos', fontSize: 17,
          bold: true, color: pptxColours.ink, margin: 0, fit: 'shrink'
        });
        stageSlide.addText(`${card.kind.replaceAll('_', ' ')} | ${card.status} | ${card.evidence.state.replaceAll('_', ' ')}`, {
          x: 9.45, y: yPosition, w: 3.0, h: 0.28, fontFace: 'Aptos', fontSize: 12,
          color: pptxColours.muted, margin: 0, align: 'right', fit: 'shrink'
        });
        if (content) stageSlide.addText(content, {
          x: 0.95, y: yPosition + 0.38, w: 11.25, h: 0.48, fontFace: 'Aptos', fontSize: 16,
          color: pptxColours.ink, margin: 0, breakLine: false, fit: 'shrink', valign: 'top'
        });
        yPosition += cardHeight;
      }
      yPosition += 0.14;
    }
  }

  const output = await pptx.write({ outputType: 'nodebuffer', compression: true });
  const bytes = Buffer.isBuffer(output)
    ? output
    : output instanceof Uint8Array
      ? Buffer.from(output)
      : output instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(output))
        : Buffer.from(String(output), 'binary');
  return { bytes, slideCount: slides.length };
}

export async function buildJourneyMapExport(
  readModel: JourneyMapReadModel,
  format: JourneyMapExportFormat,
  generatedAt = new Date().toISOString(),
  selectedView?: JourneyMapExportViewContext,
  richMap?: JourneyRichMapSnapshot | null
): Promise<JourneyMapExportArtifact> {
  const map = sanitizeJourneyMapForExport(readModel, richMap);
  const metadata = journeyMapExportMetadata(map, generatedAt, selectedView);
  const filename = journeyMapExportFilename(map, format, selectedView);
  if (format === 'json') return { bytes: buildJson(map, metadata), filename, mimeType: exportMimes.json };
  if (format === 'csv') return { bytes: buildCsv(map, metadata), filename, mimeType: exportMimes.csv };
  if (format === 'pdf') {
    const rendered = await buildPdf(map, metadata);
    return { ...rendered, filename, mimeType: exportMimes.pdf };
  }
  if (format === 'png') {
    const rendered = await buildPng(map, metadata);
    return { ...rendered, filename, mimeType: exportMimes.png };
  }
  const rendered = await buildPptx(map, metadata);
  return { ...rendered, filename, mimeType: exportMimes.pptx };
}
