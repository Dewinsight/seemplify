'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertRotationFinalizationReady,
  assertPersistentGatewayStorage,
  assertRetiredKeysRejected,
  clearRetirementLedger,
  configureApplication,
  configureEnvironment,
  consumerEnvironment,
  decryptRetirementLedger,
  deploymentSourceWithIdpWebhookDestinations,
  deriveIdpWebhookSecret,
  deriveIdpWebhookTargetSecret,
  deriveLocalLlmServiceSecret,
  deriveMessagingProxySecret,
  derivePerformanceProxySecret,
  deploymentPreflight,
  encryptRetirementLedger,
  forbiddenWebhookKeysForTarget,
  gatewayConsumerRegistrationProbe,
  gatewayReadinessProbe,
  parseEnv,
  platformUsageSinkUrl,
  previousWebhookSecretProof,
  prepareRetirementLedger,
  requiredConsumerIds,
  resolveMessagingConsumer,
  recruiterProxyReadinessProbe,
  rotationReadinessSmoke,
  ROTATION_RETIREMENT_LEDGER_KEY,
  waitForGatewayReadiness,
  waitForDeploymentCompletion,
  webhookReceiverReadinessProbe,
  webhookReceiverUrl,
  resolveGatewaySecrets,
  safePreviousWebhookSecret
} = require('./dokploy-configure.cjs');

function webhookAcknowledgement(init, status = 200) {
  const payload = JSON.parse(init.body);
  return new Response(JSON.stringify({
    received: true,
    event: payload.event,
    eventId: payload.eventId
  }), { status, headers: { 'content-type': 'application/json' } });
}

test('deployment preflight requires the IdP and every current webhook receiver', () => {
  assert.throws(() => requiredConsumerIds({
    IDENTITY_PROVIDER_APP_ID: 'idp-app',
    RECRUITER_BACKEND_APP_ID: 'recruiter-app'
  }), /LEAVE_BACKEND_APP_ID/);
  assert.deepEqual(requiredConsumerIds({
    IDENTITY_PROVIDER_APP_ID: 'idp-app',
    LEAVE_BACKEND_APP_ID: 'leave-app',
    PAYROLL_BACKEND_APP_ID: 'payroll-app',
    RECRUITER_BACKEND_APP_ID: 'recruiter-app',
    PERFORMANCE_BACKEND_APP_ID: 'performance-app'
  }), [
    { id: 'identity-provider', applicationId: 'idp-app' },
    { id: 'leave-management', applicationId: 'leave-app' },
    { id: 'payroll', applicationId: 'payroll-app' },
    { id: 'performance-management', applicationId: 'performance-app' },
    { id: 'recruiter', applicationId: 'recruiter-app' }
  ]);
});

test('Messaging deployment uses an explicit app id or discovers one exact Dokploy backend', async () => {
  const explicit = await resolveMessagingConsumer({ MESSAGING_BACKEND_APP_ID: 'messaging-explicit' }, {
    requestImpl: async () => { throw new Error('discovery must not run'); }
  });
  assert.deepEqual(explicit, { id: 'messaging', applicationId: 'messaging-explicit' });

  const discovered = await resolveMessagingConsumer({}, {
    requestImpl: async (path) => {
      assert.equal(path, '/project.all');
      return [{ environments: [{ applications: [
        { applicationId: 'frontend-app', name: 'messaging-frontend', domains: [{ host: 'messaging.seemplifyai.com' }] },
        { applicationId: 'backend-app', name: 'legacy-name', domains: [{ host: 'api-messaging.seemplifyai.com' }] }
      ] }] }];
    }
  });
  assert.deepEqual(discovered, { id: 'messaging', applicationId: 'backend-app' });

  await assert.rejects(
    resolveMessagingConsumer({}, { requestImpl: async () => [{ applications: [] }] }),
    /set MESSAGING_BACKEND_APP_ID explicitly/
  );
  await assert.rejects(
    resolveMessagingConsumer({}, { requestImpl: async () => [{ applications: [
      { applicationId: 'first', name: 'messaging-backend' },
      { applicationId: 'second', appName: 'messaging-backend' }
    ] }] }),
    /matched more than one application/
  );
});

