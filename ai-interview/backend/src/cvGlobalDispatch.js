const crypto = require('crypto');
const IORedis = require('ioredis');

const PROTOCOL_VERSION = '2';
const REDIS_HASH_TAG = '{seemplify-cv-global-dispatch}';
const CONTRACT_KEY = `seemplify:${REDIS_HASH_TAG}:contract:v${PROTOCOL_VERSION}`;
const DEFAULT_IDENTITY = 'seemplify-cv-inference';
const DEFAULT_KEY_PREFIX = 'seemplify:cv:dispatch:v2';
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_POLL_MS = 250;
const DEFAULT_FAIRNESS_WINDOW_MS = 10_000;
const VALID_SERVICE_IDS = new Set(['recruiter', 'ai-interview']);

const INITIALIZE_SCRIPT = `
-- seemplify-cv-global-dispatch:v2:initialize
local contractKey = KEYS[1]
local controlKey = KEYS[2]
local leasesKey = KEYS[3]
local protocol = ARGV[1]
local identity = ARGV[2]
local keyPrefix = ARGV[3]
local approvedLimit = ARGV[4]
local leaseMs = ARGV[5]
local fairnessWindowMs = ARGV[6]
local redisIdentity = ARGV[7]
local fingerprint = ARGV[8]
local serviceId = ARGV[9]
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local existingFingerprint = redis.call('HGET', contractKey, 'fingerprint')
if existingFingerprint == false then
  if redis.call('HLEN', contractKey) > 0 then
    return { 0, 'contract_mismatch', 'fingerprint', 'partial-contract', fingerprint }
  end
  redis.call('HSET', contractKey,
    'protocol', protocol,
    'identity', identity,
    'keyPrefix', keyPrefix,
    'approvedLimit', approvedLimit,
    'leaseMs', leaseMs,
    'fairnessWindowMs', fairnessWindowMs,
    'redisIdentity', redisIdentity,
    'fingerprint', fingerprint)
else
  local fields = { 'protocol', 'identity', 'keyPrefix', 'approvedLimit', 'leaseMs', 'fairnessWindowMs', 'redisIdentity', 'fingerprint' }
  local expected = { protocol, identity, keyPrefix, approvedLimit, leaseMs, fairnessWindowMs, redisIdentity, fingerprint }
  for index = 1, #fields do
    local actual = redis.call('HGET', contractKey, fields[index])
    if actual ~= expected[index] then
      return { 0, 'contract_mismatch', fields[index], actual or '', expected[index] }
    end
  end
end
redis.call('HSET', contractKey, 'lastSeen:' .. serviceId, tostring(now))
local rawLimit = redis.call('HGET', controlKey, 'limit')
if rawLimit == false then
  rawLimit = '1'
  redis.call('HSET', controlKey, 'limit', rawLimit)
end
local limit = tonumber(rawLimit)
local approved = tonumber(approvedLimit)
if limit == nil or limit < 1 or limit ~= math.floor(limit) or limit > approved then
  return { 0, 'invalid_limit', 'limit', rawLimit, approvedLimit }
end
redis.call('HSETNX', controlKey, 'paused', '0')
redis.call('ZREMRANGEBYSCORE', leasesKey, '-inf', now)
local active = tonumber(redis.call('ZCARD', leasesKey)) or 0
local paused = redis.call('HGET', controlKey, 'paused') == '1' and 1 or 0
return { 1, 'ok', limit, paused, active, now }
`;

const ACQUIRE_SCRIPT = `
-- seemplify-cv-global-dispatch:v2:acquire
local contractKey = KEYS[1]
local controlKey = KEYS[2]
local leasesKey = KEYS[3]
local expectedFingerprint = ARGV[1]
local leaseMs = tonumber(ARGV[2])
local token = ARGV[3]
local serviceId = ARGV[4]
local fairnessWindowMs = tonumber(ARGV[5])
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local actualFingerprint = redis.call('HGET', contractKey, 'fingerprint')
if actualFingerprint ~= expectedFingerprint then
  return { 0, 'contract_mismatch', 'fingerprint', actualFingerprint or '', expectedFingerprint }
end
redis.call('ZREMRANGEBYSCORE', leasesKey, '-inf', now)
local limit = tonumber(redis.call('HGET', controlKey, 'limit'))
local approved = tonumber(redis.call('HGET', contractKey, 'approvedLimit'))
if limit == nil or approved == nil or limit < 1 or limit > approved then
  return { 0, 'invalid_limit', limit or 0, tonumber(redis.call('ZCARD', leasesKey)) or 0, now }
end
local active = tonumber(redis.call('ZCARD', leasesKey)) or 0
local waitingField = 'waiting:' .. serviceId
redis.call('HSET', controlKey, waitingField, tostring(now))
if redis.call('HGET', controlKey, 'paused') == '1' then
  return { 0, 'paused', limit, active, now }
end
if active >= limit then
  return { 0, 'full', limit, active, now }
end
local otherService = serviceId == 'recruiter' and 'ai-interview' or 'recruiter'
local otherWaitingField = 'waiting:' .. otherService
local otherSeenAt = tonumber(redis.call('HGET', controlKey, otherWaitingField))
if otherSeenAt ~= nil and now - otherSeenAt > fairnessWindowMs then
  redis.call('HDEL', controlKey, otherWaitingField)
  otherSeenAt = nil
end
if otherSeenAt ~= nil and redis.call('HGET', controlKey, 'lastGrantedService') == serviceId then
  return { 0, 'fairness', limit, active, now }
end
local expiresAt = now + leaseMs
redis.call('HDEL', controlKey, waitingField)
redis.call('HSET', controlKey, 'lastGrantedService', serviceId)
redis.call('ZADD', leasesKey, expiresAt, token)
redis.call('PEXPIRE', leasesKey, leaseMs * 2)
return { 1, 'acquired', limit, active + 1, now, expiresAt }
`;

