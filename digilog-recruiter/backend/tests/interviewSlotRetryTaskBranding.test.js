const test = require('node:test');
const assert = require('node:assert/strict');
const InterviewSlotRetryTask = require('../models/InterviewSlotRetryTask');

test('retry tasks retain their organization name in session context', () => {
  const task = new InterviewSlotRetryTask({
    sessionContext: {
      organizationName: 'Acme Ltd'
    }
  });

  assert.equal(task.sessionContext.organizationName, 'Acme Ltd');
  assert.equal(task.toObject().sessionContext.organizationName, 'Acme Ltd');
});
