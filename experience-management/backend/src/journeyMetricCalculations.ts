export const JOURNEY_METRIC_CALCULATION_VERSION = 'journey-metric-calculation/v1' as const;

export type JourneyMetricType = 'nps' | 'csat' | 'ces';
export type JourneyMetricDirection = 'higher_is_better' | 'lower_is_better';
export type JourneyMetricFavourableOperator = 'gte' | 'lte';

export interface JourneyMetricScale {
  minimum: number;
  maximum: number;
  step: number;
}

export interface JourneyMetricFavourableRule {
  operator: JourneyMetricFavourableOperator;
  threshold: number;
}

export interface JourneyNpsFormula {
  kind: 'net_promoter_score';
  detractorMaximum: number;
  promoterMinimum: number;
}

export interface JourneyRatingFormula {
  kind: 'mean' | 'favourable_percentage';
}

interface JourneyMetricDefinitionBase {
  metricId: string;
  metricDefinitionVersion: string;
  label: string;
  scale: JourneyMetricScale;
  sourceRefs: string[];
  minimumSampleSize: number;
  freshnessMaxAgeSeconds: number;
  decimalPlaces: number;
}

export interface JourneyNpsMetricDefinition extends JourneyMetricDefinitionBase {
  metricType: 'nps';
  direction: 'higher_is_better';
  formula: JourneyNpsFormula;
}

export interface JourneyRatingMetricDefinition extends JourneyMetricDefinitionBase {
  metricType: 'csat' | 'ces';
  direction: JourneyMetricDirection;
  formula: JourneyRatingFormula;
  favourable: JourneyMetricFavourableRule;
}

export type JourneyMetricDefinition = JourneyNpsMetricDefinition | JourneyRatingMetricDefinition;

export interface JourneyMetricPeriod {
  start: string;
  end: string;
  timezone: string;
}

export interface JourneyMetricSample {
  sampleId: string;
  revision?: number;
  sourceRef: string;
  value: unknown;
  occurredAt: string;
  invalidReason?: string | null;
}

export interface JourneyMetricCalculationRequest {
  definition: JourneyMetricDefinition;
  period: JourneyMetricPeriod;
  asOf: string;
  samples: JourneyMetricSample[];
}

export type JourneyMetricInvalidReason =
  | 'SOURCE_MARKED_INVALID'
  | 'MISSING_SAMPLE_ID'
  | 'MISSING_SOURCE_REF'
  | 'INVALID_REVISION'
  | 'INVALID_OCCURRED_AT'
  | 'OCCURRED_AFTER_AS_OF'
  | 'NON_NUMERIC_VALUE'
  | 'VALUE_OUTSIDE_SCALE'
  | 'VALUE_OFF_SCALE_STEP'
  | 'CONFLICTING_DUPLICATE_REVISION';

export interface JourneyMetricInvalidExclusion {
  sampleId: string;
  reason: JourneyMetricInvalidReason;
  detail: string;
}

export interface JourneyMetricDuplicateExclusion {
  sampleId: string;
  excludedRevision: number;
  keptRevision: number;
}

export interface JourneyMetricCalculationResult {
  metricId: string;
  metricType: JourneyMetricType;
  metricDefinitionVersion: string;
  calculationVersion: typeof JOURNEY_METRIC_CALCULATION_VERSION;
  value: number | null;
  unit: 'nps_score' | 'scale_points' | 'percent';
  numerator: number | null;
  denominator: number;
  sampleSize: number;
  period: JourneyMetricPeriod;
  sourceRefs: string[];
  freshness: {
    status: 'fresh' | 'stale' | 'unavailable';
    asOf: string;
    latestObservedAt: string | null;
    ageSeconds: number | null;
    maximumAgeSeconds: number;
  };
  exclusions: {
    invalid: {
      count: number;
      records: JourneyMetricInvalidExclusion[];
    };
    duplicate: {
      count: number;
      records: JourneyMetricDuplicateExclusion[];
    };
    outsidePeriod: {
      count: number;
      sampleIds: string[];
    };
  };
  minimumSampleWarning: {
    active: boolean;
    minimumSampleSize: number;
    actualSampleSize: number;
    message: string | null;
  };
  configuration: {
    scale: JourneyMetricScale;
    direction: JourneyMetricDirection;
    formula: JourneyNpsFormula | JourneyRatingFormula;
    favourable: JourneyMetricFavourableRule | null;
    decimalPlaces: number;
  };
  breakdown: Record<string, number>;
  explanation: string;
}

