const IORedis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const crypto = require('node:crypto');

const QUEUE_NAME = 'ai-usage-metering-outbox';
const DEFAULT_ATTEMPTS = 2_147_483_647;
const DEAD_LETTER_JOB_NAME = 'dead-letter';
const DEAD_LETTER_HEALTH_JOB_NAME = 'dead-letter-health';
const DEAD_LETTER_HEALTH_JOB_ID = 'ai-usage-dead-letter-health';
const TERMINAL_PERSISTENCE_CODES = new Set([
  'AI_USAGE_EVENT_ID_INVALID',
  'AI_USAGE_IDENTITY_CONFLICT'
]);

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function resolveRedisConfig(env = process.env) {
  const explicitUrl = String(env.AI_USAGE_REDIS_URL || env.REDIS_URL || '').trim();
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const host = String(
    env.AI_USAGE_REDIS_HOST
    || env.REDIS_HOST
    || (production ? 'dokploy-redis' : '')
  ).trim();
  const enabled = booleanValue(
    env.AI_USAGE_OUTBOX_ENABLED,
    production || Boolean(explicitUrl || host)
  );
  if (!enabled) return Object.freeze({ enabled: false, url: null });

  const port = Number(env.AI_USAGE_REDIS_PORT || env.REDIS_PORT || 6379);
  const database = String(env.AI_USAGE_REDIS_DB ?? env.REDIS_DB ?? '0').trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error('AI usage metering Redis port is invalid');
    error.code = 'AI_USAGE_REDIS_CONFIG_INVALID';
    throw error;
  }
  if (!/^\d+$/.test(database)) {
    const error = new Error('AI usage metering Redis database is invalid');
    error.code = 'AI_USAGE_REDIS_CONFIG_INVALID';
    throw error;
  }

  const tls = booleanValue(env.AI_USAGE_REDIS_TLS ?? env.REDIS_TLS, false);
  const username = String(env.AI_USAGE_REDIS_USERNAME || env.REDIS_USERNAME || '');
  const password = String(env.AI_USAGE_REDIS_PASSWORD || env.REDIS_PASSWORD || '');
  const credentials = username || password
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';
  const bracketedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const derivedUrl = host
    ? `${tls ? 'rediss' : 'redis'}://${credentials}${bracketedHost}:${port}/${database}`
    : '';
  const url = explicitUrl || derivedUrl;
  if (!url) {
    const error = new Error('AI usage metering Redis URL or host is required');
    error.code = 'AI_USAGE_REDIS_CONFIG_INVALID';
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error('AI usage metering Redis URL is invalid');
    error.code = 'AI_USAGE_REDIS_CONFIG_INVALID';
    throw error;
  }
  if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname) {
    const error = new Error('AI usage metering Redis URL must use redis:// or rediss:// and include a host');
    error.code = 'AI_USAGE_REDIS_CONFIG_INVALID';
    throw error;
  }
  if (parsed.pathname && parsed.pathname !== '/' && !/^\d+$/.test(parsed.pathname.slice(1))) {
    const error = new Error('AI usage metering Redis URL database is invalid');
    error.code = 'AI_USAGE_REDIS_CONFIG_INVALID';
    throw error;
  }

  return Object.freeze({
    enabled: true,
    url,
    database: Number(parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : database),
    username: username || undefined,
    password: password || undefined,
    tls: parsed.protocol === 'rediss:' || tls,
    tlsRejectUnauthorized: booleanValue(
      env.AI_USAGE_REDIS_TLS_REJECT_UNAUTHORIZED
        ?? env.REDIS_TLS_REJECT_UNAUTHORIZED,
      true
    ),
    tlsServername: String(
      env.AI_USAGE_REDIS_TLS_SERVERNAME
        || env.REDIS_TLS_SERVERNAME
        || ''
    ).trim() || undefined
  });
}

function createConnection(config, connectionName) {
  const options = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    connectionName,
    db: config.database
  };
  if (config.username) options.username = config.username;
  if (config.password) options.password = config.password;
  if (config.tls) {
    options.tls = {
      rejectUnauthorized: config.tlsRejectUnauthorized,
      ...(config.tlsServername ? { servername: config.tlsServername } : {})
    };
  }
  return new IORedis(config.url, options);
}

