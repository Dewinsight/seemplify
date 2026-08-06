import crypto from 'node:crypto';

export const journeyStageRuleRoles = ['entry', 'progress', 'success', 'failure', 'exit'] as const;
export type JourneyStageRuleRole = typeof journeyStageRuleRoles[number];
export const journeyStagePredicateOperators = [
  'equals', 'not_equals', 'in', 'exists', 'greater_than', 'at_least', 'less_than', 'at_most'
] as const;
export type JourneyStagePredicateOperator = typeof journeyStagePredicateOperators[number];

export type JourneyRuleScalar = string | number | boolean | null;

export type JourneyStagePredicate = {
  path: string;
  operator: JourneyStagePredicateOperator;
  value?: JourneyRuleScalar | JourneyRuleScalar[];
};

export type JourneyRequiredPriorEvent = {
  eventName: string;
  withinSeconds?: number | null;
};

export type JourneyStageRule = {
  id: string;
  definitionId: string;
  stageKey: string;
  version: number;
  state: 'draft' | 'test' | 'published' | 'retired';
  role: JourneyStageRuleRole;
  priority: number;
  eventName: string;
  sourceIds?: string[];
  environments?: Array<'development' | 'staging' | 'production'>;
  predicates?: JourneyStagePredicate[];
  requiredPriorEvents?: JourneyRequiredPriorEvent[];
  excludedEventNames?: string[];
  effectiveAt?: string | null;
  expiresAt?: string | null;
};

export type JourneyRuleEvent = {
  messageId: string;
  eventName: string;
  timestamp: string;
  subjectId: string;
  sourceId: string;
  environment: 'development' | 'staging' | 'production';
  properties: Record<string, unknown>;
};

export type JourneyStageRuleTrace = {
  ruleId: string;
  ruleVersion: number;
  definitionId: string;
  stageKey: string;
  role: JourneyStageRuleRole;
  matched: boolean;
  assignmentKey: string | null;
  reasons: string[];
  specificity: number;
  priority: number;
};

export type JourneyStageRuleEvaluation = {
  eventMessageId: string;
  matches: JourneyStageRuleTrace[];
  traces: JourneyStageRuleTrace[];
};

export class JourneyStageRuleError extends Error {
  constructor(
    message: string,
    public code:
      | 'JOURNEY_RULE_LIMIT'
      | 'JOURNEY_RULE_INVALID'
      | 'JOURNEY_RULE_UNSAFE_PATH'
  ) {
    super(message);
    this.name = 'JourneyStageRuleError';
  }
}

export const journeyStageRuleLimits = Object.freeze({ rules: 500, predicates: 20, priorEvents: 20, history: 10_000 });

const safePathSegment = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const forbiddenPathSegments = new Set(['__proto__', 'constructor', 'prototype']);

function parsedTime(value: string, field: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new JourneyStageRuleError(`${field} must be an ISO timestamp.`, 'JOURNEY_RULE_INVALID');
  return time;
}

