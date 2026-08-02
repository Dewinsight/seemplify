const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ActivityQueueScheduler
} = require('../../../tools/local-llm/activity-queue.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('an activity lane waits in FIFO order instead of failing when its threshold is occupied', async () => {
  const scheduler = new ActivityQueueScheduler({
    getLimits: () => ({
      globalLimit: 2,
      activityLimit: 1,
      approvedConcurrency: 1,
      sustainedValidated: true
    })
  });
  const first = await scheduler.acquire('candidate.cv_parse');
  const secondReady = deferred();
  void scheduler.acquire('candidate.cv_parse').then(secondReady.resolve, secondReady.reject);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.snapshot().active, 1);
  assert.equal(scheduler.snapshot().waiting, 1);
  first.release();
  const second = await secondReady.promise;
  assert.equal(second.activity, 'candidate.cv_parse');
  assert.equal(scheduler.snapshot().active, 1);
  assert.equal(scheduler.snapshot().waiting, 0);
  second.release();
});

test('a saturated CV lane does not block an independently approved question lane', async () => {
  const limits = {
    'candidate.cv_parse': 1,
    'interview.questions': 2
  };
  const scheduler = new ActivityQueueScheduler({
    getLimits: (activity) => ({
      globalLimit: 3,
      activityLimit: limits[activity],
      approvedConcurrency: limits[activity],
      candidateConcurrency: limits[activity],
      sustainedValidated: true
    })
  });
  const cv = await scheduler.acquire('candidate.cv_parse');
  const queuedCv = scheduler.acquire('candidate.cv_parse');
  const questionOne = await scheduler.acquire('interview.questions');
  const questionTwo = await scheduler.acquire('interview.questions');
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.active, 3);
  assert.equal(snapshot.waiting, 1);
  assert.equal(
    snapshot.activityQueues.find((lane) => lane.activity === 'candidate.cv_parse').waiting,
    1
  );
  questionOne.release();
  questionTwo.release();
  cv.release();
  const nextCv = await queuedCv;
  nextCv.release();
});

test('round-robin dispatch gives waiting activities fair access to released global capacity', async () => {
  const scheduler = new ActivityQueueScheduler({
    getLimits: () => ({
      globalLimit: 1,
      activityLimit: 1,
      approvedConcurrency: 1,
      sustainedValidated: true
    })
  });
  const running = await scheduler.acquire('candidate.cv_parse');
  const order = [];
  const question = scheduler.acquire('interview.questions').then((permit) => {
    order.push('interview.questions');
    permit.release();
  });
  const secondCv = scheduler.acquire('candidate.cv_parse').then((permit) => {
    order.push('candidate.cv_parse');
    permit.release();
  });
  running.release();
  await Promise.all([question, secondCv]);
  assert.deepEqual(order, ['interview.questions', 'candidate.cv_parse']);
});

test('a disconnected queued caller is removed without consuming a slot', async () => {
  const scheduler = new ActivityQueueScheduler({
    getLimits: () => ({ globalLimit: 1, activityLimit: 1 })
  });
  const running = await scheduler.acquire('candidate.cv_parse');
  const controller = new AbortController();
  const queued = scheduler.acquire('candidate.cv_parse', { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, (error) => error.code === 'ACTIVITY_QUEUE_ABORTED');
  assert.equal(scheduler.snapshot().waiting, 0);
  running.release();
  assert.equal(scheduler.snapshot().active, 0);
});

test('stopping the scheduler rejects queued work while allowing active work to release', async () => {
  const scheduler = new ActivityQueueScheduler({
    getLimits: () => ({ globalLimit: 1, activityLimit: 1 })
  });
  const running = await scheduler.acquire('candidate.cv_parse');
  const queued = scheduler.acquire('candidate.cv_parse');
  scheduler.stop();
  await assert.rejects(queued, (error) => error.code === 'ACTIVITY_QUEUE_STOPPED');
  running.release();
  assert.equal(scheduler.snapshot().active, 0);
});

test('invalid dynamic limits fail closed instead of bypassing normalized scheduler limits', async () => {
  const scheduler = new ActivityQueueScheduler({
    getLimits: () => ({ globalLimit: Number.POSITIVE_INFINITY, activityLimit: 'not-a-limit' })
  });
  const queued = scheduler.acquire('candidate.cv_parse');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.snapshot().active, 0);
  assert.equal(scheduler.snapshot().waiting, 1);
  scheduler.stop();
  await assert.rejects(queued, (error) => error.code === 'ACTIVITY_QUEUE_STOPPED');
});
