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

function normalizeStringValue(value) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const values = value.map((item) => normalizeStringValue(item)).filter(Boolean);
    return values.length ? values.join(', ') : undefined;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return isPlaceholderString(trimmedValue) ? undefined : trimmedValue;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function normalizeStringArray(value) {
  const source = Array.isArray(value) ? value : [value];
  return source.map((item) => normalizeStringValue(item)).filter(Boolean);
}

function normalizeStructuredArray(value, stringFields, arrayFields = []) {
  const source = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return source
    .filter((item) => item && !Array.isArray(item) && typeof item === 'object')
    .map((item) => {
      const normalized = { ...item };
      for (const field of stringFields) {
        const fieldValue = normalizeStringValue(item[field]);
        if (fieldValue === undefined) delete normalized[field];
        else normalized[field] = fieldValue;
      }
      for (const field of arrayFields) {
        normalized[field] = normalizeStringArray(item[field]);
      }
      return normalized;
    })
    .filter((item) => hasMeaningfulValue(item));
}

function normalizeWorkExperience(workExperience) {
  if (!workExperience || Array.isArray(workExperience) || typeof workExperience !== 'object') {
    return undefined;
  }

  const normalizedWorkExperience = { ...workExperience };
  for (const field of ['experienceSummary', 'careerProgression', 'leadershipExperience', 'technicalDepth']) {
    const fieldValue = normalizeStringValue(workExperience[field]);
    if (fieldValue === undefined) delete normalizedWorkExperience[field];
    else normalizedWorkExperience[field] = fieldValue;
  }
  normalizedWorkExperience.jobHistory = normalizeStructuredArray(
    workExperience.jobHistory,
    ['company', 'position', 'duration', 'responsibilities', 'impact'],
    ['technologies']
  );
  normalizedWorkExperience.keyAchievements = normalizeStringArray(workExperience.keyAchievements);
  normalizedWorkExperience.industryExperience = normalizeStringArray(workExperience.industryExperience);
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
  for (const field of ['firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience', 'education', 'summary']) {
    const fieldValue = normalizeStringValue(extractedFields[field]);
    if (fieldValue === undefined) delete normalizedFields[field];
    else normalizedFields[field] = fieldValue;
  }
  for (const field of ['skills', 'strengths', 'potentialFlags']) {
    normalizedFields[field] = normalizeStringArray(extractedFields[field]);
  }
  const normalizedWorkExperience = normalizeWorkExperience(extractedFields.workExperience);

  if (normalizedWorkExperience) {
    normalizedFields.workExperience = normalizedWorkExperience;
  } else {
    delete normalizedFields.workExperience;
  }
  normalizedFields.educationHistory = normalizeStructuredArray(
    extractedFields.educationHistory,
    ['institution', 'degree', 'fieldOfStudy', 'graduationYear', 'gpa', 'honors', 'location', 'description']
  );
  normalizedFields.certifications = normalizeStructuredArray(
    extractedFields.certifications,
    ['name', 'issuingOrganization', 'issueDate', 'expiryDate', 'credentialId', 'credentialUrl', 'description']
  );
  normalizedFields.languages = normalizeStructuredArray(
    extractedFields.languages,
    ['language', 'proficiency', 'certifications']
  );
  normalizedFields.awards = normalizeStructuredArray(
    extractedFields.awards,
    ['title', 'issuer', 'date', 'description']
  );
  normalizedFields.projects = normalizeStructuredArray(
    extractedFields.projects,
    ['title', 'description', 'role', 'startDate', 'endDate', 'url'],
    ['technologies', 'highlights']
  );
  normalizedFields.publications = normalizeStructuredArray(
    extractedFields.publications,
    ['title', 'publication', 'publishDate', 'url', 'description'],
    ['authors']
  );
  normalizedFields.volunteerWork = normalizeStructuredArray(
    extractedFields.volunteerWork,
    ['organization', 'role', 'startDate', 'endDate', 'description', 'impact']
  );
  normalizedFields.professionalMemberships = normalizeStructuredArray(
    extractedFields.professionalMemberships,
    ['organization', 'role', 'startDate', 'endDate', 'description']
  );
  if (extractedFields.portfolioLinks && !Array.isArray(extractedFields.portfolioLinks) && typeof extractedFields.portfolioLinks === 'object') {
    normalizedFields.portfolioLinks = { ...extractedFields.portfolioLinks };
    for (const field of ['github', 'linkedin', 'personalWebsite', 'portfolio', 'stackoverflow', 'medium']) {
      const fieldValue = normalizeStringValue(extractedFields.portfolioLinks[field]);
      if (fieldValue === undefined) delete normalizedFields.portfolioLinks[field];
      else normalizedFields.portfolioLinks[field] = fieldValue;
    }
    normalizedFields.portfolioLinks.other = normalizeStringArray(extractedFields.portfolioLinks.other);
  } else {
    normalizedFields.portfolioLinks = {};
  }

  return normalizedFields;
}

module.exports = {
  normalizeNumericValue,
  normalizeStringValue,
  normalizeStringArray,
  normalizeStructuredArray,
  normalizeWorkExperience,
  normalizeCvExtractedFields,
};