test('gateway deployment requires a named /data volume and an enabled matching backup', () => {
  assert.throws(() => assertPersistentGatewayStorage([], []), /named-volume mount/);
  assert.throws(() => assertPersistentGatewayStorage([
    { type: 'bind', mountPath: '/data', hostPath: '/tmp/data' }
  ], []), /named-volume mount/);
  assert.throws(() => assertPersistentGatewayStorage([
    { type: 'volume', mountPath: '/data', volumeName: 'chatgpt_gateway_data' }
  ], []), /requires an enabled Dokploy volume backup/);
  assert.throws(() => assertPersistentGatewayStorage([
    { type: 'volume', mountPath: '/data', volumeName: 'chatgpt_gateway_data' }
  ], [{ volumeName: 'chatgpt_gateway_data', enabled: null }]), /requires an enabled Dokploy volume backup/);
  assert.throws(() => assertPersistentGatewayStorage([
    { type: 'volume', mountPath: '/data', volumeName: 'chatgpt_gateway_data' }
  ], [], {
    CHATGPT_GATEWAY_HOST_SNAPSHOT_VOLUME: 'another_volume',
    CHATGPT_GATEWAY_HOST_SNAPSHOT_ARCHIVE: 'chatgpt-gateway-20260812T154901Z.tar.gz',
    CHATGPT_GATEWAY_HOST_SNAPSHOT_SHA256: 'a'.repeat(64)
  }), /requires an enabled Dokploy volume backup/);
  const hostSnapshotResult = assertPersistentGatewayStorage([
    { type: 'volume', mountPath: '/data', volumeName: 'chatgpt_gateway_data' }
  ], [], {
    CHATGPT_GATEWAY_HOST_SNAPSHOT_VOLUME: 'chatgpt_gateway_data',
    CHATGPT_GATEWAY_HOST_SNAPSHOT_ARCHIVE: 'chatgpt-gateway-20260812T154901Z.tar.gz',
    CHATGPT_GATEWAY_HOST_SNAPSHOT_SHA256: 'a'.repeat(64)
  });
  assert.equal(hostSnapshotResult.backup.type, 'verified-host-snapshot');
  assert.equal(hostSnapshotResult.backup.volumeName, 'chatgpt_gateway_data');
  assert.equal(hostSnapshotResult.backup.sha256, 'a'.repeat(64));
  const dockerMountResult = assertPersistentGatewayStorage([
    {
      Type: 'volume',
      Name: 'chatgpt_gateway_data',
      Source: '/var/lib/docker/volumes/chatgpt_gateway_data/_data',
      Destination: '/data'
    }
  ], [{ volumeName: 'chatgpt_gateway_data', enabled: true, volumeBackupId: 'backup-live' }]);
  assert.equal(dockerMountResult.dataMount.volumeName, 'chatgpt_gateway_data');
  const result = assertPersistentGatewayStorage({ mounts: [
    { type: 'volume', mountPath: '/data/', volumeName: 'chatgpt_gateway_data' }
  ] }, { data: { volumeBackups: [
    { volumeName: 'chatgpt_gateway_data', enabled: true, volumeBackupId: 'backup-1' }
  ] } });
  assert.equal(result.dataMount.volumeName, 'chatgpt_gateway_data');
  assert.equal(result.backup.volumeBackupId, 'backup-1');
});

test('deployment preflight rejects an application ID reused by two trust boundaries before fetching', async () => {
  await assert.rejects(
    deploymentPreflight('same-app', [{ id: 'recruiter', applicationId: 'same-app' }]),
    /must be unique/
  );
});

test('shared production configuration keeps Local inference separate from ChatGPT Connect', () => {
  const configured = configureEnvironment('KEEP_ME=yes\nRECRUITER_BACKEND_URL=https://legacy.test', {
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt-gateway.example.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'hosted-secret',
    LOCAL_LLM_BASE_URL: 'https://local-gateway.example.test',
    LOCAL_LLM_SHARED_SECRET: 'local-secret'
  }, ['RECRUITER_BACKEND_URL']);
  const values = parseEnv(configured.env).values;
  assert.equal(values.get('KEEP_ME'), 'yes');
  assert.equal(values.has('RECRUITER_BACKEND_URL'), false);
  assert.equal(values.get('CHATGPT_GATEWAY_BASE_URL'), 'https://chatgpt-gateway.example.test');
  assert.equal(values.get('LOCAL_LLM_BASE_URL'), 'https://local-gateway.example.test');
});

test('hosted gateway usage sink is pinned to the signed Recruiter ingestion route', () => {
  assert.equal(
    platformUsageSinkUrl({ SEEMPLIFY_SHARED_AI_URL: 'https://api.example.test/' }),
    'https://api.example.test/api/internal/ai/v1/chatgpt-usage/events'
  );
  assert.throws(() => platformUsageSinkUrl({
    PLATFORM_AI_USAGE_SINK_URL: 'https://api.example.test/api/other'
  }), /ChatGPT usage ingestion route/);
  assert.throws(() => platformUsageSinkUrl({
    NODE_ENV: 'production',
    PLATFORM_AI_USAGE_SINK_URL: 'http://api.example.test/api/internal/ai/v1/chatgpt-usage/events'
  }), /HTTPS/);
});

