import type { Page, Route } from '@playwright/test';

export const JOB_ID = 'job-123';

type RecordedRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: Record<string, unknown>;
};

export type RecruiterApiState = {
  matchingRequests: RecordedRequest[];
  explanationRequests: RecordedRequest[];
  questionGenerationRequests: RecordedRequest[];
  unhandledRequests: RecordedRequest[];
};

const organization = {
  _id: 'org-123',
  name: 'Acme Talent',
  description: 'Playwright recruiter organization',
  industry: 'Technology',
  size: '51-200',
  userRole: 'owner',
  joinedAt: '2026-01-01T00:00:00.000Z',
  members: [],
  settings: {},
};

const user = {
  _id: 'user-123',
  email: 'recruiter@example.test',
  currentOrganization: organization._id,
  profile: {
    firstName: 'Riley',
    lastName: 'Recruiter',
    displayName: 'Riley Recruiter',
    timezone: 'Europe/London',
    language: 'en',
  },
  company: { name: organization.name, industry: organization.industry, size: organization.size },
  preferences: {
    emailNotifications: {
      newApplications: true,
      interviews: true,
      deadlines: true,
      systemUpdates: true,
    },
    dashboardConfig: { defaultView: 'overview', showQuickStats: true, preferredChartType: 'bar' },
    privacy: { profileVisibility: 'organization', showEmail: true, showPhone: false },
  },
  profileCompletion: { percentage: 100, missingFields: [], lastUpdated: '2026-08-01T00:00:00.000Z' },
  role: 'recruiter',
  permissions: ['jobs:read', 'jobs:write', 'candidates:read'],
  features: { aiAssistant: true, advancedAnalytics: true, bulkOperations: true, apiAccess: true },
  subscription: { plan: 'professional', isActive: true },
  fullName: 'Riley Recruiter',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const job = {
  _id: JOB_ID,
  organization: organization._id,
  title: 'Senior Platform Engineer',
  department: 'Engineering',
  location: 'London, UK',
  type: 'Full-time',
  level: 'Senior',
  description: 'Build reliable distributed services for a growing recruitment platform.',
  requirements: 'TypeScript, Node.js, cloud systems, and production ownership.',
  responsibilities: 'Design services, mentor engineers, and improve platform reliability.',
  skills: 'TypeScript, Node.js, Kubernetes, PostgreSQL',
  experience: '5-10',
  education: 'Bachelor',
  salary: { min: 90000, max: 120000, currency: 'GBP', period: 'annually' },
  status: 'active',
  priority: 'high',
  remote: true,
  openings: 2,
  isPublic: false,
  shortlist: [],
  applicants: [],
  analytics: { publicViews: 0, publicApplications: 0, internalViews: 0, internalApplications: 0 },
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
};

const explanation = {
  skillsMatch: {
    matchedSkills: ['TypeScript', 'Node.js', 'Kubernetes'],
    missingSkills: [],
    bonusSkills: ['PostgreSQL'],
    matchPercentage: 96,
    totalRequired: 3,
    totalMatched: 3,
  },
  experienceMatch: { isMatch: true, required: 5, candidate: 8, difference: 3, category: 'exceeds' },
  locationMatch: { isMatch: true, type: 'remote', job: 'London, UK', candidate: 'Manchester, UK' },
  industryMatch: {
    hasRelevantIndustry: true,
    matchedIndustries: ['SaaS'],
    allIndustries: ['SaaS', 'FinTech'],
    relevanceScore: 0.9,
  },
  leadershipMatch: { requiresLeadership: true, hasLeadership: true, isMatch: true, gap: false },
  aiInsights: {
    hasAIAnalysis: true,
    summary: 'Strong production ownership and direct platform engineering experience.',
    strengths: ['Distributed systems leadership', 'Relevant cloud stack'],
    potentialFlags: [],
    strengthsCount: 2,
    flagsCount: 0,
  },
  careerFit: {
    totalYearsExp: 8,
    hasCareerProgression: true,
    hasAchievements: true,
    companiesWorkedAt: 3,
    positionsHeld: 4,
    avgTenureYears: 2.6,
    stabilityScore: 'High',
    progressionIndicators: { multiplePositions: true, multipleCompanies: true, documentedGrowth: true },
  },
  dataQuality: { completeness: 98, hasDetailedHistory: true, hasAIAnalysis: true, hasCoverLetter: true },
  matchStrength: 'Excellent Match',
  overallScore: 0.96,
  reasons: ['Direct experience with the required platform stack', 'Demonstrated technical leadership'],
  concerns: [],
  gptEnhanced: {
    skillMatchPercentage: 96,
    experienceFit: 94,
    culturalAlignment: 88,
    growthPotential: 91,
    interviewFocus: ['Reliability trade-offs', 'Mentoring approach'],
    confidenceScore: 0.93,
    contextualExplanation: 'The candidate has highly relevant platform ownership experience.',
  },
};

const candidate = {
  candidateId: 'candidate-123',
  similarity: 0.93,
  similarityPercentage: 93,
  relevanceScore: 0.95,
  candidate: {
    name: 'Alex Morgan',
    position: 'Staff Platform Engineer',
    experience: '8 years',
    skills: ['TypeScript', 'Node.js', 'Kubernetes', 'PostgreSQL'],
    location: 'Manchester, UK',
    email: 'alex@example.test',
    phone: '+44 20 0000 0000',
  },
};

const question = (id: string, text: string, type: 'technical' | 'behavioral', stage: 'technical' | 'first_round') => ({
  _id: id,
  jobId: JOB_ID,
  question: text,
  type,
  category: type === 'technical' ? 'Platform engineering' : 'Leadership',
  difficulty: 'medium',
  interviewStage: stage,
  expectedAnswer: 'A structured answer grounded in concrete production experience.',
  scoringCriteria: [{ criterion: 'Evidence', weight: 1, description: 'Uses a relevant example and clear outcomes.' }],
  tags: ['generated', type],
  isActive: true,
  order: 1,
  isAIGenerated: true,
  aiGenerationMetadata: {
    generatedAt: '2026-08-19T10:00:00.000Z',
    model: 'optimized-test-model',
    confidence: 0.94,
    promptVersion: 'mixed-types-v2',
  },
  qualityMetrics: {
    semanticQualityScore: 0.92,
    qualityIssues: [],
    analysisStatus: 'complete',
    difficultyCalibration: 0.9,
    diversityIndex: 0.88,
    biasScore: 0.05,
    legalCompliance: true,
  },
  createdAt: '2026-08-19T10:00:00.000Z',
  updatedAt: '2026-08-19T10:00:00.000Z',
});

const standardQuestion = question(
  'question-standard',
  'How would you diagnose and reduce tail latency in a distributed Node.js service?',
  'technical',
  'technical',
);

const optimizedQuestion = question(
  'question-optimized',
  'Tell us about a time you improved reliability while aligning several engineering teams.',
  'behavioral',
  'first_round',
);

const json = async (route: Route, body: unknown, status = 200) => {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  });
};

