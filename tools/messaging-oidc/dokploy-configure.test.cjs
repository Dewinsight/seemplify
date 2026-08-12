'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  configureMessagingOidc,
  deploymentEnvironment,
  deriveMessagingMembershipSecret,
  deriveMessagingOidcSecret,
  idpMessagingClientReady,
  messagingOidcReady,
} = require('./dokploy-configure.cjs');

const master = '4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf';

test('Messaging OIDC uses a stable key separated from the operator master', () => {
  const secret = deriveMessagingOidcSecret(master);
  assert.equal(secret, deriveMessagingOidcSecret(master));
  assert.notEqual(secret, master);
  assert.ok(Buffer.byteLength(secret, 'utf8') >= 32);
  assert.throws(() => deriveMessagingOidcSecret('change-me'), /32 high-entropy bytes/);
});

test('membership reconciliation uses a dedicated matching service secret', () => {
  const environment = deploymentEnvironment({ IDP_WEBHOOK_MASTER_SECRET: master });
  const secret = deriveMessagingMembershipSecret(master);
  assert.equal(environment.identityProvider.MESSAGING_IDP_SERVICE_SECRET, secret);
  assert.equal(environment.messaging.MESSAGING_IDP_SERVICE_SECRET, secret);
  assert.notEqual(secret, deriveMessagingOidcSecret(master));
  assert.notEqual(secret, master);
});

test('the IdP and Messaging receive one matching production OIDC contract', () => {
  const environment = deploymentEnvironment({ IDP_WEBHOOK_MASTER_SECRET: master });
  assert.equal(
    environment.identityProvider.MESSAGING_OIDC_CLIENT_SECRET,
    environment.messaging.OIDC_CLIENT_SECRET,
  );
  assert.deepEqual(environment.messaging, {
    IDP_AUTH_REQUIRED: 'true',
    IDP_ISSUER_URL: 'https://auth.seemplifyai.com',
    OIDC_CLIENT_ID: 'messaging',
    OIDC_CLIENT_SECRET: environment.identityProvider.MESSAGING_OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI: 'https://api-workspace.seemplifyai.com/api/auth/oidc/callback',
    FRONTEND_URL: 'https://workspace.seemplifyai.com',
    APP_URL: 'https://workspace.seemplifyai.com',
    MESSAGING_IDP_SERVICE_SECRET: deriveMessagingMembershipSecret(master),
  });
});

test('deployment registers the IdP before enabling the Messaging client', async () => {
  const calls = [];
  const result = await configureMessagingOidc({
    IDENTITY_PROVIDER_APP_ID: 'idp-app',
    MESSAGING_BACKEND_APP_ID: 'messaging-app',
    IDP_WEBHOOK_MASTER_SECRET: master,
  }, {
    resolveMessagingConsumerImpl: async () => ({ id: 'messaging', applicationId: 'messaging-app' }),
    configureApplicationImpl: async (...args) => { calls.push(args); },
  });

  assert.deepEqual(result, {
    identityProviderId: 'idp-app', messagingApplicationId: 'messaging-app',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'idp-app');
  assert.equal(calls[1][0], 'messaging-app');
  assert.equal(calls[0][1].MESSAGING_OIDC_CLIENT_SECRET, calls[1][1].OIDC_CLIENT_SECRET);
  assert.deepEqual(calls[1][2], ['IDP_CLIENT_ID', 'IDP_CLIENT_SECRET']);
  assert.equal(typeof calls[0][4].waitForDeploymentImpl, 'function');
  assert.equal(typeof calls[1][4].waitForDeploymentImpl, 'function');
});

test('public readiness checks validate both ends of the OIDC trust', async () => {
  assert.equal(await idpMessagingClientReady('https://auth.example.test', {
    fetchImpl: async () => new Response(JSON.stringify([
      { appId: 'messaging', clientId: 'messaging', isActive: true },
    ]), { status: 200 }),
  }), true);
  assert.equal(await messagingOidcReady('https://api-messaging.example.test', {
    fetchImpl: async () => new Response(JSON.stringify({ configured: true, required: true }), {
      status: 200,
    }),
  }), true);
  assert.equal(await messagingOidcReady('https://api-messaging.example.test', {
    fetchImpl: async () => new Response(JSON.stringify({ configured: false, required: true }), {
      status: 200,
    }),
  }), false);
});
