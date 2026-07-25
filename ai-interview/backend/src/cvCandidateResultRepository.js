const {
  connectMongo,
  iso,
  mutateStore,
  shouldUseMongo
} = require('./store');
const {
  attachProcessingIdentity,
  deterministicCvCandidateId,
  hasProcessingIdentity
} = require('./cvCandidateIdempotency');

const COLLECTION_NAME = 'candidates';
const DEFAULT_MAX_COMMIT_ATTEMPTS = 20;

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function isDuplicateKey(error) {
  return Number(error?.code) === 11000;
}

function ownedByActor(candidate, actorId) {
  return !candidate?.createdBy || candidate.createdBy === actorId;
}

function mongoOwnership(actorId) {
  return {
    $or: [
      { createdBy: actorId },
      { createdBy: null },
      { createdBy: { $exists: false } }
    ]
  };
}

function committedIdentityFilter(publicId) {
  return {
    $or: [
      { cvProcessingJobIds: publicId },
      { cvProcessingJobId: publicId }
    ]
  };
}

function compareAndSwapFilter(candidate) {
  const filter = { _id: candidate._id };
  filter.cvProcessingRevision = Object.prototype.hasOwnProperty.call(
    candidate,
    'cvProcessingRevision'
  )
    ? candidate.cvProcessingRevision
    : { $exists: false };
  filter.updatedAt = Object.prototype.hasOwnProperty.call(candidate, 'updatedAt')
    ? candidate.updatedAt
    : { $exists: false };
  return filter;
}

function createCvCandidateResultRepository({
  useMongo = shouldUseMongo(),
  getDb = connectMongo,
  mutate = mutateStore,
  now = () => new Date(),
  maxCommitAttempts = DEFAULT_MAX_COMMIT_ATTEMPTS
} = {}) {
  const safeMaxCommitAttempts = Math.max(2, Math.floor(Number(maxCommitAttempts) || 0));

  function operationTime() {
    const value = now();
    return value instanceof Date ? new Date(value) : new Date(value);
  }

  function validateInput({
    processingJob,
    candidateEmail,
    createCandidate,
    applyResult
  }) {
    if (!processingJob?.publicId) {
      throw new TypeError('CV processing job publicId is required');
    }
    if (!['import', 'enrich'].includes(processingJob.mode)) {
      throw new TypeError('CV processing mode must be import or enrich');
    }
    if (processingJob.mode === 'import' && !String(candidateEmail || '').trim()) {
      throw new Error(
        'The CV was parsed, but no email address was found. Add the candidate manually or upload a clearer CV.'
      );
    }
    if (typeof createCandidate !== 'function' || typeof applyResult !== 'function') {
      throw new TypeError('Candidate creation and result application callbacks are required');
    }
  }

  function findJsonTarget(candidates, processingJob, candidateEmail) {
    const committed = candidates.find((candidate) => (
      hasProcessingIdentity(candidate, processingJob.publicId)
    ));
    if (committed) return { candidate: committed, committed: true };
    if (processingJob.mode === 'enrich') {
      return {
        candidate: candidates.find((candidate) => (
          candidate._id === processingJob.candidateId
          && ownedByActor(candidate, processingJob.actorId)
        )) || null,
        committed: false
      };
    }
    return {
      candidate: candidates.find((candidate) => (
        candidate.email === candidateEmail
        && candidate.jobId === processingJob.jobId
        && ownedByActor(candidate, processingJob.actorId)
      )) || null,
      committed: false
    };
  }

  async function commitJson(input) {
    return mutate(async (store) => {
      store.candidates = Array.isArray(store.candidates) ? store.candidates : [];
      const selected = findJsonTarget(
        store.candidates,
        input.processingJob,
        input.candidateEmail
      );
      if (selected.committed) {
        return { candidate: copy(selected.candidate), applied: false };
      }
      let candidate = selected.candidate;
      if (!candidate) {
        if (input.processingJob.mode === 'enrich') {
          throw new Error('Candidate not found.');
        }
        candidate = input.createCandidate(
          iso(operationTime()),
          deterministicCvCandidateId(input.processingJob.publicId)
        );
        store.candidates.push(candidate);
      }
      const committedAt = iso(operationTime());
      await input.applyResult(candidate, committedAt);
      attachProcessingIdentity(candidate, input.processingJob.publicId);
      candidate.updatedAt = committedAt;
      return { candidate: copy(candidate), applied: true };
    });
  }

  async function findMongoTarget(collection, processingJob, candidateEmail) {
    const committed = await collection.findOne(
      committedIdentityFilter(processingJob.publicId)
    );
    if (committed) return { candidate: committed, committed: true };
    if (processingJob.mode === 'enrich') {
      return {
        candidate: await collection.findOne({
          _id: processingJob.candidateId,
          ...mongoOwnership(processingJob.actorId)
        }),
        committed: false
      };
    }
    return {
      candidate: await collection.findOne({
        email: candidateEmail,
        jobId: processingJob.jobId,
        ...mongoOwnership(processingJob.actorId)
      }),
      committed: false
    };
  }

  async function commitMongo(input) {
    const db = await getDb();
    const collection = db.collection(COLLECTION_NAME);
    for (let attempt = 0; attempt < safeMaxCommitAttempts; attempt += 1) {
      const selected = await findMongoTarget(
        collection,
        input.processingJob,
        input.candidateEmail
      );
      if (selected.committed) {
        return { candidate: copy(selected.candidate), applied: false };
      }

      if (!selected.candidate) {
        if (input.processingJob.mode === 'enrich') {
          throw new Error('Candidate not found.');
        }
        const committedAt = iso(operationTime());
        const candidate = input.createCandidate(
          committedAt,
          deterministicCvCandidateId(input.processingJob.publicId)
        );
        await input.applyResult(candidate, committedAt);
        attachProcessingIdentity(candidate, input.processingJob.publicId);
        candidate.cvProcessingRevision = 1;
        candidate.updatedAt = committedAt;
        try {
          await collection.insertOne(copy(candidate));
          return { candidate: copy(candidate), applied: true };
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          continue;
        }
      }

      const candidate = copy(selected.candidate);
      const committedAt = iso(operationTime());
      await input.applyResult(candidate, committedAt);
      attachProcessingIdentity(candidate, input.processingJob.publicId);
      candidate.cvProcessingRevision = Math.max(
        0,
        Number(selected.candidate.cvProcessingRevision || 0)
      ) + 1;
      candidate.updatedAt = committedAt;
      try {
        const result = await collection.replaceOne(
          compareAndSwapFilter(selected.candidate),
          candidate
        );
        if (Number(result?.matchedCount || 0) === 1) {
          return { candidate: copy(candidate), applied: true };
        }
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }

    const committed = await collection.findOne(
      committedIdentityFilter(input.processingJob.publicId)
    );
    if (committed) return { candidate: copy(committed), applied: false };
    const error = new Error('Candidate CV result could not be committed after concurrent updates');
    error.code = 'CV_CANDIDATE_COMMIT_CONFLICT';
    throw error;
  }

  async function commit(input) {
    validateInput(input);
    return useMongo ? commitMongo(input) : commitJson(input);
  }

  return { commit };
}

const repository = createCvCandidateResultRepository();

module.exports = {
  COLLECTION_NAME,
  commit: repository.commit,
  createCvCandidateResultRepository
};
