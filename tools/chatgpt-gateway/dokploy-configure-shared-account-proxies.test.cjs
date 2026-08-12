'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const centralConfigurator = require('./dokploy-configure.cjs');
const {
  SHARED_ACCOUNT_HEALTH_PATH,
  apiBase,
  configureSharedAccountProxies,
  consumerDeploymentEndpoint,
  consumerDeploymentReadinessProbe,
  dokployRequest,
  isStaleDeploymentTimeout,
  proxySecret,
  proxyRolloutTiming,
  requiredSource,
  sharedAccountProxyReadinessProbe,
  sharedProxyEnvironment,
  sharedProxyEnvironmentMatches,
  sharedProxyRemovedKeys,
  waitForConsumerDeploymentReadiness,
  waitForSharedAccountProxyReadiness
} = require('./dokploy-configure-shared-account-proxies.cjs');

const source = {
  DOKPLOY_URL: 'https://dokploy.example.test/',
  DOKPLOY_TOKEN: 'operator-token',
  CHATGPT_GATEWAY_SHARED_SECRET: 'gateway-master-secret',
  RECRUITER_BACKEND_APP_ID: 'recruiter-app',
  PERFORMANCE_BACKEND_APP_ID: 'performance-app',
  SEEMPLIFY_SHARED_AI_URL: 'https://recruiter.example.test/'
};

function consumerDeploymentPayload(serviceId) {
  return {
    ok: true,
    service: 'seemplify-shared-ai-consumer-deployment',
    consumer: serviceId,
    signatureVersion: '2',
    shared: {
      ok: true,
      service: 'seemplify-shared-ai-account',
      consumer: serviceId,
      signatureVersion: '2'
    }
  };
}

test('central configurator exports the narrow rollout dependencies', () => {
  for (const name of [
    'configureApplication',
    'configureEnvironment',
    'deriveMessagingProxySecret',
    'derivePerformanceProxySecret',
    'resolveMessagingConsumer',
    'waitForDeploymentCompletion',
    'waitForReadiness'
  ]) {
    assert.equal(typeof centralConfigurator[name], 'function', `${name} must remain exported`);
  }
});

test('proxy repair requires no gateway application, backup, webhook, local-runtime, or OIDC secrets', () => {
  const configured = requiredSource(source);
  assert.equal(configured.RECRUITER_BACKEND_APP_ID, 'recruiter-app');
  assert.equal(configured.PERFORMANCE_BACKEND_APP_ID, 'performance-app');
  assert.equal(configured.DOKPLOY_URL, 'https://dokploy.example.test/');
  assert.equal(configured.SEEMPLIFY_SHARED_AI_URL, 'https://recruiter.example.test');
  for (const key of [
    'CHATGPT_GATEWAY_APP_ID',
    'DOKPLOY_BACKUP_DESTINATION_ID',
    'IDP_WEBHOOK_MASTER_SECRET',
    'LOCAL_LLM_BASE_URL',
    'LOCAL_LLM_SHARED_SECRET',
    'OIDC_CLIENT_SECRET'
  ]) {
    assert.equal(configured[key], undefined, `${key} is outside the proxy-only rollout`);
  }
});

test('proxy repair fails closed when an authority or mandatory consumer setting is missing', () => {
  for (const key of [
    'DOKPLOY_URL',
    'DOKPLOY_TOKEN',
    'CHATGPT_GATEWAY_SHARED_SECRET',
    'RECRUITER_BACKEND_APP_ID',
    'PERFORMANCE_BACKEND_APP_ID'
  ]) {
    const candidate = { ...source, [key]: '' };
    assert.throws(() => requiredSource(candidate), new RegExp(key));
  }
});

