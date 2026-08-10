import { activeSpaceId, api } from './api';

export const journeyStageComparisonDimensions = ['persona', 'segment', 'cohort', 'channel'] as const;
export type JourneyStageComparisonDimension = typeof journeyStageComparisonDimensions[number];
export const journeyStagePurposes = ['service_improvement', 'analytics', 'research'] as const;
export type JourneyStagePurpose = typeof journeyStagePurposes[number];
const sentiments = ['negative', 'neutral', 'positive', 'mixed', 'unknown'] as const;
const emotions = ['anger', 'anxiety', 'confusion', 'delight', 'disappointment', 'frustration', 'relief', 'sadness', 'trust', 'unknown'] as const;

export type JourneyStageComparisonRow = {
  stageId: string; dimension: JourneyStageComparisonDimension; dimensionId: string;
  metricDefinitionId: string; metricDefinitionVersionId: string; metricDefinitionVersionSha256: string;
  metricName: string; metricUnit: string; calculationVersion: 'journey-stage-comparison/v1';
  window: { from: string; to: string; asOf: string }; sampleSize: number | null; value: number | null;
  sentiment: Record<typeof sentiments[number], number | null>; emotions: Record<typeof emotions[number], number | null>;
  suppression: { suppressed: boolean; kind: 'primary' | 'secondary' | null;
    reason: 'BELOW_MINIMUM_SAMPLE' | 'COMPLEMENTARY_DISCLOSURE_RISK' | null; minimumSampleSize: number };
  lineage: Array<{ sourceType: string; sourceIdSha256: string; sourceVersion: string; schemaVersion: string;
    projectionVersion: string }>; lineageTruncated: boolean;
};

export type JourneyStageComparisonResult = {
  schemaVersion: 'journey-stage-intelligence/v1'; purpose: JourneyStagePurpose;
  window: { from: string; to: string; asOf: string }; minimumSampleSize: number;
  rows: JourneyStageComparisonRow[]; exclusions: { total: number | null; suppressed: boolean }; fingerprint: string;
};
export type JourneyStageTrendBucket = { from: string; to: string; fingerprint: string;
  exclusions: { total: number | null; suppressed: boolean }; rows: JourneyStageComparisonRow[] };
export type JourneyStageTrendResult = {
  schemaVersion: 'journey-stage-trends/v1'; purpose: JourneyStagePurpose;
  window: { from: string; to: string; asOf: string }; bucketDays: number; minimumSampleSize: number;
  buckets: JourneyStageTrendBucket[]; fingerprint: string;
};
export type JourneyStageIntelligencePolicy = { revision: number; minimumSampleSize: number;
  dimensions: JourneyStageComparisonDimension[]; maximumRows: number };