test('only Recruiter receives the gateway master and connected apps receive distinct proxy keys', () => {
  const source = {
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test', CHATGPT_GATEWAY_SHARED_SECRET: 'chatgpt-secret',
    LOCAL_LLM_BASE_URL: 'https://local.test', LOCAL_LLM_SHARED_SECRET: 'local-secret',
    IDP_WEBHOOK_MASTER_SECRET: 'independent-idp-webhook-master-secret'
  };
  for (const id of ['identity-provider', 'leave-management', 'payroll', 'recruiter', 'time-attendance']) {
    const env = consumerEnvironment(id, source);
    assert.equal(env.SEEMPLIFY_AI_SOURCE_APP, id);
    assert.equal(env.LOCAL_LLM_BASE_URL, 'https://local.test');
    assert.equal(env.LOCAL_LLM_SERVICE_SECRET, deriveLocalLlmServiceSecret('local-secret', id));
    if (id === 'recruiter') {
      assert.equal(env.CHATGPT_GATEWAY_BASE_URL, 'https://chatgpt.test');
      assert.equal(env.CHATGPT_GATEWAY_SHARED_SECRET, 'chatgpt-secret');
      assert.equal(env.LOCAL_LLM_SHARED_SECRET, 'local-secret');
      assert.equal(env.ENABLE_LLM_MATCHING, 'true');
    } else {
      assert.equal(env.CHATGPT_GATEWAY_BASE_URL, undefined);
      assert.equal(env.CHATGPT_GATEWAY_SHARED_SECRET, undefined);
      assert.equal(env.LOCAL_LLM_SHARED_SECRET, undefined);
    }
  }
  const recruiter = consumerEnvironment('recruiter', source);
  const messaging = consumerEnvironment('messaging', source);
  const performance = consumerEnvironment('performance-management', source);
  const derived = derivePerformanceProxySecret('chatgpt-secret');
  const messagingDerived = deriveMessagingProxySecret('chatgpt-secret');
  assert.equal(recruiter.PERFORMANCE_AI_SHARED_SECRET, derived);
  assert.equal(performance.PERFORMANCE_AI_SHARED_SECRET, derived);
  assert.equal(performance.CHATGPT_GATEWAY_SHARED_SECRET, undefined);
  assert.equal(performance.CHATGPT_GATEWAY_BASE_URL, undefined);
  assert.notEqual(performance.LOCAL_LLM_SERVICE_SECRET, recruiter.LOCAL_LLM_SERVICE_SECRET);
  assert.equal(performance.LOCAL_LLM_SHARED_SECRET, undefined);
  assert.notEqual(derived, 'chatgpt-secret');
  assert.equal(performance.SEEMPLIFY_SHARED_AI_URL, 'https://api.seemplifyai.com');
  assert.equal(recruiter.MESSAGING_AI_SHARED_SECRET, messagingDerived);
  assert.equal(messaging.MESSAGING_AI_SHARED_SECRET, messagingDerived);
  assert.equal(messaging.SEEMPLIFY_SHARED_AI_URL, 'https://api.seemplifyai.com');
  assert.equal(messaging.CHATGPT_GATEWAY_SHARED_SECRET, undefined);
  assert.equal(messaging.LOCAL_LLM_SHARED_SECRET, undefined);
  assert.notEqual(messagingDerived, derived);
  assert.equal(
    consumerEnvironment('recruiter', { ...source, ENABLE_LLM_MATCHING: 'false' }).ENABLE_LLM_MATCHING,
    'false'
  );
  const webhookRoot = deriveIdpWebhookSecret('independent-idp-webhook-master-secret');
  assert.equal(webhookRoot.length, 64);
  const targetSecrets = new Map(['leave-management', 'payroll', 'performance-management', 'recruiter'].map((id) => [
    id,
    consumerEnvironment(id, source).IDP_WEBHOOK_SECRET
  ]));
  assert.equal(new Set(targetSecrets.values()).size, targetSecrets.size);
  for (const [id, targetSecret] of targetSecrets) {
    assert.equal(targetSecret, deriveIdpWebhookTargetSecret(webhookRoot, id));
    for (const [otherId, otherSecret] of targetSecrets) {
      if (otherId !== id) assert.notEqual(targetSecret, otherSecret);
    }
  }
  const idp = consumerEnvironment('identity-provider', source);
  assert.equal(idp.IDP_WEBHOOK_SECRET, webhookRoot);
  assert.equal(idp.IDP_WEBHOOK_SECRET_RECRUITER, targetSecrets.get('recruiter'));
  assert.equal(idp.IDP_WEBHOOK_SECRET_PERFORMANCE_MANAGEMENT, targetSecrets.get('performance-management'));
  assert.notEqual(consumerEnvironment('time-attendance', source).IDP_WEBHOOK_SECRET, webhookRoot);
  assert.equal(
    consumerEnvironment('recruiter', source, { previousWebhookSecret: 'prior-recruiter-webhook-key' })
      .IDP_WEBHOOK_SECRET_PREVIOUS,
    'prior-recruiter-webhook-key'
  );
});

test('IdP webhook master rejects weak and placeholder operator secrets', () => {
  assert.throws(() => deriveIdpWebhookSecret('x'), /32 high-entropy bytes/);
  assert.throws(() => deriveIdpWebhookSecret('change-me-webhook-secret-change-me-webhook-secret'), /placeholder/);
  assert.throws(() => deriveIdpWebhookSecret('a'.repeat(64)), /high-entropy/);
  assert.equal(deriveIdpWebhookSecret('4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf').length, 64);
});

test('receiver migration scrubs the operator root and every sibling target key', () => {
  const source = {
    CHATGPT_GATEWAY_SHARED_SECRET: 'gateway-secret',
    LOCAL_LLM_BASE_URL: 'https://local.test',
    LOCAL_LLM_SHARED_SECRET: 'local-secret',
    IDP_WEBHOOK_MASTER_SECRET: '4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf'
  };
  const current = [
    'IDP_WEBHOOK_MASTER_SECRET=operator-root-must-go',
    'IDP_WEBHOOK_SECRET_RECRUITER=recruiter-key-must-go',
    'IDP_WEBHOOK_SECRET_PAYROLL=payroll-key-must-go',
    'IDP_WEBHOOK_SECRET_LEAVE_MANAGEMENT=leave-key-must-go',
    'IDP_WEBHOOK_SECRET_PERFORMANCE_MANAGEMENT=performance-key-must-go'
  ].join('\n');
  const migrated = configureEnvironment(
    current,
    consumerEnvironment('payroll', source),
    forbiddenWebhookKeysForTarget('payroll')
  );
  const values = parseEnv(migrated.env).values;
  assert.equal(values.has('IDP_WEBHOOK_MASTER_SECRET'), false);
  assert.equal([...values.keys()].some(key => /^IDP_WEBHOOK_SECRET_(?:RECRUITER|PAYROLL|LEAVE_MANAGEMENT|PERFORMANCE_MANAGEMENT)$/.test(key)), false);
  assert.equal(values.has('IDP_WEBHOOK_SECRET'), true);
});

