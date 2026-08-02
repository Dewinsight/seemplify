const AIRuntimeSettings = require('../models/AIRuntimeSettings');
const aiRuntimeService = require('./aiRuntime/aiRuntimeService');

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

function runtimeIsHealthy(status) {
  return Boolean(
    status?.configured
    && status?.reachable
    && status?.health?.ok !== false
    && status?.cvLocalEligible !== false
    && status?.state?.enabled !== false
    && status?.state?.ingressEnabled !== false
    && status?.state?.paused !== true
  );
}

function unhealthyReason(status) {
  if (!status?.configured) return 'local_runtime_not_configured';
  if (!status?.reachable) return 'local_gateway_unreachable';
  if (status?.cvLocalEligible === false) return 'local_engine_not_selected';
  if (status?.state?.enabled === false) return 'local_runtime_disabled';
  if (status?.state?.ingressEnabled === false) return 'local_ingress_disabled';
  if (status?.state?.paused === true) return 'local_runtime_paused';
  if (status?.health?.ok === false) return status.health.error || 'local_engine_unhealthy';
  return 'local_runtime_unhealthy';
}

class LocalAIRuntimeHealthService {
  constructor({
    runtime = aiRuntimeService,
    settingsModel = AIRuntimeSettings,
    intervalMs = Number(process.env.LOCAL_AI_HEALTH_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    now = () => new Date()
  } = {}) {
    this.runtime = runtime;
    this.Settings = settingsModel;
    this.intervalMs = Math.max(60_000, Number(intervalMs || DEFAULT_INTERVAL_MS));
    this.now = now;
    this.timer = null;
    this.startTimer = null;
    this.isRunning = false;
  }

  async checkNow() {
    const checkedAt = this.now();
    const [status, settings] = await Promise.all([
      this.runtime.getLocalRuntimeStatus(),
      this.Settings.findOne({ key: 'global' }).lean()
    ]);
    const previous = settings?.localFailover || {};
    const enabled = previous.enabled !== false;
    const healthy = runtimeIsHealthy(status);
    const active = enabled && !healthy;
    const next = {
      enabled,
      intervalMinutes: Math.round(this.intervalMs / 60_000),
      active,
      status: enabled ? (healthy ? 'healthy' : 'groq_failover') : 'disabled',
      checkedAt,
      failedAt: active ? (previous.active ? previous.failedAt || checkedAt : checkedAt) : previous.failedAt || null,
      recoveredAt: !active && previous.active ? checkedAt : previous.recoveredAt || null,
      reason: active ? unhealthyReason(status) : null,
      engine: status?.engine || null,
      model: status?.model || null
    };
    await this.Settings.updateOne(
      { key: 'global' },
      { $set: { localFailover: next }, $inc: { version: 1 } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    this.runtime.invalidateSettingsCache();
    if (previous.active !== active) {
      console.log(active
        ? `Local AI health check enabled Groq failover: ${next.reason}`
        : `Local AI health check restored local routing (${next.engine || 'unknown engine'} / ${next.model || 'unknown model'})`);
    }
    return { ...next, localRuntime: status };
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTimer = setTimeout(() => {
      this.checkNow().catch((error) => console.error('Initial local AI health check failed:', error.message));
    }, 5_000);
    this.startTimer.unref?.();
    this.timer = setInterval(() => {
      this.checkNow().catch((error) => console.error('Scheduled local AI health check failed:', error.message));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.timer) clearInterval(this.timer);
    this.startTimer = null;
    this.timer = null;
    this.isRunning = false;
  }
}

const localAIRuntimeHealthService = new LocalAIRuntimeHealthService();

module.exports = localAIRuntimeHealthService;
module.exports.LocalAIRuntimeHealthService = LocalAIRuntimeHealthService;
module.exports.runtimeIsHealthy = runtimeIsHealthy;
module.exports.unhealthyReason = unhealthyReason;
