#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const PROVIDERS = Object.freeze(['qwen', 'gte']);
const DEFAULT_HIT_AT_5_MINIMUM = 0.8;
const DEFAULT_MINIMUM_REAL_CASES = 100;
const DEFAULT_MRR_TOLERANCE = 0.02;
const DEFAULT_CRITICAL_RR_TOLERANCE = 0;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TAG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PROHIBITED_RAW_KEYS = new Set([
  'raw',
  'rawText',
  'rawQuery',
  'queryText',
  'documentText',
  'content',
  'excerpt',
  'snippet',
  'documentName',
  'filename',
  'email',
  'phone',
  'personName',
]);

class EvaluationInputError extends Error {
  constructor(message, code = 'EVALUATION_INPUT_INVALID') {
    super(message);
    this.name = 'EvaluationInputError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new EvaluationInputError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unsupported field '${key}'.`);
  }
}

function assertSafeIdentifier(value, label) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    fail(`${label} must be an opaque identifier containing only letters, numbers, '.', '_', ':', or '-'.`);
  }
  return value;
}

function assertNoProhibitedRawFields(value, location = 'evaluation set') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoProhibitedRawFields(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_RAW_KEYS.has(key)) {
      fail(`${location} contains prohibited raw-text field '${key}'.`, 'RAW_TEXT_FIELD_REJECTED');
    }
    assertNoProhibitedRawFields(child, `${location}.${key}`);
  }
}

function queryContainsLikelySensitiveText(query) {
  const patterns = [
    { type: 'email', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
    { type: 'phone-or-long-number', regex: /(?:^|\D)(?:\+?\d[\d\s().-]{7,}\d)(?:\D|$)/ },
    { type: 'url', regex: /\b(?:https?:\/\/|www\.)\S+/i },
  ];
  return patterns.find(({ regex }) => regex.test(query))?.type || null;
}

function normalizeRanking(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  const seen = new Set();
  return value.map((entry, index) => {
    const item = assertPlainObject(entry, `${label}[${index}]`);
    assertAllowedKeys(item, new Set(['documentId', 'score']), `${label}[${index}]`);
    const documentId = assertSafeIdentifier(item.documentId, `${label}[${index}].documentId`);
    if (seen.has(documentId)) fail(`${label} contains duplicate documentId '${documentId}'.`);
    seen.add(documentId);
    let score = null;
    if (item.score !== undefined && item.score !== null) {
      score = Number(item.score);
      if (!Number.isFinite(score)) fail(`${label}[${index}].score must be finite.`);
    }
    return { documentId, score };
  });
}

function normalizeLatency(value, label) {
  const latency = assertPlainObject(value, label);
  assertAllowedKeys(latency, new Set(['queue', 'embedding', 'retrieval', 'reranker', 'total']), label);
  const output = {};
  for (const key of ['queue', 'embedding', 'retrieval', 'reranker', 'total']) {
    if (latency[key] === undefined) continue;
    const numeric = Number(latency[key]);
    if (!Number.isFinite(numeric) || numeric < 0) fail(`${label}.${key} must be a non-negative finite number.`);
    output[key] = numeric;
  }
  if (!Number.isFinite(output.total)) fail(`${label}.total is required.`);
  return output;
}

function normalizeProviderResult(value, label) {
  const provider = assertPlainObject(value, label);
  assertAllowedKeys(provider, new Set(['retrieved', 'reranked', 'abstained', 'latencyMs', 'failure']), label);
  let failure = null;
  if (provider.failure !== undefined && provider.failure !== null) {
    const failureValue = assertPlainObject(provider.failure, `${label}.failure`);
    assertAllowedKeys(failureValue, new Set(['code']), `${label}.failure`);
    if (typeof failureValue.code !== 'string' || !SAFE_FAILURE_CODE.test(failureValue.code)) {
      fail(`${label}.failure.code must be an uppercase, non-sensitive category such as TIMEOUT.`);
    }
    failure = { code: failureValue.code };
  }
  if (typeof provider.abstained !== 'boolean') fail(`${label}.abstained must be a boolean.`);
  if (failure) {
    if (provider.retrieved !== undefined && (!Array.isArray(provider.retrieved) || provider.retrieved.length)) {
      fail(`${label}.retrieved must be empty or omitted when failure is present.`);
    }
    if (provider.reranked !== undefined && (!Array.isArray(provider.reranked) || provider.reranked.length)) {
      fail(`${label}.reranked must be empty or omitted when failure is present.`);
    }
    return {
      failure,
      abstained: provider.abstained,
      retrieved: [],
      reranked: [],
      latencyMs: provider.latencyMs ? normalizeLatency(provider.latencyMs, `${label}.latencyMs`) : null,
    };
  }
  if (!provider.latencyMs) fail(`${label}.latencyMs is required for a successful result.`);
  return {
    failure: null,
    abstained: provider.abstained,
    retrieved: normalizeRanking(provider.retrieved, `${label}.retrieved`),
    reranked: normalizeRanking(provider.reranked, `${label}.reranked`),
    latencyMs: normalizeLatency(provider.latencyMs, `${label}.latencyMs`),
  };
}

function normalizeRelevance(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  const seen = new Set();
  return value.map((entry, index) => {
    const item = assertPlainObject(entry, `${label}[${index}]`);
    assertAllowedKeys(item, new Set(['documentId', 'gain']), `${label}[${index}]`);
    const documentId = assertSafeIdentifier(item.documentId, `${label}[${index}].documentId`);
    if (seen.has(documentId)) fail(`${label} contains duplicate documentId '${documentId}'.`);
    seen.add(documentId);
    const gain = item.gain === undefined ? 1 : Number(item.gain);
    if (!Number.isFinite(gain) || gain <= 0 || gain > 100) fail(`${label}[${index}].gain must be between 0 and 100.`);
    return { documentId, gain };
  });
}

function normalizeCase(value, index) {
  const label = `cases[${index}]`;
  const item = assertPlainObject(value, label);
  assertAllowedKeys(
    item,
    new Set(['id', 'query', 'critical', 'noAnswer', 'multilingual', 'tags', 'relevance', 'providers']),
    label,
  );
  const id = assertSafeIdentifier(item.id, `${label}.id`);
  if (typeof item.query !== 'string' || !item.query.trim() || item.query.length > 4_000) {
    fail(`${label}.query must be non-empty redacted text no longer than 4,000 characters.`);
  }
  const sensitivePattern = queryContainsLikelySensitiveText(item.query);
  if (sensitivePattern) {
    fail(`${label}.query contains a prohibited ${sensitivePattern} pattern. Redact it before evaluation.`, 'QUERY_REDACTION_REQUIRED');
  }
  if (item.critical !== undefined && typeof item.critical !== 'boolean') fail(`${label}.critical must be a boolean.`);
  if (item.noAnswer !== undefined && typeof item.noAnswer !== 'boolean') fail(`${label}.noAnswer must be a boolean.`);
  if (item.multilingual !== undefined && typeof item.multilingual !== 'boolean') fail(`${label}.multilingual must be a boolean.`);
  const tags = item.tags === undefined ? [] : item.tags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || !SAFE_TAG.test(tag))) {
    fail(`${label}.tags must contain lowercase slug values.`);
  }
  const relevance = normalizeRelevance(item.relevance, `${label}.relevance`);
  const noAnswer = item.noAnswer === true;
  if (noAnswer && relevance.length) fail(`${label} is a no-answer case and cannot contain relevance judgments.`);
  if (!noAnswer && !relevance.length) fail(`${label} is answerable and requires at least one relevance judgment.`);
  const providers = assertPlainObject(item.providers, `${label}.providers`);
  assertAllowedKeys(providers, new Set(PROVIDERS), `${label}.providers`);
  for (const providerName of PROVIDERS) {
    if (!providers[providerName]) fail(`${label}.providers.${providerName} is required.`);
  }
  return {
    id,
    query: item.query.trim().replace(/\s+/g, ' '),
    critical: item.critical === true,
    noAnswer,
    multilingual: item.multilingual === true,
    tags: [...new Set(tags)],
    relevance,
    providers: Object.fromEntries(
      PROVIDERS.map((providerName) => [providerName, normalizeProviderResult(providers[providerName], `${label}.providers.${providerName}`)]),
    ),
  };
}

