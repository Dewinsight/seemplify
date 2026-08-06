/** Fail-closed privacy boundary for governed journey metric observations.
 *
 * Observations are append-only (0021 trigger), so a suppression flag can never
 * be backfilled onto historic rows. The decision is therefore recomputed at
 * every projection from the immutable definition version, and the stored
 * result flag is honoured as an additional suppressing signal only. Nothing in
 * this module widens disclosure: a caller can only ever lose detail here.
 *
 * The prohibition in the plan ("percentages without denominators") means a
 * partial redaction is not an option. A suppressed observation loses the value,
 * numerator, denominator, sample, source count, per-record lineage and every
 * derived count, and keeps only audit-legitimate source/window/definition
 * metadata plus the warning state itself.
 */

export const JOURNEY_METRIC_PRIVACY_VERSION = 1;

export type JourneyMetricPrivacyReason =
  | 'PRIVACY_SUPPRESSED_SOURCE'
  | 'SMALL_SAMPLE_SUPPRESSED'
  | 'DEFINITION_VERSION_UNAVAILABLE';

export type JourneyMetricPrivacyDecision = {
  suppressed: boolean;
  reasonCode: JourneyMetricPrivacyReason | null;
  minimumSampleSize: number;
  privacyVersion: typeof JOURNEY_METRIC_PRIVACY_VERSION;
};

type PrivacyVersionRow = {
  minimum_sample_size?: number | string | null;
  population_json?: unknown;
  filters_json?: unknown;
} | null | undefined;

type PrivacyObservationRow = {
  sample_size?: number | string | null;
  minimum_sample_warning?: number | boolean | null;
  result_json?: unknown;
} | null | undefined;

function parse<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return JSON.parse(String(value ?? '')) as T; } catch { return fallback; }
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The three spellings that governed operational imports have used for the
 * externally asserted suppression flag. Kept in one place so the alert
 * evaluator and the read projections can never drift apart. */
export function journeyMetricPrivacyFlagged(resultJson: unknown) {
  const result = parse<Record<string, unknown>>(resultJson, {});
  if (result.privacySuppressed === true || result.privacy_suppressed === true) return true;
  const privacy = result.privacy;
  return Boolean(privacy && typeof privacy === 'object'
    && (privacy as Record<string, unknown>).suppressed === true);
}

/** A statistical minimum (warn, keep the value) and a privacy floor (suppress)
 * are different controls. No migration is available inside the pinned runtime
 * schema window, so the floor is read from the already version-pinned and
 * content-hashed population/filters documents and can only ever raise the
 * configured minimum sample size, never lower it. */
export function journeyMetricPrivacyMinimumSampleSize(version: PrivacyVersionRow) {
  const configured = positiveInteger(version?.minimum_sample_size) ?? 0;
  const documents = [parse<Record<string, unknown>>(version?.population_json, {}),
    parse<Record<string, unknown>>(version?.filters_json, {})];
  const floors = documents
    .map((document) => positiveInteger(document.privacyMinimumSampleSize))
    .filter((value): value is number => value !== null);
  return Math.max(configured, ...floors, 0);
}

export function journeyMetricPrivacyDecision(observation: PrivacyObservationRow,
  version: PrivacyVersionRow): JourneyMetricPrivacyDecision {
  const minimumSampleSize = journeyMetricPrivacyMinimumSampleSize(version);
  const base = { privacyVersion: JOURNEY_METRIC_PRIVACY_VERSION, minimumSampleSize } as const;
  // An observation whose immutable definition version cannot be resolved has no
  // trustworthy threshold, so it is suppressed rather than published.
  if (!version) return { ...base, suppressed: true, reasonCode: 'DEFINITION_VERSION_UNAVAILABLE' };
  // Sample size is evaluated first so the reported reason names the actual
  // cause. The stored flag is also stamped by the rebuild worker for locally
  // suppressed rows, and would otherwise mask the more specific reason; it
  // stays as the catch-all for externally asserted suppression.
  const sampleSize = Number(observation?.sample_size ?? 0);
  const belowFloor = !Number.isFinite(sampleSize) || sampleSize < minimumSampleSize;
  if (belowFloor || Boolean(Number(observation?.minimum_sample_warning ?? 0))) {
    return { ...base, suppressed: true, reasonCode: 'SMALL_SAMPLE_SUPPRESSED' };
  }
  if (journeyMetricPrivacyFlagged(observation?.result_json)) {
    return { ...base, suppressed: true, reasonCode: 'PRIVACY_SUPPRESSED_SOURCE' };
  }
  return { ...base, suppressed: false, reasonCode: null };
}

