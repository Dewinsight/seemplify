const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDefaultRuntimeSettings,
  GROQ_120B,
  LOCAL_PROVIDER
} = require('../config/aiRuntimeCatalog');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');
const {
  LocalAIRuntimeHealthService,
  runtimeIsHealthy,
  unhealthyReason
} = require('../services/localAIRuntimeHealthService');

function healthyStatus() {
  return {
    configured: true,
    reachable: true,
    cvLocalEligible: true,
    engine: 'ollama',
    model: 'gemma4:26b-a4b-it-qat',
    state: { enabled: true, ingressEnabled: true, paused: false },
    health: { ok: true }
  };
}

test('local health classification covers gateway, engine, and control state', () => {
  assert.equal(runtimeIsHealthy(healthyStatus()), true);
  assert.equal(runtimeIsHealthy({ ...healthyStatus(), reachable: false }), false);
  assert.equal(unhealthyReason({ ...healthyStatus(), reachable: false }), 'local_gateway_unreachable');
  assert.equal(unhealthyReason({ ...healthyStatus(), state: { enabled: true, ingressEnabled: false, paused: false } }), 'local_ingress_disabled');
  assert.equal(unhealthyReason({ ...healthyStatus(), cvLocalEligible: false }), 'local_engine_not_selected');
});

test('30-minute monitor activates Groq failover and restores local routing after recovery', async () => {
  let current = {
    localFailover: {
      enabled: true,
      active: false,
      intervalMinutes: 30,
      checkedAt: null
    }
  };
  let runtimeStatus = { ...healthyStatus(), reachable: false };
  const updates = [];
  const settingsModel = {
    findOne() {
      return { lean: async () => current };
    },
    async updateOne(_filter, update) {
      updates.push(update.$set.localFailover);
      current = { ...current, localFailover: update.$set.localFailover };
    }
  };
  const runtime = {
    async getLocalRuntimeStatus() { return runtimeStatus; },
    invalidateSettingsCache() {}
  };
  const monitor = new LocalAIRuntimeHealthService({
    runtime,
    settingsModel,
    intervalMs: 30 * 60 * 1000,
    now: () => new Date('2026-07-24T12:00:00.000Z')
  });

  const failed = await monitor.checkNow();
  assert.equal(failed.active, true);
  assert.equal(failed.status, 'groq_failover');
  assert.equal(failed.reason, 'local_gateway_unreachable');
  assert.equal(failed.intervalMinutes, 30);

  runtimeStatus = healthyStatus();
  const recovered = await monitor.checkNow();
  assert.equal(recovered.active, false);
  assert.equal(recovered.status, 'healthy');
  assert.equal(recovered.reason, null);
  assert.equal(updates.length, 2);
});

test('effective routes use Groq only while local failover is active', () => {
  const runtime = new AIRuntimeService({ settingsModel: {}, credentialModel: {}, quotaModel: {} });
  const settings = createDefaultRuntimeSettings();
  const configured = runtime.resolveRoute('interview.questions', settings);
  assert.equal(configured.provider, LOCAL_PROVIDER);
  assert.equal(runtime.resolveExecutionRoute(configured, settings, {}).provider, LOCAL_PROVIDER);

  settings.localFailover.active = true;
  settings.localFailover.status = 'groq_failover';
  settings.localFailover.reason = 'local_gateway_unreachable';
  const failedOver = runtime.resolveExecutionRoute(configured, settings, {});
  assert.equal(failedOver.provider, 'groq');
  assert.equal(failedOver.model, GROQ_120B);
  assert.equal(failedOver.failoverFrom, LOCAL_PROVIDER);

  settings.localFailover.active = false;
  assert.equal(runtime.resolveExecutionRoute(configured, settings, {}).provider, LOCAL_PROVIDER);
});
