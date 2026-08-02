const assert = require('node:assert/strict');
const test = require('node:test');

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Job = require('../models/Job');
const Organization = require('../models/Organization');
const Plan = require('../models/Plan');
const publicCapacity = require('../services/publicApplicationCapacityService');
const publicCredits = require('../services/publicJobCreditService');

let mongo;

async function seedBilling({ unitCost = 3, remainingCredits = 100 } = {}) {
  const actorId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const planCode = `public-credit-${new mongoose.Types.ObjectId()}`;
  await Plan.collection.insertOne({
    code: planCode,
    name: planCode,
    credits: {
      totalCredits: remainingCredits,
      creditCosts: { uploadCandidate: unitCost }
    }
  });
  await Organization.collection.insertOne({
    _id: organizationId,
    name: 'Public Credit Test Organization',
    owner: actorId,
    members: [{
      user: actorId,
      role: 'owner',
      status: 'active'
    }],
    subscription: {
      plan: planCode,
      creditUsage: {
        totalCredits: remainingCredits,
        usedCredits: 0,
        remainingCredits,
        transactions: [],
        lowCreditWarning: { enabled: false, threshold: 20 }
      }
    }
  });
  return { actorId, organizationId, planCode };
}

function jobFields(organizationId, overrides = {}) {
  return {
    title: 'Locked Cost Engineer',
    department: new mongoose.Types.ObjectId(),
    location: 'London',
    type: 'Full-time',
    level: 'Senior',
    description: 'Build reliable distributed systems.',
    requirements: 'Strong engineering experience.',
    responsibilities: 'Own production services.',
    experience: '5+ years',
    education: 'Degree or equivalent experience',
    status: 'active',
    organization: organizationId,
    isPublic: false,
    candidateApplyLimit: 0,
    reservedCredits: 0,
    publicApplicationCount: 0,
    publicApplicationReservations: [],
    ...overrides
  };
}

async function seedPrivateJob(organizationId) {
  return Job.create(jobFields(organizationId));
}

async function reserveApplication(job, organizationId, suffix) {
  const processingJobId = new mongoose.Types.ObjectId();
  return publicCapacity.reserve({
    jobId: job._id,
    organizationId,
    processingJobId,
    processingJobPublicId: `cv-public-credit-${suffix}-${processingJobId}`
  });
}

function publicLedger(organization) {
  return organization.subscription.creditUsage.transactions.filter(
    (transaction) => [
      'public_job_reservation',
      'public_job_refund'
    ].includes(transaction.metadata?.type)
  );
}

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger'
    }
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: 'public-job-credit-economics'
  });
  await Promise.all([
    Job.syncIndexes(),
    Organization.syncIndexes(),
    Plan.syncIndexes()
  ]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Job.deleteMany({}),
    Organization.deleteMany({}),
    Plan.deleteMany({})
  ]);
});

test('creating a public job funds and locks its pool in the same transaction', async () => {
  const { actorId, organizationId } = await seedBilling({ unitCost: 5 });
  const job = await publicCredits.createJob({
    jobData: jobFields(organizationId, {
      isPublic: true,
      candidateApplyLimit: 2
    }),
    actorId
  });

  const organization = await Organization.findById(organizationId).lean();
  assert.equal(job.isPublic, true);
  assert.equal(job.publicApplicationCreditUnitCost, 5);
  assert.equal(job.reservedCredits, 10);
  assert.equal(organization.subscription.creditUsage.remainingCredits, 90);
  assert.equal(publicLedger(organization).length, 1);
});