const SURVEY_DEFINITION_KEYS = ['calculationVersion', 'metricId', 'metricType', 'metricDefinitionVersion',
  'period', 'sourceRefs', 'configuration'] as const;
const OPERATIONAL_DEFINITION_KEYS = ['calculationVersion', 'measureId', 'definitionVersion', 'kind',
  'sourceLineages', 'period', 'comparisonPeriod', 'interpretation'] as const;

/** Freshness carries no counts, so it survives suppression intact and keeps the
 * export audit-usable. `ageSeconds`/`maximumAgeSeconds` describe the window,
 * not the population. */
function safeFreshness(result: Record<string, unknown>) {
  const freshness = parse<Record<string, unknown>>(result.freshness, {});
  if (!Object.keys(freshness).length) return undefined;
  return { status: freshness.status ?? null, asOf: freshness.asOf ?? null,
    latestObservedAt: freshness.latestObservedAt ?? null, ageSeconds: freshness.ageSeconds ?? null,
    maximumAgeSeconds: freshness.maximumAgeSeconds ?? null };
}

/** The stored warning object carries `actualSampleSize` and an English message
 * that restates the sample ("Only 4 supporting subjects are available"). Both
 * are dropped; the warning state itself is legitimate and is preserved. */
function safeMinimumSampleWarning(result: Record<string, unknown>) {
  const warning = parse<Record<string, unknown>>(result.minimumSampleWarning, {});
  if (!Object.keys(warning).length) return undefined;
  return { active: Boolean(warning.active), minimumSampleSize: warning.minimumSampleSize ?? null };
}

/** Replaces the raw calculator result. The stored blob is capped at 1 MiB and
 * contains survey response IDs (`exclusions.invalid.records[].sampleId`,
 * `exclusions.outsidePeriod.sampleIds`), promoter/passive/detractor counts and
 * an `explanation` string that restates numerator and denominator in prose.
 * None of those may cross the projection boundary, suppressed or not. */
export function journeyMetricSafeResult(resultJson: unknown, decision: JourneyMetricPrivacyDecision) {
  const result = parse<Record<string, unknown>>(resultJson, {});
  if (!Object.keys(result).length) return {};
  const safe: Record<string, unknown> = {};
  const keys = result.kind === undefined ? SURVEY_DEFINITION_KEYS : OPERATIONAL_DEFINITION_KEYS;
  for (const key of keys) if (result[key] !== undefined) safe[key] = result[key];
  if (result.asOf !== undefined) safe.asOf = result.asOf;
  if (typeof result.formula === 'string') safe.formula = result.formula;
  const freshness = safeFreshness(result); if (freshness) safe.freshness = freshness;
  const warning = safeMinimumSampleWarning(result); if (warning) safe.minimumSampleWarning = warning;
  // A source-state warning explains why a metric is unavailable and never
  // restates a sample, so it survives. `explanation` never does.
  if (typeof result.warning === 'string') safe.warning = result.warning;
  if (typeof result.sourceState === 'string') safe.sourceState = result.sourceState;
  safe.privacy = { suppressed: decision.suppressed, reasonCode: decision.reasonCode,
    minimumSampleSize: decision.minimumSampleSize, privacyVersion: decision.privacyVersion };
  if (decision.suppressed) return safe;
  // Exclusion counts and breakdowns are only released alongside a published
  // denominator; on their own they would reconstruct one.
  if (result.breakdown && typeof result.breakdown === 'object') safe.breakdown = result.breakdown;
  if (Array.isArray(result.exclusions)) safe.exclusions = result.exclusions;
  else if (result.exclusions && typeof result.exclusions === 'object') {
    const exclusions = result.exclusions as Record<string, unknown>;
    safe.exclusions = Object.fromEntries(Object.keys(exclusions).sort().map((key) => [key,
      { count: Number(parse<Record<string, unknown>>(exclusions[key], {}).count ?? 0) }]));
  }
  if (result.durationDistribution && typeof result.durationDistribution === 'object') {
    safe.durationDistribution = result.durationDistribution;
  }
  return safe;
}

