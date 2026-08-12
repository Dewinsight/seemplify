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
  dokployRequest,
  proxySecret,
  requiredSource,
  sharedAccountProxyReadinessProbe,
  sharedProxyEnvironment,
  sharedProxyRemovedKeys,
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

test('central configurator exports the narrow rollout dependencies', () => {
  for (const name of [
    'configureApplication',
    'deriveMessagingProxySecret',
    'derivePerformanceProxySecret',
    'resolveMessagingConsumer',
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
  assert.deepEqual(readiness.map(({ serviceId }) => serviceId), ['performance-management', 'messaging']);
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
  const waitForReadinessImpl = async (label, probe) => {
    assert.equal(label, 'messaging shared ChatGPT account proxy');
    return probe();
  };
  assert.equal(await waitForSharedAccountProxyReadiness('messaging', source, {
    probeImpl, waitForReadinessImpl
  }), true);
  assert.deepEqual(calls, [{ serviceId: 'messaging', candidate: source }]);
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
  assert.doesNotMatch(workflow, /CHATGPT_GATEWAY_APP_ID/);
  assert.doesNotMatch(workflow, /DOKPLOY_BACKUP_DESTINATION_ID/);
  assert.doesNotMatch(workflow, /Dockerfile/);
});
