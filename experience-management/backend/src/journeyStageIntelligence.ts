import { createHash } from 'node:crypto';

export const journeyStageComparisonDimensions = ['persona', 'segment', 'cohort', 'channel'] as const;
export type JourneyStageComparisonDimension = typeof journeyStageComparisonDimensions[number];
export const journeyStageSentiments = ['negative', 'neutral', 'positive', 'mixed', 'unknown'] as const;
export type JourneyStageSentiment = typeof journeyStageSentiments[number];
export const journeyStageEmotions = [
  'anger', 'anxiety', 'confusion', 'delight', 'disappointment', 'frustration', 'relief', 'sadness', 'trust', 'unknown'
] as const;
export type JourneyStageEmotion = typeof journeyStageEmotions[number];

export type JourneyStageSourceLineage = {
  sourceType: 'survey' | 'service_recovery_ticket' | 'social_mention' | 'journey_event' | 'operational_import';
  sourceId: string;
  sourceVersion: string;
  schemaVersion: string;
  projectionVersion: string;
};
export type JourneyStageComparisonLineage = Omit<JourneyStageSourceLineage, 'sourceId'> & {
  sourceIdSha256: string;
};

export type JourneyStageIntelligenceFact = {
  spaceId: string;
  subjectKey: string;
  stageId: string;
  metricDefinitionId: string;
  metricDefinitionVersionId: string;
  metricDefinitionVersionSha256: string;
  metricName: string;
  metricUnit: string;
  value: number | null;
  dimensions: Partial<Record<JourneyStageComparisonDimension, readonly string[]>>;
  sentiment: JourneyStageSentiment | null;
  emotions: readonly JourneyStageEmotion[];
  occurredAt: string;
  consentState: 'granted' | 'not_required' | 'denied' | 'unknown' | 'withdrawn';
  allowedPurposes: readonly JourneyStagePurpose[];
  retentionExpiresAt: string;
  deletedAt: string | null;
  lineage: JourneyStageSourceLineage;
};

export const journeyStagePurposes = ['service_improvement', 'analytics', 'research'] as const;
export type JourneyStagePurpose = typeof journeyStagePurposes[number];

export type JourneyStageComparisonRow = {
  stageId: string;
  dimension: JourneyStageComparisonDimension;
  dimensionId: string;
  metricDefinitionId: string;
  metricDefinitionVersionId: string;
  metricDefinitionVersionSha256: string;
  metricName: string;
  metricUnit: string;
  window: { from: string; to: string; asOf: string };
  calculationVersion: 'journey-stage-comparison/v1';
  sampleSize: number | null;
  value: number | null;
  sentiment: Record<JourneyStageSentiment, number | null>;
  emotions: Record<JourneyStageEmotion, number | null>;
  suppression: {
    suppressed: boolean;
    kind: 'primary' | 'secondary' | null;
    reason: 'BELOW_MINIMUM_SAMPLE' | 'COMPLEMENTARY_DISCLOSURE_RISK' | null;
    minimumSampleSize: number;
  };
  lineage: JourneyStageComparisonLineage[];
  lineageTruncated: boolean;
};

export class JourneyStageIntelligenceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

type Input = {
  spaceId: string;
  actorSpaceId: string;
  actorRole: 'owner' | 'admin' | 'member';
  purpose: JourneyStagePurpose;
  from: string;
  to: string;
  asOf: string;
  minimumSampleSize: number;
  facts: readonly JourneyStageIntelligenceFact[];
  dimensions?: readonly JourneyStageComparisonDimension[];
  maximumRows?: number;
};

export type JourneyStageTrendBucket = {
  from: string;
  to: string;
  fingerprint: string;
  exclusions: { total: number | null; suppressed: boolean };
  rows: JourneyStageComparisonRow[];
};

export type JourneyStageTrendResult = {
  schemaVersion: 'journey-stage-trends/v1';
  purpose: JourneyStagePurpose;
  window: { from: string; to: string; asOf: string };
  bucketDays: number;
  minimumSampleSize: number;
  buckets: JourneyStageTrendBucket[];
  fingerprint: string;
};

