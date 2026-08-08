const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AIUsageEvent = require('../models/AIUsageEvent');
const CVProcessingJob = require('../models/CVProcessingJob');
const Candidate = require('../models/Candidate');
const compatibility = require('../services/cvProcessingCompatibilityService');

let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('old terminal CV jobs do not hydrate with a contradictory ingesting stage', () => {
  const completed = CVProcessingJob.hydrate({
    state: 'completed',
    progress: 100
  });
  assert.equal(completed.stage, undefined);
  assert.equal(compatibility.stageForState(completed.state), 'completed');
});

test('compatibility migration repairs stages, token metering, candidate ids, and the unique index', async () => {
  await mongoose.connection.dropDatabase();
  compatibility.resetForTests();

  const canonicalCandidateId = new mongoose.Types.ObjectId();
  const duplicateCandidateId = new mongoose.Types.ObjectId();
  await CVProcessingJob.collection.insertMany([
    {
      publicId: 'cv_historical_complete',
      state: 'completed',
      progress: 100,
      candidate: canonicalCandidateId,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:01:00Z')
    },
    {
      publicId: 'cv_historical_processing',
      state: 'processing',
      progress: 50,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:01:00Z')
    }
  ]);
  await AIUsageEvent.collection.insertMany([
    {
      requestId: 'historical-metered',
      provider: 'chatgpt-connect',
      model: 'chatgpt-connected-account',
      totalTokens: 105,
      inputTokens: 100,
      outputTokens: 5,
      usageReported: false
    },
    {
      requestId: 'historical-unmetered',
      provider: 'chatgpt-connect',
      model: 'chatgpt-connected-account',
      totalTokens: 0
    }
  ]);
  await Candidate.collection.insertMany([
    {
      _id: canonicalCandidateId,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      processingMetadata: { cvProcessingJobId: 'cv_historical_complete' }
    },
    {
      _id: duplicateCandidateId,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      processingMetadata: { cvProcessingJobId: 'cv_historical_complete' }
    },
    {
      _id: new mongoose.Types.ObjectId(),
      processingMetadata: { cvProcessingJobId: '   ' }
    }
  ]);

  const result = await compatibility.ensureCvProcessingCompatibility();
  assert.equal(result.stages, 2);
  assert.equal(result.usage.usageReported, 1);
  assert.equal(result.duplicateCandidateJobIds.groups, 1);
  assert.equal(result.duplicateCandidateJobIds.candidates, 1);

  const completed = await CVProcessingJob.collection.findOne({ publicId: 'cv_historical_complete' });
  const processing = await CVProcessingJob.collection.findOne({ publicId: 'cv_historical_processing' });
  assert.equal(completed.stage, 'completed');
  assert.equal(processing.stage, 'analyzing');

  const metered = await AIUsageEvent.collection.findOne({ requestId: 'historical-metered' });
  const unmetered = await AIUsageEvent.collection.findOne({ requestId: 'historical-unmetered' });
  assert.equal(metered.usageReported, true);
  assert.equal(metered.usageSource, 'historical-token-backfill');
  assert.equal(unmetered.usageReported, undefined);

  const canonical = await Candidate.collection.findOne({ _id: canonicalCandidateId });
  const duplicate = await Candidate.collection.findOne({ _id: duplicateCandidateId });
  const blank = await Candidate.collection.findOne({ _id: { $nin: [canonicalCandidateId, duplicateCandidateId] } });
  assert.equal(canonical.processingMetadata.cvProcessingJobId, 'cv_historical_complete');
  assert.equal(duplicate.processingMetadata?.cvProcessingJobId, undefined);
  assert.equal(blank.processingMetadata?.cvProcessingJobId, undefined);

  const index = (await Candidate.collection.indexes())
    .find((item) => item.name === compatibility.CANDIDATE_JOB_INDEX_NAME);
  assert.equal(index?.unique, true);

  await assert.rejects(
    Candidate.collection.insertOne({
      _id: new mongoose.Types.ObjectId(),
      processingMetadata: { cvProcessingJobId: 'cv_historical_complete' }
    }),
    (error) => error?.code === 11000
  );
});
