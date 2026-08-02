const DEFAULT_HEARTBEAT_MS = 15_000;

function asHeader(request, name) {
  if (typeof request?.get === 'function') return request.get(name);
  const headers = request?.headers || {};
  return headers[String(name).toLowerCase()] || headers[name];
}

class LiveSnapshotBroadcaster {
  constructor({
    sampler,
    intervalMs,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    errorMessage = 'Live telemetry is temporarily unavailable',
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    now = () => new Date()
  }) {
    if (typeof sampler !== 'function') throw new TypeError('sampler must be a function');
    if (!Number.isFinite(intervalMs) || intervalMs < 250) throw new TypeError('intervalMs must be at least 250ms');
    this.sampler = sampler;
    this.intervalMs = intervalMs;
    this.heartbeatMs = heartbeatMs;
    this.errorMessage = errorMessage;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.now = now;
    this.clients = new Set();
    this.sampleTimer = null;
    this.heartbeatTimer = null;
    this.samplePromise = null;
    this.lastSnapshot = null;
    this.lastFrame = null;
    this.lastEventId = null;
    this.revision = 0;
  }

  subscribe(request, response) {
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.flushHeaders?.();

    const client = {
      request,
      response,
      closed: false,
      blocked: false,
      pendingFrame: null,
      drainAttached: false
    };
    this.clients.add(client);
    const close = () => this.unsubscribe(client);
    request.on('close', close);
    response.on?.('close', close);

    const requestedEventId = String(asHeader(request, 'Last-Event-ID') || '');
    if (this.lastFrame && requestedEventId !== this.lastEventId) {
      this.write(client, this.lastFrame);
    }
    this.start();
    void this.sampleNow();
    return close;
  }

  unsubscribe(client) {
    if (!client || client.closed) return;
    client.closed = true;
    client.pendingFrame = null;
    this.clients.delete(client);
    if (!this.clients.size) this.stop();
  }

  start() {
    if (!this.sampleTimer) {
      this.sampleTimer = this.setIntervalFn(() => void this.sampleNow(), this.intervalMs);
      this.sampleTimer?.unref?.();
    }
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = this.setIntervalFn(() => this.heartbeat(), this.heartbeatMs);
      this.heartbeatTimer?.unref?.();
    }
  }

  stop() {
    if (this.sampleTimer) this.clearIntervalFn(this.sampleTimer);
    if (this.heartbeatTimer) this.clearIntervalFn(this.heartbeatTimer);
    this.sampleTimer = null;
    this.heartbeatTimer = null;
  }

  eventFrame(event, data, eventId = null) {
    return `${eventId ? `id: ${eventId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  write(client, frame) {
    if (!client || client.closed) return;
    if (client.blocked) {
      client.pendingFrame = frame;
      return;
    }
    try {
      if (client.response.write(frame) !== false) return;
      client.blocked = true;
      if (client.drainAttached) return;
      client.drainAttached = true;
      client.response.once?.('drain', () => {
        client.drainAttached = false;
        client.blocked = false;
        const pending = client.pendingFrame;
        client.pendingFrame = null;
        if (pending) this.write(client, pending);
      });
    } catch {
      this.unsubscribe(client);
    }
  }

  broadcast(frame) {
    for (const client of this.clients) this.write(client, frame);
  }

  heartbeat() {
    for (const client of this.clients) {
      if (!client.blocked) this.write(client, ': keep-alive\n\n');
    }
  }

  async sampleNow() {
    if (this.samplePromise) return this.samplePromise;
    this.samplePromise = Promise.resolve()
      .then(() => this.sampler())
      .then((snapshot) => {
        const sampledAt = snapshot?.sampledAt || this.now().toISOString();
        const eventId = `${Date.parse(sampledAt) || Date.now()}-${++this.revision}`;
        const enriched = {
          ...snapshot,
          stream: {
            eventId,
            sampledAt,
            staleAfterMs: this.intervalMs * 3
          }
        };
        this.lastSnapshot = enriched;
        this.lastEventId = eventId;
        this.lastFrame = this.eventFrame('snapshot', enriched, eventId);
        this.broadcast(this.lastFrame);
        return enriched;
      })
      .catch(() => {
        this.broadcast(this.eventFrame('telemetry-error', {
          message: this.errorMessage,
          lastGoodSampledAt: this.lastSnapshot?.sampledAt || null
        }));
        return null;
      })
      .finally(() => {
        this.samplePromise = null;
      });
    return this.samplePromise;
  }
}

module.exports = {
  LiveSnapshotBroadcaster
};
