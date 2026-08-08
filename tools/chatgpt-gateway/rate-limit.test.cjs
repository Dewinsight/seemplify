'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { BoundedFixedWindowRateLimiter } = require('./rate-limit.cjs');

test('a throttled key can be told how long the wait is', () => {
  const limiter = new BoundedFixedWindowRateLimiter({ windowMs: 10_000, requests: 2 });
  const start = 1_000_000;

  // A key nobody has used is not waiting for anything.
  assert.equal(limiter.retryAfterMs('subject-a', start), 0);

  assert.equal(limiter.consume('subject-a', start), true);
  assert.equal(limiter.consume('subject-a', start + 1_000), true);
  assert.equal(limiter.consume('subject-a', start + 2_000), false, 'third attempt is refused');

  // The wait is measured from when the window opened, not from the refusal, so
  // it counts down rather than resetting on every rejected attempt.
  assert.equal(limiter.retryAfterMs('subject-a', start + 2_000), 8_000);
  assert.equal(limiter.retryAfterMs('subject-a', start + 9_500), 500);

  // Another subject's throttling is none of this one's business.
  assert.equal(limiter.retryAfterMs('subject-b', start + 2_000), 0);
});

test('the wait never goes negative once the window has lapsed', () => {
  const limiter = new BoundedFixedWindowRateLimiter({ windowMs: 5_000, requests: 1 });
  limiter.consume('subject', 0);
  assert.equal(limiter.retryAfterMs('subject', 60_000), 0);
  assert.equal(limiter.consume('subject', 60_000), true, 'a lapsed window admits again');
});

test('a failed protected operation can refund its attempt', () => {
  const limiter = new BoundedFixedWindowRateLimiter({ windowMs: 10_000, requests: 1 });
  const start = 1_000;
  assert.equal(limiter.consume('subject', start), true);
  assert.equal(limiter.refund('subject'), true);
  assert.equal(limiter.consume('subject', start + 1), true,
    'the failed admitted attempt no longer consumes the subject allowance');
});

test('an explicit reset clears one subject without affecting another', () => {
  const limiter = new BoundedFixedWindowRateLimiter({ windowMs: 10_000, requests: 1 });
  limiter.consume('subject-a', 1_000);
  limiter.consume('subject-b', 1_000);
  assert.equal(limiter.reset('subject-a'), true);
  assert.equal(limiter.consume('subject-a', 1_001), true);
  assert.equal(limiter.consume('subject-b', 1_001), false);
});