function validateEvaluationSet(value) {
  assertNoProhibitedRawFields(value);
  const input = assertPlainObject(value, 'evaluation set');
  assertAllowedKeys(input, new Set(['schemaVersion', 'dataset', 'cases']), 'evaluation set');
  if (input.schemaVersion !== SCHEMA_VERSION) fail(`schemaVersion must equal ${SCHEMA_VERSION}.`);
  const dataset = assertPlainObject(input.dataset, 'dataset');
  assertAllowedKeys(dataset, new Set(['id', 'kind', 'redaction']), 'dataset');
  const id = assertSafeIdentifier(dataset.id, 'dataset.id');
  if (!['synthetic', 'real-redacted'].includes(dataset.kind)) fail("dataset.kind must be 'synthetic' or 'real-redacted'.");
  const redaction = assertPlainObject(dataset.redaction, 'dataset.redaction');
  assertAllowedKeys(redaction, new Set(['status', 'confirmedNoRawSensitiveText']), 'dataset.redaction');
  if (redaction.status !== 'redacted' || redaction.confirmedNoRawSensitiveText !== true) {
    fail('The dataset must explicitly attest that it is redacted and contains no raw sensitive text.', 'REDACTION_ATTESTATION_REQUIRED');
  }
  if (!Array.isArray(input.cases) || !input.cases.length) fail('cases must be a non-empty array.');
  const cases = input.cases.map(normalizeCase);
  const ids = new Set();
  for (const item of cases) {
    if (ids.has(item.id)) fail(`cases contains duplicate id '${item.id}'.`);
    ids.add(item.id);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    dataset: {
      id,
      kind: dataset.kind,
      redaction: { status: 'redacted', confirmedNoRawSensitiveText: true },
    },
    cases,
  };
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function rankingMetrics(item, ranking) {
  if (item.noAnswer) return null;
  const relevance = new Map(item.relevance.map(({ documentId, gain }) => [documentId, gain]));
  const ids = ranking.map(({ documentId }) => documentId);
  const firstRelevantIndex = ids.findIndex((documentId) => relevance.has(documentId));
  const foundAt20 = new Set(ids.slice(0, 20).filter((documentId) => relevance.has(documentId)));
  const dcg = ids.slice(0, 20).reduce((total, documentId, index) => {
    const gain = relevance.get(documentId) || 0;
    return total + ((2 ** gain) - 1) / Math.log2(index + 2);
  }, 0);
  const idealDcg = [...relevance.values()]
    .sort((left, right) => right - left)
    .slice(0, 20)
    .reduce((total, gain, index) => total + ((2 ** gain) - 1) / Math.log2(index + 2), 0);
  return {
    hitAt1: ids.slice(0, 1).some((documentId) => relevance.has(documentId)) ? 1 : 0,
    hitAt5: ids.slice(0, 5).some((documentId) => relevance.has(documentId)) ? 1 : 0,
    recallAt20: foundAt20.size / relevance.size,
    reciprocalRank: firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcgAt20: idealDcg > 0 ? dcg / idealDcg : 0,
    firstRelevantRank: firstRelevantIndex < 0 ? null : firstRelevantIndex + 1,
  };
}

function aggregateRankingMetrics(cases, providerName, rankingName) {
  const answerable = cases.filter((item) => !item.noAnswer);
  const rows = answerable.map((item) => rankingMetrics(item, item.providers[providerName][rankingName]));
  return {
    cases: answerable.length,
    hitAt1: round(average(rows.map((row) => row.hitAt1))),
    hitAt5: round(average(rows.map((row) => row.hitAt5))),
    recallAt20: round(average(rows.map((row) => row.recallAt20))),
    mrr: round(average(rows.map((row) => row.reciprocalRank))),
    ndcgAt20: round(average(rows.map((row) => row.ndcgAt20))),
  };
}

function aggregateLatency(cases, providerName) {
  const latencyFields = ['queue', 'embedding', 'retrieval', 'reranker', 'total'];
  const output = {};
  for (const field of latencyFields) {
    const samples = cases
      .map((item) => item.providers[providerName].latencyMs?.[field])
      .filter(Number.isFinite);
    output[field] = {
      samples: samples.length,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
    };
  }
  return output;
}

function aggregateProvider(cases, providerName) {
  const failures = cases.filter((item) => item.providers[providerName].failure);
  const noAnswerCases = cases.filter((item) => item.noAnswer);
  const falsePositiveCases = noAnswerCases.filter((item) => {
    const result = item.providers[providerName];
    return !result.failure && result.abstained !== true;
  });
  return {
    totalCases: cases.length,
    answerableCases: cases.filter((item) => !item.noAnswer).length,
    noAnswerCases: noAnswerCases.length,
    failures: failures.length,
    failureRate: round(failures.length / cases.length),
    failureCodes: [...new Set(failures.map((item) => item.providers[providerName].failure.code))].sort(),
    retrieval: aggregateRankingMetrics(cases, providerName, 'retrieved'),
    postReranker: aggregateRankingMetrics(cases, providerName, 'reranked'),
    noAnswer: {
      evaluated: noAnswerCases.length - noAnswerCases.filter((item) => item.providers[providerName].failure).length,
      falsePositives: falsePositiveCases.length,
      falsePositiveRate: noAnswerCases.length ? round(falsePositiveCases.length / noAnswerCases.length) : null,
    },
    latencyMs: aggregateLatency(cases, providerName),
  };
}

function metricDelta(gte, qwen) {
  if (!Number.isFinite(gte) || !Number.isFinite(qwen)) return null;
  return round(gte - qwen);
}

function compareAggregateMetrics(qwen, gte) {
  const compareRanking = (left, right) => ({
    hitAt1: metricDelta(right.hitAt1, left.hitAt1),
    hitAt5: metricDelta(right.hitAt5, left.hitAt5),
    recallAt20: metricDelta(right.recallAt20, left.recallAt20),
    mrr: metricDelta(right.mrr, left.mrr),
    ndcgAt20: metricDelta(right.ndcgAt20, left.ndcgAt20),
  });
  return {
    retrieval: compareRanking(qwen.retrieval, gte.retrieval),
    postReranker: compareRanking(qwen.postReranker, gte.postReranker),
    failureRate: metricDelta(gte.failureRate, qwen.failureRate),
    noAnswerFalsePositiveRate: metricDelta(gte.noAnswer.falsePositiveRate, qwen.noAnswer.falsePositiveRate),
    totalLatencyMs: {
      p50: metricDelta(gte.latencyMs.total.p50, qwen.latencyMs.total.p50),
      p95: metricDelta(gte.latencyMs.total.p95, qwen.latencyMs.total.p95),
      p99: metricDelta(gte.latencyMs.total.p99, qwen.latencyMs.total.p99),
    },
  };
}

function hashQuery(query, hashKey) {
  return crypto.createHmac('sha256', hashKey).update(query.normalize('NFKC')).digest('hex');
}

function providerCaseDiagnostic(item, providerName) {
  const provider = item.providers[providerName];
  return {
    failed: Boolean(provider.failure),
    failureCode: provider.failure?.code || null,
    abstained: provider.abstained,
    totalLatencyMs: provider.latencyMs?.total ?? null,
    retrieval: rankingMetrics(item, provider.retrieved),
    postReranker: rankingMetrics(item, provider.reranked),
  };
}

function detectCriticalRegressions(cases, diagnostics, reciprocalRankTolerance) {
  const regressions = [];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    if (!item.critical) continue;
    const qwen = diagnostics[index].providers.qwen;
    const gte = diagnostics[index].providers.gte;
    const reasons = [];
    if (!qwen.failed && gte.failed) reasons.push('gte-failed');
    if (item.noAnswer) {
      if (qwen.abstained && !gte.abstained && !gte.failed) reasons.push('no-answer-false-positive');
    } else {
      if ((qwen.postReranker?.hitAt5 || 0) > (gte.postReranker?.hitAt5 || 0)) reasons.push('reranked-hit-at-5-regressed');
      const qwenRr = qwen.postReranker?.reciprocalRank || 0;
      const gteRr = gte.postReranker?.reciprocalRank || 0;
      if (qwenRr - gteRr > reciprocalRankTolerance + Number.EPSILON) reasons.push('reranked-reciprocal-rank-regressed');
    }
    if (reasons.length) {
      regressions.push({
        caseId: item.id,
        queryHash: diagnostics[index].queryHash,
        reasons,
      });
    }
  }
  return regressions;
}

