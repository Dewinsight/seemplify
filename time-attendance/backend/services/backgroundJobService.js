const os = require('os');
const crypto = require('crypto');
const { BackgroundJob } = require('../models');

const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
const LEASE_MS = Number(process.env.BACKGROUND_JOB_LEASE_MS || 120000);
const POLL_MS = Number(process.env.BACKGROUND_JOB_POLL_MS || 5000);
let timer = null;
let processing = false;

const handlers = new Map();

function registerJobHandler(type, handler) {
    handlers.set(type, handler);
}

async function enqueueJob(type, payload = {}, options = {}) {
    const document = {
        type,
        payload,
        runAt: options.runAt || new Date(),
        repeatEveryMs: options.repeatEveryMs,
        maxAttempts: options.maxAttempts || 8,
        idempotencyKey: options.idempotencyKey,
    };
    if (!options.idempotencyKey) return BackgroundJob.create(document);
    return BackgroundJob.findOneAndUpdate(
        { idempotencyKey: options.idempotencyKey },
        { $setOnInsert: document },
        { upsert: true, new: true }
    );
}

async function ensureRecurringJobs() {
    const definitions = [
        ['auto_clock_out', 15 * 60 * 1000],
        ['timesheet_reminders', 60 * 60 * 1000],
        ['manager_reports', 60 * 60 * 1000],
        ['timesheet_automation', 15 * 60 * 1000],
        ['payroll_transfer', 60 * 1000],
        ['notification_delivery', 60 * 1000],
        ['webhook_delivery', 60 * 1000],
        ['roster_reconciliation', 24 * 60 * 60 * 1000],
        ['leave_reconciliation', 60 * 60 * 1000],
        ['presence_cleanup', 60 * 60 * 1000],
    ];
    await Promise.all(definitions.map(([type, repeatEveryMs]) => enqueueJob(type, {}, {
        idempotencyKey: `recurring:${type}`,
        repeatEveryMs,
    })));
}

async function claimNextJob() {
    const now = new Date();
    return BackgroundJob.findOneAndUpdate(
        {
            $or: [
                { status: 'pending', runAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] },
                { status: 'running', leaseUntil: { $lt: now } },
            ],
        },
        {
            $set: {
                status: 'running',
                leaseOwner: WORKER_ID,
                leaseUntil: new Date(now.getTime() + LEASE_MS),
                lastStartedAt: now,
            },
            $inc: { attempts: 1 },
        },
        { sort: { runAt: 1 }, new: true }
    );
}

async function completeJob(job, result) {
    const now = new Date();
    if (job.repeatEveryMs) {
        await BackgroundJob.updateOne({ _id: job._id, leaseOwner: WORKER_ID }, {
            $set: {
                status: 'pending',
                runAt: new Date(now.getTime() + job.repeatEveryMs),
                lastCompletedAt: now,
                lastError: '',
                result: result || null,
            },
            $unset: { leaseOwner: 1, leaseUntil: 1 },
        });
        return;
    }
    await BackgroundJob.updateOne({ _id: job._id, leaseOwner: WORKER_ID }, {
        $set: { status: 'completed', lastCompletedAt: now, result: result || null, lastError: '' },
        $unset: { leaseOwner: 1, leaseUntil: 1 },
    });
}

async function failJob(job, error) {
    const dead = job.attempts >= job.maxAttempts;
    const retryDelay = Math.min(60 * 60 * 1000, 15000 * (2 ** Math.max(0, job.attempts - 1)));
    await BackgroundJob.updateOne({ _id: job._id, leaseOwner: WORKER_ID }, {
        $set: {
            status: dead ? 'dead' : 'pending',
            runAt: new Date(Date.now() + retryDelay),
            lastError: String(error?.stack || error?.message || error).slice(0, 8000),
        },
        $unset: { leaseOwner: 1, leaseUntil: 1 },
    });
}

async function processAvailableJobs(limit = 10) {
    if (processing) return;
    processing = true;
    try {
        for (let count = 0; count < limit; count += 1) {
            const job = await claimNextJob();
            if (!job) break;
            const handler = handlers.get(job.type);
            if (!handler) {
                await failJob(job, new Error(`No handler registered for ${job.type}`));
                continue;
            }
            try {
                const result = await handler(job.payload || {}, job);
                await completeJob(job, result);
            } catch (error) {
                await failJob(job, error);
            }
        }
    } finally {
        processing = false;
    }
}

async function startBackgroundWorker() {
    if (process.env.DISABLE_BACKGROUND_WORKER === 'true' || timer) return;
    await ensureRecurringJobs();
    await BackgroundJob.updateMany(
        { status: 'running', leaseUntil: { $lt: new Date() } },
        { $set: { status: 'pending' }, $unset: { leaseOwner: 1, leaseUntil: 1 } }
    );
    timer = setInterval(() => processAvailableJobs().catch(error => console.error('Background worker error:', error)), POLL_MS);
    timer.unref?.();
    processAvailableJobs().catch(error => console.error('Background worker startup error:', error));
}

function stopBackgroundWorker() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = {
    enqueueJob,
    ensureRecurringJobs,
    processAvailableJobs,
    registerJobHandler,
    startBackgroundWorker,
    stopBackgroundWorker,
};
