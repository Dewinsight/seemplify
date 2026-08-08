'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sanitizeUsageEvent } = require('./usage-metering-outbox.cjs');
const { canonicalConsumerId, normalizeSourceApp } = require('./consumer-registry.cjs');

class PlatformUsageLedger {
  constructor({ directory, log = () => {} }) {
    if (!directory) throw new TypeError('Platform usage ledger directory is required');
    this.directory = path.resolve(directory);
    this.eventsDirectory = path.join(this.directory, 'events');
    this.log = log;
    this.writeChain = Promise.resolve();
    this.lastRecordAt = null;
    fs.mkdirSync(this.eventsDirectory, { recursive: true });
  }

  eventFile(eventId) {
    return path.join(this.eventsDirectory, `${crypto.createHash('sha256').update(eventId).digest('hex')}.json`);
  }

  async record(input) {
    const sanitized = sanitizeUsageEvent(input);
    const sourceApp = canonicalConsumerId(sanitized.sourceApp);
    if (!sourceApp) {
      throw Object.assign(new Error(`AI source application is not registered: ${sanitized.sourceApp}`), {
        code: 'AI_SOURCE_APP_NOT_ALLOWED'
      });
    }
    const event = { ...sanitized, sourceApp };
    const serialized = JSON.stringify(event);
    const file = this.eventFile(event.eventId);
    this.writeChain = this.writeChain.then(async () => {
      try { await fs.promises.writeFile(file, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
      catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await fs.promises.readFile(file, 'utf8');
        if (existing !== serialized) {
          throw Object.assign(new Error(`AI usage identity conflict for ${event.eventId}`), { code: 'AI_USAGE_IDENTITY_CONFLICT' });
        }
      }
    });
    await this.writeChain;
    this.lastRecordAt = event.occurredAt;
    return event;
  }

  async query({ sourceApp, status, activity, limit = 100 } = {}) {
    const maximum = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const names = (await fs.promises.readdir(this.eventsDirectory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    const records = await Promise.all(names.map(async (name) => {
      const file = path.join(this.eventsDirectory, name);
      try {
        const [event, stats] = await Promise.all([
          fs.promises.readFile(file, 'utf8').then(JSON.parse), fs.promises.stat(file)
        ]);
        return { event, modifiedAt: stats.mtimeMs };
      } catch (error) {
        this.log('error', 'Platform usage ledger record is unreadable', { name, error: error.message });
        return null;
      }
    }));
    const normalizedSource = sourceApp
      ? canonicalConsumerId(sourceApp) || normalizeSourceApp(sourceApp)
      : '';
    return records.filter(Boolean).sort((left, right) => right.modifiedAt - left.modifiedAt).map(({ event }) => event).filter((event) => event
      && (!normalizedSource || event.sourceApp === normalizedSource)
      && (!status || event.status === status)
      && (!activity || event.activity === activity))
      .slice(0, maximum);
  }

  async summary({ sourceApp } = {}) {
    const events = await this.query({ sourceApp, limit: 500 });
    const bySourceApp = {};
    let success = 0; let failed = 0; let totalTokens = 0;
    for (const event of events) {
      bySourceApp[event.sourceApp] = (bySourceApp[event.sourceApp] || 0) + 1;
      if (event.status === 'failed') failed += 1; else success += 1;
      totalTokens += Number(event.totalTokens || 0);
    }
    return { retainedSample: events.length, success, failed, totalTokens, bySourceApp };
  }

  status() {
    let records = 0; let bytes = 0;
    try {
      const names = fs.readdirSync(this.eventsDirectory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
      records = names.length;
      for (const name of names) bytes += fs.statSync(path.join(this.eventsDirectory, name)).size;
    } catch {}
    return { owner: 'seemplify-platform', persistence: 'server-volume', records, bytes, lastRecordAt: this.lastRecordAt };
  }
}

module.exports = { PlatformUsageLedger };