const RENEW_SCRIPT = `
-- seemplify-cv-global-dispatch:v2:renew
local contractKey = KEYS[1]
local leasesKey = KEYS[2]
local expectedFingerprint = ARGV[1]
local token = ARGV[2]
local leaseMs = tonumber(ARGV[3])
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
if redis.call('HGET', contractKey, 'fingerprint') ~= expectedFingerprint then
  return { 0, 'contract_mismatch', now, 0 }
end
local score = tonumber(redis.call('ZSCORE', leasesKey, token))
if score == nil then
  return { 0, 'missing', now, 0 }
end
if score <= now then
  redis.call('ZREM', leasesKey, token)
  return { 0, 'expired', now, score }
end
local expiresAt = now + leaseMs
redis.call('ZADD', leasesKey, expiresAt, token)
redis.call('PEXPIRE', leasesKey, leaseMs * 2)
return { 1, 'renewed', now, expiresAt }
`;

const RELEASE_SCRIPT = `
-- seemplify-cv-global-dispatch:v2:release
local contractKey = KEYS[1]
local leasesKey = KEYS[2]
local expectedFingerprint = ARGV[1]
local token = ARGV[2]
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
if redis.call('HGET', contractKey, 'fingerprint') ~= expectedFingerprint then
  return { 0, 'contract_mismatch', now }
end
local removed = tonumber(redis.call('ZREM', leasesKey, token)) or 0
return { removed, removed == 1 and 'released' or 'missing', now }
`;

const STATE_SCRIPT = `
-- seemplify-cv-global-dispatch:v2:state
local contractKey = KEYS[1]
local controlKey = KEYS[2]
local leasesKey = KEYS[3]
local expectedFingerprint = ARGV[1]
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local actualFingerprint = redis.call('HGET', contractKey, 'fingerprint')
if actualFingerprint ~= expectedFingerprint then
  return { 0, 'contract_mismatch', 'fingerprint', actualFingerprint or '', expectedFingerprint }
end
redis.call('ZREMRANGEBYSCORE', leasesKey, '-inf', now)
local limit = tonumber(redis.call('HGET', controlKey, 'limit'))
local approved = tonumber(redis.call('HGET', contractKey, 'approvedLimit'))
if limit == nil or approved == nil or limit < 1 or limit > approved then
  return { 0, 'invalid_limit', limit or 0, tonumber(redis.call('ZCARD', leasesKey)) or 0, now }
end
local active = tonumber(redis.call('ZCARD', leasesKey)) or 0
local paused = redis.call('HGET', controlKey, 'paused') == '1' and 1 or 0
return { 1, 'ok', limit, paused, active, now }
`;

const SET_CONTROL_SCRIPT = `
-- seemplify-cv-global-dispatch:v2:set-control
local contractKey = KEYS[1]
local controlKey = KEYS[2]
local expectedFingerprint = ARGV[1]
local field = ARGV[2]
local value = ARGV[3]
if redis.call('HGET', contractKey, 'fingerprint') ~= expectedFingerprint then
  return { 0, 'contract_mismatch' }
end
redis.call('HSET', controlKey, field, value)
return { 1, 'updated' }
`;

function dispatchError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function contractFingerprint(contract) {
  return crypto.createHash('sha256').update(JSON.stringify({
    protocol: contract.protocol,
    identity: contract.identity,
    keyPrefix: contract.keyPrefix,
    approvedLimit: contract.approvedLimit,
    leaseMs: contract.leaseMs,
    fairnessWindowMs: contract.fairnessWindowMs,
    redisIdentity: contract.redisIdentity
  })).digest('hex');
}

