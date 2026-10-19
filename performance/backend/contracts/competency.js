'use strict';
const crypto = require('node:crypto');
const SOURCE_TYPES = Object.freeze(['sfia', 'internal', 'strategy']);
class DomainError extends Error {
  constructor(status, code, message, fields = []) { super(message); this.name = 'CompetencyError'; this.status = status; this.code = code; this.fields = fields; }
}
function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value?._bsontype === 'ObjectId') return JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new DomainError(422, 'INVALID_NUMBER', 'Enter a finite number.');
  return JSON.stringify(value);
}
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
function id(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new DomainError(400, 'INVALID_ID', 'This record reference is invalid.');
  return value;
}
function requiredText(value, path, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DomainError(422, 'INVALID_FIELD', `Enter ${path} (maximum ${max} characters).`, [{ path, code: 'INVALID', message: `Enter ${path}.` }]);
  return value.trim();
}
function cleanObject(value, allowedKeys, path = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError(422, 'INVALID_OBJECT', `Enter valid ${path || 'details'}.`);
  const invalid = Object.keys(value).find(key => !allowedKeys.includes(key));
  if (invalid) throw new DomainError(422, 'UNKNOWN_FIELD', `The field ${path ? `${path}.` : ''}${invalid} cannot be changed.`);
  return value;
}
function revision(req) {
  const value = req.get?.('If-Match') ?? req.headers?.['if-match'];
  const match = typeof value === 'string' && /^"?(\d+)"?$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new DomainError(428, 'REVISION_REQUIRED', 'Reload this record before saving your changes.');
  return Number(match[1]);
}
function send(res, data, status = 200, meta = {}) {
  res.set('Cache-Control', 'no-store');
  if (Number.isInteger(data?.revision)) res.set('ETag', `"${data.revision}"`);
  return res.status(status).json({ data, meta: { schemaVersion: '1', ...meta } });
}
const handle = fn => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (error) {
    if (res.headersSent) return next(error);
    const ctx = req.competencyContext;
    if (ctx && [403, 404].includes(error.status)) {
      try { await require('../services/competency/authorizationService').audit(ctx, 'access.denied', 'request', null, { permission: error.permission || null, code: error.code }); } catch { /* Denial remains closed if audit storage is temporarily unavailable. */ }
    }
    const known = error instanceof DomainError;
    if (!known) console.error('[competency] Request failed', { name: error.name || 'Error', code: typeof error.code === 'string' ? error.code : 'UNEXPECTED', route: req.route?.path || 'unknown'  });
    res.set('Cache-Control', 'no-store');
    res.status(known ? error.status : 500).json({ error: { code: known ? error.code : 'COMPETENCY_REQUEST_FAILED', message: known ? error.message : 'We could not complete this request. Please try again.', ...(known && error.fields?.length ? { fields: error.fields } : {}) } });
  }
};
function validateSources(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3 || new Set(input).size !== input.length || input.some(source => !SOURCE_TYPES.includes(source))) throw new DomainError(422, 'INVALID_SOURCES', 'Select at least one assessment input, without duplicates.');
  return [...input];
}
function number(value, path, { min = 0, max = 1e9 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || Math.abs(value * 1e6 - Math.round(value * 1e6)) > 1e-6) throw new DomainError(422, 'INVALID_NUMBER', `${path} must be between ${min} and ${max}, with at most six decimal places.`);
  return value;
}
function validateWeights(weights, mode, path) {
  const values = Object.values(weights);
  values.forEach(value => number(value, path));
  const sum = values.reduce((total, value) => total + value, 0);
  const target = mode === 'fraction' ? 1 : mode === 'percentage' ? 100 : null;
  if (!(sum > 0) || (target !== null && Math.abs(sum - target) > 1e-6)) throw new DomainError(422, 'INVALID_WEIGHTS', target === null ? 'Weights must have a positive total.' : `${path} must total ${target}.`);
  return weights;
}
function validateScoring(input, sources) {
  validateSources(sources);
  cleanObject(input, ['version', 'method', 'weightMode', 'inputWeights', 'ratingScales', 'normalization', 'thresholds', 'missingPolicy', 'exceptionPolicy'], 'scoring');
  if (input.method !== 'weighted_mean' || !['fraction', 'percentage', 'relative'].includes(input.weightMode)) throw new DomainError(422, 'INVALID_SCORING', 'Choose a supported scoring method and weight mode.');
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw new DomainError(422, 'INVALID_SCORING_VERSION', 'Enter a positive scoring version.');
  cleanObject(input.inputWeights, sources, 'inputWeights');
  if (sources.some(source => !Object.hasOwn(input.inputWeights, source) || !(input.inputWeights[source] > 0))) throw new DomainError(422, 'MISSING_SOURCE_WEIGHT', 'Give every selected assessment input a positive weight.');
  validateWeights(input.inputWeights, input.weightMode, 'Input weights');
  if (input.missingPolicy !== 'block_unless_authorised_exception') throw new DomainError(422, 'INVALID_MISSING_POLICY', 'Required findings must be checked before finalisation.');
  const exceptionPolicy = input.exceptionPolicy || 'retain_as_unscored';
  if (!['retain_as_unscored', 'exclude_and_renormalize'].includes(exceptionPolicy)) throw new DomainError(422, 'INVALID_EXCEPTION_POLICY', 'Choose a supported exception policy.');
  const scales = input.ratingScales || [];
  if (!Array.isArray(scales) || scales.length > 100) throw new DomainError(422, 'INVALID_SCALES', 'Enter a valid rating scale list.');
  const scaleIds = new Set();
  for (const scale of scales) {
    cleanObject(scale, ['id', 'label', 'min', 'max'], 'ratingScale');
    requiredText(scale.id, 'scale ID', 100); requiredText(scale.label, 'scale label', 200);
    number(scale.min, 'Scale minimum', { min: -1e9 }); number(scale.max, 'Scale maximum', { min: -1e9 });
    if (scale.max <= scale.min || scaleIds.has(scale.id)) throw new DomainError(422, 'INVALID_SCALE', 'Each scale needs a unique ID and a maximum above its minimum.');
    scaleIds.add(scale.id);
  }
  if (!Array.isArray(input.normalization) || input.normalization.length > 1000) throw new DomainError(422, 'INVALID_NORMALIZATION', 'Configure how criterion measures become scores.');
  const measures = new Set();
  for (const entry of input.normalization) {
    cleanObject(entry, ['sourceVersionId', 'criterionId', 'method', 'levelScores', 'ratingScaleId'], 'normalization');
    requiredText(entry.sourceVersionId, 'source version', 100); requiredText(entry.criterionId, 'criterion', 100);
    const key = `${entry.sourceVersionId}:${entry.criterionId}`;
    if (measures.has(key)) throw new DomainError(422, 'DUPLICATE_MEASURE', 'Each criterion must use one scoring measure.');
    measures.add(key);
    if (entry.method === 'level_map') {
      if (entry.ratingScaleId !== undefined || !entry.levelScores || typeof entry.levelScores !== 'object' || Array.isArray(entry.levelScores) || !Object.keys(entry.levelScores).length) throw new DomainError(422, 'INVALID_LEVEL_MAP', 'Map native levels to explicit scores.');
      Object.values(entry.levelScores).forEach(value => number(value, 'Level score', { max: 100 }));
    } else if (entry.method === 'rating_scale') {
      if (entry.levelScores !== undefined || !scaleIds.has(entry.ratingScaleId)) throw new DomainError(422, 'INVALID_SCALE_REFERENCE', 'Select an existing rating scale for this criterion.');
    } else throw new DomainError(422, 'INVALID_MEASURE', 'Choose a native level mapping or a numeric rating scale.');
  }
  if (!Array.isArray(input.thresholds) || !input.thresholds.length || input.thresholds.length > 50) throw new DomainError(422, 'INVALID_THRESHOLDS', 'Configure suitability bands covering zero to 100.');
  let boundary = 0; const bandIds = new Set();
  const bands = [...input.thresholds].sort((a, b) => a.minInclusive - b.minInclusive);
  bands.forEach((band, index) => {
    cleanObject(band, ['id', 'label', 'minInclusive', 'maxExclusive', 'maxInclusive'], 'threshold');
    requiredText(band.id, 'threshold ID', 100); requiredText(band.label, 'suitability label', 200);
    number(band.minInclusive, 'Band minimum', { max: 100 });
    const last = index === bands.length - 1; const upper = last ? band.maxInclusive : band.maxExclusive;
    number(upper, 'Band maximum', { max: 100 });
    if (bandIds.has(band.id) || band.minInclusive !== boundary || upper <= boundary || (last ? band.maxExclusive !== undefined || upper !== 100 : band.maxInclusive !== undefined)) throw new DomainError(422, 'INVALID_THRESHOLDS', 'Suitability bands must cover zero to 100 without gaps or overlaps.');
    boundary = upper; bandIds.add(band.id);
  });
  return { ...input, ratingScales: scales, thresholds: bands, exceptionPolicy };
}
function validateRanking(input = {}) {
  cleanObject(input, ['enabled', 'scope', 'direction', 'tieRule', 'decimalPlaces', 'measure'], 'ranking');
  const value = { enabled: false, scope: 'role', direction: 'desc', tieRule: 'competition', decimalPlaces: 2, measure: 'overallScore', ...input };
  if (typeof value.enabled !== 'boolean' || !['role', 'department', 'organization'].includes(value.scope) || !['asc', 'desc'].includes(value.direction) || !['competition', 'dense'].includes(value.tieRule) || !Number.isInteger(value.decimalPlaces) || value.decimalPlaces < 0 || value.decimalPlaces > 6 || value.measure !== 'overallScore') throw new DomainError(422, 'INVALID_RANKING', 'Choose a supported ranking scope, order and tie rule.');
  return value;
}
module.exports = { DomainError, canonical, hash, id, requiredText, cleanObject, revision, send, handle, SOURCE_TYPES, validateSources, number, validateWeights, validateScoring, validateRanking };
