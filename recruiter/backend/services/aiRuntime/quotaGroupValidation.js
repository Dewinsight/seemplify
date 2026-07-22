const GROQ_API_KEY_PATTERN = /gsk_[a-z0-9_-]{12,}/gi;

function containsGroqApiKey(value) {
  GROQ_API_KEY_PATTERN.lastIndex = 0;
  return GROQ_API_KEY_PATTERN.test(String(value || ''));
}

function redactGroqApiKeys(value) {
  if (typeof value === 'string') {
    GROQ_API_KEY_PATTERN.lastIndex = 0;
    return value.replace(GROQ_API_KEY_PATTERN, '[REDACTED_GROQ_KEY]');
  }
  if (Array.isArray(value)) return value.map(redactGroqApiKeys);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactGroqApiKeys(item)]));
}

function normalizeQuotaGroupId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
}

function validationError(message, code, field, statusCode = 400) {
  const error = new TypeError(message);
  error.code = code;
  error.field = field;
  error.statusCode = statusCode;
  return error;
}

function assertSafeMetadata(value, field, label) {
  if (containsGroqApiKey(value)) {
    throw validationError(
      `Do not enter an API key in ${label}. Use the Groq API key field under Add credential.`,
      'AI_RUNTIME_SECRET_IN_METADATA',
      field
    );
  }
}

function validateQuotaGroupInput(input = {}, existingGroups = []) {
  const label = String(input.label || '').trim();
  const rawId = String(input.id || '').trim();
  assertSafeMetadata(label, 'label', 'the quota group label');
  assertSafeMetadata(rawId, 'id', 'the quota group identifier');

  if (!label || label.length > 100) {
    throw validationError(
      'Quota group label is required and must be 100 characters or fewer',
      'AI_RUNTIME_QUOTA_GROUP_LABEL_INVALID',
      'label'
    );
  }
  if (input.independentQuotaConfirmed !== true) {
    throw validationError(
      'Confirm that this group has an independent authorized Groq quota scope',
      'AI_RUNTIME_QUOTA_GROUP_CONFIRMATION_REQUIRED',
      'independentQuotaConfirmed'
    );
  }

  const id = normalizeQuotaGroupId(rawId || label);
  if (!id || id.length > 64) {
    throw validationError(
      'Quota group identifier is invalid or longer than 64 characters',
      'AI_RUNTIME_QUOTA_GROUP_ID_INVALID',
      'id'
    );
  }
  if (existingGroups.some((group) => normalizeQuotaGroupId(group.id) === id)) {
    throw validationError(
      `Quota group "${id}" already exists. Select it when adding a credential.`,
      'AI_RUNTIME_QUOTA_GROUP_EXISTS',
      'id',
      409
    );
  }

  return { id, label, independentQuotaConfirmed: true };
}

function sanitizeQuotaGroup(group) {
  if (!group || typeof group !== 'object') return group;
  return {
    ...group,
    label: containsGroqApiKey(group.label) ? `Quota group ${group.id}` : group.label
  };
}

module.exports = {
  assertSafeMetadata,
  containsGroqApiKey,
  normalizeQuotaGroupId,
  redactGroqApiKeys,
  sanitizeQuotaGroup,
  validateQuotaGroupInput
};
