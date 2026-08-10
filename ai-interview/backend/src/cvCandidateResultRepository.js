const crypto = require('crypto');
const {
  connectMongo,
  iso,
  mutateStore,
  readStore,
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

function unwrap(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'value')) return result.value;
  return result || null;
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
  const filter = {
    _id: candidate._id,
    cvDeletionRequestedAt: { $exists: false }
  };
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
  read = readStore,
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
      !candidate.cvDeletionRequestedAt
      && hasProcessingIdentity(candidate, processingJob.publicId)
    ));
    if (committed) return { candidate: committed, committed: true };
    if (processingJob.mode === 'enrich') {
      return {
        candidate: candidates.find((candidate) => (
          candidate._id === processingJob.candidateId
          && !candidate.cvDeletionRequestedAt
          && ownedByActor(candidate, processingJob.actorId)
        )) || null,
        committed: false
      };
    }
    return {
      candidate: candidates.find((candidate) => (
        candidate.email === candidateEmail
        && candidate.jobId === processingJob.jobId
        && !candidate.cvDeletionRequestedAt
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
    const committed = await collection.findOne({
      ...committedIdentityFilter(processingJob.publicId),
      cvDeletionRequestedAt: { $exists: false }
    });
    if (committed) return { candidate: committed, committed: true };
    if (processingJob.mode === 'enrich') {
      return {
        candidate: await collection.findOne({
          _id: processingJob.candidateId,
          cvDeletionRequestedAt: { $exists: false },
          ...mongoOwnership(processingJob.actorId)
        }),
        committed: false
      };
    }
    return {
      candidate: await collection.findOne({
        email: candidateEmail,
        jobId: processingJob.jobId,
        cvDeletionRequestedAt: { $exists: false },
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

    const committed = await collection.findOne({
      ...committedIdentityFilter(input.processingJob.publicId),
      cvDeletionRequestedAt: { $exists: false }
    });
    if (committed) return { candidate: copy(committed), applied: false };
    const error = new Error('Candidate CV result could not be committed after concurrent updates');
    error.code = 'CV_CANDIDATE_COMMIT_CONFLICT';
    throw error;
  }

  async function commit(input) {
    validateInput(input);
    return useMongo ? commitMongo(input) : commitJson(input);
  }

  async function beginCandidateDeletion(candidateId, {
    actorId,
    allowAny = false
  } = {}) {
    const deletionToken = crypto.randomUUID();
    const at = iso(operationTime());
    if (!useMongo) {
      return mutate((store) => {
        store.candidates = Array.isArray(store.candidates) ? store.candidates : [];
        const index = store.candidates.findIndex((item) => (
          item._id === candidateId
          && (allowAny || ownedByActor(item, actorId))
        ));
        if (index < 0) return null;
        const candidate = store.candidates[index];
        const tombstone = {
          _id: candidate._id,
          ...(candidate.jobId ? { jobId: candidate.jobId } : {}),
          ...(candidate.createdBy ? { createdBy: candidate.createdBy } : {}),
          cvDeletionRequestedAt: at,
          cvDeletionToken: deletionToken,
          cvProcessingRevision: Math.max(
          0,
          Number(candidate.cvProcessingRevision || 0)
          ) + 1,
          updatedAt: at
        };
        // Replace the profile atomically with a minimal deletion receipt. If the
        // process stops before cleanup finishes, no candidate PII remains at rest.
        store.candidates[index] = tombstone;
        return { candidate: copy(tombstone), deletionToken };
      });
    }
    const collection = (await getDb()).collection(COLLECTION_NAME);
    const filter = { _id: candidateId };
    if (!allowAny) Object.assign(filter, mongoOwnership(actorId));
    const candidate = unwrap(await collection.findOneAndUpdate(filter, [{
      $replaceWith: {
        _id: '$_id',
        jobId: '$jobId',
        createdBy: '$createdBy',
        cvDeletionRequestedAt: { $literal: at },
        cvDeletionToken: { $literal: deletionToken },
        cvProcessingRevision: {
          $add: [{ $ifNull: ['$cvProcessingRevision', 0] }, 1]
        },
        updatedAt: { $literal: at }
      }
    }], { returnDocument: 'after' }));
    return candidate ? { candidate: copy(candidate), deletionToken } : null;
  }

  async function listPendingCandidateDeletions({
    limit = 100,
    after = null
  } = {}) {
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(Number(limit) || 100)));
    const descriptor = (candidate) => ({
      candidateId: candidate._id,
      deletionToken: candidate.cvDeletionToken,
      requestedAt: candidate.cvDeletionRequestedAt
    });
    if (!useMongo) {
      const store = await read();
      return (store.candidates || [])
        .filter((candidate) => (
          candidate.cvDeletionRequestedAt
          && candidate.cvDeletionToken
          && (
            !after?.requestedAt
            || String(candidate.cvDeletionRequestedAt) > String(after.requestedAt)
            || (
              String(candidate.cvDeletionRequestedAt) === String(after.requestedAt)
              && String(candidate._id) > String(after.candidateId || '')
            )
          )
        ))
        .sort((left, right) => (
          String(left.cvDeletionRequestedAt).localeCompare(String(right.cvDeletionRequestedAt))
          || String(left._id).localeCompare(String(right._id))
        ))
        .slice(0, safeLimit)
        .map(descriptor);
    }
    const filter = {
      cvDeletionRequestedAt: { $exists: true },
      cvDeletionToken: { $type: 'string' }
    };
    if (after?.requestedAt && after?.candidateId) {
      filter.$or = [
        { cvDeletionRequestedAt: { $gt: after.requestedAt } },
        {
          cvDeletionRequestedAt: after.requestedAt,
          _id: { $gt: after.candidateId }
        }
      ];
    }
    const candidates = await (await getDb()).collection(COLLECTION_NAME)
      .find(filter, {
        projection: {
          _id: 1,
          cvDeletionRequestedAt: 1,
          cvDeletionToken: 1
        }
      })
      .sort({ cvDeletionRequestedAt: 1, _id: 1 })
      .limit(safeLimit)
      .toArray();
    return candidates.map(descriptor);
  }

  async function finishCandidateDeletion(candidateId, deletionToken) {
    if (!useMongo) {
      let deleted = false;
      await mutate((store) => {
        store.candidates = Array.isArray(store.candidates) ? store.candidates : [];
        const index = store.candidates.findIndex((candidate) => (
          candidate._id === candidateId
          && candidate.cvDeletionToken === deletionToken
        ));
        if (index < 0) return;
        store.candidates.splice(index, 1);
        deleted = true;
      });
      return deleted;
    }
    const result = await (await getDb()).collection(COLLECTION_NAME).deleteOne({
      _id: candidateId,
      cvDeletionToken: deletionToken
    });
    return Number(result.deletedCount || 0) === 1;
  }

  return {
    beginCandidateDeletion,
    commit,
    finishCandidateDeletion,
    listPendingCandidateDeletions
  };
}

const repository = createCvCandidateResultRepository();

module.exports = {
  COLLECTION_NAME,
  beginCandidateDeletion: repository.beginCandidateDeletion,
  commit: repository.commit,
  createCvCandidateResultRepository,
  finishCandidateDeletion: repository.finishCandidateDeletion,
  listPendingCandidateDeletions: repository.listPendingCandidateDeletions
};