test('a CV upload consumes application capacity only when the application is submitted', async () => {
  const { actorId, organizationId } = await seedBilling({ unitCost: 3 });
  const job = await publicCredits.createJob({
    jobData: jobFields(organizationId, {
      isPublic: true,
      candidateApplyLimit: 2
    }),
    actorId
  });
  const candidateId = new mongoose.Types.ObjectId();
  const processingJobId = new mongoose.Types.ObjectId();

  const committed = await publicCapacity.commit({
    jobId: job._id,
    organizationId,
    candidateId,
    processingJobId,
    processingJobPublicId: `cv-submit-${processingJobId}`
  });
  assert.equal(committed.duplicate, false);
  assert.equal(committed.applicationCount, 1);

  const replay = await publicCapacity.commit({
    jobId: job._id,
    organizationId,
    candidateId,
    processingJobId,
    processingJobPublicId: `cv-submit-${processingJobId}`
  });
  assert.equal(replay.duplicate, true);

  const stored = await Job.findById(job._id).lean();
  assert.equal(stored.publicApplicationCount, 1);
  assert.equal(stored.analytics.publicApplications, 1);
  assert.equal(stored.shortlist.length, 1);
  assert.equal(stored.publicApplicationReservations.length, 1);
});

test('queue-inflated legacy counters reconcile to submitted applications', async () => {
  const { organizationId } = await seedBilling({ unitCost: 3 });
  const reservations = Array.from({ length: 10 }, (_, index) => {
    const processingJobId = new mongoose.Types.ObjectId();
    return {
      processingJob: processingJobId,
      processingJobPublicId: `legacy-queue-${processingJobId}`,
      creditCost: 3,
      applicationCount: index + 1,
      limitReached: index === 9,
      reservedAt: new Date()
    };
  });
  const job = await Job.create(jobFields(organizationId, {
    isPublic: true,
    candidateApplyLimit: 10,
    reservedCredits: 30,
    publicApplicationCreditUnitCost: 3,
    publicApplicationCount: 10,
    publicApplicationReservations: reservations,
    analytics: { publicApplications: 2, applications: 2 }
  }));

  const result = await publicCapacity.reconcileInflatedCount({
    jobId: job._id,
    organizationId
  });
  assert.equal(result.repaired, true);
  assert.equal(result.previousCount, 10);
  assert.equal(result.applicationCount, 2);

  const stored = await Job.findById(job._id).lean();
  assert.equal(stored.publicApplicationCount, 2);
  assert.equal(stored.publicApplicationReservations.length, 0);
});

test('concurrent publish and limit replays reserve each target delta exactly once', async () => {
  const { actorId, organizationId } = await seedBilling({ unitCost: 3 });
  const job = await seedPrivateJob(organizationId);

  await Promise.all(Array.from({ length: 8 }, () => (
    publicCredits.updatePublicSettings({
      jobId: job._id,
      organizationId,
      isPublic: true,
      candidateApplyLimit: 2,
      actorId
    })
  )));
  await Promise.all(Array.from({ length: 8 }, () => (
    publicCredits.updatePublicSettings({
      jobId: job._id,
      organizationId,
      isPublic: true,
      candidateApplyLimit: 4,
      actorId
    })
  )));

  const storedJob = await Job.findById(job._id).lean();
  const organization = await Organization.findById(organizationId).lean();
  const ledger = publicLedger(organization);
  assert.equal(storedJob.isPublic, true);
  assert.equal(storedJob.publicApplicationCreditUnitCost, 3);
  assert.equal(storedJob.candidateApplyLimit, 4);
  assert.equal(storedJob.reservedCredits, 12);
  assert.equal(organization.subscription.creditUsage.usedCredits, 12);
  assert.equal(organization.subscription.creditUsage.remainingCredits, 88);
  assert.deepEqual(ledger.map((transaction) => transaction.credits).sort((a, b) => a - b), [6, 6]);
});

