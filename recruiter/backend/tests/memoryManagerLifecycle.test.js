const test = require('node:test');
const assert = require('node:assert/strict');

test('memory manager cleanup does not retain test workers or install process handlers', async () => {
  const sigintListeners = process.listenerCount('SIGINT');
  const sigtermListeners = process.listenerCount('SIGTERM');
  const memoryManager = require('../services/memoryManager');

  assert.equal(process.listenerCount('SIGINT'), sigintListeners);
  assert.equal(process.listenerCount('SIGTERM'), sigtermListeners);
  assert.equal(memoryManager.cleanupInterval.hasRef(), false);

  let successfulFlushes = 0;
  let failedFlushes = 0;
  memoryManager.memoryInstances.set('successful', {
    instance: {
      async flushPendingSaves() {
        successfulFlushes += 1;
      }
    }
  });
  memoryManager.memoryInstances.set('failed', {
    instance: {
      async flushPendingSaves() {
        failedFlushes += 1;
        throw new Error('synthetic persistence failure');
      }
    }
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await Promise.all([memoryManager.shutdown(), memoryManager.shutdown()]);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(successfulFlushes, 1);
  assert.equal(failedFlushes, 1);
  assert.equal(memoryManager.cleanupInterval, null);
  assert.equal(memoryManager.memoryInstances.size, 0);
});