const record = (route: Route): RecordedRequest => {
  const request = route.request();
  const url = new URL(request.url());
  let body: Record<string, unknown> | undefined;
  try {
    body = request.postDataJSON() as Record<string, unknown>;
  } catch {
    body = undefined;
  }

  return {
    method: request.method(),
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
  };
};

export function createRecruiterApiState(): RecruiterApiState {
  return {
    matchingRequests: [],
    explanationRequests: [],
    questionGenerationRequests: [],
    unhandledRequests: [],
  };
}

export async function installRecruiterApiMocks(page: Page, state: RecruiterApiState) {
  await page.addInitScript(({ organizationId }) => {
    localStorage.setItem('jwt', 'playwright-access-token');
    localStorage.setItem('refreshToken', 'playwright-refresh-token');
    localStorage.setItem('tokenExpiresAt', String(Date.now() + 60 * 60 * 1000));
    localStorage.setItem('seemplify_active_organization_id', organizationId);
  }, { organizationId: organization._id });

  await page.route('**/api/**', async (route) => {
    const request = record(route);
    const { path, method } = request;

    if (path === '/api/platform/features') {
      return json(route, {
        features: {
          aiInterviews: true,
          aiAssistant: true,
          candidateEnrichment: true,
          bulkCvUpload: true,
          peopleTransitions: true,
        },
      });
    }
    if (path === '/api/users/profile') return json(route, user);
    if (path === '/api/users/analytics') return json(route, {});
    if (path === '/api/users/profile-suggestions') return json(route, { suggestions: [] });
    if (path === '/api/organizations/user') return json(route, [organization]);
    if (path === '/api/organizations/current') return json(route, organization);
    if (path === '/api/organizations/limits') {
      return json(route, {
        userPlan: 'professional',
        maxOrganizations: 5,
        currentCount: 1,
        canCreateMore: true,
        remainingSlots: 4,
      });
    }
    if (path === '/api/organizations/invitations/user') return json(route, { pendingInvites: [], count: 0 });
    if (path === '/api/credits/status') {
      return json(route, {
        success: true,
        credits: {
          totalCredits: 1010,
          usedCredits: 10,
          remainingCredits: 1000,
          percentageUsed: 1,
          percentageRemaining: 99,
          cycleStart: '2026-08-01T00:00:00.000Z',
          cycleEnd: '2026-09-01T00:00:00.000Z',
          daysUntilReset: 13,
          rolloverCredits: 0,
          purchasedCredits: 0,
          creditCosts: {
            createJob: 0,
            uploadCandidate: 0,
            scheduleInterview: 0,
            aiMatching: 0,
            generateQuestions: 0,
            aiAnalysis: 0,
            aiInterviewCandidate: 5,
            bulkUpload: 0,
            reEmbed: 0,
          },
          usageBreakdown: {},
          projectedRunout: null,
          warnings: { lowCredit: false, nearCycleEnd: false, projectedOverage: false },
        },
      });
    }
    if (path === '/api/notifications/unread-count') return json(route, { count: 0 });
    if (path === '/api/notifications') {
      return json(route, {
        notifications: [],
        pagination: { total: 0, page: 1, limit: 20, pages: 0 },
        unreadCount: 0,
      });
    }
    if (path === '/api/ai-account') {
      return json(route, {
        account: {
          status: 'disconnected',
          connectedEmail: null,
          planType: null,
          connectedAt: null,
          lastVerifiedAt: null,
          dataSharingAcknowledgedAt: null,
          routable: false,
          rateLimits: null,
          usageLimit: null,
          lastError: null,
          runtimePreference: 'local',
        },
        runtimePolicy: {
          localEnabled: true,
          chatgptEnabled: true,
          defaultRuntime: 'local',
          chatgptRequired: false,
        },
      });
    }
    if (path === '/api/browser-notifications/configuration') {
      return json(route, { configured: false, enabled: false });
    }
    if (path === '/api/browser-notifications/events') {
      return json(route, { events: [], nextCursor: null });
    }
    if (path === `/api/jobs/${JOB_ID}/pipeline/detailed`) return json(route, { stages: [] });
    if (path === `/api/jobs/${JOB_ID}/embedding-status`) {
      return json(route, { isEmbedded: true, embeddingCreatedAt: '2026-08-18T09:00:00.000Z' });
    }
    if (path === `/api/jobs/${JOB_ID}/matching-candidates`) {
      state.matchingRequests.push(request);
      const deep = request.query.analysisMode === 'deep';
      return json(route, {
        matches: [{ ...candidate, ...(deep ? { explanation } : {}) }],
        mode: deep ? 'deep-analysis' : 'quick-ranking',
        fromCache: false,
        topK: Number(request.query.topK || 10),
      });
    }
    if (path === `/api/jobs/${JOB_ID}/candidate/${candidate.candidateId}/explanation`) {
      state.explanationRequests.push(request);
      return json(route, { explanation });
    }
    if (path === `/api/enrichment/estimate/${JOB_ID}`) {
      const enrichCount = Number(request.query.enrichCount || 1);
      return json(route, {
        jobId: JOB_ID,
        enrichCount,
        batchSize: 50,
        batchCount: 1,
        costPerBatch: 1,
        totalCredits: 1,
        availableCredits: 1000,
        remainingCreditsAfter: 999,
        hasEnoughCredits: true,
        estimatedSeconds: 15,
        estimatedMinutes: 0.25,
      });
    }
    if (path === `/api/jobs/${JOB_ID}/interview-questions/generate` && method === 'POST') {
      state.questionGenerationRequests.push(request);
      return json(route, {
        msg: 'Questions generated',
        questions: [standardQuestion],
        count: 1,
        generationOptions: request.body,
      });
    }
    if (path === `/api/jobs/${JOB_ID}/interview-questions/generate-optimized` && method === 'POST') {
      state.questionGenerationRequests.push(request);
      return json(route, {
        msg: 'Optimized question set generated',
        questions: [optimizedQuestion],
        optimization: { totalGenerated: 1, totalSaved: 1, diversityScore: 0.9, averageQuality: 0.93 },
      });
    }
    if (path === `/api/jobs/${JOB_ID}/interview-questions/stats`) {
      return json(route, { msg: 'Stats loaded', stats: { totalQuestions: 0, typeDistribution: [], stageDistribution: [] } });
    }
    if (path === `/api/jobs/${JOB_ID}/interview-questions` && method === 'GET') {
      return json(route, { msg: 'Questions loaded', questions: [], count: 0 });
    }
    if (path === `/api/jobs/${JOB_ID}` && method === 'GET') return json(route, job);
    if (path === '/api/presence/sessions' && method === 'POST') {
      return json(route, { sessionId: 'presence-session-123' });
    }
    if (path.startsWith('/api/presence/sessions/') && method === 'POST') return json(route, { ok: true });

    state.unhandledRequests.push(request);
    return json(route, { msg: `Unhandled Playwright mock: ${method} ${path}` }, 501);
  });
}