test('an insufficient publish reservation leaves both the job and organization unchanged', async () => {
  const { actorId, organizationId } = await seedBilling({
    unitCost: 3,
    remainingCredits: 5
  });
  const job = await seedPrivateJob(organizationId);

  await assert.rejects(
    publicCredits.updatePublicSettings({
      jobId: job._id,
      organizationId,
      isPublic: true,
      candidateApplyLimit: 2,
      actorId
    }),
    (error) => error.code === 'INSUFFICIENT_CREDITS'
  );

  const storedJob = await Job.findById(job._id).lean();
  const organization = await Organization.findById(organizationId).lean();
  assert.equal(storedJob.isPublic, false);
  assert.equal(storedJob.reservedCredits, 0);
  assert.equal(storedJob.publicApplicationCreditUnitCost, undefined);
  assert.equal(organization.subscription.creditUsage.remainingCredits, 5);
  assert.equal(organization.subscription.creditUsage.transactions.length, 0);
});

test('a plan-cost change cannot reprice capacity, a limit increase, or an unpublish refund', async () => {
  const { actorId, organizationId, planCode } = await seedBilling({ unitCost: 3 });
  const job = await seedPrivateJob(organizationId);
  await publicCredits.updatePublicSettings({
    jobId: job._id,
    organizationId,
    isPublic: true,
    candidateApplyLimit: 2,
    actorId
  });

  await Plan.updateOne(
    { code: planCode },
    { $set: { 'credits.creditCosts.uploadCandidate': 11 } }
  );

  const first = await reserveApplication(job, organizationId, 'first');
  assert.equal(first.creditCost, 3);
  await publicCredits.updatePublicSettings({
    jobId: job._id,
    organizationId,
    isPublic: true,
    candidateApplyLimit: 4,
    actorId
  });
  await publicCredits.updatePublicSettings({
    jobId: job._id,
    organizationId,
    isPublic: true,
    candidateApplyLimit: 3,
    actorId
  });
  const second = await reserveApplication(job, organizationId, 'second');
  assert.equal(second.creditCost, 3);

  await publicCredits.updatePublicSettings({
    jobId: job._id,
    organizationId,
    isPublic: false,
    actorId
  });

  const storedJob = await Job.findById(job._id).lean();
  const organization = await Organization.findById(organizationId).lean();
  const ledger = publicLedger(organization);
  assert.equal(storedJob.isPublic, false);
  assert.equal(storedJob.reservedCredits, 0);
  assert.equal(storedJob.publicApplicationCreditUnitCost, undefined);
  assert.equal(organization.subscription.creditUsage.usedCredits, 6);
  assert.equal(organization.subscription.creditUsage.remainingCredits, 94);
  assert.deepEqual(ledger.map((transaction) => ({
    type: transaction.metadata.type,
    credits: transaction.credits
  })), [
    { type: 'public_job_reservation', credits: 6 },
    { type: 'public_job_reservation', credits: 6 },
    { type: 'public_job_refund', credits: 3 },
    { type: 'public_job_refund', credits: 3 }
  ]);
});

test('legacy funded jobs derive and persist their historical unit cost before capacity use', async () => {
  const { actorId, organizationId, planCode } = await seedBilling({ unitCost: 3 });
  const legacy = await Job.create(jobFields(organizationId, {
    isPublic: true,
    candidateApplyLimit: 2,
    reservedCredits: 6
  }));
  await Plan.updateOne(
    { code: planCode },
    { $set: { 'credits.creditCosts.uploadCandidate': 17 } }
  );

  const reservation = await reserveApplication(legacy, organizationId, 'legacy');
  assert.equal(reservation.creditCost, 3);
  const backfilled = await Job.findById(legacy._id).lean();
  assert.equal(backfilled.publicApplicationCreditUnitCost, 3);
  assert.equal(backfilled.publicApplicationReservations[0].creditCost, 3);

  await publicCredits.updatePublicSettings({
    jobId: legacy._id,
    organizationId,
    isPublic: true,
    candidateApplyLimit: 3,
    actorId
  });
  const updated = await Job.findById(legacy._id).lean();
  const organization = await Organization.findById(organizationId).lean();
  assert.equal(updated.reservedCredits, 9);
  assert.equal(updated.publicApplicationCreditUnitCost, 3);
  assert.equal(organization.subscription.creditUsage.remainingCredits, 97);
});

