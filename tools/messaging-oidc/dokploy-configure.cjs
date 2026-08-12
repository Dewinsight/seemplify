'use strict';

const crypto = require('node:crypto');
const {
  configureApplication,
  deriveIdpWebhookSecret,
  resolveMessagingConsumer,
} = require('../chatgpt-gateway/dokploy-configure.cjs');

const MESSAGING_OIDC_KEY_CONTEXT = 'seemplify-oidc-client-v1:messaging';

function deriveMessagingOidcSecret(operatorMaster) {
  const master = String(operatorMaster || '').trim();
  deriveIdpWebhookSecret(master);
  return crypto.createHmac('sha256', master)
    .update(MESSAGING_OIDC_KEY_CONTEXT)
    .digest('base64url');
}

function deploymentEnvironment(source = process.env) {
  const issuer = String(source.IDP_ISSUER_URL || 'https://auth.seemplifyai.com').replace(/\/+$/, '');
  const frontendUrl = String(source.MESSAGING_URL || 'https://messaging.seemplifyai.com').replace(/\/+$/, '');
  const apiUrl = String(source.MESSAGING_API_URL || 'https://api-messaging.seemplifyai.com').replace(/\/+$/, '');
  const clientSecret = deriveMessagingOidcSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  return {
    identityProvider: {
      MESSAGING_OIDC_CLIENT_SECRET: clientSecret,
      MESSAGING_URL: frontendUrl,
      MESSAGING_API_URL: apiUrl,
    },
    messaging: {
      IDP_AUTH_REQUIRED: 'true',
      IDP_ISSUER_URL: issuer,
      OIDC_CLIENT_ID: 'messaging',
      OIDC_CLIENT_SECRET: clientSecret,
      OIDC_REDIRECT_URI: `${apiUrl}/api/auth/oidc/callback`,
      FRONTEND_URL: frontendUrl,
    },
  };
}

async function configureMessagingOidc(source = process.env, {
  configureApplicationImpl = configureApplication,
  resolveMessagingConsumerImpl = resolveMessagingConsumer,
} = {}) {
  const identityProviderId = String(source.IDENTITY_PROVIDER_APP_ID || '').trim();
  if (!identityProviderId) throw new Error('IDENTITY_PROVIDER_APP_ID is required');
  const messaging = await resolveMessagingConsumerImpl(source);
  const environment = deploymentEnvironment(source);

  // Register the provider first. Messaging stays fail-closed until that
  // deployment completes and only then receives the matching credential.
  await configureApplicationImpl(
    identityProviderId,
    environment.identityProvider,
    [],
    null,
    { title: `Configure Messaging OIDC provider ${new Date().toISOString()}` },
  );
  await configureApplicationImpl(
    messaging.applicationId,
    environment.messaging,
    ['IDP_CLIENT_ID', 'IDP_CLIENT_SECRET'],
    null,
    { title: `Configure Messaging OIDC client ${new Date().toISOString()}` },
  );
  return { identityProviderId, messagingApplicationId: messaging.applicationId };
}

if (require.main === module) {
  configureMessagingOidc().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  MESSAGING_OIDC_KEY_CONTEXT,
  configureMessagingOidc,
  deploymentEnvironment,
  deriveMessagingOidcSecret,
};
