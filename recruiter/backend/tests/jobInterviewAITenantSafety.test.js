const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.REDIS_ENABLED = 'false';
process.env.CHATGPT_GATEWAY_SHARED_SECRET = '';
process.env.CHATGPT_GATEWAY_BASE_URL = '';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const AIModelService = require('../services/aiModelService');
const AiJobService = require('../services/aiJobService');
const Department = require('../models/Department');
const InterviewQuestion = require('../models/InterviewQuestion');
const InterviewService = require('../services/interviewService');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const JobAgent = require('../agents/jobAgent');
const creditsService = require('../services/creditsService');
const { deductCredits } = require('../middleware/creditsMiddleware');

let mongo;
let organizationA;
let organizationB;
let departmentA;
let departmentB;
let jobA;
let jobB;
let questionB;

async function insertFixtures() {
  organizationA = new mongoose.Types.ObjectId();
  organizationB = new mongoose.Types.ObjectId();
  departmentA = new mongoose.Types.ObjectId();
  departmentB = new mongoose.Types.ObjectId();
  jobA = new mongoose.Types.ObjectId();
  jobB = new mongoose.Types.ObjectId();
  questionB = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  await Department.collection.insertMany([
    { _id: departmentA, name: 'Engineering', organization: organizationA, isActive: true, createdBy: userId },
    { _id: departmentB, name: 'Engineering', organization: organizationB, isActive: true, createdBy: userId }
  ]);
  await Job.collection.insertMany([
    {
      _id: jobA,
      title: 'Tenant A Engineer',
      organization: organizationA,
      department: departmentA,
      status: 'active',
      type: 'Full-time',
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      _id: jobB,
      title: 'Tenant B Engineer',
      organization: organizationB,
      department: departmentB,
      status: 'active',
      type: 'Full-time',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]);
  await InterviewQuestion.collection.insertOne({
    _id: questionB,
    jobId: jobB,
    question: 'How would you design a tenant B service?',
    type: 'technical',
    difficulty: 'medium',
    interviewStage: 'first_round',
    isActive: true
  });
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.beforeEach(async () => {
  await Promise.all([
    Department.deleteMany({}),
    Job.deleteMany({}),
    InterviewQuestion.deleteMany({}),
    Candidate.deleteMany({})
  ]);
  await insertFixtures();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('interview question reads, writes, generation, and analysis fail closed across organizations', async () => {
  const service = new InterviewService();
  const expectedNotFound = (error) => error?.statusCode === 404;

  await assert.rejects(service.getQuestionsByJob(jobB, {}, organizationA), expectedNotFound);
  await assert.rejects(service.getQuestionById(questionB, organizationA), expectedNotFound);
  await assert.rejects(service.updateQuestion(questionB, { question: 'Mutated' }, new mongoose.Types.ObjectId(), organizationA), expectedNotFound);
  await assert.rejects(service.deleteQuestion(questionB, organizationA), expectedNotFound);
  await assert.rejects(service.analyzeQuestionQuality(questionB, organizationA), expectedNotFound);
  await assert.rejects(service.submitQuestionFeedback(questionB, { type: 'candidate', rating: 5 }, organizationA), expectedNotFound);
  await assert.rejects(service.createQuestion({ jobId: jobB, question: 'Foreign', type: 'general' }, null, organizationA), expectedNotFound);
  await assert.rejects(service.generateQuestionsWithAI(jobB, { organizationId: organizationA }), expectedNotFound);
  await assert.rejects(service.generateOptimizedQuestionSet(jobB, {
    organizationId: organizationA,
    totalQuestions: 3,
    stages: ['screening']
  }), expectedNotFound);
  await assert.rejects(service.bulkCreateQuestions([
    { jobId: jobB, question: 'Foreign bulk', type: 'general' }
  ], null, organizationA), expectedNotFound);
  await assert.rejects(service.getQuestionStatistics(jobB, organizationA), expectedNotFound);
  await assert.rejects(service.getPerformanceInsights(jobB, organizationA), expectedNotFound);

  const unchanged = await InterviewQuestion.findById(questionB).lean();
  assert.equal(unchanged.question, 'How would you design a tenant B service?');
});

test('interview question statistics use the tenant-owned ObjectId in aggregation', async () => {
  await InterviewQuestion.collection.insertOne({
    jobId: jobA,
    question: 'How would you design a tenant A service?',
    type: 'technical',
    difficulty: 'medium',
    interviewStage: 'technical',
    isActive: true
  });

  const statistics = await new InterviewService().getQuestionStatistics(String(jobA), organizationA);
  assert.equal(statistics.totalQuestions, 1);
  assert.deepEqual(statistics.typeDistribution, [{ _id: 'technical', count: 1 }]);
  assert.deepEqual(statistics.stageDistribution, [{ _id: 'technical', count: 1 }]);
});

function passingQuestion(stage, index) {
  return {
    jobId: jobA,
    question: `${stage} grounded question ${index}`,
    type: 'technical',
    category: `${stage}-${index}`,
    difficulty: 'medium',
    qualityMetrics: {
      semanticQualityScore: 0.9,
      analysisStatus: 'complete',
      biasScore: 0.1
    }
  };
}

test('optimized generation distributes the remainder and saves the exact requested count', async () => {
  const service = new InterviewService();
  const requestedCounts = [];
  service._generateAdvancedQuestionsWithAI = async (_job, options) => {
    requestedCounts.push(options.questionCount);
    return Array.from({ length: options.questionCount }, (_, index) => passingQuestion(options.stage, index));
  };
  service.bulkCreateQuestions = async (questions, _userId, tenantId) => {
    assert.equal(String(tenantId), String(organizationA));
    return questions;
  };

  const result = await service.generateOptimizedQuestionSet(jobA, {
    organizationId: organizationA,
    totalQuestions: 10,
    stages: ['screening', 'first_round', 'technical'],
    ensureDiversity: false
  });

  assert.deepEqual(requestedCounts, [4, 3, 3]);
  assert.equal(result.questions.length, 10);
  assert.equal(result.optimization.totalSaved, 10);
});

test('optimized generation fails without saving when quality gates cannot satisfy the exact count', async () => {
  const service = new InterviewService();
  let saveCalled = false;
  service._generateAdvancedQuestionsWithAI = async (_job, options) => Array.from(
    { length: options.questionCount },
    (_, index) => ({
      ...passingQuestion(options.stage, index),
      qualityMetrics: { semanticQualityScore: 0.5, analysisStatus: 'complete', biasScore: 0.1 }
    })
  );
  service.bulkCreateQuestions = async () => {
    saveCalled = true;
    return [];
  };

  await assert.rejects(
    service.generateOptimizedQuestionSet(jobA, {
      organizationId: organizationA,
      totalQuestions: 5,
      stages: ['screening', 'technical'],
      ensureDiversity: false
    }),
    (error) => error?.code === 'AI_QUESTION_QUALITY_FAILED' && error?.statusCode === 422
  );
  assert.equal(saveCalled, false);
});

test('generateQuestions success response with jobId consumes credits exactly once', async () => {
  const originalConsumeCredits = creditsService.consumeCredits;
  const calls = [];
  creditsService.consumeCredits = async (...args) => calls.push(args);
  try {
    const req = {
      method: 'POST',
      path: `/jobs/${jobA}/interview-questions/generate`,
      params: { jobId: String(jobA) },
      user: { id: String(new mongoose.Types.ObjectId()), currentOrganization: String(organizationA) },
      creditsAction: { action: 'generateQuestions', entityType: 'question', cost: 6 }
    };
    let responseBody;
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(data) { responseBody = data; return data; }
    };

    deductCredits(req, res, () => {});
    await res.status(201).json({
      msg: 'Successfully generated 2 interview questions',
      jobId: String(jobA),
      questions: [{ _id: 'q1' }, { _id: 'q2' }],
      count: 2
    });

    assert.equal(responseBody.count, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'generateQuestions');
    assert.equal(String(calls[0][2]), String(jobA));
    assert.equal(calls[0][3], 'job');
  } finally {
    creditsService.consumeCredits = originalConsumeCredits;
  }
});

test('assistant job service scopes list/get/update/delete and resolves departments within the tenant', async () => {
  const service = new AiJobService();
  assert.equal(String(await service._resolveDepartmentId(organizationA, 'Engineering')), String(departmentA));
  await assert.rejects(
    service._resolveDepartmentId(organizationA, departmentB),
    (error) => error?.code === 'DEPARTMENT_NOT_FOUND'
  );

  const listed = await service.listJobs({ organization: organizationA });
  assert.deepEqual(listed.map((job) => job.title), ['Tenant A Engineer']);
  assert.equal(await service.getJobById(jobB, organizationA), null);
  assert.equal(await service.updateJobAndEmbed(jobB, { title: 'Stolen' }, null, organizationA), null);
  assert.equal(await service.deleteJobAndEmbed(jobB, organizationA), false);
  assert.equal((await Job.findById(jobB).lean()).title, 'Tenant B Engineer');
});

test('JobAgent forwards organization context for job list/update/delete operations', async () => {
  const agent = new JobAgent();
  const calls = [];
  agent._prepareJobData = async (updates) => updates;
  agent.aiJobService = {
    listJobs: async (filters) => { calls.push(['list', filters]); return []; },
    updateJobAndEmbed: async (...args) => { calls.push(['update', args]); return { _id: jobA, title: 'Updated' }; },
    deleteJobAndEmbed: async (...args) => { calls.push(['delete', args]); return true; }
  };
  const context = { userId: 'user-a', organizationId: String(organizationA) };

  assert.equal((await agent.processListJobs({}, context)).success, true);
  assert.equal((await agent.processUpdateJob(String(jobA), { status: 'closed' }, context)).success, true);
  assert.equal((await agent.processDeleteJob(String(jobA), context)).success, true);
  assert.equal(calls[0][1].organization, String(organizationA));
  assert.equal(calls[1][1][3], String(organizationA));
  assert.equal(calls[2][1][1], String(organizationA));
});

test('enum normalization resolves canonical values locally and runs ambiguous fields concurrently', async () => {
  const agent = new JobAgent();
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  agent.aiModelService.requestCompletion = async ({ messages }) => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    const prompt = messages[0].content;
    const value = prompt.includes('job level') ? 'Senior'
      : prompt.includes('years of experience') ? '3-5'
        : prompt.includes('education level') ? 'Master'
          : 'Contract';
    return { choices: [{ message: { content: value } }] };
  };

  assert.equal(await agent._normalizeFieldWithAI(
    agent.aiModelService,
    'full time',
    ['Full-time', 'Part-time'],
    'employment type',
    'Full-time'
  ), 'Full-time');
  assert.equal(calls, 0);

  const normalized = await agent._prepareJobData({
    level: 'advanced individual contributor',
    experience: 'several years',
    education: 'postgraduate qualification',
    type: 'fixed-duration engagement'
  }, { organizationId: String(organizationA) }, { partial: true });
  assert.equal(calls, 4);
  assert.ok(maxInFlight > 1);
  assert.deepEqual(
    { level: normalized.level, experience: normalized.experience, education: normalized.education, type: normalized.type },
    { level: 'Senior', experience: '3-5', education: 'Master', type: 'Contract' }
  );
});

test('job content generation resolves a department ObjectId to its tenant-scoped name', async () => {
  const originalDescription = AIModelService.prototype.generateJobDescription;
  const originalRequirements = AIModelService.prototype.generateJobRequirements;
  const captured = [];
  AIModelService.prototype.generateJobDescription = async (jobData) => {
    captured.push(['description', jobData]);
    return {
      success: true,
      description: `Build products in ${jobData.department}`,
      responsibilities: [],
      requirements: [],
      skills: [],
      benefits: []
    };
  };
  AIModelService.prototype.generateJobRequirements = async (jobData) => {
    captured.push(['requirements', jobData]);
    return { success: true, requirements: [`Experience in ${jobData.department}`] };
  };

  try {
    delete require.cache[require.resolve('../controllers/aiController')];
    const aiController = require('../controllers/aiController');
    const makeResponse = () => ({
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return data; }
    });
    const request = {
      user: { currentOrganization: organizationA },
      body: { title: 'Platform Engineer', department: String(departmentA) }
    };
    const descriptionResponse = makeResponse();
    const requirementsResponse = makeResponse();

    await aiController.generateJobDescription(request, descriptionResponse);
    await aiController.generateJobRequirements(request, requirementsResponse);

    assert.equal(captured[0][1].department, 'Engineering');
    assert.equal(captured[1][1].department, 'Engineering');
    assert.match(descriptionResponse.body.description, /Engineering/);
    assert.doesNotMatch(descriptionResponse.body.description, new RegExp(String(departmentA)));
  } finally {
    AIModelService.prototype.generateJobDescription = originalDescription;
    AIModelService.prototype.generateJobRequirements = originalRequirements;
  }
});

test('assistant-requested AI job generation preserves runtime failures and never returns canned fallback', async () => {
  const service = new AiJobService();
  service.aiModelService.generateJobDescription = async () => ({
    success: false,
    error: 'Connect ChatGPT to use Seemplify AI features.',
    code: 'AI_RUNTIME_ACCOUNT_REQUIRED',
    statusCode: 409,
    retryable: false
  });

  const promptData = {
    title: 'Platform Engineer',
    department: 'Engineering',
    location: 'London',
    level: 'Senior',
    type: 'Full-time',
    experience: '5-10',
    education: 'Bachelor'
  };
  const expectedRuntimeFailure = (error) => (
    error?.code === 'AI_RUNTIME_ACCOUNT_REQUIRED'
    && error?.statusCode === 409
    && /Connect ChatGPT/.test(error.message)
  );

  await assert.rejects(service.generateJobDetailsWithAzureAI(promptData), expectedRuntimeFailure);

  const agent = new JobAgent();
  agent.aiJobService = service;
  await assert.rejects(agent._generateComprehensiveJobDetails(promptData), expectedRuntimeFailure);
});

test('job analytics source keeps tenant filters and matching ownership guard', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'aiController.js'), 'utf8');
  const agentSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'langchainAgentService.js'), 'utf8');
  assert.match(source, /Job\.find\(\{ organization: organizationId \}\)\.populate\('department', 'name'\)/);
  assert.match(source, /Candidate\.find\(\{ organization: organizationId \}\)/);
  assert.match(source, /Job\.findOne\(\{ _id: jobId, organization: organizationId \}\)/);
  assert.doesNotMatch(source, /exports\.analyzeJobs[\s\S]*?const jobs = await Job\.find\(\);/);
  assert.match(source, /streamCallbacks,\s*req\.user\.currentOrganization/);
  assert.match(agentSource, /let organizationId = activeOrganizationId \|\| null/);
});
