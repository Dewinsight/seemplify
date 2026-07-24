const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const integrationEnabled = process.env.AI_INTERVIEW_CV_QUEUE_INTEGRATION === 'true';
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-cv-bullmq-'));
process.env.AI_INTERVIEW_CV_QUEUE_ENABLED = integrationEnabled ? 'true' : 'false';
process.env.AI_INTERVIEW_STORE_PATH = path.join(testDirectory, 'store.json');
process.env.AI_INTERVIEW_REDIS_HOST = process.env.AI_INTERVIEW_REDIS_HOST || '127.0.0.1';
process.env.AI_INTERVIEW_REDIS_PORT = process.env.AI_INTERVIEW_REDIS_PORT || '46379';
process.env.AI_INTERVIEW_CV_QUEUE_CONCURRENCY = '1';

const queueService = require('../src/cvProcessingQueueService');
const { iso, mutateStore } = require('../src/store');

test.after(async () => {
  await queueService.closeForTests();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('BullMQ completes AI Interview CV jobs FIFO and keeps excess uploads waiting', {
  skip: !integrationEnabled,
  timeout: 20_000
}, async () => {
  const completionOrder = [];
  await queueService.init({
    analyze: async (resumeText, context) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        profile: {
          name: resumeText.match(/Candidate ([A-Z])/i)?.[0] || 'Candidate',
          email: `${context.requestId.split(':').at(-1)}@example.com`
        },
        resumeText,
        ai: { model: 'integration-fake', analyzedAt: iso(new Date()) }
      };
    },
    onCompleted: async (processingJob, parsed) => mutateStore((store) => {
      const current = store.cvProcessingJobs.find((item) => item.publicId === processingJob.publicId);
      const candidate = {
        _id: `cand_${processingJob.publicId}`,
        name: parsed.profile.name,
        email: parsed.profile.email
      };
      completionOrder.push(processingJob.publicId);
      current.state = 'completed';
      current.progress = 100;
      current.candidateId = candidate._id;
      current.completedAt = iso(new Date());
      current.updatedAt = current.completedAt;
      current.result = { candidate, profile: parsed.profile, history: [] };
      return current.result;
    })
  });

  const submissions = [];
  for (let index = 0; index < 4; index += 1) {
    submissions.push(await queueService.submit({
      file: {
        buffer: Buffer.from(`Candidate ${String.fromCharCode(65 + index)}\\ncandidate${index}@example.com\\nExperienced product and engineering leader with ten years of delivery.`),
        originalname: `candidate-${index}.txt`,
        mimetype: 'text/plain',
        size: 120
      },
      organizationId: 'settings',
      actorId: 'user_recruiter',
      jobId: 'job_product_owner',
      mode: 'import',
      idempotencyKey: `integration-${index}`
    }));
  }

  const earlyTelemetry = await queueService.telemetry();
  assert.equal(earlyTelemetry.concurrency, 1);
  assert.ok(earlyTelemetry.counts.waitingTotal >= 2);

  const deadline = Date.now() + 15_000;
  let statuses;
  do {
    statuses = await Promise.all(submissions.map((item) => (
      queueService.getStatus(item.job.publicId, item.statusToken, 'user_recruiter')
    )));
    if (statuses.every((item) => item?.state === 'completed')) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);

  assert.equal(statuses.every((item) => item?.state === 'completed'), true);
  assert.deepEqual(completionOrder, submissions.map((item) => item.job.publicId));
  assert.equal(new Set(statuses.map((item) => item.candidateId)).size, 4);
});