function buildQualityGate({
  evaluationSet,
  providers,
  criticalRegressions,
  hitAt5Minimum,
  minimumRealCases,
  mrrTolerance,
}) {
  const realDatasetSufficient = evaluationSet.dataset.kind === 'real-redacted'
    && evaluationSet.cases.length >= minimumRealCases;
  let insufficientReason = null;
  if (evaluationSet.dataset.kind !== 'real-redacted') {
    insufficientReason = 'The evaluation set is synthetic and cannot provide real-data approval.';
  } else if (evaluationSet.cases.length < minimumRealCases) {
    insufficientReason = `Only ${evaluationSet.cases.length} real redacted cases were supplied; at least ${minimumRealCases} are required.`;
  }
  const qwenMrr = providers.qwen.postReranker.mrr;
  const gteMrr = providers.gte.postReranker.mrr;
  const checks = {
    gteRerankedMrrWithinTolerance: {
      passed: Number.isFinite(qwenMrr) && Number.isFinite(gteMrr) && gteMrr + Number.EPSILON >= qwenMrr - mrrTolerance,
      tolerance: mrrTolerance,
      qwen: qwenMrr,
      gte: gteMrr,
      delta: metricDelta(gteMrr, qwenMrr),
    },
    gteRerankedHitAt5Minimum: {
      passed: Number.isFinite(providers.gte.postReranker.hitAt5)
        && providers.gte.postReranker.hitAt5 + Number.EPSILON >= hitAt5Minimum,
      minimum: hitAt5Minimum,
      actual: providers.gte.postReranker.hitAt5,
    },
    noCriticalQueryRegression: {
      passed: criticalRegressions.length === 0,
      regressions: criticalRegressions.length,
    },
  };
  const provisionalPassed = Object.values(checks).every((check) => check.passed);
  return {
    decision: realDatasetSufficient ? (provisionalPassed ? 'PASS' : 'FAIL') : 'INSUFFICIENT_REAL_DATA',
    approved: realDatasetSufficient && provisionalPassed,
    provisionalDecision: provisionalPassed ? 'PASS' : 'FAIL',
    realDatasetSufficient,
    minimumRealCases,
    suppliedCases: evaluationSet.cases.length,
    insufficientReason,
    checks,
  };
}

