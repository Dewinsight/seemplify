import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';

let cachedKey: Buffer | null = null;
function key() {
  if (cachedKey) return cachedKey;
  let raw=''; try { raw=fs.readFileSync(config.journeyWebhookEncryptionKeyFile,'utf8').trim(); }
  catch { throw new Error('Journey webhook encryption is not configured.'); }
  if(raw.length<32) throw new Error('Journey webhook encryption is not configured.');
  const decoded=Buffer.from(raw,'base64url');
  cachedKey=decoded.length===32?decoded:crypto.createHash('sha256').update(raw).digest(); return cachedKey;
}
export function encryptJourneyWebhookSecret(value:string,context:string){
  const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(Buffer.from(context)); const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),body.toString('base64url')].join('.');
}
export function decryptJourneyWebhookSecret(value:string,context:string){
  const [version,iv,tag,body]=String(value).split('.');
  if(version!=='v1'||!iv||!tag||!body) throw new Error('Stored journey webhook secret is invalid.');
  try { const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64url'));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8');
  } catch { throw new Error('Stored journey webhook secret could not be decrypted.'); }
}
export function resetJourneyWebhookSecretCacheForTests(){cachedKey=null;}