function propertyAt(properties: Record<string, unknown>, path: string) {
  const segments = path.split('.');
  if (segments.length < 1 || segments.length > 4 || segments.some((segment) => !safePathSegment.test(segment)
    || forbiddenPathSegments.has(segment))) {
    throw new JourneyStageRuleError('Rule property paths must use one to four safe identifiers.', 'JOURNEY_RULE_UNSAFE_PATH');
  }
  let value: unknown = properties;
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function isScalar(value: unknown): value is JourneyRuleScalar {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function scalarEquals(left: JourneyRuleScalar, right: JourneyRuleScalar) {
  return typeof left === typeof right && Object.is(left, right);
}

function predicateMatches(properties: Record<string, unknown>, predicate: JourneyStagePredicate) {
  const actual = propertyAt(properties, predicate.path);
  if (predicate.operator === 'exists') return predicate.value === false ? actual === undefined : actual !== undefined;
  if (!isScalar(actual)) return false;
  if (predicate.operator === 'equals') return isScalar(predicate.value) && scalarEquals(actual, predicate.value);
  if (predicate.operator === 'not_equals') return isScalar(predicate.value) && !scalarEquals(actual, predicate.value);
  if (predicate.operator === 'in') {
    return Array.isArray(predicate.value) && predicate.value.some((item) => isScalar(item) && scalarEquals(actual, item));
  }
  if (typeof actual !== 'number' || typeof predicate.value !== 'number'
    || !Number.isFinite(actual) || !Number.isFinite(predicate.value)) return false;
  if (predicate.operator === 'greater_than') return actual > predicate.value;
  if (predicate.operator === 'at_least') return actual >= predicate.value;
  if (predicate.operator === 'less_than') return actual < predicate.value;
  return actual <= predicate.value;
}

function ruleSpecificity(rule: JourneyStageRule) {
  return (rule.predicates?.length || 0) + (rule.requiredPriorEvents?.length || 0)
    + (rule.sourceIds?.length ? 1 : 0) + (rule.environments?.length ? 1 : 0)
    + (rule.excludedEventNames?.length || 0);
}

function assignmentKey(rule: JourneyStageRule, event: JourneyRuleEvent) {
  return crypto.createHash('sha256').update([
    rule.definitionId, rule.id, String(rule.version), rule.stageKey, rule.role, event.messageId
  ].join('\u0000')).digest('hex');
}

function evaluateRule(rule: JourneyStageRule, event: JourneyRuleEvent, history: readonly JourneyRuleEvent[]): JourneyStageRuleTrace {
  const reasons: string[] = [];
  const specificity = ruleSpecificity(rule);
  const trace = (matched: boolean): JourneyStageRuleTrace => ({
    ruleId: rule.id, ruleVersion: rule.version, definitionId: rule.definitionId,
    stageKey: rule.stageKey, role: rule.role, matched,
    assignmentKey: matched ? assignmentKey(rule, event) : null,
    reasons, specificity, priority: rule.priority
  });

  if (rule.state !== 'published') { reasons.push(`rule_${rule.state}`); return trace(false); }
  if (rule.eventName !== event.eventName) { reasons.push('event_name_mismatch'); return trace(false); }
  if (rule.sourceIds?.length && !rule.sourceIds.includes(event.sourceId)) {
    reasons.push('source_mismatch'); return trace(false);
  }
  if (rule.environments?.length && !rule.environments.includes(event.environment)) {
    reasons.push('environment_mismatch'); return trace(false);
  }
  const eventTime = parsedTime(event.timestamp, 'event timestamp');
  if (rule.effectiveAt && eventTime < parsedTime(rule.effectiveAt, 'rule effectiveAt')) {
    reasons.push('before_effective_time'); return trace(false);
  }
  if (rule.expiresAt && eventTime >= parsedTime(rule.expiresAt, 'rule expiresAt')) {
    reasons.push('after_expiry_time'); return trace(false);
  }
  const excludedPrior = history.find((prior) => prior.subjectId === event.subjectId
    && (rule.excludedEventNames || []).includes(prior.eventName)
    && parsedTime(prior.timestamp, 'excluded prior event timestamp') <= eventTime);
  if (excludedPrior) {
    reasons.push(`excluded_prior_event:${excludedPrior.eventName}`); return trace(false);
  }
  for (const predicate of rule.predicates || []) {
    if (!predicateMatches(event.properties, predicate)) {
      reasons.push(`predicate_failed:${predicate.path}:${predicate.operator}`); return trace(false);
    }
    reasons.push(`predicate_matched:${predicate.path}:${predicate.operator}`);
  }
  for (const required of rule.requiredPriorEvents || []) {
    const withinMs = required.withinSeconds === null || required.withinSeconds === undefined
      ? Number.POSITIVE_INFINITY : required.withinSeconds * 1_000;
    if (!Number.isFinite(withinMs) && withinMs !== Number.POSITIVE_INFINITY
      || withinMs < 0 || withinMs > 366 * 24 * 60 * 60 * 1_000) {
      throw new JourneyStageRuleError('Prior-event windows must be between 0 and 366 days.', 'JOURNEY_RULE_INVALID');
    }
    const found = history.some((prior) => prior.subjectId === event.subjectId
      && prior.eventName === required.eventName
      && parsedTime(prior.timestamp, 'prior event timestamp') <= eventTime
      && eventTime - parsedTime(prior.timestamp, 'prior event timestamp') <= withinMs);
    if (!found) { reasons.push(`prior_event_missing:${required.eventName}`); return trace(false); }
    reasons.push(`prior_event_matched:${required.eventName}`);
  }
  reasons.push('rule_matched');
  return trace(true);
}

/**
 * Evaluates published rules deterministically. It can return matches for more
 * than one journey definition; consumers decide instance semantics. Matches
 * are ordered by priority, specificity, definition, stage, role, and rule ID,
 * and each carries a stable assignment key for idempotent persistence.
 */
export function evaluateJourneyStageRules(
  rules: readonly JourneyStageRule[],
  event: JourneyRuleEvent,
  history: readonly JourneyRuleEvent[] = []
): JourneyStageRuleEvaluation {
  if (rules.length > journeyStageRuleLimits.rules || history.length > journeyStageRuleLimits.history) {
    throw new JourneyStageRuleError('Rule evaluation exceeds its bounded input limits.', 'JOURNEY_RULE_LIMIT');
  }
  parsedTime(event.timestamp, 'event timestamp');
  const ids = new Set<string>();
  for (const rule of rules) {
    const versionedId = `${rule.id}\u0000${rule.version}`;
    if (ids.has(versionedId) || !Number.isSafeInteger(rule.version) || rule.version < 1
      || !Number.isSafeInteger(rule.priority)
      || (rule.predicates?.length || 0) > journeyStageRuleLimits.predicates
      || (rule.requiredPriorEvents?.length || 0) > journeyStageRuleLimits.priorEvents) {
      throw new JourneyStageRuleError('A rule has duplicate identity, invalid version/priority, or exceeds condition limits.', 'JOURNEY_RULE_INVALID');
    }
    ids.add(versionedId);
  }
  const traces = rules.map((rule) => evaluateRule(rule, event, history));
  const order = (left: JourneyStageRuleTrace, right: JourneyStageRuleTrace) =>
    right.priority - left.priority || right.specificity - left.specificity
      || left.definitionId.localeCompare(right.definitionId) || left.stageKey.localeCompare(right.stageKey)
      || left.role.localeCompare(right.role) || left.ruleId.localeCompare(right.ruleId);
  traces.sort(order);
  return { eventMessageId: event.messageId, matches: traces.filter((trace) => trace.matched), traces };
}