function assertReportIsRedacted(report, sourceQueries = []) {
  const serialized = JSON.stringify(report);
  const forbiddenKey = /"(?:query|queryText|rawQuery|rawText|documentText|content|excerpt|snippet)"\s*:/i;
  if (forbiddenKey.test(serialized)) throw new Error('Refusing to save a report containing a raw-text field.');
  for (const query of sourceQueries) {
    if (query.length >= 8 && serialized.includes(query)) throw new Error('Refusing to save a report containing source query text.');
  }
  return true;
}

function evaluateMigration(input, options = {}) {
  const evaluationSet = validateEvaluationSet(input);
  const hitAt5Minimum = options.hitAt5Minimum === undefined
    ? DEFAULT_HIT_AT_5_MINIMUM
    : Number(options.hitAt5Minimum);
  const minimumRealCases = options.minimumRealCases === undefined
    ? DEFAULT_MINIMUM_REAL_CASES
    : Number(options.minimumRealCases);
  const mrrTolerance = options.mrrTolerance === undefined ? DEFAULT_MRR_TOLERANCE : Number(options.mrrTolerance);
  const criticalReciprocalRankTolerance = options.criticalReciprocalRankTolerance === undefined
    ? DEFAULT_CRITICAL_RR_TOLERANCE
    : Number(options.criticalReciprocalRankTolerance);
  if (!Number.isFinite(hitAt5Minimum) || hitAt5Minimum < 0 || hitAt5Minimum > 1) fail('hitAt5Minimum must be between 0 and 1.');
  if (!Number.isInteger(minimumRealCases) || minimumRealCases < 1) fail('minimumRealCases must be a positive integer.');
  if (!Number.isFinite(mrrTolerance) || mrrTolerance < 0 || mrrTolerance > 1) fail('mrrTolerance must be between 0 and 1.');
  if (!Number.isFinite(criticalReciprocalRankTolerance) || criticalReciprocalRankTolerance < 0 || criticalReciprocalRankTolerance > 1) {
    fail('criticalReciprocalRankTolerance must be between 0 and 1.');
  }
  let hashKey = options.hashKey;
  let hashScope = 'stable-secret';
  if (!hashKey) {
    hashKey = crypto.randomBytes(32);
    hashScope = 'report-local';
  } else if (Buffer.byteLength(String(hashKey), 'utf8') < 32) {
    fail('The diagnostic hash key must contain at least 32 UTF-8 bytes.', 'HASH_KEY_TOO_SHORT');
  }
  const caseDiagnostics = evaluationSet.cases.map((item) => ({
    caseId: item.id,
    queryHash: hashQuery(item.query, hashKey),
    critical: item.critical,
    noAnswer: item.noAnswer,
    multilingual: item.multilingual,
    tags: item.tags,
    providers: Object.fromEntries(PROVIDERS.map((providerName) => [providerName, providerCaseDiagnostic(item, providerName)])),
  }));
  const providers = Object.fromEntries(PROVIDERS.map((providerName) => [providerName, aggregateProvider(evaluationSet.cases, providerName)]));
  const criticalRegressions = detectCriticalRegressions(
    evaluationSet.cases,
    caseDiagnostics,
    criticalReciprocalRankTolerance,
  );
  const report = {
    schemaVersion: SCHEMA_VERSION,
    reportType: 'qwen-to-gte-migration-evaluation',
    generatedAt: options.generatedAt || new Date().toISOString(),
    dataset: {
      id: evaluationSet.dataset.id,
      kind: evaluationSet.dataset.kind,
      caseCount: evaluationSet.cases.length,
      answerableCases: evaluationSet.cases.filter((item) => !item.noAnswer).length,
      noAnswerCases: evaluationSet.cases.filter((item) => item.noAnswer).length,
      criticalCases: evaluationSet.cases.filter((item) => item.critical).length,
      multilingualCases: evaluationSet.cases.filter((item) => item.multilingual).length,
    },
    privacy: {
      inputRedactionAttested: true,
      rawQueryStored: false,
      documentTextStored: false,
      queryHashAlgorithm: 'HMAC-SHA-256',
      queryHashScope: hashScope,
      hashKeyStored: false,
    },
    configuration: {
      hitAt5Minimum,
      minimumRealCases,
      mrrTolerance,
      criticalReciprocalRankTolerance,
      ndcgCutoff: 20,
    },
    providers,
    comparison: compareAggregateMetrics(providers.qwen, providers.gte),
    criticalRegressions,
    qualityGate: null,
    cases: caseDiagnostics,
  };
  report.qualityGate = buildQualityGate({
    evaluationSet,
    providers,
    criticalRegressions,
    hitAt5Minimum,
    minimumRealCases,
    mrrTolerance,
  });
  assertReportIsRedacted(report, evaluationSet.cases.map((item) => item.query));
  return report;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}

