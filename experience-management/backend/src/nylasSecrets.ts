import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';

let cachedKey: Buffer | null = null;

function encryptionKey() {
  if (cachedKey) return cachedKey;
  let raw = '';
  try { raw = fs.readFileSync(config.nylasCredentialEncryptionKeyFile, 'utf8').trim(); }
  catch { throw new Error('Nylas connection encryption is not configured. Run the local setup script.'); }
  if (raw.length < 32) throw new Error('Nylas connection encryption is not configured. Run the local setup script.');
  const decoded = Buffer.from(raw, 'base64url');
  cachedKey = decoded.length === 32 ? decoded : crypto.createHash('sha256').update(raw).digest();
  return cachedKey;
}

export function encryptNylasSecret(value: string, context: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptNylasSecret(envelope: string, context: string) {
  const [version, ivValue, tagValue, encryptedValue] = String(envelope || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('Stored Nylas connection credentials could not be decrypted.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new Error('Stored Nylas connection credentials could not be decrypted.'); }
}

export function fingerprintNylasGrant(grantId: string) {
  return crypto.createHmac('sha256', encryptionKey()).update(`nylas-grant\n${grantId}`).digest('base64url');
}

export function resetNylasSecretKeyCacheForTests() { cachedKey = null; }

export function nylasSecretEncryptionConfigured() {
  try { encryptionKey(); return true; } catch { return false; }
}
