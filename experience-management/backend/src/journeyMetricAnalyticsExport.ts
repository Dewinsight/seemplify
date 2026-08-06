/** Governed analytics export.
 *
 * The renderer consumes the *already suppressed* observation projection, never
 * the stored rows, so an export can never disclose more than the screen that
 * produced it. It is deterministic: identical inputs and a fixed `generatedAt`
 * produce byte-identical output, which is what makes the usage-ledger intent
 * hash meaningful.
 *
 * Only CSV and JSON are offered. The PDF/PNG/PPTX renderers in
 * `journeyMapExports` are built around the sanitised journey map read model and
 * have no observation-table equivalent; the quality budget also requires those
 * heavier formats to be cancellable durable jobs.
 */
import { formulaSafeCsvCell } from './journeyMapExports.js';
import type { JourneyMetricSentimentLane } from './journeyMetricPrivacy.js';

export const JOURNEY_METRIC_ANALYTICS_EXPORT_SCHEMA = 'journey-metric-analytics-export/v1';
export const journeyMetricAnalyticsExportFormats = ['csv', 'json'] as const;
export type JourneyMetricAnalyticsExportFormat = typeof journeyMetricAnalyticsExportFormats[number];

export function isJourneyMetricAnalyticsExportFormat(value: string): value is JourneyMetricAnalyticsExportFormat {
  return (journeyMetricAnalyticsExportFormats as readonly string[]).includes(value);
}

export type JourneyMetricAnalyticsExportDefinition = {
  id: string; name: string; targetType: string; targetId: string; targetName: string;
  calculatorKind: string; sourceKind: string; versionNumber: number | null; windowSeconds: number | null;
  timezone: string | null; minimumSampleSize: number | null; contentSha256: string | null;
};

export type JourneyMetricAnalyticsExportObservation = {
  id: string; definitionId: string; definitionVersionId: string; revision: number; status: string;
  value: number | null; unit: string; numerator: number | null; denominator: number | null;
  sampleSize: number | null; sourceCount: number | null;
  period: { start: string | null; end: string | null; timezone: string };
  asOf: string | null; calculatedAt: string | null; freshnessStatus: string; latestObservedAt: string | null;
  minimumSampleWarning: boolean; result: Record<string, unknown>;
  sentiment: JourneyMetricSentimentLane | null;
  privacy: { suppressed: boolean; reasonCode: string | null; minimumSampleSize: number; privacyVersion: number };
};

export type JourneyMetricAnalyticsExportInput = {
  journeyDefinitionId: string; journeyName: string;
  definitions: readonly JourneyMetricAnalyticsExportDefinition[];
  observations: readonly JourneyMetricAnalyticsExportObservation[];
  appliedFilters: Record<string, unknown>;
  format: JourneyMetricAnalyticsExportFormat;
  generatedAt: string;
};

const SENTIMENT_KEYS = ['negative', 'neutral', 'positive', 'unknown'] as const;

const NOTICE = 'Values are selected from materialised authorised observations for the stated filters and window; '
  + 'they are not recomputed at export time. Suppressed rows carry no value, numerator, denominator, sample or '
  + 'source count. Sentiment shares are aggregate only and never describe an individual customer path. '
  + 'This export is descriptive and does not establish causation.';

function exportMetadata(input: JourneyMetricAnalyticsExportInput, rows: number, suppressed: number) {
  return {
    exportSchema: JOURNEY_METRIC_ANALYTICS_EXPORT_SCHEMA,
    generatedAt: input.generatedAt,
    journeyDefinitionId: input.journeyDefinitionId,
    journeyName: input.journeyName,
    appliedFilters: input.appliedFilters,
    selection: 'materialised_authorised_observations',
    definitionCount: input.definitions.length,
    observationCount: rows,
    suppressedObservationCount: suppressed,
    notice: NOTICE
  };
}

function sentimentShare(sentiment: JourneyMetricSentimentLane | null, key: string) {
  if (!sentiment) return '';
  const row = sentiment.rows.find((entry) => entry.key === key);
  return row?.currentValue === null || row?.currentValue === undefined ? '' : String(row.currentValue);
}

