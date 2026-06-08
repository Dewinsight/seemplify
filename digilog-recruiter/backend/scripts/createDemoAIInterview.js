const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const InterviewQuestion = require('../models/InterviewQuestion');
const AIInterview = require('../models/AIInterview');
const AIInterviewSession = require('../models/AIInterviewSession');

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : fallback;
}

function hashPublicToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createDemoToken({ organizationId, candidateEmail }) {
  const secret = process.env.AI_INTERVIEW_DEMO_TOKEN_SECRET || process.env.JWT_SECRET || 'local-demo-secret';
  return crypto
    .createHmac('sha256', secret)
    .update(`ai-interview-demo:${organizationId}:${candidateEmail}`)
    .digest('base64url');
}

function getBaseUrl() {
  return (
    getArg('base-url') ||
    process.env.AI_INTERVIEW_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:5000'
  ).replace(/\/$/, '');
}

async function main() {
  const email = (getArg('email') || process.env.AI_INTERVIEW_DEMO_USER_EMAIL || '').toLowerCase();
  if (!email) {
    throw new Error('Pass --email=<recruiter-email> or set AI_INTERVIEW_DEMO_USER_EMAIL.');
  }

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email }).select('email profile currentOrganization organizationMemberships');
  if (!user) {
    throw new Error(`Recruiter user not found for ${email}`);
  }

  const organizationId =
    user.currentOrganization ||
    user.organizationMemberships.find((membership) => membership.isActive)?.organization;
  if (!organizationId) {
    throw new Error(`Recruiter ${email} has no active organization.`);
  }

  const organization = await Organization.findById(organizationId).select('name');
  if (!organization) {
    throw new Error(`Organization not found for ${organizationId}`);
  }

  const department = await Department.findOneAndUpdate(
    { organization: organization._id, name: 'Product' },
    {
      $setOnInsert: {
        description: 'Product management and strategy',
        organization: organization._id,
        createdBy: user._id
      },
      $set: { isActive: true }
    },
    { new: true, upsert: true }
  );

  const candidateEmail = `ai-interview-demo-candidate+${String(organization._id).slice(-6)}@example.test`;
  const candidate = await Candidate.findOneAndUpdate(
    { organization: organization._id, email: candidateEmail },
    {
      $set: {
        firstName: 'Demo',
        lastName: 'Candidate',
        phone: '+10000000000',
        position: 'Product Owner',
        experience: '3-5',
        education: 'bachelors',
        skills: 'Product discovery, Agile, stakeholder management, backlog prioritization',
        location: 'Remote',
        status: 'Interviewing',
        source: 'AI interview demo',
        updatedBy: user._id
      },
      $setOnInsert: {
        organization: organization._id,
        createdBy: user._id
      }
    },
    { new: true, upsert: true }
  );

  const job = await Job.findOneAndUpdate(
    { organization: organization._id, title: '[Demo] Product Owner AI Interview' },
    {
      $set: {
        department: department._id,
        location: 'Remote',
        type: 'Full-time',
        level: 'Mid',
        description: 'Reusable demo job for testing the AI Interview candidate voice flow.',
        requirements: 'Experience with Agile teams, product discovery, and backlog prioritization.',
        responsibilities: 'Guide product discovery, align stakeholders, and prioritize product outcomes.',
        skills: 'Product ownership, Agile, customer discovery, prioritization',
        experience: '3-5',
        education: 'Bachelor',
        status: 'active',
        organization: organization._id,
        updatedBy: user._id
      },
      $setOnInsert: {
        createdBy: user._id,
        applicants: []
      }
    },
    { new: true, upsert: true }
  );

  const candidateId = String(candidate._id);
  const hasApplicant = (job.applicants || []).some((entry) => String(entry.candidate) === candidateId);
  if (!hasApplicant) {
    job.applicants.push({
      candidate: candidate._id,
      applicationType: 'manual',
      status: 'interviewing',
      addedBy: user._id,
      statusHistory: [{
        status: 'interviewing',
        changedBy: user._id,
        previousStatus: 'applied',
        notes: 'Reusable AI interview demo candidate'
      }]
    });
    await job.save();
  }

  const questionDefinitions = [
    {
      question: 'Tell me about a time you worked with a cross-functional Agile team to define and prioritize product features based on business goals and customer needs.',
      type: 'behavioral',
      category: 'Product ownership',
      difficulty: 'medium',
      expectedAnswer: 'A strong answer should include context, role, actions, collaboration, prioritization tradeoffs, and measurable outcome.',
      scoringCriteria: [
        { criterion: 'Specific example', weight: 25, description: 'Uses a concrete product situation.' },
        { criterion: 'Prioritization reasoning', weight: 35, description: 'Explains tradeoffs between customer and business goals.' },
        { criterion: 'Outcome', weight: 25, description: 'Shares measurable or clearly described impact.' },
        { criterion: 'Communication', weight: 15, description: 'Shows cross-functional collaboration.' }
      ],
      order: 0,
      timeLimit: 10
    },
    {
      question: 'How would you handle a situation where engineering, sales, and leadership disagree on what should be built next?',
      type: 'situational',
      category: 'Stakeholder management',
      difficulty: 'medium',
      expectedAnswer: 'A strong answer should describe structured discovery, evidence gathering, facilitation, decision criteria, and communication.',
      scoringCriteria: [
        { criterion: 'Stakeholder alignment', weight: 30, description: 'Balances perspectives constructively.' },
        { criterion: 'Decision framework', weight: 35, description: 'Uses evidence and product strategy to decide.' },
        { criterion: 'Communication', weight: 20, description: 'Explains how decisions are shared.' },
        { criterion: 'Risk management', weight: 15, description: 'Identifies risks and follow-up.' }
      ],
      order: 1,
      timeLimit: 10
    }
  ];

  const questions = [];
  for (const definition of questionDefinitions) {
    const question = await InterviewQuestion.findOneAndUpdate(
      { jobId: job._id, question: definition.question },
      {
        $set: {
          ...definition,
          jobId: job._id,
          interviewStage: 'first_round',
          isActive: true,
          tags: ['ai-interview-demo', 'product-owner']
        }
      },
      { new: true, upsert: true }
    );
    questions.push(question);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const questionSnapshots = questions.map((question, index) => ({
    questionId: question._id,
    question: question.question,
    type: question.type,
    category: question.category,
    difficulty: question.difficulty,
    interviewStage: question.interviewStage,
    order: index,
    timeLimit: question.timeLimit,
    expectedAnswer: question.expectedAnswer,
    scoringCriteria: question.scoringCriteria || []
  }));

  const aiInterview = await AIInterview.findOneAndUpdate(
    { organization: organization._id, title: '[Demo] Product Owner AI Interview' },
    {
      $set: {
        job: job._id,
        createdBy: user._id,
        guidelines: 'This is a reusable demo interview for testing voice mode. Answer naturally, ask for clarification if needed, then confirm when ready to move on.',
        questionSnapshots,
        timers: {
          perQuestionMinutes: 10,
          totalMinutes: 45
        },
        schedule: {
          sendAt: new Date(now.getTime() - 60 * 1000),
          expiresAt,
          timezone: user.profile?.timezone || 'UTC'
        },
        status: 'active',
        candidateCount: 1,
        creditCostPerCandidate: 0
      },
      $setOnInsert: {
        publicLink: `ai_${crypto.randomBytes(18).toString('base64url')}`
      }
    },
    { new: true, upsert: true }
  );

  const token = createDemoToken({ organizationId: organization._id, candidateEmail });
  const tokenHash = hashPublicToken(token);
  const session = await AIInterviewSession.findOneAndUpdate(
    { aiInterview: aiInterview._id, candidate: candidate._id },
    {
      $set: {
        organization: organization._id,
        job: job._id,
        createdBy: user._id,
        candidateSnapshot: {
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          name: `${candidate.firstName} ${candidate.lastName}`,
          email: candidate.email
        },
        tokenHash,
        tokenGeneratedAt: now,
        status: 'sent',
        currentQuestionIndex: 0,
        startedAt: undefined,
        completedAt: undefined,
        lastActivityAt: now,
        questionStartedAt: undefined,
        questionDeadlineAt: undefined,
        totalDeadlineAt: undefined,
        messages: [],
        answers: [],
        scoring: {
          status: 'pending',
          strengths: [],
          concerns: [],
          questionScores: []
        },
        credits: {
          charged: true,
          cost: 0,
          chargedAt: now
        },
        email: {
          sentAt: now,
          messageId: 'demo',
          attempts: 0
        }
      }
    },
    { new: true, upsert: true }
  );

  await AIInterview.findByIdAndUpdate(aiInterview._id, {
    stats: {
      sent: 1,
      opened: 0,
      inProgress: 0,
      completed: 0,
      blocked: 0,
      failed: 0
    }
  });

  const url = `${getBaseUrl()}/public/ai-interview/${token}?demo=1`;
  console.log(JSON.stringify({
    organization: organization.name,
    aiInterviewId: String(aiInterview._id),
    sessionId: String(session._id),
    jobId: String(job._id),
    demoUrl: url
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });
