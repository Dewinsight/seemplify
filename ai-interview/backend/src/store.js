const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  AI_INTERVIEW_PRICE_CENTS,
  estimateAIInterviewWalletCost,
  findAIInterviewVoiceOption,
  getAIInterviewVoiceOptions
} = require('./aiInterviewVoiceOptions');
const { seedUsers } = require('./auth');

const STORE_PATH = path.join(__dirname, 'data', 'store.json');
const DEMO_TOKEN = 'demo-token';
const COLLECTIONS = ['jobs', 'candidates', 'questions', 'interviews', 'sessions', 'emailLog', 'walletLedger', 'users'];

let mongoConnected = false;

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000);
}

function iso(date) {
  return new Date(date).toISOString();
}

function getMongoUri() {
  return process.env.AI_INTERVIEW_MONGO_URI || process.env.MONGO_URI || process.env.MONGODB_URI || '';
}

function getMongoDbName() {
  return process.env.AI_INTERVIEW_MONGO_DB || 'ai_recruiter';
}

function shouldUseMongo() {
  return Boolean(getMongoUri());
}

async function connectMongo() {
  if (!shouldUseMongo()) return null;
  if (!mongoConnected) {
    await mongoose.connect(getMongoUri(), {
      dbName: getMongoDbName(),
      serverSelectionTimeoutMS: 10000
    });
    mongoConnected = true;
    console.log(`AI Interview Mongo connected to database "${getMongoDbName()}"`);
  }
  return mongoose.connection.db;
}

function defaultSettings() {
  return {
    _id: 'settings',
    organizationName: 'Seemplify AI Interview',
    walletCurrency: 'USD',
    walletBalanceCents: 9850,
    interviewPriceCents: AI_INTERVIEW_PRICE_CENTS,
    proctoringEnabled: true,
    maxFocusViolations: 3,
    allowPublicSignup: true,
    requireEmailConfiguredForInvites: true
  };
}