const CSV_COLUMNS = [
  'metricDefinitionId', 'metric', 'targetType', 'targetId', 'target', 'calculatorKind', 'sourceKind',
  'definitionVersionId', 'definitionVersionNumber', 'definitionContentSha256', 'observationId', 'revision',
  'periodStart', 'periodEnd', 'timezone', 'windowSeconds', 'status', 'privacySuppressed', 'privacyReasonCode',
  'privacyMinimumSampleSize', 'value', 'unit', 'numerator', 'denominator', 'sampleSize', 'sourceCount',
  'minimumSampleWarning', 'freshnessStatus', 'latestObservedAt', 'asOf', 'calculatedAt',
  'sentimentNegativePercent', 'sentimentNeutralPercent', 'sentimentPositivePercent', 'sentimentUnknownPercent',
  'formula'
] as const;

function csvRow(observation: JourneyMetricAnalyticsExportObservation,
  definition: JourneyMetricAnalyticsExportDefinition | undefined) {
  const suppressed = observation.privacy.suppressed;
  const blank = (value: number | null) => (suppressed || value === null ? '' : String(value));
  return [
    observation.definitionId, definition?.name ?? '', definition?.targetType ?? '', definition?.targetId ?? '',
    definition?.targetName ?? '', definition?.calculatorKind ?? '', definition?.sourceKind ?? '',
    observation.definitionVersionId, definition?.versionNumber ?? '', definition?.contentSha256 ?? '',
    observation.id, observation.revision, observation.period.start ?? '', observation.period.end ?? '',
    observation.period.timezone, definition?.windowSeconds ?? '', observation.status,
    suppressed ? 'true' : 'false', observation.privacy.reasonCode ?? '', observation.privacy.minimumSampleSize,
    blank(observation.value), observation.unit, blank(observation.numerator), blank(observation.denominator),
    blank(observation.sampleSize), blank(observation.sourceCount),
    observation.minimumSampleWarning ? 'true' : 'false', observation.freshnessStatus,
    observation.latestObservedAt ?? '', observation.asOf ?? '', observation.calculatedAt ?? '',
    ...SENTIMENT_KEYS.map((key) => sentimentShare(observation.sentiment, key)),
    typeof observation.result.formula === 'string' ? observation.result.formula : ''
  ];
}

function buildCsv(input: JourneyMetricAnalyticsExportInput, suppressed: number) {
  const definitions = new Map(input.definitions.map((definition) => [definition.id, definition]));
  const metadata = JSON.stringify(exportMetadata(input, input.observations.length, suppressed))
    .replace(/[\r\n]/gu, ' ');
  const rows = input.observations.map((observation) =>
    csvRow(observation, definitions.get(observation.definitionId)).map(formulaSafeCsvCell).join(','));
  const header = CSV_COLUMNS.map(formulaSafeCsvCell).join(',');
  return Buffer.from(`# ${metadata}\r\n${header}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`, 'utf8');
}

function buildJson(input: JourneyMetricAnalyticsExportInput, suppressed: number) {
  return Buffer.from(`${JSON.stringify({
    metadata: exportMetadata(input, input.observations.length, suppressed),
    definitions: input.definitions,
    observations: input.observations
  }, null, 2)}\n`, 'utf8');
}

export function journeyMetricAnalyticsExportFilename(journeyDefinitionId: string,
  format: JourneyMetricAnalyticsExportFormat) {
  const id = journeyDefinitionId.replace(/[^a-zA-Z0-9-]/gu, '').slice(0, 100) || 'journey';
  return `journey-metric-analytics-${id}.${format}`;
}

export function buildJourneyMetricAnalyticsExport(input: JourneyMetricAnalyticsExportInput) {
  const suppressed = input.observations.filter((observation) => observation.privacy.suppressed).length;
  const bytes = input.format === 'csv' ? buildCsv(input, suppressed) : buildJson(input, suppressed);
  return {
    filename: journeyMetricAnalyticsExportFilename(input.journeyDefinitionId, input.format),
    mimeType: input.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    bytes,
    suppressedObservationCount: suppressed
  };
}
