const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function validDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] || 0;
}

function metric(records) {
  const calls = records.length;
  const failures = records.filter((record) => record.status === 'failed').length;
  const latency = records.reduce((sum, record) => sum + Number(record.latencyMs || 0), 0);
  return {
    calls,
    successes: calls - failures,
    failures,
    successRate: calls ? Number((((calls - failures) / calls) * 100).toFixed(1)) : 0,
    inputTokens: records.reduce((sum, record) => sum + Number(record.inputTokens || 0), 0),
    cachedInputTokens: records.reduce((sum, record) => sum + Number(record.cachedInputTokens || 0), 0),
    outputTokens: records.reduce((sum, record) => sum + Number(record.outputTokens || 0), 0),
    reasoningTokens: records.reduce((sum, record) => sum + Number(record.reasoningTokens || 0), 0),
    totalTokens: records.reduce((sum, record) => sum + Number(record.totalTokens || 0), 0),
    estimatedCostUsd: Number(records.reduce((sum, record) => sum + Number(record.estimatedCostUsd || 0), 0).toFixed(8)),
    averageLatencyMs: calls ? Math.round(latency / calls) : 0,
    maxLatencyMs: calls ? Math.max(...records.map((record) => Number(record.latencyMs || 0))) : 0,
    p50LatencyMs: percentile(records.map((record) => Number(record.latencyMs || 0)), 0.5),
    p95LatencyMs: percentile(records.map((record) => Number(record.latencyMs || 0)), 0.95),
    failovers: records.reduce((sum, record) => sum + Number(record.failovers || 0), 0)
  };
}

function identifier(record) {
  return crypto.createHash('sha256')
    .update(String(record.eventId || record.gatewayExecutionId || `${record.occurredAt}:${Math.random()}`))
    .digest('hex').slice(0, 24);
}

class LocalTelemetryStore {
  constructor({ directory, maxEvents = 50_000, maxQueueJobs = 10_000 } = {}) {
    this.directory = directory;
    this.eventsFile = path.join(directory, 'activity-events.jsonl');
    this.queueFile = path.join(directory, 'queue-history.json');
    this.maxEvents = boundedInteger(maxEvents, 50_000, 100, 250_000);
    this.maxQueueJobs = boundedInteger(maxQueueJobs, 10_000, 100, 100_000);
    this.events = this.readEvents();
    this.queueJobs = this.readJson(this.queueFile, []);
    this.writeChain = Promise.resolve();
  }

  readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
  }

  readEvents() {
    try {
      return fs.readFileSync(this.eventsFile, 'utf8').split(/\r?\n/).filter(Boolean)
        .slice(-this.maxEvents).map((line) => JSON.parse(line));
    } catch { return []; }
  }

  atomicWrite(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  persist() {
    this.writeChain = this.writeChain.then(() => {
      this.atomicWrite(this.eventsFile, `${this.events.map((event) => JSON.stringify(event)).join('\n')}\n`);
      this.atomicWrite(this.queueFile, JSON.stringify(this.queueJobs, null, 2));
    });
    return this.writeChain;
  }

  async record(record) {
    if (!record) return;
    const occurredAt = validDate(record.occurredAt)?.toISOString() || new Date().toISOString();
    const event = { ...record, _id: identifier(record), createdAt: occurredAt, occurredAt };
    const existing = this.events.findIndex((item) => item._id === event._id);
    if (existing >= 0) this.events[existing] = event;
    else this.events.push(event);
    this.events = this.events.slice(-this.maxEvents);
    await this.persist();
  }

  async recordQueueSnapshot(snapshot = {}) {
    const byId = new Map(this.queueJobs.map((job) => [job.jobId, job]));
    for (const job of Array.isArray(snapshot.recentJobs) ? snapshot.recentJobs : []) {
      if (!job?.jobId) continue;
      byId.set(job.jobId, { ...byId.get(job.jobId), ...job });
    }
    this.queueJobs = [...byId.values()]
      .sort((left, right) => Number(validDate(left.updatedAt)) - Number(validDate(right.updatedAt)))
      .slice(-this.maxQueueJobs);
    await this.persist();
  }

  providerTelemetry() {
    const now = Date.now();
    const within = (minutes) => this.events.filter((event) => now - Number(validDate(event.createdAt)) <= minutes * 60_000);
    const hour = within(60);
    const providerIds = [...new Set(hour.map((event) => event.provider || 'unknown'))];
    return {
      sampledAt: new Date().toISOString(), window: { minutes: 60 },
      totals: { fiveMinutes: metric(within(5)), hour: metric(hour) },
      providers: providerIds.map((id) => {
        const records = hour.filter((event) => (event.provider || 'unknown') === id);
        return { id, ...metric(records), lastRequestAt: records.at(-1)?.createdAt || null };
      })
    };
  }

  rangeRecords(range = '24h') {
    const duration = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000, '90d': 7_776_000_000 }[range] || 86_400_000;
    return this.events.filter((event) => Date.now() - Number(validDate(event.createdAt)) <= duration);
  }

  breakdown(records, property) {
    const groups = new Map();
    for (const record of records) {
      const id = String(record[property] || 'unknown');
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(record);
    }
    return [...groups.entries()].map(([id, values]) => ({ id, name: id, ...metric(values) }))
      .sort((left, right) => right.calls - left.calls);
  }

  analytics(range = '24h') {
    const records = this.rangeRecords(range);
    const bucketMs = range === '1h' ? 60_000 : range === '24h' ? 3_600_000 : 86_400_000;
    const buckets = new Map();
    for (const record of records) {
      const time = Number(validDate(record.createdAt));
      const at = new Date(Math.floor(time / bucketMs) * bucketMs).toISOString();
      if (!buckets.has(at)) buckets.set(at, []);
      buckets.get(at).push(record);
    }
    return {
      sampledAt: new Date().toISOString(), range,
      summary: {
        ...metric(records),
        uniqueActors: new Set(records.map((record) => record.actorId).filter(Boolean)).size,
        uniqueOrganizations: new Set(records.map((record) => record.organizationId).filter(Boolean)).size,
        sourceApps: new Set(records.map((record) => record.sourceApp).filter(Boolean)).size
      },
      timeline: [...buckets.entries()].sort().map(([at, values]) => ({ at, calls: values.length, failures: values.filter((value) => value.status === 'failed').length, tokens: metric(values).totalTokens })),
      activities: this.breakdown(records, 'activity'), providers: this.breakdown(records, 'provider'),
      sources: this.breakdown(records, 'sourceApp'), organizations: this.breakdown(records, 'organizationId'),
      actors: this.breakdown(records, 'actorId')
    };
  }

  activityHistory(query = {}) {
    const page = boundedInteger(query.page, 1, 1, 100_000);
    const limit = boundedInteger(query.limit, 25, 10, 100);
    let items = this.rangeRecords(query.range);
    for (const field of ['status', 'provider', 'activity', 'sourceApp', 'organizationId', 'actorId']) {
      if (query[field]) items = items.filter((item) => String(item[field] || '') === String(query[field]));
    }
    if (query.search) {
      const needle = String(query.search).toLowerCase();
      items = items.filter((item) => [item.requestId, item.activity, item.model, item.organizationName, item.actorName, item.actorEmail, item.errorCode]
        .some((value) => String(value || '').toLowerCase().includes(needle)));
    }
    items.sort((left, right) => Number(validDate(right.createdAt)) - Number(validDate(left.createdAt)));
    const total = items.length;
    return { items: items.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  queueHistory(query = {}) {
    const page = boundedInteger(query.page, 1, 1, 100_000);
    const limit = boundedInteger(query.limit, 25, 10, 100);
    let jobs = [...this.queueJobs];
    if (query.state) jobs = jobs.filter((job) => [job.state, job.phase].includes(query.state));
    if (query.source) jobs = jobs.filter((job) => job.source === query.source);
    if (query.search) jobs = jobs.filter((job) => String(job.jobId || '').toLowerCase().includes(String(query.search).toLowerCase()));
    if (validDate(query.from)) jobs = jobs.filter((job) => Number(validDate(job.updatedAt)) >= Number(validDate(query.from)));
    if (validDate(query.to)) jobs = jobs.filter((job) => Number(validDate(job.updatedAt)) <= Number(validDate(query.to)));
    jobs.sort((left, right) => Number(validDate(right.updatedAt)) - Number(validDate(left.updatedAt)));
    const total = jobs.length;
    return { jobs: jobs.slice((page - 1) * limit, page * limit), page, limit, total, pages: Math.ceil(total / limit), coverageStartedAt: jobs.at(-1)?.createdAt || null, measuredAt: new Date().toISOString() };
  }

  detail(id) { return this.events.find((event) => event._id === id) || null; }
  status() { return { directory: this.directory, retainedEvents: this.events.length, retainedQueueJobs: this.queueJobs.length, maxEvents: this.maxEvents, maxQueueJobs: this.maxQueueJobs }; }
}

module.exports = { LocalTelemetryStore, metric };
