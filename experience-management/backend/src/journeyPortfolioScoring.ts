export type JourneyScoreMethod = 'rice' | 'ice' | 'weighted';

export type JourneyScoreField = 'reach' | 'impact' | 'confidence' | 'effort' | 'ease';

export type JourneyWeightedScoreDimension = {
  /** Stable organisation-defined identity, for example `strategic_alignment`. */
  key: string;
  label: string;
  weight: number;
  minimum: number;
  maximum: number;
  direction: 'higher_is_better' | 'lower_is_better';
};

export type JourneyScoreInput = {
  reach?: number | null;
  impact?: number | null;
  /** Confidence is always a fraction from 0 to 1, never an ambiguous percentage. */
  confidence?: number | null;
  effort?: number | null;
  ease?: number | null;
  /** Values are interpreted only by the exact weighted policy version. */
  dimensions?: Record<string, number | null | undefined>;
};

export type JourneyScoreResult = {
  method: JourneyScoreMethod;
  formulaVersion: 'rice.v1' | 'ice.v1' | 'weighted.v1';
  status: 'calculated' | 'incomplete';
  value: number | null;
  missing: string[];
  inputs: Partial<Record<string, number>>;
  formula: string;
  explanation: string;
};

export class JourneyPortfolioScoreError extends Error {
  constructor(
    message: string,
    public code: 'JOURNEY_SCORE_NOT_FINITE' | 'JOURNEY_SCORE_OUT_OF_RANGE',
    public field: string
  ) {
    super(message);
    this.name = 'JourneyPortfolioScoreError';
  }
}

const requiredFields: Record<Exclude<JourneyScoreMethod, 'weighted'>, JourneyScoreField[]> = {
  rice: ['reach', 'impact', 'confidence', 'effort'],
  ice: ['impact', 'confidence', 'ease']
};

const DIMENSION_KEY = /^[a-z][a-z0-9_]{0,63}$/u;

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
}

function read(input: JourneyScoreInput, field: JourneyScoreField): number | undefined {
  const value = input[field];
  if (value === null || value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new JourneyPortfolioScoreError(`${field} must be a finite number.`, 'JOURNEY_SCORE_NOT_FINITE', field);
  }
  if (field === 'confidence' && (value < 0 || value > 1)) {
    throw new JourneyPortfolioScoreError('confidence must be a fraction from 0 to 1.', 'JOURNEY_SCORE_OUT_OF_RANGE', field);
  }
  if (field === 'effort' && value <= 0) {
    throw new JourneyPortfolioScoreError('effort must be greater than zero.', 'JOURNEY_SCORE_OUT_OF_RANGE', field);
  }
  if (field !== 'confidence' && field !== 'effort' && value < 0) {
    throw new JourneyPortfolioScoreError(`${field} cannot be negative.`, 'JOURNEY_SCORE_OUT_OF_RANGE', field);
  }
  return value;
}

/**
 * Calculates a transparent portfolio score without assigning priority bands.
 * Bands are organisation policy and must be versioned separately from this
 * arithmetic. Missing values stay incomplete rather than being silently
 * coerced to zero.
 */
export function calculateJourneyPortfolioScore(
  method: JourneyScoreMethod,
  input: JourneyScoreInput,
  weightedDimensions: readonly JourneyWeightedScoreDimension[] = []
): JourneyScoreResult {
  if (method === 'weighted') return calculateWeightedScore(input, weightedDimensions);
  const fields = requiredFields[method];
  const values: Partial<Record<JourneyScoreField, number>> = {};
  const missing: JourneyScoreField[] = [];
  for (const field of fields) {
    const value = read(input, field);
    if (value === undefined) missing.push(field);
    else values[field] = value;
  }

  const formula = method === 'rice'
    ? '(reach × impact × confidence) ÷ effort'
    : 'impact × confidence × ease';
  const formulaVersion = method === 'rice' ? 'rice.v1' : 'ice.v1';

  if (missing.length) {
    return {
      method, formulaVersion, status: 'incomplete', value: null, missing, inputs: values, formula,
      explanation: `Cannot calculate ${method.toUpperCase()}: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`
    };
  }

  const raw = method === 'rice'
    ? (values.reach! * values.impact! * values.confidence!) / values.effort!
    : values.impact! * values.confidence! * values.ease!;
  const value = round(raw);
  const detail = fields.map((field) => `${field} ${values[field]}`).join(', ');

  return {
    method, formulaVersion, status: 'calculated', value, missing: [], inputs: values, formula,
    explanation: `${method.toUpperCase()} ${value} using ${formula}; ${detail}. Confidence is represented as a 0–1 fraction.`
  };
}