export type JourneyMetricSentimentRow = {
  key: string; label: string; currentValue: number | null; currentUnit: string;
  previousValue: number | null; changeValue: number | null; changeUnit: string | null;
};
export type JourneyMetricSentimentLane = {
  kind: 'sentiment_distribution' | 'sentiment_trend';
  rows: JourneyMetricSentimentRow[];
  period: unknown; comparisonPeriod: unknown; formula: string | null;
  subjectType: 'social_post'; aggregateOnly: true;
};

const SENTIMENT_KINDS = new Set(['sentiment_distribution', 'sentiment_trend']);

/** The emotional lane cannot read `observation.value`: for `sentiment_trend`
 * the stored scalar is `rows[0].current` — the *negative* share, because
 * SENTIMENTS is ordered ['negative','neutral','positive','unknown'] — persisted
 * as a bare percent with no label. The lane therefore reads the labelled rows,
 * and only ever aggregate shares: individual social posts are never projected
 * as records, so a social observation can never be read as a customer path. */
export function journeyMetricSentimentLane(resultJson: unknown,
  decision: JourneyMetricPrivacyDecision): JourneyMetricSentimentLane | null {
  if (decision.suppressed) return null;
  const result = parse<Record<string, unknown>>(resultJson, {});
  const kind = String(result.kind || '');
  if (!SENTIMENT_KINDS.has(kind) || !Array.isArray(result.rows)) return null;
  const rows = result.rows.map((entry) => {
    const row = parse<Record<string, unknown>>(entry, {});
    const current = parse<Record<string, unknown>>(row.current, {});
    const previous = parse<Record<string, unknown>>(row.previous, {});
    const change = parse<Record<string, unknown>>(row.change, {});
    const numeric = (value: unknown) => (value === null || value === undefined || !Number.isFinite(Number(value))
      ? null : Number(value));
    return { key: String(row.key || ''), label: String(row.label || ''),
      currentValue: numeric(current.value), currentUnit: String(current.unit || 'percent'),
      previousValue: numeric(previous.value), changeValue: numeric(change.value),
      changeUnit: change.unit === undefined ? null : String(change.unit) };
  }).filter((row) => row.key.length > 0);
  if (!rows.length) return null;
  return { kind: kind as JourneyMetricSentimentLane['kind'], rows, period: result.period ?? null,
    comparisonPeriod: result.comparisonPeriod ?? null,
    formula: typeof result.formula === 'string' ? result.formula : null,
    subjectType: 'social_post', aggregateOnly: true };
}

export type JourneyMetricLineageRow = {
  sourceType: string; sourceRecordId: string | null; sourceRevisionSha256: string | null;
  occurredAt: string | null; included: boolean | null; exclusionCode: string | null;
};

/** Lineage cardinality is itself a denominator: returning one row per included
 * source lets a caller recount a suppressed sample exactly. Suppressed lineage
 * therefore collapses to the distinct source *types*, which keeps the audit
 * question "where did this come from" answerable without disclosing how many. */
export function journeyMetricSafeLineage(rows: readonly JourneyMetricLineageRow[],
  decision: JourneyMetricPrivacyDecision): JourneyMetricLineageRow[] {
  if (!decision.suppressed) return [...rows];
  return [...new Set(rows.map((row) => row.sourceType))].sort().map((sourceType) => ({
    sourceType, sourceRecordId: null, sourceRevisionSha256: null, occurredAt: null,
    included: null, exclusionCode: null
  }));
}