test('concurrent delete refunds unused locked-cost credits only once after a plan change', async () => {
  const { actorId, organizationId, planCode } = await seedBilling({ unitCost: 4 });
  const job = await seedPrivateJob(organizationId);
  await publicCredits.updatePublicSettings({
    jobId: job._id,
    organizationId,
    isPublic: true,
    candidateApplyLimit: 3,
    actorId
  });
  await reserveApplication(job, organizationId, 'used');
  await Plan.updateOne(
    { code: planCode },
    { $set: { 'credits.creditCosts.uploadCandidate': 20 } }
  );

  const deletions = await Promise.allSettled([
    publicCredits.deleteJob({ jobId: job._id, organizationId, actorId }),
    publicCredits.deleteJob({ jobId: job._id, organizationId, actorId })
  ]);
  assert.equal(deletions.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(deletions.filter((result) => result.status === 'rejected').length, 1);

  const organization = await Organization.findById(organizationId).lean();
  const ledger = publicLedger(organization);
  assert.equal(await Job.exists({ _id: job._id }), null);
  assert.equal(organization.subscription.creditUsage.usedCredits, 4);
  assert.equal(organization.subscription.creditUsage.remainingCredits, 96);
  assert.deepEqual(ledger.map((transaction) => ({
    type: transaction.metadata.type,
    credits: transaction.credits
  })), [
    { type: 'public_job_reservation', credits: 12 },
    { type: 'public_job_refund', credits: 8 }
  ]);
});

test('capacity reservation racing unpublish cannot admit against a refunded pool', async () => {
  const { actorId, organizationId } = await seedBilling({ unitCost: 3 });
  const job = await seedPrivateJob(organizationId);
  await publicCredits.updatePublicSettings({
    jobId: job._id,
    organizationId,
    isPublic: true,
    candidateApplyLimit: 2,
    actorId
  });

  const [capacityResult, unpublishResult] = await Promise.allSettled([
    reserveApplication(job, organizationId, 'unpublish-race'),
    publicCredits.updatePublicSettings({
      jobId: job._id,
      organizationId,
      isPublic: false,
      actorId
    })
  ]);

  const storedJob = await Job.findById(job._id).lean();
  const organization = await Organization.findById(organizationId).lean();
  const applicationWon = capacityResult.status === 'fulfilled';
  assert.equal(unpublishResult.status, 'fulfilled');
  assert.equal(storedJob.isPublic, false);
  assert.equal(storedJob.reservedCredits, 0);
  assert.equal(storedJob.publicApplicationReservations.length, 0);
  assert.equal(
    organization.subscription.creditUsage.usedCredits,
    applicationWon ? 3 : 0
  );
  assert.equal(
    organization.subscription.creditUsage.remainingCredits,
    applicationWon ? 97 : 100
  );
});

test('a limit reduction below already consumed capacity is rejected without a credit mutation', async () => {
  const { actorId, organizationId } = await seedBilling({ unitCost: 3 });
  const job = await seedPrivateJob(organizationId);
  await publicCredits.updatePublicSettings({
    jobId: job._id,
    organizationId,
    isPublic: true,
    candidateApplyLimit: 2,
    actorId
  });
  await reserveApplication(job, organizationId, 'one');
  await reserveApplication(job, organizationId, 'two');

  await assert.rejects(
    publicCredits.updatePublicSettings({
      jobId: job._id,
      organizationId,
      isPublic: true,
      candidateApplyLimit: 1,
      actorId
    }),
    (error) => error.code === 'PUBLIC_APPLY_LIMIT_BELOW_USAGE'
  );
  const storedJob = await Job.findById(job._id).lean();
  const organization = await Organization.findById(organizationId).lean();
  assert.equal(storedJob.candidateApplyLimit, 2);
  assert.equal(storedJob.reservedCredits, 6);
  assert.equal(organization.subscription.creditUsage.remainingCredits, 94);
  assert.equal(publicLedger(organization).length, 1);
});
