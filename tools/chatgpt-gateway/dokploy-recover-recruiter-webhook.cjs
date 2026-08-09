'use strict';

const {
  configureApplication,
  deriveIdpWebhookSecret,
  deriveIdpWebhookTargetSecret,
  publicHealthProbe,
  waitForReadiness
} = require('./dokploy-configure.cjs');

async function main(source = process.env) {
  const recruiterId = String(source.RECRUITER_BACKEND_APP_ID || '').trim();
  const identityProviderId = String(source.IDENTITY_PROVIDER_APP_ID || '').trim();
  if (!recruiterId) throw new Error('RECRUITER_BACKEND_APP_ID is required');
  if (!identityProviderId) throw new Error('IDENTITY_PROVIDER_APP_ID is required');

  const root = deriveIdpWebhookSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  const recruiterSecret = deriveIdpWebhookTargetSecret(root, 'recruiter');

  // Restore the receiver first. The operator master remains in Actions only;
  // Recruiter receives just its target-bound derivative.
  const healthGatedDeployment = { waitForDeploymentImpl: async () => ({ status: 'health-gated' }) };
  await configureApplication(recruiterId, {
    IDP_WEBHOOK_SECRET: recruiterSecret,
    ENABLE_LLM_MATCHING: 'true'
  }, ['IDP_WEBHOOK_SECRET_PREVIOUS'], null, healthGatedDeployment);
  await waitForReadiness('Recruiter recovery health', () => (
    publicHealthProbe('https://api.seemplifyai.com/api/health')
  ));

  // Then update the sender with that same target-specific derivative. No
  // other product receives or can use Recruiter's webhook credential.
  await configureApplication(identityProviderId, {
    IDP_WEBHOOK_SECRET_RECRUITER: recruiterSecret
  }, [], null, healthGatedDeployment);
  await waitForReadiness('Identity Provider recovery health', () => (
    publicHealthProbe('https://auth.seemplifyai.com/health')
  ));

  process.stdout.write('Recruiter and Identity Provider webhook trust recovered with a target-bound secret.\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