test('rotation never preserves a root or sibling target key as a receiver compatibility key', () => {
  const source = { IDP_WEBHOOK_MASTER_SECRET: '4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf' };
  const root = deriveIdpWebhookSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  const recruiterKey = deriveIdpWebhookTargetSecret(root, 'recruiter');
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${root}`
  }, 'payroll', source), '');
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET_PREVIOUS=${recruiterKey}\nIDP_WEBHOOK_SECRET=legacy-shared-key-that-is-at-least-32-characters`
  }, 'payroll', source), 'legacy-shared-key-that-is-at-least-32-characters');
  assert.equal(safePreviousWebhookSecret({
    env: 'IDP_WEBHOOK_SECRET=legacy-shared-key-at-least-32-characters'
  }, 'payroll', source), 'legacy-shared-key-at-least-32-characters');
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${source.IDP_WEBHOOK_MASTER_SECRET}`
  }, 'payroll', source), '');
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET_PREVIOUS=${source.IDP_WEBHOOK_MASTER_SECRET}`
  }, 'payroll', source), '');
  assert.throws(() => safePreviousWebhookSecret({
    env: 'IDP_WEBHOOK_SECRET=weak-legacy-key'
  }, 'payroll', source), /weak legacy webhook key/);
});

test('overlapping webhook rotation preserves the live current key rather than an older previous key', () => {
  const newSource = { IDP_WEBHOOK_MASTER_SECRET: 'new-C-master-4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf' };
  const priorRoot = deriveIdpWebhookSecret('prior-B-master-9F31z!tnD8r$M6qP1vW7yC4eS2jL5xUa');
  const olderRoot = deriveIdpWebhookSecret('older-A-master-8E20y!smC7q#N5eL0uV6zB3dR9hK1wTf');
  const liveCurrent = deriveIdpWebhookTargetSecret(priorRoot, 'payroll');
  const olderPrevious = deriveIdpWebhookTargetSecret(olderRoot, 'payroll');
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${liveCurrent}\nIDP_WEBHOOK_SECRET_PREVIOUS=${olderPrevious}`
  }, 'payroll', newSource), liveCurrent);
});

test('overlapping rotation preserves only the receiver own old target key', () => {
  const newSource = { IDP_WEBHOOK_MASTER_SECRET: 'new-C-master-4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf' };
  const oldRawMaster = 'prior-B-master-9F31z!tnD8r$M6qP1vW7yC4eS2jL5xUa';
  const oldRoot = deriveIdpWebhookSecret(oldRawMaster);
  const oldPayroll = deriveIdpWebhookTargetSecret(oldRoot, 'payroll');
  const oldRecruiter = deriveIdpWebhookTargetSecret(oldRoot, 'recruiter');
  const idpApplication = { env: [
    `IDP_WEBHOOK_MASTER_SECRET=${oldRawMaster}`,
    `IDP_WEBHOOK_SECRET=${oldRoot}`,
    `IDP_WEBHOOK_SECRET_PAYROLL=${oldPayroll}`,
    `IDP_WEBHOOK_SECRET_RECRUITER=${oldRecruiter}`
  ].join('\n') };

  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${oldPayroll}`
  }, 'payroll', newSource, idpApplication), oldPayroll);
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${oldRoot}`
  }, 'payroll', newSource, idpApplication), '');
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${oldRecruiter}`
  }, 'payroll', newSource, idpApplication), '');
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${oldRawMaster}`
  }, 'payroll', newSource, idpApplication), '');

  const legacyShared = 'legacy-shared-key-that-is-at-least-32-characters';
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${legacyShared}`
  }, 'payroll', newSource, {
    env: `IDP_WEBHOOK_SECRET=${legacyShared}`
  }), legacyShared);

  const currentRoot = deriveIdpWebhookSecret(newSource.IDP_WEBHOOK_MASTER_SECRET);
  const currentPayroll = deriveIdpWebhookTargetSecret(currentRoot, 'payroll');
  assert.equal(safePreviousWebhookSecret({
    env: `IDP_WEBHOOK_SECRET=${currentPayroll}\nIDP_WEBHOOK_SECRET_PREVIOUS=${oldRecruiter}`
  }, 'payroll', newSource, {
    env: [
      `IDP_WEBHOOK_SECRET=${currentRoot}`,
      `IDP_WEBHOOK_SECRET_PAYROLL=${currentPayroll}`,
      `IDP_WEBHOOK_SECRET_RECRUITER=${deriveIdpWebhookTargetSecret(currentRoot, 'recruiter')}`
    ].join('\n')
  }), '');
});

