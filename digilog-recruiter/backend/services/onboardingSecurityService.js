const crypto = require('crypto');

const SENSITIVE_TYPES = new Set(['bank_account', 'routing_number', 'tax_id']);

function encryptionKey() {
  const source = process.env.ONBOARDING_FIELD_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'seemplify-onboarding-development-key';
  return crypto.createHash('sha256').update(source).digest();
}

function encryptValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const plaintext = JSON.stringify(value ?? '');
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  };
}

function decryptValue(encrypted) {
  if (!encrypted?.iv || !encrypted?.tag || !encrypted?.data) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, 'base64')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(decrypted);
}

function isSensitiveField(field = {}) {
  return Boolean(field.sensitive || SENSITIVE_TYPES.has(field.type));
}

function maskValue(value, type = 'text') {
  if (value === undefined || value === null || value === '') return '';
  const raw = Array.isArray(value) ? value.join(', ') : String(value);
  const compact = raw.replace(/\s+/g, '');
  const last4 = compact.slice(-4);
  if (!last4) return 'Stored securely';
  if (type === 'routing_number') return `•••••${last4}`;
  if (type === 'tax_id') return `•••-••-${last4}`;
  return `•••• ${last4}`;
}

function valuePreview(value, field = {}) {
  if (isSensitiveField(field)) return maskValue(value, field.type);
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === undefined || value === null) return '';
  return String(value).slice(0, 300);
}

function serializeSubmission(submission, { reveal = false } = {}) {
  if (!submission) return null;
  const raw = typeof submission.toObject === 'function' ? submission.toObject() : submission;
  return {
    ...raw,
    values: (raw.values || []).map((entry) => {
      const canReveal = reveal && entry.sensitive && entry.encryptedValue;
      const revealedValue = canReveal ? decryptValue(entry.encryptedValue) : undefined;
      return {
        fieldId: entry.fieldId,
        key: entry.key,
        label: entry.label,
        type: entry.type,
        sensitive: Boolean(entry.sensitive),
        value: entry.sensitive ? undefined : entry.value,
        revealedValue,
        valuePreview: canReveal ? valuePreview(revealedValue, entry) : entry.valuePreview,
        files: entry.files || [],
        updatedAt: entry.updatedAt
      };
    })
  };
}

module.exports = {
  decryptValue,
  encryptValue,
  isSensitiveField,
  maskValue,
  serializeSubmission,
  valuePreview
};
