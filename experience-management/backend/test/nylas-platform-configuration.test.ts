import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Experience loads Nylas credentials from Identity with a signed no-store request', async () => {
  const secret = 'experience-idp-contract-test-secret-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  process.env.IDP_PLATFORM_CONFIGURATION_URL = 'https://identity.example.test';
  process.env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET = secret;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-nylas-platform-'));
  const encryptionKeyFile = path.join(root, 'nylas-key');
  fs.writeFileSync(encryptionKeyFile, Buffer.alloc(32, 91).toString('base64url'));
  process.env.NYLAS_CREDENTIAL_ENCRYPTION_KEY_FILE = encryptionKeyFile;
  delete process.env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE;
  delete process.env.NYLAS_CLIENT_ID;
  delete process.env.NYLAS_API_KEY;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    if (String(url).endsWith('/v3/connect/token')) {
      return new Response(JSON.stringify({ data: { grant_id: 'grant-1', email: 'owner@example.test', provider: 'google' } }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({
      configured: true, clientId: 'central-client', apiKey: 'central-secret',
      apiUri: 'https://api.us.nylas.com', redirectUri: 'https://experience.example.test/callback',
      connectScopes: ['openid', 'Mail.Read'], webhookSecret: '', revision: 4
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const module = await import(`../src/nylasPlatformConfiguration.js?test=${Date.now()}`);
    const result = await module.resolveNylasPlatformConfiguration(true);
    assert.equal(result?.clientId, 'central-client');
    assert.equal(result?.apiKey, 'central-secret');
    assert.equal(captured[0].url, 'https://identity.example.test/api/internal/v1/platform-integrations/nylas');
    const headers = new Headers(captured[0].init?.headers);
    const timestamp = headers.get('x-seemplify-timestamp')!;
    const nonce = headers.get('x-seemplify-nonce')!;
    const canonical = `${timestamp}\n${nonce}\nexperience-management\nGET\n/api/internal/v1/platform-integrations/nylas`;
    assert.equal(headers.get('x-seemplify-signature'), crypto.createHmac('sha256', secret).update(canonical).digest('hex'));

    const client = await import('../src/nylasClient.js');
    const oauthState = 'state-value-with-enough-entropy-for-the-test';
    const authorizeUrl = new URL(await client.createNylasAuthorizeUrl('google', oauthState));
    assert.equal(authorizeUrl.origin, 'https://api.us.nylas.com');
    assert.equal(authorizeUrl.searchParams.get('client_id'), 'central-client');
    assert.equal(authorizeUrl.searchParams.get('redirect_uri'), 'https://experience.example.test/callback');
    assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
    const grant = await client.exchangeNylasCode('oauth-code', 'google', oauthState);
    assert.equal(grant.grantId, 'grant-1');
    const tokenCall = captured.find((call) => call.url.endsWith('/v3/connect/token'))!;
    const tokenBody = JSON.parse(String(tokenCall.init?.body));
    const verifier = String(tokenBody.code_verifier);
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(
      authorizeUrl.searchParams.get('code_challenge'),
      crypto.createHash('sha256').update(verifier).digest('base64url')
    );
    delete tokenBody.code_verifier;
    assert.deepEqual(tokenBody, {
      client_id: 'central-client', client_secret: 'central-secret', grant_type: 'authorization_code',
      redirect_uri: 'https://experience.example.test/callback', code: 'oauth-code'
    });
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
