const crypto = require('crypto');

function parseKey(value, label) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is required`);

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')) {
    return decoded;
  }

  throw new Error(`${label} must be a 32-byte base64 value or 64 hexadecimal characters`);
}

function resolveKeyRing(env = process.env) {
  const activeVersion = String(env.AI_PROVIDER_ENCRYPTION_KEY_VERSION || 'v1').trim();
  const keys = new Map();

  if (env.AI_PROVIDER_ENCRYPTION_KEYS) {
    let parsed;
    try {
      parsed = JSON.parse(env.AI_PROVIDER_ENCRYPTION_KEYS);
    } catch {
      throw new Error('AI_PROVIDER_ENCRYPTION_KEYS must be valid JSON');
    }
    for (const [version, value] of Object.entries(parsed || {})) {
      keys.set(version, parseKey(value, `AI provider encryption key ${version}`));
    }
  }

  if (env.AI_PROVIDER_ENCRYPTION_KEY) {
    keys.set(activeVersion, parseKey(env.AI_PROVIDER_ENCRYPTION_KEY, 'AI_PROVIDER_ENCRYPTION_KEY'));
  }

  if (!keys.has(activeVersion)) {
    throw new Error(`No AI provider encryption key is configured for active version ${activeVersion}`);
  }

  return { activeVersion, keys };
}

function fingerprintSecret(secret) {
  return crypto.createHash('sha256').update(String(secret || '')).digest('hex');
}

function maskSecret(secret) {
  const value = String(secret || '');
  return value ? `****${value.slice(-4)}` : 'Not stored';
}

function encryptSecret(secret, { env = process.env } = {}) {
  const value = String(secret || '').trim();
  if (!value) throw new Error('Provider API key is required');

  const { activeVersion, keys } = resolveKeyRing(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys.get(activeVersion), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return {
    algorithm: 'aes-256-gcm',
    keyVersion: activeVersion,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptSecret(encryptedSecret, { env = process.env } = {}) {
  if (!encryptedSecret || encryptedSecret.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported or missing encrypted provider secret');
  }

  const { keys } = resolveKeyRing(env);
  const key = keys.get(encryptedSecret.keyVersion);
  if (!key) throw new Error(`Missing AI provider encryption key version ${encryptedSecret.keyVersion}`);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedSecret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encryptedSecret.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedSecret.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

module.exports = {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  maskSecret,
  resolveKeyRing
};
