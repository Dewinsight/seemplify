'use strict';

// Loopback-only browser fixture. Product routes, RBAC, frozen questionnaires,
// AI report construction and Mongo persistence run unchanged. Synthetic IdP
// claims/directory and the external account/completion client are the boundaries.
// Never imported by app.js or any production entry point.
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const prompts = [
  'What outcome did you deliver?',
  'What did you learn from the work?',
  'What will you focus on next?'
];
const questionIds = ['impact', 'learning', 'next'];
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function startConversationBrowserFixture() {
  if (process.env.NODE_ENV === 'production') throw new Error('Browser fixtures cannot run in production');
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const Appraisal = require('../../models/Appraisal');
  const Cycle = require('../../models/AppraisalCycle');
  const User = require('../../models/User');
  const ai = require('../../services/appraisalAIService');
  const account = require('../../services/chatGptAccountService');
  const previous = { client: ai.client, initialized: ai.initialized, readAccount: account.readAccount, readAccountState: account.readAccountState };
  const { DEFAULT_ACCESS_ROLES } = await import('../../../../Identityprovider/src/config/accessControlCatalog.js');
  const employeeRole = DEFAULT_ACCESS_ROLES.find(role => role.key === 'employee');
  const organization = {
    id: 'cccccccccccccccccccccccc', name: 'Disposable conversation browser QA', role: 'employee',
    appAccess: { mode: 'all', appIds: [] },
    authorization: { schemaVersion: 5, permissionsByApp: { 'performance-management': employeeRole.grants.filter(row => row.appId === 'performance-management').flatMap(row => row.permissions) } }
  };
  const team = { id: 'conversation-team', name: 'Product', organizationId: organization.id, role: 'member', managerId: 'reviewer' };
  const principal = { id: 'employee', sub: 'employee', name: 'Jordan Ellis', email: 'employee@example.test', organizations: [organization], currentOrganization: organization, idpTeams: [team], teams: [team] };
  const directory = { organizationId: organization.id, scope: 'self', organizationRole: 'employee', teams: [team], reviewers: [], members: [{ userId: principal.id, name: principal.name, email: principal.email, organizationRole: 'employee', teams: [team], teamIds: [team.id] }] };
  await User.create({ idpSub: principal.id, email: principal.email, profile: { displayName: principal.name }, currentOrganizationId: organization.id, idpTeams: [team] });
  await Appraisal.createIndexes();
  const stats = { accountReads: 0, contextReads: 0, startRequests: 0, acknowledgements: 0, reportProviderCalls: 0 };
  let heldAck = null, heldAccount = null;
  const externalAccount = { isRoutable: () => true, toPublicJSON: () => ({ status: 'connected', routable: true, connectedEmail: principal.email, dataSharingAcknowledgedAt: new Date().toISOString(), lastError: null }) };
  account.readAccount = async () => externalAccount;
  account.readAccountState = async () => {
    stats.accountReads++;
    if (heldAccount) { const hold = heldAccount; heldAccount = null; hold.entered.resolve(); await hold.released.promise; }
    return { account: externalAccount, preferences: null };
  };
  ai.initialized = true;
  ai.client = { chat: { completions: { create: async options => {
    const prompt = options.messages.map(message => message.content).join('\n');
    let content;
    if (prompt.includes('Acknowledge one employee response')) {
      stats.acknowledgements++;
      if (heldAck) { const hold = heldAck; heldAck = null; hold.entered.resolve(); await hold.released.promise; }
      content = 'Your response has been saved.';
    } else if (options.activity === 'performance.self_assessment.report') {
      stats.reportProviderCalls++;
      content = JSON.stringify({ strengths: ['Fictional evidence is documented.'], developmentAreas: [], suggestions: [], coachingOpportunities: [], sentiment: 'neutral', consistencyCheck: { isConsistent: true, notes: 'Synthetic provider output.' }, suggestedRating: 3, ratingJustification: 'Synthetic recommendation for fictional browser evidence.', keyStrengths: [], confidenceScore: 0.7 });
    } else throw new Error('Unexpected external completion: an existing conversation must not restart.');
    return { choices: [{ message: { content } }], usage: { total_tokens: 1 } };
  } } } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // This is a synthetic IdP session/directory, never a product permission bypass.
    req.session = { user: principal, currentOrganizationId: organization.id };
    req.currentOrganization = organization;
    req._performanceDirectory = directory;
    if (req.path.endsWith('/conversation/context')) stats.contextReads++;
    if (req.path.endsWith('/conversation/start')) stats.startRequests++;
    next();
  });
  app.get('/api/auth/me', (_req, res) => res.json({ success: true, user: principal, currentOrganization: organization, currentOrganizationId: organization.id }));
  for (const [path, module] of [
    ['appraisals', 'appraisals'], ['ai-account', 'aiAccount'], ['user', 'user'],
    ['competency', 'competency'], ['notifications', 'notifications'], ['actions', 'actions'],
    ['organization-features', 'organizationFeatures'], ['okrs', 'okrs']
  ]) app.use(`/api/${path}`, require(`../../routes/${module}`));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const apiURL = `http://127.0.0.1:${server.address().port}`;
  function hold(which) {
    const entered = deferred(), released = deferred();
    const item = { entered, released };
    if (which === 'ack') heldAck = item;
    else heldAccount = item;
    return { entered: entered.promise, release: () => released.resolve() };
  }
  return {
    apiURL, prompts, questionIds, stats,
    holdNextAcknowledgement: () => hold('ack'),
    holdNextAccountRead: () => hold('account'),
    async seed(daysAway = 100) {
      const then = new Date(Date.now() - daysAway * 86400000);
      const design = { version: 1, scoring: { goalsWeight: 100, competenciesWeight: 0 },
        stages: { selfAssessment: { enabled: true }, managerReview: { enabled: true }, finalReview: { enabled: true } },
        sections: [{ id: 'reflection', title: 'Review reflections', type: 'custom', respondent: 'employee', required: true, scored: false, weight: 0,
          questions: questionIds.map((id, index) => ({ id, prompt: prompts[index], responseType: 'long_text', required: true })) }] };
      const cycle = await Cycle.create({ organizationId: organization.id, name: 'Long-running browser review', status: 'active',
        periodStart: new Date(then.getTime() - 90 * 86400000), periodEnd: then,
        phases: { selfAssessment: { startDate: then, endDate: new Date(then.getTime() + 7 * 86400000), isActive: true } },
        settings: { enableAiAssist: true, requireOkrAlignment: false, allowSelfRating: false }, workflowDefinition: design });
      const record = await Appraisal.create({ organizationId: organization.id, cycleId: cycle._id, status: 'self_assessment_in_progress',
        employee: { userId: principal.id, name: principal.name, email: principal.email }, manager: { userId: 'reviewer', name: 'Morgan Reviewer', email: 'reviewer@example.test' },
        cycleConfigurationSnapshot: { version: 1, workflowDefinition: design, settings: cycle.settings, capturedAt: then, cvRequired: false },
        conversationAssessment: { mode: 'conversation', currentPhase: 'cycle_questions', currentOkrIndex: 0, completedPhases: [], startedAt: then, lastActivityAt: then, messageCount: 1,
          extractedData: { achievements: [], challenges: [], skills: [], goals: [] },
          cycleQuestionProgress: { currentIndex: 0, completedKeys: [], skippedKeys: [], startedAt: then } },
        chatThread: [{ sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' }, message: prompts[0], messageType: 'prompt', phase: 'cycle_questions', questionRef: { sectionId: 'reflection', questionId: 'impact' }, createdAt: then }] });
      return { id: String(record._id), startedAt: then.toISOString() };
    },
    read: id => Appraisal.findById(id).lean(),
    async close() {
      if (heldAck) heldAck.released.resolve();
      if (heldAccount) heldAccount.released.resolve();
      ai.client = previous.client; ai.initialized = previous.initialized;
      account.readAccount = previous.readAccount; account.readAccountState = previous.readAccountState;
      await new Promise(resolve => server.close(resolve));
      await mongoose.disconnect(); await mongo.stop();
    }
  };
}

module.exports = { startConversationBrowserFixture };
