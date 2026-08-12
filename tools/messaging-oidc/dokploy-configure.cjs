'use strict';

const crypto = require('node:crypto');
const {
  configureApplication,
  deriveIdpWebhookSecret,
  resolveMessagingConsumer,
} = require('../chatgpt-gateway/dokploy-configure.cjs');

const MESSAGING_OIDC_KEY_CONTEXT = 'seemplify-oidc-client-v1:messaging';
const MESSAGING_MEMBERSHIP_KEY_CONTEXT = 'seemplify-idp-membership-v1:messaging';

function deriveMessagingOidcSecret(operatorMaster) {
  const master = String(operatorMaster || '').trim();
  deriveIdpWebhookSecret(master);
  return crypto.createHmac('sha256', master)
    .update(MESSAGING_OIDC_KEY_CONTEXT)
    .digest('base64url');
}

function deriveMessagingMembershipSecret(operatorMaster) {
  const master = String(operatorMaster || '').trim();
  deriveIdpWebhookSecret(master);
  return crypto.createHmac('sha256', master)
    .update(MESSAGING_MEMBERSHIP_KEY_CONTEXT)
    .digest('base64url');
}

function deploymentEnvironment(source = process.env) {
  const issuer = String(source.IDP_ISSUER_URL || 'https://auth.seemplifyai.com').replace(/\/+$/, '');
  const frontendUrl = String(source.MESSAGING_URL || 'https://workspace.seemplifyai.com').replace(/\/+$/, '');
  const apiUrl = String(source.MESSAGING_API_URL || 'https://api-workspace.seemplifyai.com').replace(/\/+$/, '');
  const clientSecret = deriveMessagingOidcSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  const membershipSecret = deriveMessagingMembershipSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  return {
    identityProvider: {
      MESSAGING_OIDC_CLIENT_SECRET: clientSecret,
      MESSAGING_URL: frontendUrl,
      MESSAGING_API_URL: apiUrl,
      MESSAGING_WEBHOOK_URL: `${apiUrl}/api/webhooks/idp`,
      MESSAGING_IDP_SERVICE_SECRET: membershipSecret,
    },
    messaging: {
      IDP_AUTH_REQUIRED: 'true',
      IDP_ISSUER_URL: issuer,
      OIDC_CLIENT_ID: 'messaging',
      OIDC_CLIENT_SECRET: clientSecret,
      OIDC_REDIRECT_URI: `${apiUrl}/api/auth/oidc/callback`,
      FRONTEND_URL: frontendUrl,
      APP_URL: frontendUrl,
      MESSAGING_IDP_SERVICE_SECRET: membershipSecret,
    },
  };
}

async function waitForReadiness(label, probe, {
  attempts = 120,
  delayMs = 2_000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (await probe()) return true;
      lastError = new Error('service returned a non-ready response');
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await wait(delayMs);
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || 'timeout'}`);
}

async function idpMessagingClientReady(issuer, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${issuer}/api/apps`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`IDP app catalogue returned HTTP ${response.status}`);
  const apps = await response.json();
  return Array.isArray(apps) && apps.some((app) => (
    app?.appId === 'messaging' && app?.clientId === 'messaging' && app?.isActive === true
  ));
}

async function messagingOidcReady(apiUrl, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${apiUrl}/api/auth/oidc/status`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Messaging OIDC status returned HTTP ${response.status}`);
  const status = await response.json();
  return status?.configured === true && status?.required === true;
}

async function configureMessagingOidc(source = process.env, {
  configureApplicationImpl = configureApplication,
  resolveMessagingConsumerImpl = resolveMessagingConsumer,
} = {}) {
  const identityProviderId = String(source.IDENTITY_PROVIDER_APP_ID || '').trim();
  if (!identityProviderId) throw new Error('IDENTITY_PROVIDER_APP_ID is required');
  const messaging = await resolveMessagingConsumerImpl(source);
  const environment = deploymentEnvironment(source);
  const issuer = environment.messaging.IDP_ISSUER_URL;
  const apiUrl = new URL(environment.messaging.OIDC_REDIRECT_URI).origin;

  // Register the provider first. Messaging stays fail-closed until that
  // deployment completes and only then receives the matching credential.
  await configureApplicationImpl(
    identityProviderId,
    environment.identityProvider,
    [],
    null,
    {
      title: `Configure Messaging OIDC provider ${new Date().toISOString()}`,
      waitForDeploymentImpl: () => waitForReadiness(
        'Identity Provider Messaging client',
        () => idpMessagingClientReady(issuer),
      ),
    },
  );
  await configureApplicationImpl(
    messaging.applicationId,
    environment.messaging,
    ['IDP_CLIENT_ID', 'IDP_CLIENT_SECRET'],
    null,
    {
      title: `Configure Messaging OIDC client ${new Date().toISOString()}`,
      waitForDeploymentImpl: () => waitForReadiness(
        'Messaging OIDC client',
        () => messagingOidcReady(apiUrl),
      ),
    },
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
  deriveMessagingMembershipSecret,
  idpMessagingClientReady,
  messagingOidcReady,
  waitForReadiness,
};
