const AIUsageEvent = require('../models/AIUsageEvent');
const CVProcessingJob = require('../models/CVProcessingJob');
const Candidate = require('../models/Candidate');

const CANDIDATE_JOB_INDEX_NAME = 'uniq_cv_processing_job_candidate';
const CANDIDATE_JOB_FIELD = 'processingMetadata.cvProcessingJobId';
const CANDIDATE_JOB_INDEX_KEY = { [CANDIDATE_JOB_FIELD]: 1 };
const CANDIDATE_JOB_INDEX_OPTIONS = {
  unique: true,
  name: CANDIDATE_JOB_INDEX_NAME,
  partialFilterExpression: {
    [CANDIDATE_JOB_FIELD]: { $type: 'string' }
  }
};

let compatibilityPromise;

function stageForState(state) {
  if (state === 'completed' || state === 'failed') return state;
  if (state === 'processing') return 'analyzing';
  return 'ingesting';
}

function sameIndexKey(left = {}, right = {}) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value], index) => (
      key === rightEntries[index]?.[0] && Number(value) === Number(rightEntries[index]?.[1])
    ));
}

async function backfillCvStages() {
  const states = ['queued', 'waiting_for_local_runtime', 'processing', 'completed', 'failed'];
  const results = await Promise.all(states.map((state) => CVProcessingJob.collection.updateMany(
    {
      state,
      $or: [
        { stage: { $exists: false } },
        { stage: null },
        { stage: '' }
      ]
    },
    { $set: { stage: stageForState(state) } }
  )));
  return results.reduce((total, result) => total + Number(result.modifiedCount || 0), 0);
}

async function backfillHistoricalTokenMetering() {
  const tokenFilter = {
    usageReported: { $ne: true },
    $or: [
      { totalTokens: { $gt: 0 } },
      { inputTokens: { $gt: 0 } },
      { cachedInputTokens: { $gt: 0 } },
      { outputTokens: { $gt: 0 } },
      { reasoningTokens: { $gt: 0 } }
    ]
  };
  const sourceResult = await AIUsageEvent.collection.updateMany(
    {
      ...tokenFilter,
      $and: [
        {
          $or: [
            { usageSource: { $exists: false } },
            { usageSource: null },
            { usageSource: '' }
          ]
        }
      ]
    },
    { $set: { usageSource: 'historical-token-backfill' } }
  );
  const reportedResult = await AIUsageEvent.collection.updateMany(
    tokenFilter,
    { $set: { usageReported: true } }
  );
  return {
    usageReported: Number(reportedResult.modifiedCount || 0),
    usageSource: Number(sourceResult.modifiedCount || 0)
  };
}

async function unsetBlankCandidateJobIds() {
  const result = await Candidate.collection.updateMany(
    {
      $and: [
        { [CANDIDATE_JOB_FIELD]: { $type: 'string' } },
        { [CANDIDATE_JOB_FIELD]: { $regex: /^\s*$/ } }
      ]
    },
    { $unset: { [CANDIDATE_JOB_FIELD]: '' } }
  );
  return Number(result.modifiedCount || 0);
}

async function repairDuplicateCandidateJobIds() {
  const duplicates = await Candidate.collection.aggregate([
    {
      $match: {
        $and: [
          { [CANDIDATE_JOB_FIELD]: { $type: 'string' } },
          { [CANDIDATE_JOB_FIELD]: { $regex: /\S/ } }
        ]
      }
    },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: `$${CANDIDATE_JOB_FIELD}`,
        candidateIds: { $push: '$_id' },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  let repaired = 0;
  for (const duplicate of duplicates) {
    const job = await CVProcessingJob.findOne({ publicId: duplicate._id })
      .select('candidate')
      .lean();
    const preferredId = String(job?.candidate || '');
    const canonical = duplicate.candidateIds.find((candidateId) => String(candidateId) === preferredId)
      || duplicate.candidateIds[0];
    const redundantIds = duplicate.candidateIds.filter((candidateId) => String(candidateId) !== String(canonical));
    if (!redundantIds.length) continue;
    const result = await Candidate.collection.updateMany(
      { _id: { $in: redundantIds } },
      { $unset: { [CANDIDATE_JOB_FIELD]: '' } }
    );
    repaired += Number(result.modifiedCount || 0);
  }
  return { groups: duplicates.length, candidates: repaired };
}

async function ensureCandidateJobIndex() {
  const indexes = await Candidate.collection.indexes();
  for (const index of indexes) {
    if (index.name === CANDIDATE_JOB_INDEX_NAME) {
      const compatible = index.unique === true
        && sameIndexKey(index.key, CANDIDATE_JOB_INDEX_KEY)
        && index.partialFilterExpression?.[CANDIDATE_JOB_FIELD]?.$type === 'string';
      if (compatible) {
        await Candidate.createIndexes();
        return { created: false, name: index.name };
      }
      await Candidate.collection.dropIndex(index.name);
      continue;
    }
    if (sameIndexKey(index.key, CANDIDATE_JOB_INDEX_KEY) && index.unique !== true) {
      await Candidate.collection.dropIndex(index.name);
    }
  }
  const name = await Candidate.collection.createIndex(
    CANDIDATE_JOB_INDEX_KEY,
    CANDIDATE_JOB_INDEX_OPTIONS
  );
  // Build any other declared Candidate indexes after the idempotency preflight.
  await Candidate.createIndexes();
  return { created: true, name };
}

async function runCompatibilityMigration() {
  const [stages, usage, blankCandidateJobIds] = await Promise.all([
    backfillCvStages(),
    backfillHistoricalTokenMetering(),
    unsetBlankCandidateJobIds()
  ]);
  const duplicateCandidateJobIds = await repairDuplicateCandidateJobIds();
  const candidateJobIndex = await ensureCandidateJobIndex();
  return {
    stages,
    usage,
    blankCandidateJobIds,
    duplicateCandidateJobIds,
    candidateJobIndex
  };
}

function ensureCvRuntimeCompatibility() {
  if (!compatibilityPromise) {
    compatibilityPromise = runCompatibilityMigration().catch((error) => {
      compatibilityPromise = null;
      throw error;
    });
  }
  return compatibilityPromise;
}

function resetForTests() {
  compatibilityPromise = null;
}

module.exports = {
  CANDIDATE_JOB_INDEX_NAME,
  ensureCvRuntimeCompatibility,
  resetForTests,
  stageForState,
  _runCompatibilityMigrationForTests: runCompatibilityMigration
};