test('proxy environments contain only target-bound central-account settings', () => {
  const configured = requiredSource(source);
  const performanceSecret = centralConfigurator.derivePerformanceProxySecret(
    configured.CHATGPT_GATEWAY_SHARED_SECRET
  );
  const messagingSecret = centralConfigurator.deriveMessagingProxySecret(
    configured.CHATGPT_GATEWAY_SHARED_SECRET
  );

  assert.deepEqual(sharedProxyEnvironment('recruiter', configured), {
    PERFORMANCE_AI_SHARED_SECRET: performanceSecret,
    MESSAGING_AI_SHARED_SECRET: messagingSecret
  });
  assert.deepEqual(sharedProxyEnvironment('performance-management', configured), {
    SEEMPLIFY_AI_SOURCE_APP: 'performance-management',
    SEEMPLIFY_SHARED_AI_URL: 'https://recruiter.example.test',
    PERFORMANCE_AI_SHARED_SECRET: performanceSecret
  });
  assert.deepEqual(sharedProxyEnvironment('messaging', configured), {
    SEEMPLIFY_AI_SOURCE_APP: 'messaging',
    SEEMPLIFY_SHARED_AI_URL: 'https://recruiter.example.test',
    MESSAGING_AI_SHARED_SECRET: messagingSecret
  });
  assert.equal(proxySecret('messaging', configured), messagingSecret);
  assert.equal(proxySecret('performance-management', configured), performanceSecret);
  assert.throws(() => proxySecret('unknown', configured), /Unsupported shared-account proxy service/);
  assert.throws(() => sharedProxyEnvironment('unknown', configured), /Unsupported shared-account proxy target/);
});

test('non-authority apps remove every direct gateway credential while Recruiter retains its authority', () => {
  const directGatewayKeys = [
    'CHATGPT_GATEWAY_BASE_URL',
    'CHATGPT_GATEWAY_SHARED_SECRET',
    'RECRUITER_CHATGPT_GATEWAY_SECRET',
    'RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET',
    'CHATGPT_GATEWAY_STORAGE_SECRET'
  ];
  assert.deepEqual(sharedProxyRemovedKeys('performance-management'), directGatewayKeys);
  assert.deepEqual(sharedProxyRemovedKeys('messaging'), directGatewayKeys);
  assert.deepEqual(sharedProxyRemovedKeys('recruiter'), []);
});

test('environment matching requires every desired value and every credential removal', () => {
  const configured = requiredSource(source);
  const desired = sharedProxyEnvironment('messaging', configured);
  const exact = centralConfigurator.configureEnvironment('', desired).env;
  assert.equal(sharedProxyEnvironmentMatches({ env: exact }, 'messaging', configured), true);
  assert.equal(sharedProxyEnvironmentMatches({ env: `${exact}\nCHATGPT_GATEWAY_SHARED_SECRET=stale` }, 'messaging', configured), false);
  assert.equal(sharedProxyEnvironmentMatches({ env: exact.replace('SEEMPLIFY_AI_SOURCE_APP=messaging', 'SEEMPLIFY_AI_SOURCE_APP=wrong') }, 'messaging', configured), false);
  assert.equal(sharedProxyEnvironmentMatches(null, 'messaging', configured), false);
});

test('consumer deployment endpoints use configurable bases and fail closed on insecure production URLs', () => {
  assert.equal(
    consumerDeploymentEndpoint('performance-management', source),
    'https://api-performance.seemplifyai.com/api/ai-account/deployment-health'
  );
  assert.equal(
    consumerDeploymentEndpoint('messaging', source),
    'https://api-workspace.seemplifyai.com/api/workspace-ai/deployment-health'
  );
  assert.equal(
    consumerDeploymentEndpoint('performance-management', {
      ...source, PERFORMANCE_MANAGEMENT_API_URL: 'https://performance.example.test/root/'
    }),
    'https://performance.example.test/api/ai-account/deployment-health'
  );
  assert.equal(
    consumerDeploymentEndpoint('messaging', {
      ...source, MESSAGING_API_URL: 'https://messaging.example.test/root/'
    }),
    'https://messaging.example.test/api/workspace-ai/deployment-health'
  );
  assert.throws(
    () => consumerDeploymentEndpoint('messaging', {
      ...source, NODE_ENV: 'production', MESSAGING_API_URL: 'http://messaging.internal'
    }),
    /must use HTTPS/
  );
  assert.throws(
    () => consumerDeploymentEndpoint('unknown', source),
    /Unsupported shared-account proxy service/
  );
});