/**
 * Normalises each configured dimension to 0â€“100 before applying weights.
 * This makes dimensions with different input ranges comparable and keeps the
 * exact weights/ranges visible in the immutable policy version.
 */
function calculateWeightedScore(
  input: JourneyScoreInput,
  dimensions: readonly JourneyWeightedScoreDimension[]
): JourneyScoreResult {
  if (!dimensions.length) {
    throw new JourneyPortfolioScoreError(
      'A weighted policy requires at least one dimension.',
      'JOURNEY_SCORE_OUT_OF_RANGE',
      'dimensions'
    );
  }
  const seen = new Set<string>();
  let totalWeight = 0;
  for (const dimension of dimensions) {
    if (!DIMENSION_KEY.test(dimension.key) || seen.has(dimension.key)) {
      throw new JourneyPortfolioScoreError(
        'Weighted dimension keys must be unique stable identifiers.',
        'JOURNEY_SCORE_OUT_OF_RANGE',
        dimension.key || 'dimensions'
      );
    }
    seen.add(dimension.key);
    if (!dimension.label.trim() || !Number.isFinite(dimension.weight) || dimension.weight <= 0
      || !Number.isFinite(dimension.minimum) || !Number.isFinite(dimension.maximum)
      || dimension.maximum <= dimension.minimum) {
      throw new JourneyPortfolioScoreError(
        'Weighted dimensions require a label, positive weight, and an ordered finite range.',
        'JOURNEY_SCORE_OUT_OF_RANGE',
        dimension.key
      );
    }
    totalWeight += dimension.weight;
  }
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new JourneyPortfolioScoreError('Weighted policy weights are invalid.', 'JOURNEY_SCORE_OUT_OF_RANGE', 'dimensions');
  }

  const supplied = input.dimensions || {};
  const missing: string[] = [];
  const values: Record<string, number> = {};
  let weightedTotal = 0;
  for (const dimension of dimensions) {
    const raw = supplied[dimension.key];
    if (raw === null || raw === undefined) {
      missing.push(dimension.key);
      continue;
    }
    if (!Number.isFinite(raw)) {
      throw new JourneyPortfolioScoreError(
        `${dimension.label} must be a finite number.`, 'JOURNEY_SCORE_NOT_FINITE', dimension.key
      );
    }
    if (raw < dimension.minimum || raw > dimension.maximum) {
      throw new JourneyPortfolioScoreError(
        `${dimension.label} must be between ${dimension.minimum} and ${dimension.maximum}.`,
        'JOURNEY_SCORE_OUT_OF_RANGE',
        dimension.key
      );
    }
    values[dimension.key] = raw;
    const ascending = (raw - dimension.minimum) / (dimension.maximum - dimension.minimum);
    const normalised = dimension.direction === 'higher_is_better' ? ascending : 1 - ascending;
    weightedTotal += normalised * dimension.weight;
  }

  const formula = 'sum(normalised dimension Ã— weight) Ã· sum(weights) Ã— 100';
  if (missing.length) {
    return {
      method: 'weighted', formulaVersion: 'weighted.v1', status: 'incomplete', value: null,
      missing, inputs: values, formula,
      explanation: `Cannot calculate weighted score: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`
    };
  }
  const value = round((weightedTotal / totalWeight) * 100);
  return {
    method: 'weighted', formulaVersion: 'weighted.v1', status: 'calculated', value,
    missing: [], inputs: values, formula,
    explanation: `Weighted score ${value} out of 100 using ${dimensions.length} versioned ${dimensions.length === 1 ? 'dimension' : 'dimensions'}.`
  };
}