function normalizeContract({
  identity = DEFAULT_IDENTITY,
  keyPrefix = DEFAULT_KEY_PREFIX,
  approvedLimit = 1,
  leaseMs = DEFAULT_LEASE_MS,
  fairnessWindowMs = DEFAULT_FAIRNESS_WINDOW_MS,
  redisIdentity = 'redis://unspecified:6379/0'
} = {}) {
  const normalizedIdentity = String(identity || '').trim();
  const normalizedPrefix = String(keyPrefix || '').trim().replace(/:+$/, '');
  if (!/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(normalizedIdentity)) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch identity is invalid');
  }
  if (!normalizedPrefix || normalizedPrefix.length > 180 || /[{}\s]/.test(normalizedPrefix)) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch key prefix is invalid');
  }
  const normalizedApprovedLimit = positiveInteger(approvedLimit, null);
  if (!normalizedApprovedLimit) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch approved limit must be a positive integer');
  }
  const normalizedLeaseMs = positiveInteger(leaseMs, null, 1_000);
  if (!normalizedLeaseMs) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch lease must be at least 1000ms');
  }
  const normalizedFairnessWindowMs = positiveInteger(fairnessWindowMs, null, 100);
  if (!normalizedFairnessWindowMs) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch fairness window must be at least 100ms');
  }
  const contract = {
    protocol: PROTOCOL_VERSION,
    identity: normalizedIdentity,
    keyPrefix: normalizedPrefix,
    approvedLimit: normalizedApprovedLimit,
    leaseMs: normalizedLeaseMs,
    fairnessWindowMs: normalizedFairnessWindowMs,
    redisIdentity: String(redisIdentity || '').trim()
  };
  if (!/^rediss?:\/\/[^/\s]+\/\d+$/.test(contract.redisIdentity)) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch Redis identity is invalid');
  }
  contract.fingerprint = contractFingerprint(contract);
  return Object.freeze(contract);
}

function globalDispatchKeys(keyPrefix = DEFAULT_KEY_PREFIX) {
  const normalizedPrefix = String(keyPrefix || '').trim().replace(/:+$/, '');
  if (!normalizedPrefix || /[{}\s]/.test(normalizedPrefix)) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch key prefix is invalid');
  }
  return Object.freeze({
    contractKey: CONTRACT_KEY,
    controlKey: `${normalizedPrefix}:${REDIS_HASH_TAG}:control`,
    leasesKey: `${normalizedPrefix}:${REDIS_HASH_TAG}:leases`
  });
}

