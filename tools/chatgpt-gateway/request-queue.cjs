class ActivityQueueError extends Error {
  constructor(message, { code = 'ACTIVITY_QUEUE_ERROR', status = 503, retryable = true } = {}) {
    super(message);
    this.name = 'ActivityQueueError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function positiveInteger(value, fallback = 1, maximum = 128) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, parsed);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

class ActivityQueueScheduler {
  constructor({
    getLimits,
    maxQueuePerActivity = 1_000,
    maxWaitMs = 0,
    now = () => Date.now()
  } = {}) {
    if (typeof getLimits !== 'function') throw new TypeError('getLimits must be a function');
    this.getLimits = getLimits;
    this.maxQueuePerActivity = positiveInteger(maxQueuePerActivity, 1_000, 100_000);
    this.maxWaitMs = Math.max(0, Number(maxWaitMs || 0));
    this.now = now;
    this.active = 0;
    this.lanes = new Map();
    this.rotation = [];
    this.rotationIndex = 0;
    this.lastDispatchedActivity = null;
    this.stopped = false;
  }

  lane(activity) {
    const key = String(activity || '').trim();
    if (!key) throw new ActivityQueueError('An activity is required', {
      code: 'ACTIVITY_QUEUE_ACTIVITY_REQUIRED',
      status: 400,
      retryable: false
    });
    if (!this.lanes.has(key)) {
      this.lanes.set(key, {
        activity: key,
        active: 0,
        waiting: [],
        completed: 0,
        failed: 0,
        totalWaitMs: 0,
        maxObservedWaitMs: 0,
        recentWaitMs: [],
        recentRunMs: [],
        lastStartedAt: null,
        lastCompletedAt: null
      });
      this.rotation.push(key);
    }
    return this.lanes.get(key);
  }

  limits(activity) {
    const value = this.getLimits(activity) || {};
    const globalLimit = Math.max(0, Number(value.globalLimit ?? value.global ?? 0));
    const activityLimit = Math.max(0, Number(value.activityLimit ?? value.activity ?? 0));
    return {
      ...value,
      globalLimit: Number.isFinite(globalLimit) ? Math.floor(globalLimit) : 0,
      activityLimit: Number.isFinite(activityLimit) ? Math.floor(activityLimit) : 0
    };
  }

  canStart(lane) {
    if (this.stopped) return false;
    const limits = this.limits(lane.activity);
    return limits.globalLimit > 0
      && limits.activityLimit > 0
      && this.active < limits.globalLimit
      && lane.active < limits.activityLimit;
  }

  createPermit(lane, queuedAt = this.now()) {
    const startedAt = this.now();
    const waitMs = Math.max(0, startedAt - queuedAt);
    lane.active += 1;
    this.active += 1;
    lane.totalWaitMs += waitMs;
    lane.maxObservedWaitMs = Math.max(lane.maxObservedWaitMs, waitMs);
    lane.recentWaitMs.push(waitMs);
    if (lane.recentWaitMs.length > 200) lane.recentWaitMs.shift();
    lane.lastStartedAt = new Date(startedAt).toISOString();
    this.lastDispatchedActivity = lane.activity;
    let released = false;
    return {
      activity: lane.activity,
      waitMs,
      startedAt,
      release: ({ status = 'completed', latencyMs } = {}) => {
        if (released) return;
        released = true;
        const runMs = Math.max(0, Number(latencyMs ?? (this.now() - startedAt)));
        lane.active = Math.max(0, lane.active - 1);
        this.active = Math.max(0, this.active - 1);
        if (status === 'failed') lane.failed += 1;
        else lane.completed += 1;
        lane.recentRunMs.push(runMs);
        if (lane.recentRunMs.length > 200) lane.recentRunMs.shift();
        lane.lastCompletedAt = new Date(this.now()).toISOString();
        this.pump();
      }
    };
  }

  removeWaitingEntry(lane, entry) {
    const index = lane.waiting.indexOf(entry);
    if (index >= 0) lane.waiting.splice(index, 1);
    if (entry.timeout) clearTimeout(entry.timeout);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
  }

  acquire(activity, { signal } = {}) {
    const lane = this.lane(activity);
    if (this.stopped) {
      return Promise.reject(new ActivityQueueError('The inference scheduler is stopping', {
        code: 'ACTIVITY_QUEUE_STOPPED'
      }));
    }
    if (signal?.aborted) {
      return Promise.reject(new ActivityQueueError('The inference request was cancelled', {
        code: 'ACTIVITY_QUEUE_ABORTED',
        status: 499,
        retryable: true
      }));
    }
    if (this.canStart(lane) && lane.waiting.length === 0) {
      return Promise.resolve(this.createPermit(lane));
    }
    if (lane.waiting.length >= this.maxQueuePerActivity) {
      return Promise.reject(new ActivityQueueError(
        `The ${lane.activity} inference queue is full`,
        { code: 'ACTIVITY_QUEUE_FULL' }
      ));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        queuedAt: this.now(),
        resolve,
        reject,
        signal,
        onAbort: null,
        timeout: null
      };
      entry.onAbort = () => {
        this.removeWaitingEntry(lane, entry);
        reject(new ActivityQueueError('The inference request was cancelled while queued', {
          code: 'ACTIVITY_QUEUE_ABORTED',
          status: 499,
          retryable: true
        }));
        this.pump();
      };
      if (signal) signal.addEventListener('abort', entry.onAbort, { once: true });
      if (this.maxWaitMs > 0) {
        entry.timeout = setTimeout(() => {
          this.removeWaitingEntry(lane, entry);
          reject(new ActivityQueueError('The inference request exceeded its queue wait limit', {
            code: 'ACTIVITY_QUEUE_WAIT_TIMEOUT'
          }));
          this.pump();
        }, this.maxWaitMs);
        entry.timeout.unref?.();
      }
      lane.waiting.push(entry);
      this.pump();
    });
  }

  nextEligibleLane() {
    if (!this.rotation.length) return null;
    const lastIndex = this.lastDispatchedActivity
      ? this.rotation.indexOf(this.lastDispatchedActivity)
      : -1;
    const startIndex = lastIndex >= 0
      ? (lastIndex + 1) % this.rotation.length
      : this.rotationIndex;
    for (let offset = 0; offset < this.rotation.length; offset += 1) {
      const index = (startIndex + offset) % this.rotation.length;
      const lane = this.lanes.get(this.rotation[index]);
      if (lane?.waiting.length && this.canStart(lane)) {
        this.rotationIndex = (index + 1) % this.rotation.length;
        return lane;
      }
    }
    return null;
  }

  pump() {
    if (this.stopped) return;
    while (true) {
      const lane = this.nextEligibleLane();
      if (!lane) return;
      const entry = lane.waiting.shift();
      if (!entry) continue;
      if (entry.timeout) clearTimeout(entry.timeout);
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
      if (entry.signal?.aborted) {
        entry.reject(new ActivityQueueError('The inference request was cancelled while queued', {
          code: 'ACTIVITY_QUEUE_ABORTED',
          status: 499,
          retryable: true
        }));
        continue;
      }
      entry.resolve(this.createPermit(lane, entry.queuedAt));
    }
  }

  notifyLimitsChanged() {
    this.pump();
  }

  stop(error = new ActivityQueueError('The inference scheduler stopped', {
    code: 'ACTIVITY_QUEUE_STOPPED'
  })) {
    this.stopped = true;
    for (const lane of this.lanes.values()) {
      for (const entry of [...lane.waiting]) {
        this.removeWaitingEntry(lane, entry);
        entry.reject(error);
      }
    }
  }

  snapshot(knownActivities = []) {
    for (const activity of knownActivities) this.lane(activity);
    const activityQueues = [...this.lanes.values()]
      .map((lane) => {
        const limits = this.limits(lane.activity);
        const oldest = lane.waiting[0];
        return {
          activity: lane.activity,
          active: lane.active,
          waiting: lane.waiting.length,
          concurrency: limits.activityLimit,
          approvedConcurrency: Number(limits.approvedConcurrency ?? limits.activityLimit),
          candidateConcurrency: Number(limits.candidateConcurrency ?? limits.activityLimit),
          sustainedValidated: limits.sustainedValidated === true,
          durable: false,
          oldestWaitMs: oldest ? Math.max(0, this.now() - oldest.queuedAt) : 0,
          completed: lane.completed,
          failed: lane.failed,
          averageWaitMs: lane.recentWaitMs.length
            ? Math.round(lane.recentWaitMs.reduce((sum, value) => sum + value, 0) / lane.recentWaitMs.length)
            : 0,
          p95WaitMs: percentile(lane.recentWaitMs, 0.95),
          averageRunMs: lane.recentRunMs.length
            ? Math.round(lane.recentRunMs.reduce((sum, value) => sum + value, 0) / lane.recentRunMs.length)
            : 0,
          p95RunMs: percentile(lane.recentRunMs, 0.95),
          lastStartedAt: lane.lastStartedAt,
          lastCompletedAt: lane.lastCompletedAt
        };
      })
      .sort((left, right) => left.activity.localeCompare(right.activity));
    return {
      active: this.active,
      waiting: activityQueues.reduce((sum, lane) => sum + lane.waiting, 0),
      activityQueues
    };
  }
}

module.exports = {
  ActivityQueueError,
  ActivityQueueScheduler,
  positiveInteger
};
