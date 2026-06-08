const PLACEHOLDER_VALUES = new Set([
  '',
  'n/a',
  'na',
  'none',
  'null',
  'unknown',
  'not available',
  'not specified',
  'not provided',
  'tbd',
]);

function isPlaceholderString(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

function normalizeNumericValue(value) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (isPlaceholderString(trimmedValue)) {
    return undefined;
  }

  const rangeMatch = trimmedValue.match(/(-?\d+(?:\.\d+)?)\s*(?:to|-)\s*(-?\d+(?:\.\d+)?)/i);
  if (rangeMatch) {
    const lowerBound = Number.parseFloat(rangeMatch[1]);
    const upperBound = Number.parseFloat(rangeMatch[2]);

    if (Number.isFinite(lowerBound) && Number.isFinite(upperBound)) {
      return Number(((lowerBound + upperBound) / 2).toFixed(1));
    }
  }

  const numericMatch = trimmedValue.match(/-?\d+(?:\.\d+)?/);
  if (!numericMatch) {
    return undefined;
  }

  const parsedValue = Number.parseFloat(numericMatch[0]);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'string') {
    return !isPlaceholderString(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  if (typeof value === 'object') {
    return Object.values(value).some((item) => hasMeaningfulValue(item));
  }

  return false;
}

function normalizeWorkExperience(workExperience) {
  if (!workExperience || Array.isArray(workExperience) || typeof workExperience !== 'object') {
    return undefined;
  }

  const normalizedWorkExperience = { ...workExperience };
  const totalYearsExperience = normalizeNumericValue(workExperience.totalYearsExperience);

  if (totalYearsExperience === undefined) {
    delete normalizedWorkExperience.totalYearsExperience;
  } else {
    normalizedWorkExperience.totalYearsExperience = totalYearsExperience;
  }

  return hasMeaningfulValue(normalizedWorkExperience) ? normalizedWorkExperience : undefined;
}

function normalizeCvExtractedFields(extractedFields) {
  if (!extractedFields || Array.isArray(extractedFields) || typeof extractedFields !== 'object') {
    return {};
  }

  const normalizedFields = { ...extractedFields };
  const normalizedWorkExperience = normalizeWorkExperience(extractedFields.workExperience);

  if (normalizedWorkExperience) {
    normalizedFields.workExperience = normalizedWorkExperience;
  } else {
    delete normalizedFields.workExperience;
  }

  return normalizedFields;
}

module.exports = {
  normalizeNumericValue,
  normalizeWorkExperience,
  normalizeCvExtractedFields,
};