function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

function formatLatency(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'n/a';
}

function renderHumanSummary(report) {
  const lines = [
    '# Qwen to GTE migration evaluation',
    '',
    `- Decision: **${report.qualityGate.decision}**`,
    `- Provisional metric decision: **${report.qualityGate.provisionalDecision}**`,
    `- Dataset: \`${report.dataset.id}\` (${report.dataset.kind})`,
    `- Cases: ${report.dataset.caseCount} (${report.dataset.answerableCases} answerable, ${report.dataset.noAnswerCases} no-answer)`,
    `- Real-data minimum: ${report.qualityGate.minimumRealCases}`,
    '',
  ];
  if (!report.qualityGate.realDatasetSufficient) {
    lines.push('> This report is not a real-data approval. ' + report.qualityGate.insufficientReason, '');
  }
  lines.push(
    '## Retrieval quality',
    '',
    '| Stage | Provider | Hit@1 | Hit@5 | Recall@20 | MRR | nDCG@20 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const [stageKey, stageLabel] of [['retrieval', 'Initial retrieval'], ['postReranker', 'Post-reranker']]) {
    for (const providerName of PROVIDERS) {
      const metrics = report.providers[providerName][stageKey];
      lines.push(`| ${stageLabel} | ${providerName.toUpperCase()} | ${formatPercent(metrics.hitAt1)} | ${formatPercent(metrics.hitAt5)} | ${formatPercent(metrics.recallAt20)} | ${formatMetric(metrics.mrr)} | ${formatMetric(metrics.ndcgAt20)} |`);
    }
  }
  lines.push(
    '',
    '## Reliability and no-answer behavior',
    '',
    '| Provider | Failure rate | No-answer false-positive rate | Failures |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const providerName of PROVIDERS) {
    const provider = report.providers[providerName];
    lines.push(`| ${providerName.toUpperCase()} | ${formatPercent(provider.failureRate)} | ${formatPercent(provider.noAnswer.falsePositiveRate)} | ${provider.failures} |`);
  }
  lines.push(
    '',
    '## End-to-end latency',
    '',
    '| Provider | p50 | p95 | p99 | Samples |',
    '| --- | ---: | ---: | ---: | ---: |',
  );
  for (const providerName of PROVIDERS) {
    const latency = report.providers[providerName].latencyMs.total;
    lines.push(`| ${providerName.toUpperCase()} | ${formatLatency(latency.p50)} | ${formatLatency(latency.p95)} | ${formatLatency(latency.p99)} | ${latency.samples} |`);
  }
  lines.push('', '## Quality gates', '', '| Gate | Result | Detail |', '| --- | --- | --- |');
  const checks = report.qualityGate.checks;
  lines.push(
    `| GTE reranked MRR within ${(checks.gteRerankedMrrWithinTolerance.tolerance * 100).toFixed(2)} points | ${checks.gteRerankedMrrWithinTolerance.passed ? 'PASS' : 'FAIL'} | Qwen ${formatMetric(checks.gteRerankedMrrWithinTolerance.qwen)}, GTE ${formatMetric(checks.gteRerankedMrrWithinTolerance.gte)} |`,
    `| GTE reranked Hit@5 minimum | ${checks.gteRerankedHitAt5Minimum.passed ? 'PASS' : 'FAIL'} | Minimum ${formatPercent(checks.gteRerankedHitAt5Minimum.minimum)}, actual ${formatPercent(checks.gteRerankedHitAt5Minimum.actual)} |`,
    `| No critical-query regression | ${checks.noCriticalQueryRegression.passed ? 'PASS' : 'FAIL'} | ${checks.noCriticalQueryRegression.regressions} regression(s) |`,
  );
  lines.push('', '## Critical-query regressions', '');
  if (!report.criticalRegressions.length) {
    lines.push('None detected.');
  } else {
    for (const regression of report.criticalRegressions) {
      lines.push(`- \`${regression.caseId}\` / \`${regression.queryHash.slice(0, 16)}\`: ${regression.reasons.join(', ')}`);
    }
  }
  lines.push(
    '',
    '## Privacy',
    '',
    `Queries are represented only by ${report.privacy.queryHashAlgorithm} hashes (${report.privacy.queryHashScope}). No query text, document text, excerpts, filenames, or hash key are stored in this report.`,
    '',
  );
  const markdown = lines.join('\n');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(markdown)) throw new Error('Refusing to save a summary containing an email address.');
  return markdown;
}

