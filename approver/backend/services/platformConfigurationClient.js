const crypto = require('crypto');
const fs = require('fs');

const SERVICE = 'approver';
const STORAGE_PATH = '/api/internal/v1/platform-integrations/storage';
let cache = null;

function sharedSecret(environment = process.env) {
    const file = String(environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || '').trim();
    const value = file ? fs.readFileSync(file, 'utf8').trim() : String(environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET || '').trim();
    if (value.length >= 32) return value;
    if (environment.NODE_ENV !== 'production') return 'experience-admin-development-secret-change-me';
    throw new Error('Approver platform configuration authentication is not configured.');
}

async function resolveStoragePlatformConfiguration({ environment = process.env, force = false } = {}) {
    const now = Date.now();
    if (!force && cache?.expiresAt > now) return cache.value;
    const baseUrl = String(environment.IDP_PLATFORM_CONFIGURATION_URL || environment.IDP_ISSUER_URL || 'https://auth.seemplifyai.com').replace(/\/+$/u, '');
    const timestamp = String(now);
    const nonce = crypto.randomBytes(24).toString('base64url');
    const signature = crypto.createHmac('sha256', sharedSecret(environment))
        .update(`${timestamp}\n${nonce}\n${SERVICE}\nGET\n${STORAGE_PATH}`).digest('hex');
    const response = await fetch(`${baseUrl}${STORAGE_PATH}`, {
        headers: { accept: 'application/json', 'x-seemplify-service': SERVICE, 'x-seemplify-timestamp': timestamp,
            'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature },
        signal: AbortSignal.timeout(Number(environment.IDP_PLATFORM_CONFIGURATION_TIMEOUT_MS || 5_000))
    });
    if (!response.ok) throw new Error(`Identity returned ${response.status}.`);
    const value = await response.json();
    if (!value?.configured) throw new Error('Managed storage is not configured.');
    cache = { value, expiresAt: now + 5 * 60_000 };
    return value;
}

function clearStoragePlatformConfigurationCache() { cache = null; }

module.exports = { clearStoragePlatformConfigurationCache, resolveStoragePlatformConfiguration };
