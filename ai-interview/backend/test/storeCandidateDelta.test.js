const assert = require('node:assert/strict');
const test = require('node:test');

const { buildCandidateDeltaOperations } = require('../src/store');

test('Mongo snapshot mutations only write candidate fields that actually changed', () => {
  const previous = [{
    _id: 'cand_existing',
    email: 'ada@example.com',
    phone: '',
    skills: ['Math'],
    updatedAt: '2026-07-24T11:00:00.000Z'
  }];
  const next = [{
    ...previous[0],
    phone: '+44 1234',
    updatedAt: '2026-07-24T12:00:00.000Z'
  }];

  const operations = buildCandidateDeltaOperations(previous, next);
  assert.equal(operations.length, 1);
  assert.deepEqual(operations[0].updateOne.update.$set, {
    phone: '+44 1234',
    updatedAt: '2026-07-24T12:00:00.000Z'
  });
  assert.equal('resumeUploads' in operations[0].updateOne.update.$set, false);
  assert.equal('cvProcessingJobIds' in operations[0].updateOne.update.$set, false);
});

test('stale snapshot deletion cannot remove a candidate changed by CV processing', () => {
  const withoutReceipt = buildCandidateDeltaOperations([{
    _id: 'cand_existing',
    email: 'ada@example.com'
  }], []);
  assert.deepEqual(withoutReceipt[0].deleteOne.filter.cvProcessingRevision, {
    $exists: false
  });

  const withReceipt = buildCandidateDeltaOperations([{
    _id: 'cand_existing',
    email: 'ada@example.com',
    cvProcessingRevision: 7
  }], []);
  assert.equal(withReceipt[0].deleteOne.filter.cvProcessingRevision, 7);
});