const sentimentEmpty = () => Object.fromEntries(journeyStageSentiments.map((key) => [key, 0])) as Record<JourneyStageSentiment, number>;
const emotionEmpty = () => Object.fromEntries(journeyStageEmotions.map((key) => [key, 0])) as Record<JourneyStageEmotion, number>;
const nullSentiment = () => Object.fromEntries(journeyStageSentiments.map((key) => [key, null])) as Record<JourneyStageSentiment, null>;
const nullEmotion = () => Object.fromEntries(journeyStageEmotions.map((key) => [key, null])) as Record<JourneyStageEmotion, null>;

function instant(value: string, label: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new JourneyStageIntelligenceError(`${label} must be an ISO timestamp.`, 400,
    'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  return parsed;
}

function boundedToken(value: string, label: string, maximum = 200) {
  const token = value.trim();
  if (!token || token.length > maximum) throw new JourneyStageIntelligenceError(`${label} is invalid.`, 400,
    'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  return token;
}

function percent(count: number, total: number) {
  return total ? Math.round((count / total) * 10_000) / 100 : 0;
}

type Working = Omit<JourneyStageComparisonRow, 'sampleSize' | 'value' | 'sentiment' | 'emotions' | 'suppression'> & {
  subjects: Set<string>;
  values: number[];
  sentimentCounts: Record<JourneyStageSentiment, number>;
  emotionCounts: Record<JourneyStageEmotion, number>;
};

function suppress(row: JourneyStageComparisonRow, kind: 'primary' | 'secondary',
  reason: 'BELOW_MINIMUM_SAMPLE' | 'COMPLEMENTARY_DISCLOSURE_RISK'): JourneyStageComparisonRow {
  return { ...row, sampleSize: null, value: null, sentiment: nullSentiment(), emotions: nullEmotion(),
    lineage: [], lineageTruncated: false,
    suppression: { ...row.suppression, suppressed: true, kind, reason } };
}

/**
 * Builds only aggregate, version-lineaged comparisons. Text is never accepted,
 * so sentiment and emotion can only originate from an explicit deterministic
 * source classification. Unknown classifications stay unknown; they are never
 * converted into neutral or inferred by a model.
 */
export function buildJourneyStageComparisons(input: Input) {
  if (input.spaceId !== input.actorSpaceId) throw new JourneyStageIntelligenceError('Journey comparison not found.', 404,
    'JOURNEY_STAGE_INTELLIGENCE_NOT_FOUND');
  if (!['owner', 'admin', 'member'].includes(input.actorRole)) throw new JourneyStageIntelligenceError('Forbidden.', 403,
    'JOURNEY_STAGE_INTELLIGENCE_FORBIDDEN');
  const from = instant(input.from, 'from'); const to = instant(input.to, 'to'); const asOf = instant(input.asOf, 'asOf');
  if (from >= to || to > asOf) throw new JourneyStageIntelligenceError('The requested window is invalid.', 400,
    'JOURNEY_STAGE_INTELLIGENCE_WINDOW_INVALID');
  if (!Number.isSafeInteger(input.minimumSampleSize) || input.minimumSampleSize < 3 || input.minimumSampleSize > 1_000) {
    throw new JourneyStageIntelligenceError('minimumSampleSize must be between 3 and 1000.', 400,
      'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  }
  const maximumRows = input.maximumRows ?? 5_000;
  if (!Number.isSafeInteger(maximumRows) || maximumRows < 1 || maximumRows > 5_000) throw new JourneyStageIntelligenceError(
    'maximumRows must be between 1 and 5000.', 400, 'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  const dimensions = [...new Set(input.dimensions ?? journeyStageComparisonDimensions)];
  const groups = new Map<string, Working>();
  const excluded = { wrongTenant: 0, outsideWindow: 0, consent: 0, purpose: 0, retention: 0, deleted: 0 };

  // Stable ordering prevents a connector's batch order from changing which
  // one of several same-subject facts contributes to a distinct-subject cell.
  // The most recent eligible fact wins; source identity breaks timestamp ties.
  const orderedFacts = [...input.facts].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    || JSON.stringify(left.lineage).localeCompare(JSON.stringify(right.lineage))
    || left.subjectKey.localeCompare(right.subjectKey));
  for (const fact of orderedFacts) {
    if (fact.spaceId !== input.spaceId) { excluded.wrongTenant += 1; continue; }
    const occurredAt = instant(fact.occurredAt, 'fact.occurredAt');
    if (occurredAt < from || occurredAt >= to) { excluded.outsideWindow += 1; continue; }
    if (!['granted', 'not_required'].includes(fact.consentState)) { excluded.consent += 1; continue; }
    if (!fact.allowedPurposes.includes(input.purpose)) { excluded.purpose += 1; continue; }
    if (instant(fact.retentionExpiresAt, 'fact.retentionExpiresAt') <= asOf) { excluded.retention += 1; continue; }
    if (fact.deletedAt !== null) { excluded.deleted += 1; continue; }
    const stageId = boundedToken(fact.stageId, 'stageId');
    const definitionId = boundedToken(fact.metricDefinitionId, 'metricDefinitionId');
    const definitionVersionId = boundedToken(fact.metricDefinitionVersionId, 'metricDefinitionVersionId');
    if (!/^[a-f0-9]{64}$/u.test(fact.metricDefinitionVersionSha256)) throw new JourneyStageIntelligenceError(
      'metricDefinitionVersionSha256 is invalid.', 400, 'JOURNEY_STAGE_INTELLIGENCE_LINEAGE_INVALID');
    for (const dimension of dimensions) for (const rawDimensionId of fact.dimensions[dimension] ?? []) {
      const dimensionId = boundedToken(rawDimensionId, `${dimension}Id`);
      const key = [stageId, dimension, dimensionId, definitionVersionId].join('\u001f');
      let group = groups.get(key);
      if (!group) {
        group = { stageId, dimension, dimensionId, metricDefinitionId: definitionId, metricDefinitionVersionId: definitionVersionId,
          metricDefinitionVersionSha256: fact.metricDefinitionVersionSha256, metricName: boundedToken(fact.metricName, 'metricName'),
          metricUnit: boundedToken(fact.metricUnit, 'metricUnit', 80), window: { from: input.from, to: input.to, asOf: input.asOf },
          calculationVersion: 'journey-stage-comparison/v1', lineage: [], lineageTruncated: false,
          subjects: new Set(), values: [],
          sentimentCounts: sentimentEmpty(), emotionCounts: emotionEmpty() };
        groups.set(key, group);
      }
      if (group.metricDefinitionId !== definitionId || group.metricDefinitionVersionSha256 !== fact.metricDefinitionVersionSha256) {
        throw new JourneyStageIntelligenceError('Metric lineage conflicts inside one comparison group.', 409,
          'JOURNEY_STAGE_INTELLIGENCE_LINEAGE_CONFLICT');
      }
      const subjectKey = boundedToken(fact.subjectKey, 'subjectKey');
      const firstSubjectFact = !group.subjects.has(subjectKey);
      group.subjects.add(subjectKey);
      if (firstSubjectFact) {
        if (fact.value !== null && Number.isFinite(fact.value)) group.values.push(fact.value);
        group.sentimentCounts[fact.sentiment ?? 'unknown'] += 1;
        const emotions = fact.emotions.length ? [...new Set(fact.emotions)] : ['unknown' as const];
        for (const emotion of emotions) group.emotionCounts[emotion] += 1;
      }
      const lineage: JourneyStageComparisonLineage = { sourceType: fact.lineage.sourceType,
        sourceIdSha256: createHash('sha256').update(fact.lineage.sourceId).digest('hex'),
        sourceVersion: boundedToken(fact.lineage.sourceVersion, 'sourceVersion', 128),
        schemaVersion: boundedToken(fact.lineage.schemaVersion, 'schemaVersion', 128),
        projectionVersion: boundedToken(fact.lineage.projectionVersion, 'projectionVersion', 128) };
      const identity = JSON.stringify(lineage);
      if (!group.lineage.some((row) => JSON.stringify(row) === identity)) {
        if (group.lineage.length < 50) group.lineage.push(lineage);
        else group.lineageTruncated = true;
      }
    }
    if (groups.size > maximumRows) throw new JourneyStageIntelligenceError('The comparison exceeds the bounded row limit.', 413,
      'JOURNEY_STAGE_INTELLIGENCE_RESULT_TOO_LARGE');
  }

  let rows = [...groups.values()].map<JourneyStageComparisonRow>((group) => {
    const sampleSize = group.subjects.size;
    const value = group.values.length ? Math.round((group.values.reduce((sum, current) => sum + current, 0)
      / group.values.length) * 10_000) / 10_000 : null;
    const result: JourneyStageComparisonRow = { ...group, subjects: undefined, values: undefined,
      sentimentCounts: undefined, emotionCounts: undefined, sampleSize, value,
      sentiment: Object.fromEntries(journeyStageSentiments.map((key) => [key, percent(group.sentimentCounts[key], sampleSize)])) as Record<JourneyStageSentiment, number>,
      emotions: Object.fromEntries(journeyStageEmotions.map((key) => [key, percent(group.emotionCounts[key], sampleSize)])) as Record<JourneyStageEmotion, number>,
      suppression: { suppressed: false, kind: null, reason: null, minimumSampleSize: input.minimumSampleSize },
      lineage: group.lineage.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) } as JourneyStageComparisonRow;
    return sampleSize < input.minimumSampleSize ? suppress(result, 'primary', 'BELOW_MINIMUM_SAMPLE') : result;
  });

  // Complementary suppression: when exactly one cell in a comparable row is
  // hidden, the total and visible cells could reveal it. Hide the smallest
  // remaining cell as well. A tie is resolved by dimension id for determinism.
  const comparisonSets = new Map<string, JourneyStageComparisonRow[]>();
  for (const row of rows) {
    const key = [row.stageId, row.dimension, row.metricDefinitionVersionId].join('\u001f');
    comparisonSets.set(key, [...(comparisonSets.get(key) ?? []), row]);
  }
  const secondary = new Set<string>();
  for (const set of comparisonSets.values()) {
    const primary = set.filter((row) => row.suppression.kind === 'primary');
    const visible = set.filter((row) => !row.suppression.suppressed);
    if (primary.length === 1 && visible.length > 0) {
      visible.sort((left, right) => (left.sampleSize! - right.sampleSize!) || left.dimensionId.localeCompare(right.dimensionId));
      secondary.add([visible[0].stageId, visible[0].dimension, visible[0].dimensionId,
        visible[0].metricDefinitionVersionId].join('\u001f'));
    }
  }
  rows = rows.map((row) => secondary.has([row.stageId, row.dimension, row.dimensionId,
    row.metricDefinitionVersionId].join('\u001f'))
    ? suppress(row, 'secondary', 'COMPLEMENTARY_DISCLOSURE_RISK') : row);
  rows.sort((left, right) => [left.stageId, left.dimension, left.dimensionId, left.metricDefinitionVersionId].join('\u001f')
    .localeCompare([right.stageId, right.dimension, right.dimensionId, right.metricDefinitionVersionId].join('\u001f')));
  const fingerprint = createHash('sha256').update(JSON.stringify({ spaceId: input.spaceId, purpose: input.purpose,
    window: { from: input.from, to: input.to, asOf: input.asOf }, dimensions, rows })).digest('hex');
  const excludedTotal = Object.values(excluded).reduce((sum, count) => sum + count, 0);
  return { schemaVersion: 'journey-stage-intelligence/v1' as const, purpose: input.purpose,
    window: { from: input.from, to: input.to, asOf: input.asOf }, minimumSampleSize: input.minimumSampleSize,
    rows, exclusions: { total: excludedTotal === 0 ? 0
      : excludedTotal >= input.minimumSampleSize ? excludedTotal : null,
    suppressed: excludedTotal > 0 && excludedTotal < input.minimumSampleSize }, fingerprint };
}

export type JourneyStageComparisonResult = ReturnType<typeof buildJourneyStageComparisons>;

/** Builds a bounded sequence of independently suppressed comparison windows.
 * Suppression is recalculated inside every bucket; a broad-window aggregate is
 * never used to reveal a small time cell. Empty buckets remain explicit so a
 * missing period cannot be mistaken for a zero-valued observation. */
export function buildJourneyStageTrends(input: Input & { bucketDays: number; maximumBuckets?: number }): JourneyStageTrendResult {
  const from = instant(input.from, 'from'); const to = instant(input.to, 'to'); const asOf = instant(input.asOf, 'asOf');
  if (from >= to || to > asOf) throw new JourneyStageIntelligenceError('The requested window is invalid.', 400,
    'JOURNEY_STAGE_INTELLIGENCE_WINDOW_INVALID');
  if (!Number.isSafeInteger(input.bucketDays) || input.bucketDays < 1 || input.bucketDays > 31) {
    throw new JourneyStageIntelligenceError('bucketDays must be between 1 and 31.', 400,
      'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  }
  const maximumBuckets = input.maximumBuckets ?? 52;
  if (!Number.isSafeInteger(maximumBuckets) || maximumBuckets < 1 || maximumBuckets > 366) {
    throw new JourneyStageIntelligenceError('maximumBuckets must be between 1 and 366.', 400,
      'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  }
  const bucketMs = input.bucketDays * 86_400_000;
  const bucketCount = Math.ceil((to - from) / bucketMs);
  if (bucketCount > maximumBuckets) throw new JourneyStageIntelligenceError('The trend exceeds the bounded bucket limit.', 413,
    'JOURNEY_STAGE_INTELLIGENCE_RESULT_TOO_LARGE');
  const maximumRows = input.maximumRows ?? 5_000;
  const buckets: JourneyStageTrendBucket[] = [];
  let totalRows = 0;
  for (let index = 0; index < bucketCount; index += 1) {
    const bucketFrom = from + index * bucketMs;
    const bucketTo = Math.min(to, bucketFrom + bucketMs);
    const result = buildJourneyStageComparisons({ ...input, from: new Date(bucketFrom).toISOString(),
      to: new Date(bucketTo).toISOString(), maximumRows });
    totalRows += result.rows.length;
    if (totalRows > maximumRows) throw new JourneyStageIntelligenceError('The trend exceeds the bounded row limit.', 413,
      'JOURNEY_STAGE_INTELLIGENCE_RESULT_TOO_LARGE');
    buckets.push({ from: result.window.from, to: result.window.to, fingerprint: result.fingerprint,
      exclusions: result.exclusions, rows: result.rows });
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ spaceId: input.spaceId, purpose: input.purpose,
    window: { from: input.from, to: input.to, asOf: input.asOf }, bucketDays: input.bucketDays,
    minimumSampleSize: input.minimumSampleSize, buckets })).digest('hex');
  return { schemaVersion: 'journey-stage-trends/v1', purpose: input.purpose,
    window: { from: input.from, to: input.to, asOf: input.asOf }, bucketDays: input.bucketDays,
    minimumSampleSize: input.minimumSampleSize, buckets, fingerprint };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  const formulaSafe = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(formulaSafe) ? `"${formulaSafe.replaceAll('"', '""')}"` : formulaSafe;
}

/** Exports only the already-suppressed projection; raw facts are never accepted. */
export function exportJourneyStageComparisons(result: JourneyStageComparisonResult, format: 'csv' | 'json',
  limits: { maximumRows?: number; maximumBytes?: number } = {}) {
  const maximumRows = limits.maximumRows ?? 5_000; const maximumBytes = limits.maximumBytes ?? 5 * 1024 * 1024;
  if (result.rows.length > maximumRows) throw new JourneyStageIntelligenceError('The export exceeds the row limit.', 413,
    'JOURNEY_STAGE_INTELLIGENCE_EXPORT_TOO_LARGE');
  const safeRows = result.rows.map((row) => row.suppression.suppressed ? { ...row, sampleSize: null, value: null,
    sentiment: nullSentiment(), emotions: nullEmotion() } : row);
  const bytes = format === 'json' ? Buffer.from(`${JSON.stringify({ ...result, rows: safeRows }, null, 2)}\n`, 'utf8')
    : Buffer.from(`${['stageId', 'dimension', 'dimensionId', 'metricDefinitionVersionId', 'metricDefinitionVersionSha256',
      'windowFrom', 'windowTo', 'calculationVersion', 'suppressed', 'suppressionKind', 'sampleSize', 'value',
      ...journeyStageSentiments.map((key) => `sentiment_${key}`), ...journeyStageEmotions.map((key) => `emotion_${key}`)]
      .map(csvCell).join(',')}\r\n${safeRows.map((row) => [row.stageId, row.dimension, row.dimensionId,
      row.metricDefinitionVersionId, row.metricDefinitionVersionSha256, row.window.from, row.window.to,
      row.calculationVersion, row.suppression.suppressed, row.suppression.kind, row.sampleSize, row.value,
      ...journeyStageSentiments.map((key) => row.sentiment[key]), ...journeyStageEmotions.map((key) => row.emotions[key])]
      .map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');
  if (bytes.length > maximumBytes) throw new JourneyStageIntelligenceError('The export exceeds the byte limit.', 413,
    'JOURNEY_STAGE_INTELLIGENCE_EXPORT_TOO_LARGE');
  return { bytes, mimeType: format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
    rowCount: safeRows.length, suppressedRowCount: safeRows.filter((row) => row.suppression.suppressed).length };
}
