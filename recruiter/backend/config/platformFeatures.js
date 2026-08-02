const PLATFORM_FEATURE_DEFINITIONS = Object.freeze({
  aiInterviews: Object.freeze({
    label: 'AI Interviews',
    description: 'Blocks integrated and standalone interview pages, APIs, and candidate sessions.',
    defaultEnabled: true
  }),
  aiAssistant: Object.freeze({
    label: 'AI Assistant',
    description: 'Blocks assistant chat and AI-generated recruitment content.',
    defaultEnabled: true
  }),
  candidateEnrichment: Object.freeze({
    label: 'Candidate Enrichment',
    description: 'Blocks enrichment estimates, runs, status checks, and results.',
    defaultEnabled: true
  }),
  bulkCvUpload: Object.freeze({
    label: 'Bulk CV Upload',
    description: 'Blocks bulk CV uploads and processing status checks.',
    defaultEnabled: true
  }),
  peopleTransitions: Object.freeze({
    label: 'People Transitions',
    description: 'Blocks transition management, document signing queues, and related APIs.',
    defaultEnabled: true
  })
});

const PLATFORM_FEATURE_KEYS = Object.freeze(Object.keys(PLATFORM_FEATURE_DEFINITIONS));

const DEFAULT_PLATFORM_FEATURE_FLAGS = Object.freeze(
  PLATFORM_FEATURE_KEYS.reduce((flags, key) => {
    flags[key] = PLATFORM_FEATURE_DEFINITIONS[key].defaultEnabled;
    return flags;
  }, {})
);

function normalizePlatformFeatureFlags(value = {}) {
  return PLATFORM_FEATURE_KEYS.reduce((flags, key) => {
    flags[key] = typeof value?.[key] === 'boolean'
      ? value[key]
      : DEFAULT_PLATFORM_FEATURE_FLAGS[key];
    return flags;
  }, {});
}

function validatePlatformFeatureUpdates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('features must be an object');
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new TypeError('At least one feature must be provided');
  }

  const updates = {};
  for (const [key, enabled] of entries) {
    if (!PLATFORM_FEATURE_DEFINITIONS[key]) {
      throw new TypeError(`Unknown platform feature: ${key}`);
    }
    if (typeof enabled !== 'boolean') {
      throw new TypeError(`${key} must be true or false`);
    }
    updates[key] = enabled;
  }

  return updates;
}

module.exports = {
  DEFAULT_PLATFORM_FEATURE_FLAGS,
  PLATFORM_FEATURE_DEFINITIONS,
  PLATFORM_FEATURE_KEYS,
  normalizePlatformFeatureFlags,
  validatePlatformFeatureUpdates
};
