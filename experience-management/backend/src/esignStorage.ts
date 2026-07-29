import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE_MAGIC = Buffer.from('SEEMSIG1');
let cachedKey: Buffer | null = null;

function encryptionKey() {
  if (cachedKey) return cachedKey;
  let raw = '';
  try { raw = fs.readFileSync(config.esignEncryptionKeyFile, 'utf8').trim(); }
  catch { throw new Error('E-sign encryption is not configured. Run the local setup script.'); }
  if (raw.length < 32) throw new Error('E-sign encryption is not configured. Run the local setup script.');
  const decoded = Buffer.from(raw, 'base64url');
  cachedKey = decoded.length === 32 ? decoded : crypto.createHash('sha256').update(raw).digest();
  return cachedKey;
}

function storagePath(storageKey: string) {
  if (!/^[0-9a-f]{2}\/[0-9a-f-]{36}\.bin$/i.test(storageKey)) throw new Error('Invalid protected storage key.');
  const root = path.resolve(config.esignStorageDir);
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Invalid protected storage path.');
  return resolved;
}

export function hashBytes(bytes: Uint8Array) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function randomOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sealText(value: string, context: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function openText(value: string, context: string) {
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('Protected e-sign data could not be decrypted.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new Error('Protected e-sign data could not be decrypted.'); }
}

export function writeProtectedFile(bytes: Uint8Array, context: string) {
  const id = crypto.randomUUID();
  const storageKey = `${id.slice(0, 2)}/${id}.bin`;
  const destination = storagePath(storageKey);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const payload = Buffer.concat([FILE_MAGIC, iv, cipher.getAuthTag(), encrypted]);
  const temporary = `${destination}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, payload, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, destination);
  return { storageKey, sha256: hashBytes(bytes), size: bytes.byteLength };
}

export function readProtectedFile(storageKey: string, context: string) {
  const payload = fs.readFileSync(storagePath(storageKey));
  if (payload.length < FILE_MAGIC.length + 28 || !payload.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
    throw new Error('Protected e-sign file is invalid.');
  }
  try {
    const offset = FILE_MAGIC.length;
    const iv = payload.subarray(offset, offset + 12);
    const tag = payload.subarray(offset + 12, offset + 28);
    const encrypted = payload.subarray(offset + 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch { throw new Error('Protected e-sign file could not be decrypted.'); }
}

export function removeProtectedFile(storageKey: string) {
  try { fs.rmSync(storagePath(storageKey), { force: true }); } catch { /* already absent or invalid */ }
}

export function auditDigest(value: string) {
  return crypto.createHmac('sha256', encryptionKey()).update(value).digest('hex');
}

export function resetEsignKeyCacheForTests() { cachedKey = null; }