function outboxJobId(eventId) {
  return `ai-usage-${crypto.createHash('sha256').update(String(eventId)).digest('hex')}`;
}

function hashValue(value) {
  if (value === undefined || value === null || value === '') return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeLabel(value, maximumLength = 100) {
  if (typeof value !== 'string') return null;
  const label = value.trim().slice(0, maximumLength);
  return /^[a-zA-Z0-9._:/-]+$/.test(label) ? label : null;
}

function isTerminalPersistenceError(error) {
  return TERMINAL_PERSISTENCE_CODES.has(error?.code)
    || error?.name === 'ValidationError'
    || error?.name === 'CastError';
}

function deadLetterEnvelope(envelope, error) {
  const event = envelope?.event || {};
  const legacyUsage = event.usage || {};
  const tokenCount = (field) => Math.max(
    0,
    Number(event[field] ?? legacyUsage[field]) || 0
  );
  return {
    kind: 'ai-usage-dead-letter',
    schemaVersion: 1,
    eventIdHash: hashValue(event.eventId),
    requestIdHash: hashValue(event.requestId),
    fingerprintHash: hashValue(envelope?.fingerprint),
    sourceApp: safeLabel(event.sourceApp),
    activity: safeLabel(event.activity),
    provider: safeLabel(event.provider),
    model: safeLabel(event.model),
    status: safeLabel(event.status),
    reasonCode: safeLabel(error?.code || error?.name || 'TERMINAL_PERSISTENCE_ERROR'),
    usage: {
      inputTokens: tokenCount('inputTokens'),
      cachedInputTokens: tokenCount('cachedInputTokens'),
      outputTokens: tokenCount('outputTokens'),
      reasoningTokens: tokenCount('reasoningTokens'),
      totalTokens: tokenCount('totalTokens')
    },
    detectedAt: new Date().toISOString()
  };
}

function deadLetterJobId(marker) {
  return `ai-usage-dead-letter-${crypto.createHash('sha256')
    .update(`${marker.eventIdHash || ''}:${marker.fingerprintHash || ''}:${marker.reasonCode || ''}`)
    .digest('hex')}`;
}

function deadLetterRetentionOptions(env) {
  const age = Math.max(
    3_600,
    Number(env.AI_USAGE_OUTBOX_DEAD_LETTER_AGE_SECONDS) || 30 * 24 * 60 * 60
  );
  const count = Math.max(
    100,
    Number(env.AI_USAGE_OUTBOX_DEAD_LETTER_COUNT) || 25_000
  );
  return {
    attempts: 1,
    removeOnComplete: { age, count },
    removeOnFail: { age, count }
  };
}

function usageMeteringOutboxRequired(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production';
}

function usageMeteringOutboxReady(status, env = process.env) {
  if (!usageMeteringOutboxRequired(env)) {
    return !status?.configured || (status.started === true && status.healthy === true);
  }
  return status?.configured === true
    && status.started === true
    && status.healthy === true;
}

function assertUsageMeteringOutboxReady(status, env = process.env) {
  if (usageMeteringOutboxReady(status, env)) return status;
  const error = new Error(
    usageMeteringOutboxRequired(env)
      ? 'Production requires a configured, started, and healthy AI usage metering outbox'
      : 'The configured AI usage metering outbox is not started and healthy'
  );
  error.code = 'AI_USAGE_OUTBOX_NOT_READY';
  error.status = status;
  throw error;
}

class UsageMeteringOutbox {
  constructor({
    env = process.env,
    QueueClass = Queue,
    WorkerClass = Worker,
    connectionFactory = createConnection
  } = {}) {
    this.env = env;
    this.QueueClass = QueueClass;
    this.WorkerClass = WorkerClass;
    this.connectionFactory = connectionFactory;
    this.queue = null;
    this.queueConnection = null;
    this.worker = null;
    this.workerConnection = null;
    this.lastError = null;
    this.lastTerminalFailure = null;
    this.deadLetterCount = 0;
    this.failedJobIds = new Set();
    this.started = false;
  }

  config() {
    return resolveRedisConfig(this.env);
  }

  ensureQueue() {
    if (this.queue) return this.queue;
    const config = this.config();
    if (!config.enabled) {
      const error = new Error('AI usage metering outbox is not configured');
      error.code = 'AI_USAGE_OUTBOX_UNAVAILABLE';
      throw error;
    }
    this.queueConnection = this.connectionFactory(config, 'ai-usage-metering:producer');
    this.queue = new this.QueueClass(QUEUE_NAME, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: Math.max(1, Number(this.env.AI_USAGE_OUTBOX_ATTEMPTS) || DEFAULT_ATTEMPTS),
        backoff: {
          type: 'fixed',
          delay: Math.max(100, Number(this.env.AI_USAGE_OUTBOX_RETRY_DELAY_MS) || 5_000)
        },
        removeOnComplete: {
          age: Math.max(3_600, Number(this.env.AI_USAGE_OUTBOX_COMPLETED_AGE_SECONDS) || 7 * 24 * 60 * 60),
          count: Math.max(1_000, Number(this.env.AI_USAGE_OUTBOX_COMPLETED_COUNT) || 100_000)
        },
        removeOnFail: false
      }
    });
    return this.queue;
  }

  async enqueue(envelope) {
    const queue = this.ensureQueue();
    const jobId = outboxJobId(envelope.event.eventId);
    const existing = await queue.getJob(jobId);
    if (existing) {
      if (existing.data?.fingerprint !== envelope.fingerprint) {
        const error = new Error(`AI usage outbox identity conflict for ${envelope.event.eventId}`);
        error.code = 'AI_USAGE_IDENTITY_CONFLICT';
        throw error;
      }
      return { jobId, duplicate: true };
    }
    const job = await queue.add('persist-usage', envelope, { jobId });
    if (job.data?.fingerprint !== envelope.fingerprint) {
      const error = new Error(`AI usage outbox identity conflict for ${envelope.event.eventId}`);
      error.code = 'AI_USAGE_IDENTITY_CONFLICT';
      throw error;
    }
    return { jobId: job.id, duplicate: false };
  }

  async hydrateTerminalHealth() {
    const marker = await this.ensureQueue().getJob(DEAD_LETTER_HEALTH_JOB_ID);
    if (!marker?.data) return;
    this.deadLetterCount = Math.max(1, Number(marker.data.count) || 1);
    this.lastTerminalFailure = {
      reasonCode: safeLabel(marker.data.reasonCode) || 'TERMINAL_PERSISTENCE_ERROR',
      eventIdHash: /^[a-f0-9]{64}$/.test(String(marker.data.eventIdHash || ''))
        ? marker.data.eventIdHash
        : null,
      at: marker.data.detectedAt || null
    };
  }

  async recordDeadLetter(envelope, error) {
    const queue = this.ensureQueue();
    const marker = deadLetterEnvelope(envelope, error);
    const retention = deadLetterRetentionOptions(this.env);
    await queue.add(DEAD_LETTER_JOB_NAME, marker, {
      jobId: deadLetterJobId(marker),
      ...retention
    });

    const existingHealth = await queue.getJob(DEAD_LETTER_HEALTH_JOB_ID);
    const count = Math.max(0, Number(existingHealth?.data?.count) || 0) + 1;
    const healthMarker = {
      kind: 'ai-usage-dead-letter-health',
      schemaVersion: 1,
      count,
      reasonCode: marker.reasonCode,
      eventIdHash: marker.eventIdHash,
      detectedAt: marker.detectedAt
    };
    if (existingHealth?.updateData) {
      await existingHealth.updateData(healthMarker);
    } else if (!existingHealth) {
      await queue.add(DEAD_LETTER_HEALTH_JOB_NAME, healthMarker, {
        jobId: DEAD_LETTER_HEALTH_JOB_ID,
        attempts: 1,
        // This is one fixed, non-PII sentinel rather than an accumulating
        // history. It remains until operators explicitly remediate/remove it.
        removeOnComplete: false,
        removeOnFail: false
      });
    }
    this.deadLetterCount = count;
    this.lastTerminalFailure = {
      reasonCode: marker.reasonCode,
      eventIdHash: marker.eventIdHash,
      at: marker.detectedAt
    };
    return marker;
  }

  async start(processor) {
    if (this.worker) return this.status();
    const config = this.config();
    if (!config.enabled) return this.status();
    if (typeof processor !== 'function') {
      throw new TypeError('AI usage metering worker requires a processor');
    }
    try {
      await this.hydrateTerminalHealth();
      await this.queue?.waitUntilReady?.();
      this.workerConnection = this.connectionFactory(config, 'ai-usage-metering:worker');
      this.worker = new this.WorkerClass(
        QUEUE_NAME,
        async (job) => {
          if (job.name === DEAD_LETTER_JOB_NAME || job.name === DEAD_LETTER_HEALTH_JOB_NAME) {
            return { deadLetter: true };
          }
          try {
            return await processor(job.data);
          } catch (error) {
            if (!isTerminalPersistenceError(error)) throw error;
            const marker = await this.recordDeadLetter(job.data, error);
            return { deadLetter: true, reasonCode: marker.reasonCode };
          }
        },
        {
          connection: this.workerConnection,
          concurrency: Math.max(1, Number(this.env.AI_USAGE_OUTBOX_CONCURRENCY) || 4)
        }
      );
      await this.worker.waitUntilReady?.();
      this.lastError = null;
      this.started = true;
    } catch (error) {
      await this.close().catch(() => {});
      this.lastError = {
        message: String(error?.message || error).slice(0, 300),
        at: new Date().toISOString()
      };
      throw error;
    }
    this.worker.on?.('error', (error) => {
      this.lastError = {
        message: String(error?.message || error).slice(0, 300),
        at: new Date().toISOString()
      };
    });
    this.worker.on?.('completed', (job) => {
      if (!job?.id) return;
      this.failedJobIds.delete(job.id);
      if (this.lastError?.jobId !== job.id) return;
      const remainingJobId = this.failedJobIds.values().next().value;
      this.lastError = remainingJobId
        ? {
            message: 'AI usage persistence jobs are awaiting retry',
            jobId: remainingJobId,
            at: new Date().toISOString()
          }
        : null;
    });
    this.worker.on?.('failed', (job, error) => {
      if (job?.id) this.failedJobIds.add(job.id);
      this.lastError = {
        message: String(error?.message || error).slice(0, 300),
        jobId: job?.id || null,
        at: new Date().toISOString()
      };
    });
    return this.status();
  }

  status() {
    let configured = false;
    try {
      configured = this.config().enabled;
    } catch (error) {
      this.lastError = {
        message: String(error?.message || error).slice(0, 300),
        at: new Date().toISOString()
      };
    }
    return {
      configured,
      started: this.started,
      healthy: !this.lastError && !this.lastTerminalFailure,
      lastError: this.lastError,
      lastTerminalFailure: this.lastTerminalFailure,
      deadLetterCount: this.deadLetterCount
    };
  }

  async close() {
    await this.worker?.close?.();
    await this.queue?.close?.();
    await this.workerConnection?.quit?.();
    await this.queueConnection?.quit?.();
    this.worker = null;
    this.queue = null;
    this.workerConnection = null;
    this.queueConnection = null;
    this.started = false;
  }
}

const usageMeteringOutbox = new UsageMeteringOutbox();

module.exports = {
  DEAD_LETTER_HEALTH_JOB_ID,
  DEAD_LETTER_HEALTH_JOB_NAME,
  DEAD_LETTER_JOB_NAME,
  QUEUE_NAME,
  UsageMeteringOutbox,
  assertUsageMeteringOutboxReady,
  deadLetterEnvelope,
  isTerminalPersistenceError,
  outboxJobId,
  resolveRedisConfig,
  usageMeteringOutboxReady,
  usageMeteringOutboxRequired,
  usageMeteringOutbox
};