test('consumer deployment probes bind the exact target key and require both exact identities', async () => {
  const requests = [];
  const now = () => 1_786_500_000_000;
  const randomBytes = () => Buffer.alloc(24, 9);
  const fetchImpl = async (url, init) => {
    const serviceId = init.headers['x-seemplify-service'];
    const pathname = new URL(url).pathname;
    const expected = crypto.createHmac('sha256', proxySecret(serviceId, source))
      .update([
        init.headers['x-seemplify-timestamp'],
        init.headers['x-seemplify-nonce'],
        serviceId,
        'POST',
        pathname,
        init.body
      ].join('\n'))
      .digest('hex');
    assert.equal(init.headers['x-seemplify-signature'], expected);
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(consumerDeploymentPayload(serviceId)), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };
  for (const serviceId of ['performance-management', 'messaging']) {
    assert.equal(await consumerDeploymentReadinessProbe(serviceId, source, {
      fetchImpl, now, randomBytes
    }), true);
  }
  assert.deepEqual(requests.map(({ url }) => url), [
    'https://api-performance.seemplifyai.com/api/ai-account/deployment-health',
    'https://api-workspace.seemplifyai.com/api/workspace-ai/deployment-health'
  ]);
  for (const { init } of requests) {
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.body, '{}');
    assert.equal(init.headers['x-seemplify-signature-version'], '2');
    assert.equal(init.headers['x-seemplify-nonce'], Buffer.alloc(24, 9).toString('base64url'));
  }
});

