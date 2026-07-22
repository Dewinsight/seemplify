const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertSafeMetadata,
  containsGroqApiKey,
  normalizeQuotaGroupId,
  redactGroqApiKeys,
  sanitizeQuotaGroup,
  validateQuotaGroupInput
} = require('../services/aiRuntime/quotaGroupValidation');

const existingGroups = [{ id: 'groq-primary', label: 'Groq primary organization', enabled: true }];

test('quota group identifiers are normalized consistently', () => {
  assert.equal(normalizeQuotaGroupId(' EU Backup / Paid '), 'eu-backup-paid');
});

test('quota group validation rejects API keys without echoing them', () => {
  const secret = `gsk_${'x'.repeat(30)}`;
  assert.throws(
    () => validateQuotaGroupInput({ label: secret, independentQuotaConfirmed: true }, existingGroups),
    (error) => {
      assert.equal(error.code, 'AI_RUNTIME_SECRET_IN_METADATA');
      assert.equal(error.field, 'label');
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );
});

test('quota group validation reports duplicate identifiers as conflicts', () => {
  assert.throws(
    () => validateQuotaGroupInput({ label: 'Groq Primary', independentQuotaConfirmed: true }, existingGroups),
    (error) => {
      assert.equal(error.code, 'AI_RUNTIME_QUOTA_GROUP_EXISTS');
      assert.equal(error.statusCode, 409);
      assert.equal(error.field, 'id');
      return true;
    }
  );
});

test('quota group validation generates safe identifiers from labels', () => {
  assert.deepEqual(
    validateQuotaGroupInput({ label: 'EU paid organization', independentQuotaConfirmed: true }, existingGroups),
    { id: 'eu-paid-organization', label: 'EU paid organization', independentQuotaConfirmed: true }
  );
});

test('credential metadata rejects misplaced API keys', () => {
  assert.throws(
    () => assertSafeMetadata(`Production gsk_${'x'.repeat(30)}`, 'projectLabel', 'the project label'),
    { code: 'AI_RUNTIME_SECRET_IN_METADATA', field: 'projectLabel' }
  );
});

test('legacy secret-shaped labels and audit values are redacted', () => {
  const secret = `gsk_${'x'.repeat(30)}`;
  assert.equal(containsGroqApiKey(secret), true);
  assert.equal(sanitizeQuotaGroup({ id: 'free', label: secret }).label, 'Quota group free');
  assert.deepEqual(
    redactGroqApiKeys({ message: `Created ${secret}`, metadata: { nested: secret } }),
    { message: 'Created [REDACTED_GROQ_KEY]', metadata: { nested: '[REDACTED_GROQ_KEY]' } }
  );
});
