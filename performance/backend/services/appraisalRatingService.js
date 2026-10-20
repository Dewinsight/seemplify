'use strict';

function ratingBounds(appraisal) {
  const scale = appraisal?.cycleConfigurationSnapshot?.ratingScale || appraisal?.cycleId?.ratingScale || {};
  return { min: Number.isFinite(scale.min) ? scale.min : 1, max: Number.isFinite(scale.max) ? scale.max : 5 };
}

function ratingWithinScale(value, appraisal) {
  if (value == null) return true;
  const { min, max } = ratingBounds(appraisal);
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function normalizeHumanRating(raw, appraisal, { required = false, submit = false, label = 'Rating' } = {}) {
  const { min, max } = ratingBounds(appraisal);
  const empty = raw == null || (typeof raw === 'string' && raw.trim() === '');
  let value = empty ? undefined : (typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN);
  // Older star inputs use zero for an untouched field. On a positive scale it
  // remains unrated in drafts and optional fields; a required submission fails.
  if (value === 0 && min > 0 && (!submit || !required)) value = undefined;
  const message = value === undefined
    ? (required && submit ? `${label} is required` : null)
    : (!ratingWithinScale(value, appraisal) ? `${label} must be a number from ${min} to ${max}` : null);
  if (message) throw Object.assign(new Error(message), { code: 'INVALID_APPRAISAL_RATING' });
  return value;
}

module.exports = { ratingBounds, ratingWithinScale, normalizeHumanRating };