test('consumer deployment probes reject false outer or nested identities and HTTP failures', async () => {
  const invalidPayload = (mutate) => async (url, init) => {
    const valid = consumerDeploymentPayload('messaging');
    return new Response(JSON.stringify(mutate(valid)), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };
  for (const mutate of [
    (valid) => ({ ...valid, ok: false }),
    (valid) => ({ ...valid, consumer: 'performance-management' }),
    (valid) => ({ ...valid, signatureVersion: '1' }),
    (valid) => ({ ...valid, service: 'unrelated-service' }),
    (valid) => ({ ...valid, shared: { ...valid.shared, ok: false } }),
    (valid) => ({ ...valid, shared: { ...valid.shared, consumer: 'performance-management' } }),
    (valid) => ({ ...valid, shared: { ...valid.shared, signatureVersion: '1' } }),
    (valid) => ({ ...valid, shared: { ...valid.shared, service: 'unrelated-service' } })
  ]) {
    await assert.rejects(
      consumerDeploymentReadinessProbe('messaging', source, {
        fetchImpl: invalidPayload(mutate)
      }),
      /invalid service identity/
    );
  }
  await assert.rejects(
    consumerDeploymentReadinessProbe('messaging', source, {
      fetchImpl: async () => new Response(JSON.stringify({}), {
        status: 200, headers: { 'content-type': 'text/html' }
      })
    }),
    /non-JSON response/
  );
  await assert.rejects(
    consumerDeploymentReadinessProbe('messaging', source, {
      fetchImpl: async () => new Response('{}', { status: 404 })
    }),
    /failed with HTTP 404/
  );
});

test('only an exact running or queued timeout for the same deployment title is fallback eligible', () => {
  const title = 'Shared ChatGPT messaging proxy 2026-08-12T12:00:00.000Z [safe]';
  for (const status of ['running', 'queued']) {
    assert.equal(isStaleDeploymentTimeout(
      new Error(`Dokploy deployment ${title} did not complete (last status: ${status})`),
      title
    ), true);
  }
  for (const message of [
    `Dokploy deployment ${title} did not complete (last status: error)`,
    `Dokploy deployment ${title} did not complete (last status: cancelled)`,
    `Dokploy deployment another title did not complete (last status: running)`,
    `prefix Dokploy deployment ${title} did not complete (last status: running)`,
    `Dokploy deployment ${title} did not complete (last status: running) suffix`
  ]) {
    assert.equal(isStaleDeploymentTimeout(new Error(message), title), false, message);
  }
});

test('rollout timing defaults exceed ten minutes and accept bounded operator overrides', () => {
  const defaults = proxyRolloutTiming(source);
  assert.equal(defaults.deploymentAttempts * defaults.deploymentDelayMs, 1_800_000);
  assert.equal(defaults.readinessAttempts * defaults.readinessDelayMs, 1_200_000);
  assert.deepEqual(proxyRolloutTiming({
    ...source,
    SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_ATTEMPTS: '1000',
    SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_DELAY_MS: '1500',
    SEEMPLIFY_PROXY_READINESS_WAIT_ATTEMPTS: '700',
    SEEMPLIFY_PROXY_READINESS_WAIT_DELAY_MS: '1000'
  }), {
    deploymentAttempts: 1000,
    deploymentDelayMs: 1500,
    readinessAttempts: 700,
    readinessDelayMs: 1000
  });
  assert.throws(
    () => proxyRolloutTiming({ ...source, SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_ATTEMPTS: '299' }),
    /SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_ATTEMPTS/
  );
});

test('Messaging discovery uses the production API domain and rejects ambiguity', async () => {
  const discovered = await centralConfigurator.resolveMessagingConsumer(source, {
    requestImpl: async (pathname) => {
      assert.equal(pathname, '/project.all');
      return {
        projects: [{
          applications: [
            { applicationId: 'frontend-app', name: 'messaging-frontend', domains: [{ host: 'messaging.seemplifyai.com' }] },
            { applicationId: 'backend-app', name: 'legacy-name', domains: [{ host: 'api-messaging.seemplifyai.com' }] }
          ]
        }]
      };
    }
  });
  assert.deepEqual(discovered, { id: 'messaging', applicationId: 'backend-app' });

  await assert.rejects(
    centralConfigurator.resolveMessagingConsumer(source, {
      requestImpl: async () => ([
        { applicationId: 'first', name: 'messaging-backend' },
        { applicationId: 'second', appName: 'messaging-backend' }
      ])
    }),
    /matched more than one application/
  );
});

test('an explicit Messaging application ID avoids project-wide discovery', async () => {
  const discovered = await centralConfigurator.resolveMessagingConsumer({
    ...source,
    MESSAGING_BACKEND_APP_ID: 'messaging-explicit'
  }, {
    requestImpl: async () => assert.fail('discovery must not run for an explicit application ID')
  });
  assert.deepEqual(discovered, { id: 'messaging', applicationId: 'messaging-explicit' });
});

test('proxy repair preflights all targets, deploys no gateway, and verifies both signed identities', async () => {
  const events = [];
  const configured = [];
  const readiness = [];
  const targets = await configureSharedAccountProxies(source, {
    resolveMessagingImpl: async () => ({ id: 'messaging', applicationId: 'messaging-app' }),
    requestImpl: async (pathname) => {
      events.push(`read:${pathname}`);
      return {
        applicationId: new URL(`https://dokploy.test${pathname}`).searchParams.get('applicationId'),
        env: 'EXISTING_VALUE=preserved'
      };
    },
    configureImpl: async (applicationId, required, removed, application, options) => {
      events.push(`configure:${applicationId}`);
      configured.push({ applicationId, required, removed, application, options });
    },
    readinessImpl: async (serviceId, deploymentSource) => {
      events.push(`ready:${serviceId}`);
      readiness.push({ serviceId, deploymentSource });
    }
  });

  assert.deepEqual(targets, [
    { id: 'recruiter', applicationId: 'recruiter-app' },
    { id: 'performance-management', applicationId: 'performance-app' },
    { id: 'messaging', applicationId: 'messaging-app' }
  ]);
  assert.deepEqual(events.slice(0, 3), [
    'read:/application.one?applicationId=recruiter-app',
    'read:/application.one?applicationId=performance-app',
    'read:/application.one?applicationId=messaging-app'
  ]);
  assert.deepEqual(events.slice(3), [
    'configure:recruiter-app',
    'ready:performance-management',
    'ready:messaging',
    'configure:performance-app',
    'ready:performance-management',
    'configure:messaging-app',
    'ready:messaging'
  ]);
  assert.deepEqual(configured.map(({ applicationId }) => applicationId), [
    'recruiter-app', 'performance-app', 'messaging-app'
  ]);
  assert.equal(configured.some(({ applicationId }) => applicationId === 'gateway-app'), false);
  assert.deepEqual(Object.keys(configured[0].required).sort(), [
    'MESSAGING_AI_SHARED_SECRET', 'PERFORMANCE_AI_SHARED_SECRET'
  ]);
  assert.deepEqual(Object.keys(configured[1].required).sort(), [
    'PERFORMANCE_AI_SHARED_SECRET', 'SEEMPLIFY_AI_SOURCE_APP', 'SEEMPLIFY_SHARED_AI_URL'
  ]);
  assert.deepEqual(Object.keys(configured[2].required).sort(), [
    'MESSAGING_AI_SHARED_SECRET', 'SEEMPLIFY_AI_SOURCE_APP', 'SEEMPLIFY_SHARED_AI_URL'
  ]);
  assert.equal(
    configured[0].required.MESSAGING_AI_SHARED_SECRET,
    configured[2].required.MESSAGING_AI_SHARED_SECRET
  );
  assert.equal(
    configured[0].required.PERFORMANCE_AI_SHARED_SECRET,
    configured[1].required.PERFORMANCE_AI_SHARED_SECRET
  );
  assert.equal(configured.every(({ application }) => application.env === 'EXISTING_VALUE=preserved'), true);
  assert.equal(configured.every(({ options }) => /Shared ChatGPT .* proxy/.test(options.title)), true);
  assert.deepEqual(readiness.map(({ serviceId }) => serviceId), [
    'performance-management', 'messaging', 'performance-management', 'messaging'
  ]);
  assert.equal(configured.every(({ options }) => typeof options.waitForDeploymentImpl === 'function'), true);
});

test('a rerun with exact environments and signed authority readiness creates no duplicate deployments', async () => {
  const configured = requiredSource(source);
  const applications = new Map([
    ['recruiter-app', { env: centralConfigurator.configureEnvironment(
      '', sharedProxyEnvironment('recruiter', configured)
    ).env }],
    ['performance-app', { env: centralConfigurator.configureEnvironment(
      '', sharedProxyEnvironment('performance-management', configured)
    ).env }],
    ['messaging-app', { env: centralConfigurator.configureEnvironment(
      '', sharedProxyEnvironment('messaging', configured)
    ).env }]
  ]);
  const readiness = [];
  let deployments = 0;
  await configureSharedAccountProxies(source, {
    resolveMessagingImpl: async () => ({ id: 'messaging', applicationId: 'messaging-app' }),
    requestImpl: async (pathname) => applications.get(
      new URL(`https://dokploy.test${pathname}`).searchParams.get('applicationId')
    ),
    configureImpl: async () => { deployments += 1; },
    readinessImpl: async (serviceId, deploymentSource, { timing }) => {
      readiness.push({ serviceId, deploymentSource, timing });
    }
  });
  assert.equal(deployments, 0);
  assert.deepEqual(readiness.map(({ serviceId }) => serviceId), [
    'performance-management', 'messaging'
  ]);
  assert.equal(readiness.every(({ timing }) => timing.readinessAttempts === 600), true);
});

test('an interrupted Recruiter deployment waits for both signed keys and never redeploys the authority', async () => {
  const configured = requiredSource(source);
  const authorityEnv = centralConfigurator.configureEnvironment(
    '', sharedProxyEnvironment('recruiter', configured)
  ).env;
  const deployments = [];
  const events = [];
  const probeAttempts = new Map();
  await configureSharedAccountProxies(source, {
    resolveMessagingImpl: async () => ({ id: 'messaging', applicationId: 'messaging-app' }),
    requestImpl: async (pathname) => {
      const applicationId = new URL(`https://dokploy.test${pathname}`).searchParams.get('applicationId');
      return { env: applicationId === 'recruiter-app' ? authorityEnv : '' };
    },
    configureImpl: async (applicationId) => {
      deployments.push(applicationId);
      events.push(`deploy:${applicationId}`);
    },
    readinessImpl: async (serviceId, deploymentSource, { timing }) => {
      events.push(`wait:${serviceId}`);
      return waitForSharedAccountProxyReadiness(serviceId, deploymentSource, {
        timing,
        probeImpl: async (candidateId) => {
          const attempt = (probeAttempts.get(candidateId) || 0) + 1;
          probeAttempts.set(candidateId, attempt);
          if (attempt < 3) throw new Error('in-flight authority revision is not live yet');
          return true;
        },
        waitForReadinessImpl: async (label, probe, waitOptions) => {
          assert.equal(waitOptions.attempts, 600);
          assert.equal(waitOptions.delayMs, 2000);
          let lastError;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              return await probe();
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError;
        }
      });
    }
  });
  assert.deepEqual(deployments, ['performance-app', 'messaging-app']);
  assert.deepEqual(events.slice(0, 2), [
    'wait:performance-management', 'wait:messaging'
  ]);
  assert.equal(events.includes('deploy:recruiter-app'), false);
  assert.deepEqual(Object.fromEntries(probeAttempts), {
    // Three attempts wait for the interrupted authority revision; the fourth
    // is the post-deployment fail-closed check for each changed consumer.
    'performance-management': 4,
    messaging: 4
  });
});

test('changed deployments receive the configurable long deployment poll contract', async () => {
  const waits = [];
  await configureSharedAccountProxies({
    ...source,
    SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_ATTEMPTS: '1000',
    SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_DELAY_MS: '1500'
  }, {
    resolveMessagingImpl: async () => ({ id: 'messaging', applicationId: 'messaging-app' }),
    requestImpl: async () => ({ env: '' }),
    configureImpl: async (applicationId, required, removed, application, options) => {
      await options.waitForDeploymentImpl(applicationId, `test-${applicationId}`, {
        requestImpl: async () => ({})
      });
    },
    deploymentWaitImpl: async (applicationId, title, waitOptions) => {
      waits.push({ applicationId, title, waitOptions });
      return { status: 'done' };
    },
    readinessImpl: async () => true
  });
  assert.deepEqual(waits.map(({ applicationId }) => applicationId), [
    'recruiter-app', 'performance-app', 'messaging-app'
  ]);
  assert.equal(waits.every(({ waitOptions }) => waitOptions.attempts === 1000), true);
  assert.equal(waits.every(({ waitOptions }) => waitOptions.delayMs === 1500), true);
  assert.equal(waits.every(({ waitOptions }) => typeof waitOptions.requestImpl === 'function'), true);
});

test('a stale consumer deployment is accepted only after its exact end-to-end readiness succeeds', async () => {
  const fallbacks = [];
  const deployments = [];
  await configureSharedAccountProxies(source, {
    resolveMessagingImpl: async () => ({ id: 'messaging', applicationId: 'messaging-app' }),
    requestImpl: async () => ({ env: '' }),
    configureImpl: async (applicationId, required, removed, application, options) => {
      deployments.push(applicationId);
      if (applicationId === 'messaging-app') {
        throw new Error(
          `Dokploy deployment ${options.title} did not complete (last status: running)`
        );
      }
    },
    readinessImpl: async () => true,
    consumerDeploymentReadinessImpl: async (serviceId, deploymentSource, { timing }) => {
      fallbacks.push({ serviceId, deploymentSource, timing });
      return true;
    }
  });
  assert.deepEqual(deployments, ['recruiter-app', 'performance-app', 'messaging-app']);
  assert.deepEqual(fallbacks.map(({ serviceId }) => serviceId), ['messaging']);
  assert.equal(fallbacks[0].deploymentSource.CHATGPT_GATEWAY_SHARED_SECRET, source.CHATGPT_GATEWAY_SHARED_SECRET);
  assert.equal(fallbacks[0].timing.readinessAttempts, 600);
});

test('fallback never masks consumer proof failure, non-stale status, mismatched title, or authority timeout', async () => {
  async function runFailure({ failApplicationId, messageFor, fallbackImpl }) {
    let fallbackCalls = 0;
    await assert.rejects(
      configureSharedAccountProxies(source, {
        resolveMessagingImpl: async () => ({ id: 'messaging', applicationId: 'messaging-app' }),
        requestImpl: async () => ({ env: '' }),
        configureImpl: async (applicationId, required, removed, application, options) => {
          if (applicationId === failApplicationId) throw new Error(messageFor(options.title));
        },
        readinessImpl: async () => true,
        consumerDeploymentReadinessImpl: async () => {
          fallbackCalls += 1;
          return fallbackImpl();
        }
      }),
      /proof failed|last status: error|another title|last status: running/
    );
    return fallbackCalls;
  }

  assert.equal(await runFailure({
    failApplicationId: 'messaging-app',
    messageFor: (title) => `Dokploy deployment ${title} did not complete (last status: running)`,
    fallbackImpl: () => { throw new Error('consumer proof failed'); }
  }), 1);
  assert.equal(await runFailure({
    failApplicationId: 'messaging-app',
    messageFor: (title) => `Dokploy deployment ${title} did not complete (last status: error)`,
    fallbackImpl: () => true
  }), 0);
  assert.equal(await runFailure({
    failApplicationId: 'messaging-app',
    messageFor: () => 'Dokploy deployment another title did not complete (last status: running)',
    fallbackImpl: () => true
  }), 0);
  assert.equal(await runFailure({
    failApplicationId: 'recruiter-app',
    messageFor: (title) => `Dokploy deployment ${title} did not complete (last status: running)`,
    fallbackImpl: () => true
  }), 0);
});

test('duplicate or inaccessible targets abort before the first environment mutation', async () => {
  let configured = 0;
  await assert.rejects(
    configureSharedAccountProxies(source, {
      resolveMessagingImpl: async () => ({ id: 'messaging', applicationId: 'performance-app' }),
      requestImpl: async () => ({ env: '' }),
      configureImpl: async () => { configured += 1; }
    }),
    /application IDs must be unique/
  );
  assert.equal(configured, 0);

  await assert.rejects(
    configureSharedAccountProxies(source, {
      resolveMessagingImpl: async () => ({ id: 'messaging', applicationId: 'messaging-app' }),
      requestImpl: async (pathname) => (
        pathname.includes('performance-app') ? null : { env: '' }
      ),
      configureImpl: async () => { configured += 1; }
    }),
    /performance-management could not be verified/
  );
  assert.equal(configured, 0);
});

test('Performance and Messaging health probes use exact v2 target-bound signatures', async () => {
  const requests = [];
  const now = () => 1_786_500_000_000;
  const randomBytes = () => Buffer.alloc(24, 7);
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const serviceId = init.headers['x-seemplify-service'];
    const expected = crypto.createHmac('sha256', proxySecret(serviceId, source))
      .update([
        init.headers['x-seemplify-timestamp'],
        init.headers['x-seemplify-nonce'],
        serviceId,
        'POST',
        SHARED_ACCOUNT_HEALTH_PATH,
        init.body
      ].join('\n'))
      .digest('hex');
    assert.equal(init.headers['x-seemplify-signature'], expected);
    return new Response(JSON.stringify({
      ok: true,
      service: 'seemplify-shared-ai-account',
      consumer: serviceId,
      signatureVersion: '2'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  for (const serviceId of ['performance-management', 'messaging']) {
    assert.equal(await sharedAccountProxyReadinessProbe(serviceId, source, {
      fetchImpl, now, randomBytes
    }), true);
  }
  assert.deepEqual(requests.map(({ url }) => url), [
    'https://recruiter.example.test/api/internal/ai/v1/health',
    'https://recruiter.example.test/api/internal/ai/v1/health'
  ]);
  for (const { init } of requests) {
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '{}');
    assert.equal(init.headers['x-seemplify-signature-version'], '2');
    assert.equal(init.headers['x-seemplify-nonce'], Buffer.alloc(24, 7).toString('base64url'));
  }
});

test('health probes reject HTTP failures and incorrect service identities', async () => {
  await assert.rejects(
    sharedAccountProxyReadinessProbe('messaging', source, {
      fetchImpl: async () => new Response('{}', { status: 401 })
    }),
    /messaging shared-account health probe failed with HTTP 401/
  );
  await assert.rejects(
    sharedAccountProxyReadinessProbe('performance-management', source, {
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        service: 'seemplify-shared-ai-account',
        consumer: 'messaging',
        signatureVersion: '2'
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
    /invalid service identity/
  );
  await assert.rejects(
    sharedAccountProxyReadinessProbe('recruiter', source),
    /Unsupported shared-account proxy service/
  );
});

test('readiness waits through the shared retry helper without changing the probe contract', async () => {
  const calls = [];
  const probeImpl = async (serviceId, candidate) => {
    calls.push({ serviceId, candidate });
    return true;
  };
  const waitForReadinessImpl = async (label, probe, options) => {
    assert.equal(label, 'messaging shared ChatGPT account proxy');
    assert.deepEqual(options, { attempts: 700, delayMs: 1000 });
    return probe();
  };
  assert.equal(await waitForSharedAccountProxyReadiness('messaging', {
    ...source,
    SEEMPLIFY_PROXY_READINESS_WAIT_ATTEMPTS: '700',
    SEEMPLIFY_PROXY_READINESS_WAIT_DELAY_MS: '1000'
  }, {
    probeImpl,
    waitForReadinessImpl
  }), true);
  assert.equal(calls[0].serviceId, 'messaging');
  assert.equal(calls[0].candidate.SEEMPLIFY_PROXY_READINESS_WAIT_ATTEMPTS, '700');
});

test('consumer deployment fallback uses the bounded readiness retry contract', async () => {
  const calls = [];
  const probeImpl = async (serviceId, candidate) => {
    calls.push({ serviceId, candidate });
    return true;
  };
  const waitForReadinessImpl = async (label, probe, options) => {
    assert.equal(label, 'performance-management end-to-end deployment fallback');
    assert.deepEqual(options, { attempts: 700, delayMs: 1000 });
    return probe();
  };
  assert.equal(await waitForConsumerDeploymentReadiness('performance-management', {
    ...source,
    SEEMPLIFY_PROXY_READINESS_WAIT_ATTEMPTS: '700',
    SEEMPLIFY_PROXY_READINESS_WAIT_DELAY_MS: '1000'
  }, { probeImpl, waitForReadinessImpl }), true);
  assert.equal(calls[0].serviceId, 'performance-management');
});

test('Dokploy request handling authenticates without leaking unrelated settings', async () => {
  assert.equal(apiBase('https://dokploy.example.test/'), 'https://dokploy.example.test/api');
  let captured;
  const payload = await dokployRequest('/application.one?applicationId=app', {
    method: 'POST',
    body: '{}'
  }, source, async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ applicationId: 'app' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });
  assert.deepEqual(payload, { applicationId: 'app' });
  assert.equal(captured.url, 'https://dokploy.example.test/api/application.one?applicationId=app');
  assert.equal(captured.init.headers['x-api-key'], 'operator-token');
  assert.equal(captured.init.headers['content-type'], 'application/json');
});

test('workflow stays proxy-only and runs its contract test before rollout', () => {
  const workflow = fs.readFileSync(path.resolve(
    __dirname,
    '../../.github/workflows/configure-chatgpt-account-proxies.yml'
  ), 'utf8');
  assert.match(workflow, /dokploy-configure-shared-account-proxies\.test\.cjs/);
  assert.match(workflow, /PERFORMANCE_BACKEND_APP_ID/);
  assert.match(workflow, /MESSAGING_BACKEND_APP_ID/);
  assert.match(workflow, /CHATGPT_GATEWAY_SHARED_SECRET/);
  assert.match(workflow, /timeout-minutes: 240/);
  assert.match(workflow, /SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_ATTEMPTS/);
  assert.match(workflow, /SEEMPLIFY_PROXY_READINESS_WAIT_ATTEMPTS/);
  assert.match(workflow, /PERFORMANCE_MANAGEMENT_API_URL/);
  assert.match(workflow, /MESSAGING_API_URL/);
  assert.match(workflow, /performance\/backend\/routes\/aiAccount\.js/);
  assert.match(workflow, /performance\/backend\/services\/deploymentHealthSecurity\.js/);
  assert.doesNotMatch(workflow, /CHATGPT_GATEWAY_APP_ID/);
  assert.doesNotMatch(workflow, /DOKPLOY_BACKUP_DESTINATION_ID/);
  assert.doesNotMatch(workflow, /Dockerfile/);
});