test('an IdP-last deployment failure keeps only its proven receiver compatibility key on retry', () => {
  const oldRawMaster = 'prior-B-master-9F31z!tnD8r$M6qP1vW7yC4eS2jL5xUa';
  const newRawMaster = 'new-C-master-4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf';
  const oldRoot = deriveIdpWebhookSecret(oldRawMaster);
  const newRoot = deriveIdpWebhookSecret(newRawMaster);
  const oldPayroll = deriveIdpWebhookTargetSecret(oldRoot, 'payroll');
  const newPayroll = deriveIdpWebhookTargetSecret(newRoot, 'payroll');
  const newSource = {
    IDP_WEBHOOK_MASTER_SECRET: newRawMaster,
    LOCAL_LLM_BASE_URL: 'https://local.example.test',
    LOCAL_LLM_SHARED_SECRET: 'local-runtime-master-secret'
  };
  const staged = consumerEnvironment('payroll', newSource, {
    previousWebhookSecret: oldPayroll
  });
  assert.equal(staged.IDP_WEBHOOK_SECRET, newPayroll);
  assert.equal(staged.IDP_WEBHOOK_SECRET_PREVIOUS, oldPayroll);
  assert.equal(
    staged.IDP_WEBHOOK_SECRET_PREVIOUS_PROOF,
    previousWebhookSecretProof(newRawMaster, 'payroll', oldPayroll)
  );

  // Dokploy saved the IdP C environment, but its deployment failed and the
  // running IdP is still B. A retry must redeploy receivers with C/B intact.
  const savedIdpAfterFailedDeploy = { env: [
    `IDP_WEBHOOK_SECRET=${newRoot}`,
    `IDP_WEBHOOK_SECRET_PAYROLL=${newPayroll}`,
    `IDP_WEBHOOK_SECRET_RECRUITER=${deriveIdpWebhookTargetSecret(newRoot, 'recruiter')}`
  ].join('\n') };
  const stagedReceiver = { env: [
    `IDP_WEBHOOK_SECRET=${staged.IDP_WEBHOOK_SECRET}`,
    `IDP_WEBHOOK_SECRET_PREVIOUS=${staged.IDP_WEBHOOK_SECRET_PREVIOUS}`,
    `IDP_WEBHOOK_SECRET_PREVIOUS_PROOF=${staged.IDP_WEBHOOK_SECRET_PREVIOUS_PROOF}`
  ].join('\n') };
  assert.equal(
    safePreviousWebhookSecret(stagedReceiver, 'payroll', newSource, savedIdpAfterFailedDeploy),
    oldPayroll
  );

  // The proof is target- and key-bound. An unknown sibling or manual value is
  // never retained merely because it is long enough to look strong.
  stagedReceiver.env = stagedReceiver.env.replace(
    staged.IDP_WEBHOOK_SECRET_PREVIOUS_PROOF,
    previousWebhookSecretProof(newRawMaster, 'recruiter', oldPayroll)
  );
  assert.equal(
    safePreviousWebhookSecret(stagedReceiver, 'payroll', newSource, savedIdpAfterFailedDeploy),
    ''
  );
});

test('gateway migration rotates request auth without re-encrypting existing receipts', () => {
  const migrated = resolveGatewaySecrets(
    'CHATGPT_GATEWAY_SHARED_SECRET=legacy-distributed-master',
    'bootstrap-secret',
    () => Buffer.from('fresh-request-secret')
  );
  assert.equal(migrated.requestSecret, Buffer.from('fresh-request-secret').toString('base64url'));
  assert.notEqual(migrated.requestSecret, 'legacy-distributed-master');
  assert.equal(migrated.previousRequestSecret, 'legacy-distributed-master');
  assert.equal(migrated.storageSecret, 'legacy-distributed-master');

  const stable = resolveGatewaySecrets([
    `RECRUITER_CHATGPT_GATEWAY_SECRET=${migrated.requestSecret}`,
    `RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET=${migrated.previousRequestSecret}`,
    `CHATGPT_GATEWAY_STORAGE_SECRET=${migrated.storageSecret}`
  ].join('\n'), 'ignored-bootstrap', () => { throw new Error('must not rotate on every deploy'); });
  assert.deepEqual(stable, migrated);
});

test('rotation finalization is a separate approved run after every target has the staged keys', () => {
  const priorApproval = process.env.SEEMPLIFY_SECRET_ROTATION_APPROVED;
  process.env.SEEMPLIFY_SECRET_ROTATION_APPROVED = 'true';
  const deploymentSource = {
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'gateway-current',
    LOCAL_LLM_BASE_URL: 'https://local.test',
    LOCAL_LLM_SHARED_SECRET: 'local-master',
    IDP_WEBHOOK_MASTER_SECRET: 'independent-idp-webhook-master-secret'
  };
  const consumers = [
    { id: 'recruiter', applicationId: 'recruiter-app' },
    { id: 'performance-management', applicationId: 'performance-app' },
    { id: 'identity-provider', applicationId: 'idp-app' }
  ];
  const applications = new Map([
    ['gateway-app', { env: 'RECRUITER_CHATGPT_GATEWAY_SECRET=gateway-current' }],
    ...consumers.map((consumer) => [
      consumer.applicationId,
      { env: Object.entries(consumerEnvironment(consumer.id, deploymentSource))
        .map(([key, value]) => `${key}=${value}`).join('\n') }
    ])
  ]);
  try {
    assert.doesNotThrow(() => assertRotationFinalizationReady({
      gatewayId: 'gateway-app',
      consumers,
      applications,
      deploymentSource,
      gatewaySecrets: { requestSecret: 'gateway-current' }
    }));
    applications.get('performance-app').env = 'IDP_WEBHOOK_SECRET=stale';
    assert.throws(() => assertRotationFinalizationReady({
      gatewayId: 'gateway-app',
      consumers,
      applications,
      deploymentSource,
      gatewaySecrets: { requestSecret: 'gateway-current' }
    }), /performance-management has not completed/);
  } finally {
    if (priorApproval === undefined) delete process.env.SEEMPLIFY_SECRET_ROTATION_APPROVED;
    else process.env.SEEMPLIFY_SECRET_ROTATION_APPROVED = priorApproval;
  }
});