export class JourneyMetricConfigurationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'JourneyMetricConfigurationError';
  }
}

interface ValidSample {
  sampleId: string;
  revision: number;
  sourceRef: string;
  value: number;
  occurredAt: string;
  occurredAtMs: number;
}

interface CalculatedMetricValue {
  value: number | null;
  numerator: number | null;
  denominator: number;
  unit: JourneyMetricCalculationResult['unit'];
  breakdown: Record<string, number>;
  explanation: string;
}

function configurationError(code: string, message: string): never {
  throw new JourneyMetricConfigurationError(code, message);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function parseInstant(value: string): number | null {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireText(value: string, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    configurationError('METRIC_DEFINITION_INVALID', `${field} must be a non-empty string.`);
  }
}

function validateDefinition(definition: JourneyMetricDefinition) {
  requireText(definition.metricId, 'metricId');
  requireText(definition.metricDefinitionVersion, 'metricDefinitionVersion');
  requireText(definition.label, 'label');
  if (!Array.isArray(definition.sourceRefs) || !definition.sourceRefs.length
    || definition.sourceRefs.some((sourceRef) => typeof sourceRef !== 'string' || !sourceRef.trim())) {
    configurationError('METRIC_SOURCE_REQUIRED', 'At least one non-empty definition source reference is required.');
  }
  const { minimum, maximum, step } = definition.scale;
  if (![minimum, maximum, step].every(Number.isFinite) || minimum >= maximum || step <= 0) {
    configurationError('METRIC_SCALE_INVALID', 'Scale minimum, maximum, and positive step must be finite and minimum must be below maximum.');
  }
  if (!Number.isInteger(definition.minimumSampleSize) || definition.minimumSampleSize < 1) {
    configurationError('METRIC_MINIMUM_SAMPLE_INVALID', 'minimumSampleSize must be a positive integer.');
  }
  if (!Number.isInteger(definition.freshnessMaxAgeSeconds) || definition.freshnessMaxAgeSeconds < 1) {
    configurationError('METRIC_FRESHNESS_INVALID', 'freshnessMaxAgeSeconds must be a positive integer.');
  }
  if (!Number.isInteger(definition.decimalPlaces) || definition.decimalPlaces < 0 || definition.decimalPlaces > 6) {
    configurationError('METRIC_PRECISION_INVALID', 'decimalPlaces must be an integer between 0 and 6.');
  }
  if (definition.metricType === 'nps') {
    if (definition.direction !== 'higher_is_better'
      || minimum !== 0 || maximum !== 10 || step !== 1
      || definition.formula.kind !== 'net_promoter_score'
      || definition.formula.detractorMaximum !== 6
      || definition.formula.promoterMinimum !== 9) {
      configurationError('NPS_DEFINITION_INVALID', 'NPS v1 requires the explicit standard 0-10 scale, 0-6 detractors, 9-10 promoters, and higher-is-better direction.');
    }
    return;
  }
  if (!['mean', 'favourable_percentage'].includes(definition.formula.kind)) {
    configurationError('RATING_FORMULA_INVALID', 'CSAT/CES formula must be mean or favourable_percentage.');
  }
  const { operator, threshold } = definition.favourable;
  if (!Number.isFinite(threshold) || threshold < minimum || threshold > maximum) {
    configurationError('FAVOURABLE_THRESHOLD_INVALID', 'The favourable threshold must fall within the configured scale.');
  }
  if ((definition.direction === 'higher_is_better' && operator !== 'gte')
    || (definition.direction === 'lower_is_better' && operator !== 'lte')) {
    configurationError('FAVOURABLE_DIRECTION_MISMATCH', 'The favourable operator must agree with the configured metric direction.');
  }
}

function validatePeriod(period: JourneyMetricPeriod, asOf: string) {
  const startMs = parseInstant(period.start);
  const endMs = parseInstant(period.end);
  const asOfMs = parseInstant(asOf);
  if (startMs === null || endMs === null || startMs >= endMs) {
    configurationError('METRIC_PERIOD_INVALID', 'Period start and end must be valid instants and start must be before end.');
  }
  if (asOfMs === null) configurationError('METRIC_AS_OF_INVALID', 'asOf must be a valid instant.');
  requireText(period.timezone, 'period.timezone');
  return { startMs, endMs, asOfMs };
}

function isOnScale(value: number, scale: JourneyMetricScale) {
  const position = (value - scale.minimum) / scale.step;
  return Math.abs(position - Math.round(position)) < 1e-9;
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function comparableFingerprint(sample: ValidSample) {
  return `${sample.revision}\u0000${sample.sourceRef}\u0000${sample.value}\u0000${sample.occurredAt}`;
}

function prepareSamples(
  definition: JourneyMetricDefinition,
  samples: JourneyMetricSample[],
  periodBounds: { startMs: number; endMs: number; asOfMs: number }
) {
  const invalid: JourneyMetricInvalidExclusion[] = [];
  const outsidePeriod: string[] = [];
  const candidates: ValidSample[] = [];
  const invalidate = (sampleId: string, reason: JourneyMetricInvalidReason, detail: string) => {
    invalid.push({ sampleId, reason, detail });
  };
  for (const sample of samples) {
    const sampleId = typeof sample.sampleId === 'string' ? sample.sampleId.trim() : '';
    const displayId = sampleId || '(missing)';
    if (!sampleId) {
      invalidate(displayId, 'MISSING_SAMPLE_ID', 'A stable sample identifier is required for deduplication.');
      continue;
    }
    if (typeof sample.sourceRef !== 'string' || !sample.sourceRef.trim()) {
      invalidate(displayId, 'MISSING_SOURCE_REF', 'A canonical source reference is required for lineage.');
      continue;
    }
    const revision = sample.revision ?? 1;
    if (!Number.isInteger(revision) || revision < 1) {
      invalidate(displayId, 'INVALID_REVISION', 'Revision must be a positive integer.');
      continue;
    }
    const occurredAtMs = parseInstant(sample.occurredAt);
    if (occurredAtMs === null) {
      invalidate(displayId, 'INVALID_OCCURRED_AT', 'occurredAt must be a valid instant.');
      continue;
    }
    if (occurredAtMs > periodBounds.asOfMs) {
      invalidate(displayId, 'OCCURRED_AFTER_AS_OF', 'Future observations are not included in an as-of calculation.');
      continue;
    }
    if (sample.invalidReason && sample.invalidReason.trim()) {
      invalidate(displayId, 'SOURCE_MARKED_INVALID', sample.invalidReason.trim());
      continue;
    }
    if (occurredAtMs < periodBounds.startMs || occurredAtMs >= periodBounds.endMs) {
      outsidePeriod.push(displayId);
      continue;
    }
    const value = finiteNumber(sample.value);
    if (value === null) {
      invalidate(displayId, 'NON_NUMERIC_VALUE', 'Metric values must be finite JSON numbers; numeric strings are not coerced.');
      continue;
    }
    if (value < definition.scale.minimum || value > definition.scale.maximum) {
      invalidate(displayId, 'VALUE_OUTSIDE_SCALE', `Value ${value} is outside ${definition.scale.minimum}-${definition.scale.maximum}.`);
      continue;
    }
    if (!isOnScale(value, definition.scale)) {
      invalidate(displayId, 'VALUE_OFF_SCALE_STEP', `Value ${value} does not align to scale step ${definition.scale.step}.`);
      continue;
    }
    candidates.push({ sampleId, revision, sourceRef: sample.sourceRef.trim(), value, occurredAt: sample.occurredAt, occurredAtMs });
  }

  const byId = new Map<string, ValidSample[]>();
  for (const candidate of candidates) {
    const group = byId.get(candidate.sampleId) || [];
    group.push(candidate);
    byId.set(candidate.sampleId, group);
  }
  const accepted: ValidSample[] = [];
  const duplicate: JourneyMetricDuplicateExclusion[] = [];
  for (const [sampleId, group] of [...byId.entries()].sort(([left], [right]) => compareText(left, right))) {
    const keptRevision = Math.max(...group.map((sample) => sample.revision));
    const latest = group.filter((sample) => sample.revision === keptRevision)
      .sort((left, right) => compareText(comparableFingerprint(left), comparableFingerprint(right)));
    const fingerprint = comparableFingerprint(latest[0]);
    if (latest.some((sample) => comparableFingerprint(sample) !== fingerprint)) {
      for (const sample of latest) {
        invalidate(sampleId, 'CONFLICTING_DUPLICATE_REVISION', `Revision ${keptRevision} has conflicting values or lineage.`);
      }
      for (const sample of group.filter((item) => item.revision < keptRevision)) {
        duplicate.push({ sampleId, excludedRevision: sample.revision, keptRevision });
      }
      continue;
    }
    accepted.push(latest[0]);
    for (const sample of group) {
      if (sample !== latest[0]) duplicate.push({ sampleId, excludedRevision: sample.revision, keptRevision });
    }
  }
  accepted.sort((left, right) => compareText(left.sampleId, right.sampleId));
  invalid.sort((left, right) => compareText(left.sampleId, right.sampleId) || compareText(left.reason, right.reason));
  duplicate.sort((left, right) => compareText(left.sampleId, right.sampleId) || left.excludedRevision - right.excludedRevision);
  outsidePeriod.sort(compareText);
  return { accepted, invalid, duplicate, outsidePeriod };
}

function favourableText(rule: JourneyMetricFavourableRule) {
  return `${rule.operator === 'gte' ? '>=' : '<='} ${rule.threshold}`;
}

function calculateValue(definition: JourneyMetricDefinition, accepted: ValidSample[]): CalculatedMetricValue {
  const denominator = accepted.length;
  if (definition.metricType === 'nps') {
    const promoters = accepted.filter((sample) => sample.value >= definition.formula.promoterMinimum).length;
    const detractors = accepted.filter((sample) => sample.value <= definition.formula.detractorMaximum).length;
    const passives = denominator - promoters - detractors;
    const numerator = promoters - detractors;
    const value = denominator ? round((numerator / denominator) * 100, definition.decimalPlaces) : null;
    const explanation = denominator
      ? `NPS = ((${promoters} promoters [${definition.formula.promoterMinimum}-${definition.scale.maximum}] - ${detractors} detractors [${definition.scale.minimum}-${definition.formula.detractorMaximum}]) / ${denominator} valid responses) x 100 = ${value}. Scores between the two bands are passive. Higher is better.`
      : `NPS is unavailable because no valid responses fall in the period. The configured bands are ${definition.formula.promoterMinimum}-${definition.scale.maximum} promoters and ${definition.scale.minimum}-${definition.formula.detractorMaximum} detractors.`;
    return { value, numerator: denominator ? numerator : null, denominator, unit: 'nps_score' as const, breakdown: { promoters, passives, detractors }, explanation };
  }
  const favourable = accepted.filter((sample) => definition.favourable.operator === 'gte'
    ? sample.value >= definition.favourable.threshold
    : sample.value <= definition.favourable.threshold).length;
  if (definition.formula.kind === 'favourable_percentage') {
    const value = denominator ? round((favourable / denominator) * 100, definition.decimalPlaces) : null;
    const explanation = denominator
      ? `${definition.metricType.toUpperCase()} favourable percentage = (${favourable} responses matching ${favourableText(definition.favourable)} / ${denominator} valid responses) x 100 = ${value}%. ${definition.direction === 'higher_is_better' ? 'Higher' : 'Lower'} is better.`
      : `${definition.metricType.toUpperCase()} favourable percentage is unavailable because no valid responses fall in the period. Favourable is configured as ${favourableText(definition.favourable)}.`;
    return { value, numerator: denominator ? favourable : null, denominator, unit: 'percent' as const, breakdown: { favourable, unfavourable: denominator - favourable }, explanation };
  }
  const sum = accepted.reduce((total, sample) => total + sample.value, 0);
  const value = denominator ? round(sum / denominator, definition.decimalPlaces) : null;
  const explanation = denominator
    ? `${definition.metricType.toUpperCase()} mean = ${round(sum, definition.decimalPlaces)} / ${denominator} valid responses = ${value} on the ${definition.scale.minimum}-${definition.scale.maximum} scale. Favourable is ${favourableText(definition.favourable)}. ${definition.direction === 'higher_is_better' ? 'Higher' : 'Lower'} is better.`
    : `${definition.metricType.toUpperCase()} mean is unavailable because no valid responses fall in the period. The configured scale is ${definition.scale.minimum}-${definition.scale.maximum} and favourable is ${favourableText(definition.favourable)}.`;
  return { value, numerator: denominator ? round(sum, definition.decimalPlaces) : null, denominator, unit: 'scale_points' as const, breakdown: { favourable, unfavourable: denominator - favourable }, explanation };
}

export function calculateJourneyMetric(request: JourneyMetricCalculationRequest): JourneyMetricCalculationResult {
  validateDefinition(request.definition);
  if (!Array.isArray(request.samples)) configurationError('METRIC_SAMPLES_INVALID', 'samples must be an array.');
  const periodBounds = validatePeriod(request.period, request.asOf);
  const prepared = prepareSamples(request.definition, request.samples, periodBounds);
  const calculated = calculateValue(request.definition, prepared.accepted);
  const latest = prepared.accepted.reduce<ValidSample | null>((current, sample) =>
    !current || sample.occurredAtMs > current.occurredAtMs ? sample : current, null);
  const ageSeconds = latest ? Math.floor((periodBounds.asOfMs - latest.occurredAtMs) / 1000) : null;
  const freshnessStatus = ageSeconds === null ? 'unavailable' as const
    : ageSeconds <= request.definition.freshnessMaxAgeSeconds ? 'fresh' as const : 'stale' as const;
  const minimumSampleActive = calculated.denominator < request.definition.minimumSampleSize;
  const sourceRefs = [...new Set([
    ...request.definition.sourceRefs.map((sourceRef) => sourceRef.trim()),
    ...prepared.accepted.map((sample) => sample.sourceRef)
  ])].sort(compareText);
  return {
    metricId: request.definition.metricId,
    metricType: request.definition.metricType,
    metricDefinitionVersion: request.definition.metricDefinitionVersion,
    calculationVersion: JOURNEY_METRIC_CALCULATION_VERSION,
    value: calculated.value,
    unit: calculated.unit,
    numerator: calculated.numerator,
    denominator: calculated.denominator,
    sampleSize: calculated.denominator,
    period: { ...request.period },
    sourceRefs,
    freshness: {
      status: freshnessStatus,
      asOf: request.asOf,
      latestObservedAt: latest?.occurredAt || null,
      ageSeconds,
      maximumAgeSeconds: request.definition.freshnessMaxAgeSeconds
    },
    exclusions: {
      invalid: { count: prepared.invalid.length, records: prepared.invalid },
      duplicate: { count: prepared.duplicate.length, records: prepared.duplicate },
      outsidePeriod: { count: prepared.outsidePeriod.length, sampleIds: prepared.outsidePeriod }
    },
    minimumSampleWarning: {
      active: minimumSampleActive,
      minimumSampleSize: request.definition.minimumSampleSize,
      actualSampleSize: calculated.denominator,
      message: minimumSampleActive
        ? `Only ${calculated.denominator} valid responses are available; at least ${request.definition.minimumSampleSize} are required.`
        : null
    },
    configuration: {
      scale: { ...request.definition.scale },
      direction: request.definition.direction,
      formula: { ...request.definition.formula },
      favourable: request.definition.metricType === 'nps' ? null : { ...request.definition.favourable },
      decimalPlaces: request.definition.decimalPlaces
    },
    breakdown: calculated.breakdown,
    explanation: calculated.explanation
  };
}