function resolveGlobalDispatchConfig({
  env = process.env,
  enabled,
  serviceId,
  defaultApprovedLimit = 1,
  legacyRedis = {}
} = {}) {
  if (!VALID_SERVICE_IDS.has(serviceId)) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch service identity is invalid');
  }
  const explicitRedisUrl = String(
    env.CV_GLOBAL_DISPATCH_REDIS_URL
    || env.REDIS_URL
    || ''
  ).trim();
  const fallbackHost = String(
    env.CV_GLOBAL_DISPATCH_REDIS_HOST
    || env.REDIS_HOST
    || legacyRedis.host
    || ''
  ).trim();
  const fallbackPort = positiveInteger(
    env.CV_GLOBAL_DISPATCH_REDIS_PORT || env.REDIS_PORT || legacyRedis.port,
    6379
  );
  const fallbackDatabase = String(
    env.CV_GLOBAL_DISPATCH_REDIS_DB
    ?? env.REDIS_DB
    ?? legacyRedis.db
    ?? '0'
  ).trim();
  if (fallbackDatabase && !/^\d+$/.test(fallbackDatabase)) {
    throw dispatchError('CV_GLOBAL_DISPATCH_REDIS_URL_INVALID', 'CV global dispatch Redis database must be numeric');
  }
  const useTls = String(
    env.CV_GLOBAL_DISPATCH_REDIS_TLS
    ?? env.REDIS_TLS
    ?? legacyRedis.tls
    ?? 'false'
  ).toLowerCase() === 'true';
  const username = String(
    env.CV_GLOBAL_DISPATCH_REDIS_USERNAME
    || env.REDIS_USERNAME
    || legacyRedis.username
    || ''
  );
  const password = String(
    env.CV_GLOBAL_DISPATCH_REDIS_PASSWORD
    || env.REDIS_PASSWORD
    || legacyRedis.password
    || ''
  );
  const credentials = username || password
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';
  const bracketedHost = fallbackHost.includes(':') && !fallbackHost.startsWith('[')
    ? `[${fallbackHost}]`
    : fallbackHost;
  const derivedRedisUrl = fallbackHost
    ? `${useTls ? 'rediss' : 'redis'}://${credentials}${bracketedHost}:${fallbackPort}/${fallbackDatabase || '0'}`
    : '';
  const redisUrl = explicitRedisUrl || derivedRedisUrl;
  if (enabled && !redisUrl) {
    throw dispatchError(
      'CV_GLOBAL_DISPATCH_REDIS_URL_REQUIRED',
      'CV global dispatch requires CV_GLOBAL_DISPATCH_REDIS_URL or shared Redis host configuration'
    );
  }
  let parsedUrl = null;
  if (redisUrl) {
    try {
      parsedUrl = new URL(redisUrl);
    } catch {
      throw dispatchError('CV_GLOBAL_DISPATCH_REDIS_URL_INVALID', 'CV global dispatch Redis URL is invalid');
    }
    if (!['redis:', 'rediss:'].includes(parsedUrl.protocol)) {
      throw dispatchError('CV_GLOBAL_DISPATCH_REDIS_URL_INVALID', 'CV global dispatch Redis URL must use redis:// or rediss://');
    }
    if (!parsedUrl.hostname) {
      throw dispatchError('CV_GLOBAL_DISPATCH_REDIS_URL_INVALID', 'CV global dispatch Redis URL must include a host');
    }
    if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
      const db = parsedUrl.pathname.slice(1);
      if (!/^\d+$/.test(db)) {
        throw dispatchError('CV_GLOBAL_DISPATCH_REDIS_URL_INVALID', 'CV global dispatch Redis URL database must be numeric');
      }
    }
  }
  const database = parsedUrl?.pathname && parsedUrl.pathname !== '/'
    ? parsedUrl.pathname.slice(1)
    : '0';
  const redisEndpoint = parsedUrl
    ? `${parsedUrl.protocol}//${parsedUrl.hostname}:${parsedUrl.port || '6379'}/${database}`
    : null;
  const contract = normalizeContract({
    identity: env.CV_GLOBAL_DISPATCH_IDENTITY || DEFAULT_IDENTITY,
    keyPrefix: env.CV_GLOBAL_DISPATCH_KEY_PREFIX || DEFAULT_KEY_PREFIX,
    approvedLimit: env.CV_GLOBAL_DISPATCH_APPROVED_LIMIT || defaultApprovedLimit,
    leaseMs: env.CV_GLOBAL_DISPATCH_LEASE_MS || DEFAULT_LEASE_MS,
    fairnessWindowMs: env.CV_GLOBAL_DISPATCH_FAIRNESS_WINDOW_MS || DEFAULT_FAIRNESS_WINDOW_MS,
    redisIdentity: redisEndpoint || 'redis://unspecified:6379/0'
  });
  return Object.freeze({
    enabled: enabled === true,
    serviceId,
    redisUrl: redisUrl || null,
    redisEndpoint,
    redisSource: explicitRedisUrl ? 'url' : derivedRedisUrl ? 'legacy-derived' : null,
    tls: parsedUrl?.protocol === 'rediss:',
    tlsRejectUnauthorized: env.CV_GLOBAL_DISPATCH_TLS_REJECT_UNAUTHORIZED !== 'false',
    tlsServername: String(env.CV_GLOBAL_DISPATCH_TLS_SERVERNAME || '').trim() || undefined,
    pollMs: positiveInteger(env.CV_GLOBAL_DISPATCH_POLL_MS, DEFAULT_POLL_MS, 10),
    contract,
    keys: globalDispatchKeys(contract.keyPrefix)
  });
}

function createGlobalDispatchConnection(config, {
  Redis = IORedis,
  connectionName = `cv-global-dispatch:${config?.serviceId || 'worker'}`,
  enableReadyCheck = true
} = {}) {
  if (!config?.redisUrl) return null;
  const options = {
    maxRetriesPerRequest: null,
    enableReadyCheck,
    lazyConnect: true,
    connectionName
  };
  if (config.tls) {
    options.tls = {
      rejectUnauthorized: config.tlsRejectUnauthorized,
      ...(config.tlsServername ? { servername: config.tlsServername } : {})
    };
  }
  return new Redis(config.redisUrl, options);
}

function resultText(result, index, fallback = '') {
  return result?.[index] == null ? fallback : String(result[index]);
}