function seedStore() {
  const now = new Date();
  const nowText = iso(now);
  const expiresAt = addMinutes(now, 7 * 24 * 60);
  const job = {
    _id: 'job_product_owner',
    title: 'Product Owner',
    department: 'Product',
    location: 'Remote',
    createdBy: 'user_recruiter',
    createdAt: nowText
  };
  const candidates = [
    { _id: 'cand_michael', firstName: 'Michael', lastName: 'Egbo', name: 'Michael Egbo', email: 'michaelegbo@example.com', jobId: job._id, createdBy: 'user_recruiter' },
    { _id: 'cand_amina', firstName: 'Amina', lastName: 'Okafor', name: 'Amina Okafor', email: 'amina@example.com', jobId: job._id, createdBy: 'user_recruiter' },
    { _id: 'cand_david', firstName: 'David', lastName: 'Mensah', name: 'David Mensah', email: 'david@example.com', jobId: job._id, createdBy: 'user_recruiter' }
  ];
  const questions = [
    {
      _id: 'q_agile_prioritization',
      jobId: job._id,
      question: 'Tell me about a time you worked with a cross-functional Agile team to prioritize product features based on customer and business needs.',
      type: 'behavioral',
      category: 'Product discovery',
      difficulty: 'intermediate',
      expectedAnswer: 'Specific situation, role, prioritization framework, stakeholder alignment, and measurable outcome.',
      scoringCriteria: [
        { criterion: 'Specificity', weight: 35, description: 'Uses a concrete example.' },
        { criterion: 'Product judgement', weight: 35, description: 'Balances customer and business value.' },
        { criterion: 'Outcome', weight: 30, description: 'Explains impact and learning.' }
      ],
      createdBy: 'user_recruiter'
    },
    {
      _id: 'q_tradeoff',
      jobId: job._id,
      question: 'Describe a product trade-off you made when engineering capacity was limited. How did you decide what to keep, cut, or defer?',
      type: 'situational',
      category: 'Execution',
      difficulty: 'intermediate',
      expectedAnswer: 'Decision criteria, constraints, communication, and outcome.',
      scoringCriteria: [
        { criterion: 'Decision process', weight: 40, description: 'Explains clear criteria.' },
        { criterion: 'Stakeholder management', weight: 30, description: 'Communicates trade-offs.' },
        { criterion: 'Impact', weight: 30, description: 'Connects decision to product result.' }
      ],
      createdBy: 'user_recruiter'
    }
  ];
  const estimate = estimateAIInterviewWalletCost({
    candidateCount: 1,
    questionCount: questions.length,
    totalMinutes: 45,
    voiceId: 'en-US-JennyMultilingualNeural',
    unitPriceCents: AI_INTERVIEW_PRICE_CENTS
  });
  const openingBalanceCents = 10000;
  const demoDebitCents = estimate.totalCents;
  const demoDebitLedgerId = 'ledger_demo_interview_debit';
  const interview = {
    _id: 'ai_demo_product_owner',
    title: 'Product Owner AI Interview',
    jobId: job._id,
    status: 'active',
    guidelines: 'Please answer each question with a specific example. You may ask the interviewer to clarify the current question before answering.',
    questionSnapshots: questions.map((question, index) => ({
      questionId: question._id,
      question: question.question,
      type: question.type,
      category: question.category,
      difficulty: question.difficulty,
      order: index + 1,
      expectedAnswer: question.expectedAnswer,
      scoringCriteria: question.scoringCriteria
    })),
    timers: { perQuestionMinutes: 10, totalMinutes: 45 },
    schedule: { sendAt: nowText, expiresAt: iso(expiresAt), timezone: 'UTC' },
    candidateCount: 1,
    billing: {
      currency: 'USD',
      unitPriceCents: estimate.unitPriceCents,
      totalCents: estimate.totalCents,
      chargedAt: nowText,
      ledgerEntryId: demoDebitLedgerId
    },
    costEstimate: estimate,
    voice: findAIInterviewVoiceOption('en-US-JennyMultilingualNeural'),
    stats: { sent: 1, opened: 0, inProgress: 0, completed: 0, blocked: 0, failed: 0, proctorFailed: 0 },
    createdBy: 'user_recruiter',
    createdAt: nowText,
    updatedAt: nowText
  };
  const session = {
    _id: 'sess_demo_michael',
    aiInterview: interview._id,
    jobId: job._id,
    candidateId: candidates[0]._id,
    recipientType: 'candidate',
    candidateSnapshot: {
      firstName: candidates[0].firstName,
      lastName: candidates[0].lastName,
      name: candidates[0].name,
      email: candidates[0].email
    },
    tokenHash: hashToken(DEMO_TOKEN),
    tokenGeneratedAt: nowText,
    status: 'sent',
    currentQuestionIndex: 0,
    messages: [],
    answers: [],
    scoring: { status: 'pending' },
    email: { sentAt: nowText, attempts: 1, deliveryMode: 'seeded_demo' },
    billing: {
      charged: true,
      currency: 'USD',
      amountCents: estimate.unitPriceCents,
      chargedAt: nowText,
      ledgerEntryId: demoDebitLedgerId
    },
    proctoring: { enabled: true, maxFocusViolations: 3, focusViolationCount: 0, pasteAttemptCount: 0, violations: [] },
    createdBy: 'user_recruiter',
    createdAt: nowText,
    updatedAt: nowText
  };

  return {
    settings: {
      ...defaultSettings(),
      walletBalanceCents: openingBalanceCents - demoDebitCents
    },
    jobs: [job],
    candidates,
    questions,
    interviews: [interview],
    sessions: [session],
    emailLog: [],
    walletLedger: [
      {
        _id: 'ledger_demo_top_up',
        type: 'top_up',
        amountCents: openingBalanceCents,
        balanceAfterCents: openingBalanceCents,
        currency: 'USD',
        description: 'Demo wallet opening balance',
        createdAt: nowText,
        createdBy: 'user_admin'
      },
      {
        _id: demoDebitLedgerId,
        type: 'interview_debit',
        amountCents: -demoDebitCents,
        balanceAfterCents: openingBalanceCents - demoDebitCents,
        currency: 'USD',
        referenceType: 'ai_interview',
        referenceId: interview._id,
        description: `Demo interview charge for ${interview.title}`,
        createdAt: nowText,
        createdBy: 'user_recruiter'
      }
    ],
    users: seedUsers(nowText),
    generatedAt: nowText
  };
}

async function ensureStore() {
  if (!shouldUseMongo()) {
    if (!fs.existsSync(STORE_PATH)) {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(seedStore(), null, 2));
    }
    return;
  }

  const db = await connectMongo();
  const settings = await db.collection('settings').findOne({ _id: 'settings' });
  if (!settings) {
    await writeStore(seedStore());
    return;
  }

  const userCount = await db.collection('users').countDocuments({});
  if (!userCount) {
    await db.collection('users').insertMany(seedUsers(iso(new Date())));
  }
}

async function readMongoStore() {
  const db = await connectMongo();
  const settings = await db.collection('settings').findOne({ _id: 'settings' });
  const store = { settings: settings || defaultSettings() };
  for (const collectionName of COLLECTIONS) {
    store[collectionName] = await db.collection(collectionName).find({}).sort({ createdAt: 1 }).toArray();
  }
  return store;
}