function writePrivateFile(filename, contents) {
  const resolved = path.resolve(filename);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, resolved);
  try { fs.chmodSync(resolved, 0o600); } catch {}
  return resolved;
}

function writeReports(report, { jsonOutput, markdownOutput, sourceQueries = [] }) {
  assertReportIsRedacted(report, sourceQueries);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderHumanSummary(report);
  for (const query of sourceQueries) {
    if (query.length >= 8 && (json.includes(query) || markdown.includes(query))) {
      throw new Error('Refusing to save output containing source query text.');
    }
  }
  return {
    jsonOutput: writePrivateFile(jsonOutput, json),
    markdownOutput: writePrivateFile(markdownOutput, markdown),
  };
}

function usage() {
  return [
    'Usage:',
    '  node migration-evaluation.cjs --input <redacted.json> [options]',
    '',
    'Options:',
    '  --json-output <file>          Machine-readable report path.',
    '  --markdown-output <file>      Human summary path.',
    `  --hit5-min <0..1>             GTE post-reranker Hit@5 gate (default ${DEFAULT_HIT_AT_5_MINIMUM}).`,
    `  --minimum-real-cases <n>      Real-data sufficiency minimum (default ${DEFAULT_MINIMUM_REAL_CASES}).`,
    `  --mrr-tolerance <0..1>        Allowed GTE MRR drop (default ${DEFAULT_MRR_TOLERANCE}).`,
    '  --critical-rr-tolerance <n>   Allowed critical reciprocal-rank drop (default 0).',
    '  --hash-key-env <name>         Environment variable holding a 32-byte-or-longer HMAC key.',
    '  --no-write                    Print the redacted JSON report to stdout only.',
    '  --help                        Show this message.',
    '',
    'The input must be explicitly marked redacted. Saved reports never contain query or document text.',
  ].join('\n');
}

function parseCliArgs(argv) {
  const options = {
    input: null,
    jsonOutput: path.resolve('migration-evaluation-report.json'),
    markdownOutput: path.resolve('migration-evaluation-report.md'),
    hitAt5Minimum: DEFAULT_HIT_AT_5_MINIMUM,
    minimumRealCases: DEFAULT_MINIMUM_REAL_CASES,
    mrrTolerance: DEFAULT_MRR_TOLERANCE,
    criticalReciprocalRankTolerance: DEFAULT_CRITICAL_RR_TOLERANCE,
    hashKeyEnvironment: 'EXPERIENCE_MIGRATION_EVAL_HASH_KEY',
    noWrite: false,
    help: false,
  };
  const takesValue = new Map([
    ['--input', 'input'],
    ['--json-output', 'jsonOutput'],
    ['--markdown-output', 'markdownOutput'],
    ['--hit5-min', 'hitAt5Minimum'],
    ['--minimum-real-cases', 'minimumRealCases'],
    ['--mrr-tolerance', 'mrrTolerance'],
    ['--critical-rr-tolerance', 'criticalReciprocalRankTolerance'],
    ['--hash-key-env', 'hashKeyEnvironment'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (argument === '--no-write') { options.noWrite = true; continue; }
    const property = takesValue.get(argument);
    if (!property) fail(`Unknown argument '${argument}'.`, 'UNKNOWN_ARGUMENT');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${argument} requires a value.`, 'MISSING_ARGUMENT_VALUE');
    options[property] = value;
    index += 1;
  }
  options.hitAt5Minimum = Number(options.hitAt5Minimum);
  options.minimumRealCases = Number(options.minimumRealCases);
  options.mrrTolerance = Number(options.mrrTolerance);
  options.criticalReciprocalRankTolerance = Number(options.criticalReciprocalRankTolerance);
  return options;
}

function runCli(argv = process.argv.slice(2), environment = process.env) {
  const options = parseCliArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return { help: true };
  }
  if (!options.input) fail('--input is required.', 'INPUT_REQUIRED');
  const inputPath = path.resolve(options.input);
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const hashKey = environment[options.hashKeyEnvironment] || null;
  const report = evaluateMigration(input, {
    hashKey,
    hitAt5Minimum: options.hitAt5Minimum,
    minimumRealCases: options.minimumRealCases,
    mrrTolerance: options.mrrTolerance,
    criticalReciprocalRankTolerance: options.criticalReciprocalRankTolerance,
  });
  if (options.noWrite) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return { report, outputs: null };
  }
  if (path.resolve(options.jsonOutput) === inputPath || path.resolve(options.markdownOutput) === inputPath) {
    fail('Output paths must not overwrite the evaluation input.', 'OUTPUT_OVERWRITES_INPUT');
  }
  const outputs = writeReports(report, {
    jsonOutput: options.jsonOutput,
    markdownOutput: options.markdownOutput,
    sourceQueries: input.cases.map((item) => item.query),
  });
  process.stdout.write(`${JSON.stringify({
    decision: report.qualityGate.decision,
    approved: report.qualityGate.approved,
    provisionalDecision: report.qualityGate.provisionalDecision,
    caseCount: report.dataset.caseCount,
    jsonOutput: outputs.jsonOutput,
    markdownOutput: outputs.markdownOutput,
  })}\n`);
  return { report, outputs };
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.code || 'MIGRATION_EVALUATION_FAILED'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_CRITICAL_RR_TOLERANCE,
  DEFAULT_HIT_AT_5_MINIMUM,
  DEFAULT_MINIMUM_REAL_CASES,
  DEFAULT_MRR_TOLERANCE,
  EvaluationInputError,
  aggregateProvider,
  assertReportIsRedacted,
  compareAggregateMetrics,
  evaluateMigration,
  hashQuery,
  parseCliArgs,
  percentile,
  rankingMetrics,
  renderHumanSummary,
  runCli,
  usage,
  validateEvaluationSet,
  writeReports,
};