export class JourneyStageIntelligenceResponseError extends Error {
  constructor(message: string) { super(`Invalid journey stage intelligence response: ${message}`); }
}
type Row = Record<string, unknown>;
function fail(message: string): never { throw new JourneyStageIntelligenceResponseError(message); }
function object(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); return value as Row;
}
function exact(value: unknown, label: string, keys: readonly string[]) {
  const row = object(value, label); const allowed = new Set(keys); const extra = Object.keys(row).find((key) => !allowed.has(key));
  if (extra) fail(`${label} contains unexpected field ${extra}`); return row;
}
function text(value: unknown, label: string) { if (typeof value !== 'string' || !value.length) fail(`${label} must be text`); return value; }
function number(value: unknown, label: string) { if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be finite`); return value; }
function integer(value: unknown, label: string, minimum: number) { const result = number(value, label);
  if (!Number.isSafeInteger(result) || result < minimum) fail(`${label} must be an integer`); return result; }
function bool(value: unknown, label: string) { if (typeof value !== 'boolean') fail(`${label} must be boolean`); return value; }
function nullableNumber(value: unknown, label: string) { return value === null ? null : number(value, label); }
function enumValue<T extends string>(value: unknown, label: string, values: readonly T[]) {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(`${label} is invalid`); return value as T;
}
function array(value: unknown, label: string) { if (!Array.isArray(value)) fail(`${label} must be an array`); return value; }
function timestamp(value: unknown, label: string) { const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) fail(`${label} must be an ISO timestamp`); return result; }
function windowValue(value: unknown, label: string) { const row = exact(value, label, ['from', 'to', 'asOf']);
  return { from: timestamp(row.from, `${label}.from`), to: timestamp(row.to, `${label}.to`), asOf: timestamp(row.asOf, `${label}.asOf`) }; }

function shares<K extends string>(value: unknown, label: string, keys: readonly K[]) {
  const row = exact(value, label, keys); return Object.fromEntries(keys.map((key) => [key,
    nullableNumber(row[key], `${label}.${key}`)])) as Record<K, number | null>;
}

function parseRow(value: unknown): JourneyStageComparisonRow {
  const row = exact(value, 'row', ['stageId', 'dimension', 'dimensionId', 'metricDefinitionId', 'metricDefinitionVersionId',
    'metricDefinitionVersionSha256', 'metricName', 'metricUnit', 'window', 'calculationVersion', 'sampleSize', 'value',
    'sentiment', 'emotions', 'suppression', 'lineage', 'lineageTruncated']);
  const suppression = exact(row.suppression, 'row.suppression', ['suppressed', 'kind', 'reason', 'minimumSampleSize']);
  const suppressed = bool(suppression.suppressed, 'row.suppression.suppressed');
  const sentiment = shares(row.sentiment, 'row.sentiment', sentiments); const emotion = shares(row.emotions, 'row.emotions', emotions);
  const lineage = array(row.lineage, 'row.lineage').map((value, index) => {
    const item = exact(value, `row.lineage[${index}]`, ['sourceType', 'sourceIdSha256', 'sourceVersion', 'schemaVersion', 'projectionVersion']);
    const digest = text(item.sourceIdSha256, 'lineage.sourceIdSha256'); if (!/^[a-f0-9]{64}$/u.test(digest)) fail('lineage hash is invalid');
    return { sourceType: text(item.sourceType, 'lineage.sourceType'), sourceIdSha256: digest,
      sourceVersion: text(item.sourceVersion, 'lineage.sourceVersion'), schemaVersion: text(item.schemaVersion, 'lineage.schemaVersion'),
      projectionVersion: text(item.projectionVersion, 'lineage.projectionVersion') };
  });
  const sampleSize = row.sampleSize === null ? null : integer(row.sampleSize, 'row.sampleSize', 1);
  const metricValue = nullableNumber(row.value, 'row.value');
  if (suppressed && (sampleSize !== null || metricValue !== null || lineage.length
      || [...Object.values(sentiment), ...Object.values(emotion)].some((entry) => entry !== null))) {
    fail('suppressed row discloses protected detail');
  }
  return { stageId: text(row.stageId, 'row.stageId'), dimension: enumValue(row.dimension, 'row.dimension', journeyStageComparisonDimensions),
    dimensionId: text(row.dimensionId, 'row.dimensionId'), metricDefinitionId: text(row.metricDefinitionId, 'row.metricDefinitionId'),
    metricDefinitionVersionId: text(row.metricDefinitionVersionId, 'row.metricDefinitionVersionId'),
    metricDefinitionVersionSha256: text(row.metricDefinitionVersionSha256, 'row.metricDefinitionVersionSha256'),
    metricName: text(row.metricName, 'row.metricName'), metricUnit: text(row.metricUnit, 'row.metricUnit'),
    window: windowValue(row.window, 'row.window'), calculationVersion: enumValue(row.calculationVersion, 'row.calculationVersion', ['journey-stage-comparison/v1'] as const),
    sampleSize, value: metricValue, sentiment, emotions: emotion, suppression: { suppressed,
      kind: suppression.kind === null ? null : enumValue(suppression.kind, 'suppression.kind', ['primary', 'secondary'] as const),
      reason: suppression.reason === null ? null : enumValue(suppression.reason, 'suppression.reason',
        ['BELOW_MINIMUM_SAMPLE', 'COMPLEMENTARY_DISCLOSURE_RISK'] as const),
      minimumSampleSize: integer(suppression.minimumSampleSize, 'suppression.minimumSampleSize', 3) },
    lineage, lineageTruncated: bool(row.lineageTruncated, 'row.lineageTruncated') };
}

export function parseJourneyStageComparisonResult(value: unknown): JourneyStageComparisonResult {
  const row = exact(value, 'result', ['schemaVersion', 'purpose', 'window', 'minimumSampleSize', 'rows', 'exclusions', 'fingerprint']);
  const exclusions = exact(row.exclusions, 'result.exclusions', ['total', 'suppressed']);
  const fingerprint = text(row.fingerprint, 'result.fingerprint'); if (!/^[a-f0-9]{64}$/u.test(fingerprint)) fail('fingerprint is invalid');
  return { schemaVersion: enumValue(row.schemaVersion, 'result.schemaVersion', ['journey-stage-intelligence/v1'] as const),
    purpose: enumValue(row.purpose, 'result.purpose', journeyStagePurposes), window: windowValue(row.window, 'result.window'),
    minimumSampleSize: integer(row.minimumSampleSize, 'result.minimumSampleSize', 3),
    rows: array(row.rows, 'result.rows').map(parseRow), exclusions: {
      total: exclusions.total === null ? null : integer(exclusions.total, 'result.exclusions.total', 0),
      suppressed: bool(exclusions.suppressed, 'result.exclusions.suppressed') }, fingerprint };
}

export function parseJourneyStageTrendResult(value: unknown): JourneyStageTrendResult {
  const row = exact(value, 'trend result', ['schemaVersion', 'purpose', 'window', 'bucketDays',
    'minimumSampleSize', 'buckets', 'fingerprint']);
  const fingerprint = text(row.fingerprint, 'trend result.fingerprint');
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) fail('trend fingerprint is invalid');
  const buckets = array(row.buckets, 'trend result.buckets').map((value, index) => {
    const bucket = exact(value, `trend bucket[${index}]`, ['from', 'to', 'fingerprint', 'exclusions', 'rows']);
    const exclusions = exact(bucket.exclusions, `trend bucket[${index}].exclusions`, ['total', 'suppressed']);
    const bucketFingerprint = text(bucket.fingerprint, `trend bucket[${index}].fingerprint`);
    if (!/^[a-f0-9]{64}$/u.test(bucketFingerprint)) fail('trend bucket fingerprint is invalid');
    const from = timestamp(bucket.from, `trend bucket[${index}].from`);
    const to = timestamp(bucket.to, `trend bucket[${index}].to`);
    if (Date.parse(from) >= Date.parse(to)) fail('trend bucket window is invalid');
    return { from, to, fingerprint: bucketFingerprint, exclusions: {
      total: exclusions.total === null ? null : integer(exclusions.total, 'trend bucket exclusions.total', 0),
      suppressed: bool(exclusions.suppressed, 'trend bucket exclusions.suppressed') },
    rows: array(bucket.rows, `trend bucket[${index}].rows`).map(parseRow) };
  });
  for (let index = 1; index < buckets.length; index += 1) {
    if (buckets[index - 1].to !== buckets[index].from) fail('trend buckets must be contiguous');
  }
  return { schemaVersion: enumValue(row.schemaVersion, 'trend result.schemaVersion', ['journey-stage-trends/v1'] as const),
    purpose: enumValue(row.purpose, 'trend result.purpose', journeyStagePurposes),
    window: windowValue(row.window, 'trend result.window'), bucketDays: integer(row.bucketDays, 'trend result.bucketDays', 1),
    minimumSampleSize: integer(row.minimumSampleSize, 'trend result.minimumSampleSize', 3), buckets, fingerprint };
}

export function parseJourneyStagePolicy(value: unknown): JourneyStageIntelligencePolicy {
  const envelope = exact(value, 'policy response', ['policy']); const row = exact(envelope.policy, 'policy',
    ['revision', 'minimumSampleSize', 'dimensions', 'maximumRows']);
  return { revision: integer(row.revision, 'policy.revision', 1), minimumSampleSize: integer(row.minimumSampleSize, 'policy.minimumSampleSize', 3),
    dimensions: array(row.dimensions, 'policy.dimensions').map((item) => enumValue(item, 'policy.dimension', journeyStageComparisonDimensions)),
    maximumRows: integer(row.maximumRows, 'policy.maximumRows', 1) };
}

export type JourneyStageComparisonQuery = { journeyDefinitionId: string; purpose: JourneyStagePurpose;
  from: string; to: string; asOf: string; dimensions?: JourneyStageComparisonDimension[] };
function queryString(input: JourneyStageComparisonQuery) { const params = new URLSearchParams({ journeyDefinitionId: input.journeyDefinitionId,
  purpose: input.purpose, from: input.from, to: input.to, asOf: input.asOf });
  if (input.dimensions?.length) params.set('dimensions', [...new Set(input.dimensions)].join(',')); return params.toString(); }

export async function readJourneyStageComparisons(input: JourneyStageComparisonQuery) {
  return parseJourneyStageComparisonResult(await api<unknown>(`/api/journey-stage-intelligence/comparisons?${queryString(input)}`));
}
export async function readJourneyStageTrends(input: JourneyStageComparisonQuery & { bucketDays: number }) {
  const params = new URLSearchParams(queryString(input)); params.set('bucketDays', String(input.bucketDays));
  return parseJourneyStageTrendResult(await api<unknown>(`/api/journey-stage-intelligence/trends?${params.toString()}`));
}
export async function readJourneyStagePolicy() { return parseJourneyStagePolicy(await api<unknown>('/api/journey-stage-intelligence/policy')); }
export async function updateJourneyStagePolicy(input: JourneyStageIntelligencePolicy) {
  return parseJourneyStagePolicy(await api<unknown>('/api/journey-stage-intelligence/policy', { method: 'PUT',
    body: JSON.stringify({ expectedRevision: input.revision, minimumSampleSize: input.minimumSampleSize,
      dimensions: input.dimensions, maximumRows: input.maximumRows }) }));
}
export async function downloadJourneyStageComparisons(input: JourneyStageComparisonQuery, format: 'csv' | 'json') {
  const headers = new Headers(); const spaceId = activeSpaceId(); if (spaceId) headers.set('x-seemplify-space', spaceId);
  const response = await fetch(`/api/journey-stage-intelligence/comparisons.${format}?${queryString(input)}`, { headers });
  if (!response.ok) throw new Error(`Journey stage export failed (${response.status}).`);
  return { blob: await response.blob(), disposition: response.headers.get('content-disposition') || '' };
}