async function writeMongoStore(store) {
  const db = await connectMongo();
  const settings = { ...(store.settings || defaultSettings()), _id: 'settings', updatedAt: iso(new Date()) };
  await db.collection('settings').replaceOne({ _id: 'settings' }, settings, { upsert: true });
  for (const collectionName of COLLECTIONS) {
    await db.collection(collectionName).deleteMany({});
    const docs = store[collectionName] || [];
    if (docs.length) {
      await db.collection(collectionName).insertMany(docs.map((doc) => ({ ...doc })), { ordered: false });
    }
  }
}

async function readStore() {
  await ensureStore();
  if (shouldUseMongo()) return readMongoStore();
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

async function writeStore(store) {
  const nextStore = { ...store, updatedAt: iso(new Date()) };
  if (shouldUseMongo()) {
    await writeMongoStore(nextStore);
    return;
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(nextStore, null, 2));
}

async function mutateStore(mutator) {
  const store = await readStore();
  const result = await mutator(store);
  await writeStore(store);
  return result;
}

function getFrontendUrl() {
  return (process.env.AI_INTERVIEW_FRONTEND_URL || 'http://localhost:5200').replace(/\/$/, '');
}

function canAccessOwnedResource(user, item) {
  if (!user) return true;
  if (user.role === 'admin') return true;
  return !item.createdBy || item.createdBy === user._id;
}

function getOptionsPayload(store, user = null) {
  const voices = getAIInterviewVoiceOptions();
  const tiers = Object.values(voices.reduce((acc, voice) => {
    if (!acc[voice.tier]) {
      acc[voice.tier] = {
        id: voice.tier,
        label: voice.tierLabel,
        description: voice.tierDescription,
        walletSurchargeCents: voice.walletSurchargeCents,
        usdPerMillionCharacters: voice.usdPerMillionCharacters,
        voices: []
      };
    }
    acc[voice.tier].voices.push(voice);
    return acc;
  }, {}));

  return {
    voices,
    tiers,
    defaultVoiceId: voices.find((voice) => voice.isDefault)?.id || voices[0]?.id,
    jobs: store.jobs.filter((item) => canAccessOwnedResource(user, item)),
    candidates: store.candidates.filter((item) => canAccessOwnedResource(user, item)),
    questions: store.questions.filter((item) => canAccessOwnedResource(user, item)),
    settings: store.settings,
    pricing: {
      currency: store.settings.walletCurrency || 'USD',
      unitPriceCents: Number(store.settings.interviewPriceCents || AI_INTERVIEW_PRICE_CENTS),
      walletBalanceCents: Number(store.settings.walletBalanceCents || 0),
      source: shouldUseMongo() ? `mongo:${getMongoDbName()}` : 'json_dev_store'
    }
  };
}

function makePublicState(store, session, actionExtras = {}) {
  const interview = store.interviews.find((item) => item._id === session.aiInterview);
  const job = store.jobs.find((item) => item._id === interview?.jobId);
  const currentQuestion = interview?.questionSnapshots?.[session.currentQuestionIndex];
  const speechConfigured = Boolean((process.env.AZURE_SPEECH_KEY || process.env.AZURE_VOICELIVE_API_KEY) && (process.env.AZURE_SPEECH_REGION || process.env.AZURE_LOCATION));

  return {
    success: true,
    ...actionExtras,
    session: {
      ...session,
      aiInterview: interview?._id,
      candidate: session.candidateId
    },
    interview: {
      id: interview?._id,
      title: interview?.title,
      guidelines: interview?.guidelines,
      questionCount: interview?.questionSnapshots?.length || 0,
      timers: interview?.timers,
      schedule: interview?.schedule,
      currentQuestion: currentQuestion ? {
        questionIndex: session.currentQuestionIndex,
        type: currentQuestion.type,
        difficulty: currentQuestion.difficulty,
        timeLimit: Number(currentQuestion.timeLimit || interview.timers?.perQuestionMinutes || 10)
      } : null
    },
    candidate: session.candidateSnapshot,
    voice: {
      enabled: process.env.AI_INTERVIEW_ENABLE_VOICE === 'false' ? false : speechConfigured,
      provider: 'azure-speech',
      model: 'azure-speech-tts',
      language: interview?.voice?.language || 'en-US',
      sampleRate: 24000,
      voice: interview?.voice?.voiceId || interview?.voice?.id,
      selectedVoice: interview?.voice || null
    },
    job: job ? { id: job._id, title: job.title } : null
  };
}

module.exports = {
  DEMO_TOKEN,
  STORE_PATH,
  id,
  iso,
  hashToken,
  addMinutes,
  readStore,
  writeStore,
  mutateStore,
  seedStore,
  getFrontendUrl,
  getOptionsPayload,
  makePublicState,
  shouldUseMongo,
  getMongoDbName,
  canAccessOwnedResource
};