test('retirement ledger is authenticated ciphertext bound to the operator master and gateway', () => {
  const operatorMaster = 'ledger-master-4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf';
  const retiredKeys = {
    gateway: 'retired-gateway-secret-exact',
    performanceProxy: 'retired-proxy-secret-exact',
    webhooks: {
      recruiter: 'retired-recruiter-webhook-exact',
      payroll: 'retired-payroll-webhook-exact'
    }
  };
  const serialized = encryptRetirementLedger(retiredKeys, operatorMaster, 'gateway-app', {
    randomBytes: size => Buffer.alloc(size, size),
    now: () => 1786291200000
  });
  assert.match(serialized, /^v1\./);
  for (const secret of [
    retiredKeys.gateway,
    retiredKeys.performanceProxy,
    ...Object.values(retiredKeys.webhooks)
  ]) assert.equal(serialized.includes(secret), false);
  assert.deepEqual(
    decryptRetirementLedger(serialized, operatorMaster, 'gateway-app'),
    retiredKeys
  );

  const last = serialized.at(-1);
  const tampered = `${serialized.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
  assert.throws(
    () => decryptRetirementLedger(tampered, operatorMaster, 'gateway-app'),
    /authentication failed/
  );
  assert.throws(
    () => decryptRetirementLedger(
      serialized,
      'wrong-master-9F31z!tnD8r$M6qP1vW7yC4eS2jL5xUa',
      'gateway-app'
    ),
    /authentication failed/
  );
  assert.throws(
    () => decryptRetirementLedger(serialized, operatorMaster, 'different-gateway-app'),
    /authentication failed/
  );
});

test('failed finalization resumes exact retirement evidence and clears it only after rejection proof', async () => {
  const operatorMaster = 'ledger-master-4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf';
  const retiredKeys = {
    gateway: 'old-gateway-key',
    performanceProxy: 'old-proxy-key',
    webhooks: { recruiter: 'old-recruiter-webhook', payroll: 'old-payroll-webhook' }
  };
  const gatewayApplication = {
    env: [
      'RECRUITER_CHATGPT_GATEWAY_SECRET=new-gateway-key',
      `RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET=${retiredKeys.gateway}`
    ].join('\n')
  };
  const saves = [];
  const requestImpl = async (path, options = {}) => {
    if (path === '/application.saveEnvironment') saves.push(JSON.parse(options.body).env);
    return {};
  };
  const firstRun = await prepareRetirementLedger({
    rotationPhase: 'finalize',
    gatewayId: 'gateway-app',
    gatewayApplication,
    retiredKeys,
    operatorMaster,
    requestImpl,
    randomBytes: size => Buffer.alloc(size, size),
    now: () => 1786291200000
  });
  assert.equal(firstRun.resumed, false);
  assert.equal(saves.length, 1);
  assert.ok(parseEnv(gatewayApplication.env).values.get(ROTATION_RETIREMENT_LEDGER_KEY));

  // Dokploy saves the environment without the previous gateway key, but the
  // exact deployment then fails. This is the saved-env/running-revision split
  // that previously made the retired key unrecoverable on a retry.
  await assert.rejects(configureApplication(
    'gateway-app',
    {
      RECRUITER_CHATGPT_GATEWAY_SECRET: 'new-gateway-key',
      [ROTATION_RETIREMENT_LEDGER_KEY]: firstRun.serialized
    },
    ['RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET'],
    gatewayApplication,
    {
      title: 'failed-finalize',
      requestImpl,
      waitForDeploymentImpl: async () => { throw new Error('build failed after environment save'); }
    }
  ), /build failed after environment save/);
  assert.equal(
    parseEnv(gatewayApplication.env).values.has('RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET'),
    false
  );

  const resumed = await prepareRetirementLedger({
    rotationPhase: 'finalize',
    gatewayId: 'gateway-app',
    gatewayApplication,
    retiredKeys: { gateway: '', performanceProxy: '', webhooks: {} },
    operatorMaster,
    requestImpl
  });
  assert.equal(resumed.resumed, true);
  assert.deepEqual(resumed.retiredKeys, retiredKeys);
  await assert.rejects(prepareRetirementLedger({
    rotationPhase: 'stage',
    gatewayId: 'gateway-app',
    gatewayApplication,
    retiredKeys: null,
    operatorMaster,
    requestImpl
  }), /resume finalization/);

  await assert.rejects(assertRetiredKeysRejected(resumed.retiredKeys, {
    CHATGPT_GATEWAY_BASE_URL: 'https://gateway.example.test',
    SEEMPLIFY_SHARED_AI_URL: 'https://api.example.test',
    PAYROLL_MANAGEMENT_API_URL: 'https://payroll.example.test'
  }, {
    attempts: 3,
    fetchImpl: async () => new Response('{}', { status: 200 })
  }), /was not rejected/);
  assert.ok(parseEnv(gatewayApplication.env).values.get(ROTATION_RETIREMENT_LEDGER_KEY));

  let negativeProbes = 0;
  await assertRetiredKeysRejected(resumed.retiredKeys, {
    CHATGPT_GATEWAY_BASE_URL: 'https://gateway.example.test',
    SEEMPLIFY_SHARED_AI_URL: 'https://api.example.test',
    PAYROLL_MANAGEMENT_API_URL: 'https://payroll.example.test'
  }, {
    attempts: 3,
    now: () => 1786291200000,
    fetchImpl: async () => {
      negativeProbes += 1;
      return new Response('{}', { status: 401 });
    }
  });
  assert.equal(negativeProbes, 12);
  await clearRetirementLedger('gateway-app', gatewayApplication, { requestImpl });
  assert.equal(parseEnv(gatewayApplication.env).values.has(ROTATION_RETIREMENT_LEDGER_KEY), false);
});

test('finalization probes the live gateway and Performance proxy with their current keys', async () => {
  const calls = [];
  const result = await rotationReadinessSmoke({
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.example.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'gateway-current',
    SEEMPLIFY_SHARED_AI_URL: 'https://api.example.test',
    IDP_WEBHOOK_MASTER_SECRET: '4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf'
  }, {
    now: () => 1786291200000,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/api/ai-account/deployment-health')) {
        return new Response(JSON.stringify({ ok: true, shared: { ok: true } }), { status: 200 });
      }
      if (url.includes('/api/internal/webhook-readiness')) {
        return new Response(JSON.stringify({
          ok: true,
          targets: ['smarthr', 'leaveManagement', 'payroll', 'performance']
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ connected: false }), { status: 200 });
    }
  });
  assert.deepEqual(result, { gateway: true, performanceProxy: true, webhookTargets: true });
  assert.equal(calls[0].url, 'https://chatgpt.example.test/v1/codex/account');
  assert.equal(calls[1].url, 'https://api-performance.seemplifyai.com/api/ai-account/deployment-health');
  assert.equal(calls[1].init.headers['x-seemplify-service'], 'performance-management');
  assert.equal(calls[1].init.headers['x-seemplify-signature-version'], '2');
  assert.equal(calls[2].url, 'https://auth.seemplifyai.com/api/internal/webhook-readiness');
});

test('stage waits for the live gateway to accept the current key before rotating consumers', async () => {
  let attempts = 0;
  let waits = 0;
  const ready = await waitForGatewayReadiness({
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.example.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'gateway-current'
  }, {
    attempts: 3,
    delayMs: 0,
    now: () => 1786291200000,
    wait: async () => { waits += 1; },
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response('{}', { status: 401 })
        : new Response(JSON.stringify({ connected: false }), { status: 200 });
    }
  });
  assert.equal(ready, true);
  assert.equal(attempts, 2);
  assert.equal(waits, 1);
});

test('pre-cutover webhook probe exercises a receiver with its staged target key', async () => {
  let captured;
  const source = {
    IDP_WEBHOOK_MASTER_SECRET: '4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf',
    PAYROLL_MANAGEMENT_API_URL: 'https://payroll.example.test'
  };
  assert.equal(await webhookReceiverReadinessProbe('payroll', source, {
    now: () => 1786291200000,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return webhookAcknowledgement(init);
    }
  }), true);
  assert.equal(captured.url, 'https://payroll.example.test/api/webhooks/idp');
  const secret = deriveIdpWebhookTargetSecret(
    deriveIdpWebhookSecret(source.IDP_WEBHOOK_MASTER_SECRET),
    'payroll'
  );
  assert.equal(
    captured.init.headers['x-idp-signature-v2'],
    require('node:crypto').createHmac('sha256', secret)
      .update(`${captured.init.headers['x-idp-delivery-timestamp']}\n${captured.init.body}`)
      .digest('hex')
  );
});

test('readiness probes reject HTML or unrelated 200 responses', async () => {
  const source = {
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.example.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'gateway-current',
    SEEMPLIFY_SHARED_AI_URL: 'https://api.example.test'
  };
  await assert.rejects(gatewayReadinessProbe(source, {
    fetchImpl: async () => new Response('<html>ok</html>', { status: 200 })
  }), /invalid JSON response/);
  await assert.rejects(gatewayReadinessProbe(source, {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  }), /invalid account status/);
  await assert.rejects(gatewayConsumerRegistrationProbe(source, {
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      service: 'seemplify-ai-gateway',
      runtime: 'codex-app-server',
      ownership: 'seemplify-platform',
      consumers: ['recruiter']
    }), { status: 200 })
  }), /did not register Messaging/);
  assert.equal(await gatewayConsumerRegistrationProbe(source, {
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://chatgpt.example.test/health');
      assert.equal(init.redirect, 'error');
      return new Response(JSON.stringify({
        ok: true,
        service: 'seemplify-ai-gateway',
        runtime: 'codex-app-server',
        ownership: 'seemplify-platform',
        consumers: ['recruiter', 'messaging']
      }), { status: 200 });
    }
  }), true);
  await assert.rejects(recruiterProxyReadinessProbe(source, {
    fetchImpl: async () => new Response('<html>ok</html>', { status: 200 })
  }), /invalid JSON response/);
  await assert.rejects(recruiterProxyReadinessProbe(source, {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  }), /invalid service identity/);
});

test('webhook readiness uses saved IdP destinations and rejects false acknowledgements', async () => {
  const source = deploymentSourceWithIdpWebhookDestinations({
    NODE_ENV: 'production',
    IDP_WEBHOOK_MASTER_SECRET: '4P21x!smC9q#N7eL0uV6zB8dR5hK3wTf'
  }, {
    env: 'PAYROLL_WEBHOOK_URL=https://custom-payroll.example.test/hooks/idp'
  });
  assert.equal(webhookReceiverUrl('payroll', source), 'https://custom-payroll.example.test/hooks/idp');
  await assert.rejects(webhookReceiverReadinessProbe('payroll', source, {
    fetchImpl: async () => new Response('<html>proxy page</html>', { status: 200 })
  }), /invalid JSON response/);
  await assert.rejects(webhookReceiverReadinessProbe('payroll', source, {
    fetchImpl: async () => new Response(JSON.stringify({ received: true }), { status: 200 })
  }), /invalid event acknowledgement/);
  assert.throws(() => webhookReceiverUrl('payroll', {
    NODE_ENV: 'production',
    PAYROLL_WEBHOOK_URL: 'http://custom-payroll.example.test/hooks/idp'
  }), /must use HTTPS/);
});

test('Dokploy deployment polling blocks on a running revision and fails closed on errors', async () => {
  let polls = 0;
  let waits = 0;
  const completed = await waitForDeploymentCompletion('app-1', 'rotation-1', {
    delayMs: 0,
    wait: async () => { waits += 1; },
    requestImpl: async () => ({ deployments: [{
      title: 'rotation-1',
      status: ++polls < 3 ? 'running' : 'done',
      deploymentId: 'deployment-1'
    }] })
  });
  assert.equal(completed.deploymentId, 'deployment-1');
  assert.equal(polls, 3);
  assert.equal(waits, 2);

  await assert.rejects(waitForDeploymentCompletion('app-2', 'rotation-2', {
    attempts: 1,
    delayMs: 0,
    requestImpl: async () => ({ deployments: [{
      title: 'rotation-2', status: 'error', errorMessage: 'build failed'
    }] })
  }), /build failed/);
});

test('application configuration does not resolve until its exact deployment completes', async () => {
  const calls = [];
  await configureApplication('app-1', { CURRENT_KEY: 'new' }, [], { env: 'CURRENT_KEY=old' }, {
    title: 'rotation-exact',
    requestImpl: async (path) => { calls.push(path); return {}; },
    waitForDeploymentImpl: async (applicationId, title) => {
      calls.push(`wait:${applicationId}:${title}`);
      return { status: 'done' };
    }
  });
  assert.deepEqual(calls, [
    '/application.saveEnvironment',
    '/application.deploy',
    'wait:app-1:rotation-exact'
  ]);
});

test('application configuration skips an exact live revision and accepts only proven running timeouts', async () => {
  const exactCalls = [];
  const alreadyReady = await configureApplication('gateway-app', { CURRENT_KEY: 'same' }, [], {
    env: 'CURRENT_KEY=same'
  }, {
    title: 'rotation-ready',
    requestImpl: async (path) => { exactCalls.push(path); return {}; },
    readinessProbe: async () => true
  });
  assert.equal(alreadyReady.status, 'already-ready');
  assert.deepEqual(exactCalls, []);

  let readinessChecks = 0;
  const accepted = await configureApplication('gateway-app', { CURRENT_KEY: 'new' }, [], {
    env: 'CURRENT_KEY=old'
  }, {
    title: 'rotation-running',
    requestImpl: async () => ({}),
    waitForDeploymentImpl: async () => {
      throw new Error('Dokploy deployment rotation-running did not complete (last status: running)');
    },
    readinessProbe: async () => { readinessChecks += 1; return true; },
    acceptRunningDeploymentWhenReady: true
  });
  assert.equal(accepted.status, 'ready-after-running-timeout');
  assert.equal(readinessChecks, 1);

  await assert.rejects(configureApplication('gateway-app', { CURRENT_KEY: 'new' }, [], {
    env: 'CURRENT_KEY=old'
  }, {
    title: 'rotation-error',
    requestImpl: async () => ({}),
    waitForDeploymentImpl: async () => {
      throw new Error('Dokploy deployment rotation-error error: build failed');
    },
    readinessProbe: async () => true,
    acceptRunningDeploymentWhenReady: true
  }), /build failed/);
});

test('finalization proves every previous credential is rejected repeatedly', async () => {
  const calls = [];
  const source = {
    CHATGPT_GATEWAY_BASE_URL: 'https://gateway.example.test',
    SEEMPLIFY_SHARED_AI_URL: 'https://api.example.test',
    PERFORMANCE_MANAGEMENT_API_URL: 'https://performance.example.test',
    LEAVE_MANAGEMENT_API_URL: 'https://leave.example.test',
    PAYROLL_MANAGEMENT_API_URL: 'https://payroll.example.test'
  };
  assert.equal(await assertRetiredKeysRejected({
    gateway: 'old-gateway-key',
    performanceProxy: 'old-proxy-key',
    webhooks: { recruiter: 'old-recruiter-webhook', payroll: 'old-payroll-webhook' }
  }, source, {
    attempts: 3,
    now: () => 1786291200000,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response('{}', { status: 401 });
    }
  }), true);
  assert.equal(calls.length, 12);

  await assert.rejects(assertRetiredKeysRejected({
    gateway: 'still-accepted-key', performanceProxy: '', webhooks: {}
  }, source, {
    attempts: 3,
    fetchImpl: async () => new Response('{}', { status: 200 })
  }), /was not rejected/);
  await assert.rejects(assertRetiredKeysRejected({
    gateway: 'old-gateway-key', performanceProxy: '', webhooks: {}
  }, {
    ...source,
    SEEMPLIFY_ROTATION_RETIREMENT_PROBE_ATTEMPTS: 'not-a-number'
  }, {
    fetchImpl: async () => new Response('{}', { status: 401 })
  }), /must be an integer from 3 to 50/);
});