function resultNumber(result, index, fallback = 0) {
  const parsed = Number(result?.[index]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isDispatchSafetyError(error) {
  return String(error?.code || '').startsWith('CV_GLOBAL_DISPATCH_');
}

function createGlobalDispatchCoordinator({
  redis,
  serviceId,
  config,
  identity,
  keyPrefix,
  approvedLimit,
  leaseMs,
  fairnessWindowMs,
  pollMs,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  tokenFactory = () => crypto.randomUUID(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onFault = () => {}
} = {}) {
  if (!VALID_SERVICE_IDS.has(serviceId)) {
    throw dispatchError('CV_GLOBAL_DISPATCH_CONFIG_INVALID', 'CV global dispatch service identity is invalid');
  }
  const contract = config?.contract || normalizeContract({
    identity,
    keyPrefix,
    approvedLimit,
    leaseMs,
    fairnessWindowMs
  });
  const keys = config?.keys || globalDispatchKeys(contract.keyPrefix);
  const safePollMs = positiveInteger(pollMs ?? config?.pollMs, DEFAULT_POLL_MS, 10);
  const renewEveryMs = Math.max(250, Math.floor(contract.leaseMs / 3));
  const permits = new Map();
  let initialized = false;
  let stopping = false;
  let fault = null;
  let initializationPromise = null;

  function requireRedis() {
    if (!redis) {
      throw dispatchError('CV_GLOBAL_DISPATCH_UNAVAILABLE', 'Global CV dispatch Redis is unavailable');
    }
  }

  function requireInitialized() {
    requireRedis();
    if (!initialized) {
      throw dispatchError('CV_GLOBAL_DISPATCH_NOT_INITIALIZED', 'Global CV dispatch coordinator is not initialized');
    }
  }

  function wrapRedisError(error, action) {
    if (isDispatchSafetyError(error)) return error;
    return dispatchError(
      'CV_GLOBAL_DISPATCH_REDIS_ERROR',
      `Global CV dispatch Redis ${action} failed`,
      error
    );
  }

  function markFault(error) {
    const safeError = isDispatchSafetyError(error)
      ? error
      : wrapRedisError(error, 'operation');
    if (!fault) {
      fault = safeError;
      for (const permit of permits.values()) permit.markLost(safeError);
      try {
        onFault(safeError);
      } catch {}
    }
    return fault;
  }

  function parseState(result) {
    return {
      limit: Math.max(1, resultNumber(result, 2, 1)),
      paused: resultNumber(result, 3, 0) === 1,
      active: Math.max(0, resultNumber(result, 4, 0)),
      serverTimeMs: resultNumber(result, 5, 0)
    };
  }

  function initializationFailure(result) {
    const reason = resultText(result, 1, 'unknown');
    if (reason === 'contract_mismatch') {
      const field = resultText(result, 2, 'unknown');
      const actual = resultText(result, 3, 'unset');
      const expected = resultText(result, 4, 'unset');
      const error = dispatchError(
        'CV_GLOBAL_DISPATCH_CONTRACT_MISMATCH',
        `CV global dispatch contract mismatch for ${field} (expected ${expected}, persisted ${actual})`
      );
      error.dispatchField = field;
      error.expected = expected;
      error.actual = actual;
      return error;
    }
    if (reason === 'invalid_limit') {
      const initializedLayout = resultText(result, 2) === 'limit';
      const persisted = resultText(result, initializedLayout ? 3 : 2, 'unset');
      const approved = initializedLayout
        ? resultText(result, 4, String(contract.approvedLimit))
        : String(contract.approvedLimit);
      const error = dispatchError(
        'CV_GLOBAL_DISPATCH_PERSISTED_LIMIT_INVALID',
        `Persisted CV global dispatch limit ${persisted} is outside approved range 1-${approved}`
      );
      error.persistedLimit = persisted;
      error.approvedLimit = approved;
      return error;
    }
    return dispatchError('CV_GLOBAL_DISPATCH_INITIALIZATION_FAILED', 'CV global dispatch initialization failed');
  }

  async function initialize() {
    requireRedis();
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
      if (redis.status === 'wait') await redis.connect();
      let result;
      try {
        result = await redis.eval(
          INITIALIZE_SCRIPT,
          3,
          keys.contractKey,
          keys.controlKey,
          keys.leasesKey,
          contract.protocol,
          contract.identity,
          contract.keyPrefix,
          String(contract.approvedLimit),
          String(contract.leaseMs),
          String(contract.fairnessWindowMs),
          contract.redisIdentity,
          contract.fingerprint,
          serviceId
        );
      } catch (error) {
        throw markFault(wrapRedisError(error, 'initialization'));
      }
      if (resultNumber(result, 0) !== 1) {
        throw markFault(initializationFailure(result));
      }
      if (permits.size) {
        throw markFault(dispatchError(
          'CV_GLOBAL_DISPATCH_RECOVERY_UNSAFE',
          'Cannot recover CV global dispatch while local permits remain active'
        ));
      }
      initialized = true;
      fault = null;
      return parseState(result);
    })();
    try {
      return await initializationPromise;
    } finally {
      initializationPromise = null;
    }
  }

  async function state() {
    requireInitialized();
    let result;
    try {
      result = await redis.eval(
        STATE_SCRIPT,
        3,
        keys.contractKey,
        keys.controlKey,
        keys.leasesKey,
        contract.fingerprint
      );
    } catch (error) {
      throw markFault(wrapRedisError(error, 'state read'));
    }
    if (resultNumber(result, 0) !== 1) {
      throw markFault(initializationFailure(result));
    }
    return parseState(result);
  }

  async function setControl(field, value) {
    requireInitialized();
    if (fault) throw fault;
    let result;
    try {
      result = await redis.eval(
        SET_CONTROL_SCRIPT,
        2,
        keys.contractKey,
        keys.controlKey,
        contract.fingerprint,
        field,
        String(value)
      );
    } catch (error) {
      throw markFault(wrapRedisError(error, 'control update'));
    }
    if (resultNumber(result, 0) !== 1) {
      throw markFault(dispatchError(
        'CV_GLOBAL_DISPATCH_CONTRACT_MISMATCH',
        'CV global dispatch contract changed during control update'
      ));
    }
    return state();
  }

  async function setLimit(value) {
    const limit = positiveInteger(value, null);
    if (!limit || limit > contract.approvedLimit) {
      throw dispatchError(
        'CV_GLOBAL_DISPATCH_LIMIT_NOT_APPROVED',
        `CV global dispatch limit must be between 1 and ${contract.approvedLimit}`
      );
    }
    return setControl('limit', limit);
  }

  async function setPaused(paused) {
    return setControl('paused', paused === true ? '1' : '0');
  }

  function createPermit(token, acquiredAt, expiresAt) {
    const abortController = new AbortController();
    let renewalTimer = null;
    let renewPromise = null;
    let releasePromise = null;
    let released = false;
    let lostError = null;
    let resolveLoss;
    const lossPromise = new Promise((resolve) => {
      resolveLoss = resolve;
    });

    function stopRenewalTimer() {
      if (renewalTimer) clearTimeoutFn(renewalTimer);
      renewalTimer = null;
    }

    function markLost(error) {
      if (lostError) return;
      lostError = isDispatchSafetyError(error)
        ? error
        : dispatchError('CV_GLOBAL_DISPATCH_LEASE_LOST', 'CV global dispatch lease was lost', error);
      stopRenewalTimer();
      abortController.abort(lostError);
      resolveLoss(lostError);
    }

    async function renew() {
      if (lostError) throw lostError;
      if (released) {
        throw dispatchError('CV_GLOBAL_DISPATCH_LEASE_RELEASED', 'CV global dispatch lease was already released');
      }
      if (renewPromise) return renewPromise;
      renewPromise = (async () => {
        let result;
        try {
          result = await redis.eval(
            RENEW_SCRIPT,
            2,
            keys.contractKey,
            keys.leasesKey,
            contract.fingerprint,
            token,
            String(contract.leaseMs)
          );
        } catch (error) {
          const wrapped = markFault(wrapRedisError(error, 'lease renewal'));
          markLost(wrapped);
          throw wrapped;
        }
        if (resultNumber(result, 0) !== 1) {
          const reason = resultText(result, 1, 'missing');
          const error = dispatchError(
            reason === 'contract_mismatch'
              ? 'CV_GLOBAL_DISPATCH_CONTRACT_MISMATCH'
              : 'CV_GLOBAL_DISPATCH_LEASE_LOST',
            reason === 'contract_mismatch'
              ? 'CV global dispatch contract changed while inference was active'
              : `CV global dispatch lease was ${reason}`
          );
          markLost(error);
          markFault(error);
          throw error;
        }
        permit.serverTimeMs = resultNumber(result, 2, permit.serverTimeMs);
        permit.expiresAt = resultNumber(result, 3, permit.expiresAt);
        return true;
      })().finally(() => {
        renewPromise = null;
      });
      return renewPromise;
    }

    function scheduleRenewal() {
      if (released || lostError || renewalTimer) return;
      renewalTimer = setTimeoutFn(() => {
        renewalTimer = null;
        void renew().then(scheduleRenewal).catch(() => {});
      }, renewEveryMs);
      renewalTimer?.unref?.();
    }

    const permit = {
      token,
      acquiredAt,
      expiresAt,
      serverTimeMs: acquiredAt,
      signal: abortController.signal,
      get lost() {
        return Boolean(lostError);
      },
      get lossError() {
        return lostError;
      },
      markLost,
      async run(operation) {
        if (typeof operation !== 'function') {
          throw new TypeError('CV global dispatch permit operation must be a function');
        }
        if (lostError) throw lostError;
        scheduleRenewal();
        const operationPromise = Promise.resolve().then(() => operation({
          signal: abortController.signal,
          permit
        }));
        const lossRace = lossPromise.then((error) => {
          throw error;
        });
        let result;
        try {
          result = await Promise.race([operationPromise, lossRace]);
        } catch (error) {
          stopRenewalTimer();
          if (lostError) {
            // Do not return the durable job for retry while an uncooperative
            // provider request may still be running. The propagated abort
            // signal should make this settle promptly in normal operation.
            await operationPromise.catch(() => {});
            throw lostError;
          }
          throw error;
        }
        stopRenewalTimer();
        await renew();
        return result;
      },
      async release() {
        if (released) return false;
        if (releasePromise) return releasePromise;
        stopRenewalTimer();
        releasePromise = (async () => {
          try {
            if (renewPromise) {
              await renewPromise.catch(() => {});
            }
            if (lostError) {
              await redis.zrem(keys.leasesKey, token).catch(() => 0);
              return false;
            }
            let result;
            try {
              result = await redis.eval(
                RELEASE_SCRIPT,
                2,
                keys.contractKey,
                keys.leasesKey,
                contract.fingerprint,
                token
              );
            } catch (error) {
              const wrapped = markFault(wrapRedisError(error, 'lease release'));
              markLost(wrapped);
              throw wrapped;
            }
            if (resultNumber(result, 0) !== 1) {
              const reason = resultText(result, 1, 'missing');
              const error = dispatchError(
                reason === 'contract_mismatch'
                  ? 'CV_GLOBAL_DISPATCH_CONTRACT_MISMATCH'
                  : 'CV_GLOBAL_DISPATCH_LEASE_LOST',
                `CV global dispatch lease release failed: ${reason}`
              );
              markLost(error);
              markFault(error);
              throw error;
            }
            return true;
          } finally {
            released = true;
            permits.delete(token);
          }
        })();
        return releasePromise;
      }
    };
    permits.set(token, permit);
    scheduleRenewal();
    return permit;
  }

  async function tryAcquire(jobId) {
    requireInitialized();
    if (stopping) {
      return {
        acquired: false,
        reason: 'stopping',
        limit: contract.approvedLimit,
        active: permits.size
      };
    }
    if (fault) {
      if (permits.size === 0) {
        try {
          await initialize();
        } catch {}
      }
      if (fault) {
        return {
          acquired: false,
          reason: 'unhealthy',
          limit: contract.approvedLimit,
          active: permits.size,
          error: fault
        };
      }
    }
    const token = `${serviceId}:${process.pid}:${String(jobId || 'job').slice(0, 120)}:${tokenFactory()}`;
    let result;
    try {
      result = await redis.eval(
        ACQUIRE_SCRIPT,
        3,
        keys.contractKey,
        keys.controlKey,
        keys.leasesKey,
        contract.fingerprint,
        String(contract.leaseMs),
        token,
        serviceId,
        String(contract.fairnessWindowMs)
      );
    } catch (error) {
      const wrapped = markFault(wrapRedisError(error, 'lease acquisition'));
      return {
        acquired: false,
        reason: 'unhealthy',
        limit: contract.approvedLimit,
        active: permits.size,
        error: wrapped
      };
    }
    const reason = resultText(result, 1, 'unknown');
    if (resultNumber(result, 0) !== 1) {
      if (['contract_mismatch', 'invalid_limit'].includes(reason)) {
        const error = reason === 'contract_mismatch'
          ? dispatchError('CV_GLOBAL_DISPATCH_CONTRACT_MISMATCH', 'CV global dispatch contract changed')
          : dispatchError('CV_GLOBAL_DISPATCH_PERSISTED_LIMIT_INVALID', 'Persisted CV global dispatch limit is invalid');
        markFault(error);
        return {
          acquired: false,
          reason: 'unhealthy',
          limit: resultNumber(result, 2, contract.approvedLimit),
          active: resultNumber(result, 3, permits.size),
          error
        };
      }
      return {
        acquired: false,
        reason,
        limit: Math.max(1, resultNumber(result, 2, 1)),
        active: Math.max(0, resultNumber(result, 3, 0)),
        serverTimeMs: resultNumber(result, 4, 0)
      };
    }
    const acquiredAt = resultNumber(result, 4, 0);
    const leaseExpiresAt = resultNumber(result, 5, acquiredAt + contract.leaseMs);
    return {
      acquired: true,
      reason: 'acquired',
      limit: Math.max(1, resultNumber(result, 2, 1)),
      active: Math.max(1, resultNumber(result, 3, 1)),
      serverTimeMs: acquiredAt,
      permit: createPermit(token, acquiredAt, leaseExpiresAt)
    };
  }

  async function acquire(jobId) {
    while (!stopping) {
      const attempt = await tryAcquire(jobId);
      if (attempt.acquired) return attempt.permit;
      if (attempt.reason === 'unhealthy') throw attempt.error || fault;
      await sleep(safePollMs);
    }
    throw dispatchError(
      'CV_GLOBAL_DISPATCH_STOPPING',
      'CV worker is stopping before a global dispatch permit became available'
    );
  }

  async function withPermit(jobId, operation) {
    const permit = await acquire(jobId);
    let result;
    let operationError;
    try {
      result = await permit.run(operation);
    } catch (error) {
      operationError = error;
    }
    let releaseError;
    try {
      await permit.release();
    } catch (error) {
      releaseError = error;
    }
    if (operationError) throw operationError;
    if (releaseError) throw releaseError;
    return result;
  }

  function open() {
    stopping = false;
  }

  function beginShutdown() {
    stopping = true;
  }

  async function releaseAll() {
    await Promise.all([...permits.values()].map((permit) => permit.release().catch(() => false)));
  }

  function health() {
    return {
      initialized,
      stopping,
      healthy: !fault,
      errorCode: fault?.code || null,
      localPermits: permits.size
    };
  }

  return {
    acquire,
    beginShutdown,
    contract,
    health,
    initialize,
    keys,
    open,
    releaseAll,
    setLimit,
    setPaused,
    state,
    tryAcquire,
    withPermit
  };
}

function createGlobalDispatchInferenceRunner({
  coordinator,
  retryDelayMs = DEFAULT_POLL_MS,
  now = () => Date.now(),
  DelayedErrorType
} = {}) {
  if (!coordinator || typeof coordinator.tryAcquire !== 'function') {
    throw new TypeError('CV global dispatch inference runner requires a coordinator');
  }
  if (typeof DelayedErrorType !== 'function') {
    throw new TypeError('CV global dispatch inference runner requires BullMQ DelayedError');
  }
  const safeRetryDelayMs = positiveInteger(retryDelayMs, DEFAULT_POLL_MS, 10);

  async function defer(bullJob, workerToken, onDeferred, reason, error) {
    try {
      if (typeof onDeferred === 'function') {
        await onDeferred({
          reason,
          error: error || null,
          retryAfterMs: safeRetryDelayMs
        });
      }
      if (typeof bullJob?.moveToDelayed !== 'function') {
        throw new Error('BullMQ job does not support delayed storage');
      }
      await bullJob.moveToDelayed(now() + safeRetryDelayMs, workerToken);
    } catch (cause) {
      throw dispatchError(
        'CV_GLOBAL_DISPATCH_DEFER_FAILED',
        'CV job could not be returned to delayed storage',
        cause
      );
    }
    const delayed = new DelayedErrorType();
    delayed.code = 'CV_GLOBAL_DISPATCH_DEFERRED';
    delayed.dispatchReason = reason;
    delayed.retryAfterMs = safeRetryDelayMs;
    throw delayed;
  }

  return async function runInference(bullJob, workerToken, operation, onDeferred) {
    let dispatch;
    try {
      dispatch = await coordinator.tryAcquire(bullJob?.id || bullJob?.data?.processingJobId);
    } catch (error) {
      return defer(bullJob, workerToken, onDeferred, 'unhealthy', error);
    }
    if (!dispatch.acquired) {
      return defer(
        bullJob,
        workerToken,
        onDeferred,
        dispatch.reason || 'unknown',
        dispatch.error || null
      );
    }

    let result;
    let operationError;
    try {
      result = await dispatch.permit.run(({ signal, permit }) => operation({ signal, permit }));
    } catch (error) {
      operationError = error;
    }
    let releaseError;
    try {
      await dispatch.permit.release();
    } catch (error) {
      releaseError = error;
    }
    const safetyError = [operationError, releaseError].find(isDispatchSafetyError);
    if (safetyError) {
      return defer(bullJob, workerToken, onDeferred, 'lease-lost', safetyError);
    }
    if (operationError) throw operationError;
    if (releaseError) throw releaseError;
    return result;
  };
}

module.exports = {
  CONTRACT_KEY,
  DEFAULT_IDENTITY,
  DEFAULT_KEY_PREFIX,
  DEFAULT_LEASE_MS,
  DEFAULT_POLL_MS,
  DEFAULT_FAIRNESS_WINDOW_MS,
  PROTOCOL_VERSION,
  REDIS_HASH_TAG,
  createGlobalDispatchConnection,
  createGlobalDispatchCoordinator,
  createGlobalDispatchInferenceRunner,
  globalDispatchKeys,
  isDispatchSafetyError,
  normalizeContract,
  resolveGlobalDispatchConfig
};
