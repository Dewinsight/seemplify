const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Interview = require('../models/Interview');
const interviewController = require('../controllers/interviewController');
const capabilityService = require('../services/publicFeedbackCapabilityService');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('authenticated feedback UI receives a signed interview capability', async () => {
  const originalFindById = Interview.findById;
  const originalBelongs = capabilityService.belongsToOrganization;
  const originalIssue = capabilityService.issue;
  const interview = {
    _id: '66c4c7f0a96ae218df000001',
    candidateId: '66c4c7f0a96ae218df000002',
    organizationId: '66c4c7f0a96ae218df000003',
    jobId: '66c4c7f0a96ae218df000004',
    status: 'scheduled'
  };

  try {
    Interview.findById = () => ({ select: async () => interview });
    capabilityService.belongsToOrganization = async () => true;
    capabilityService.issue = async () => ({
      token: 'signed-feedback-capability',
      expiresAt: new Date('2026-09-18T12:00:00.000Z')
    });

    const res = response();
    await interviewController.issuePublicFeedbackAccess({
      params: { interviewId: interview._id },
      user: { currentOrganization: interview.organizationId }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.accessToken, 'signed-feedback-capability');
    assert.equal(res.body.success, true);
  } finally {
    Interview.findById = originalFindById;
    capabilityService.belongsToOrganization = originalBelongs;
    capabilityService.issue = originalIssue;
  }
});

test('feedback access route is authenticated and the UI no longer opens a bare public URL', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/interview.js'), 'utf8');
  const component = fs.readFileSync(
    path.join(__dirname, '../../frontend/components/ui/interview-feedback-simple.tsx'),
    'utf8'
  );

  assert.match(
    routes,
    /feedback\/access', authMiddleware, requireOrganization, interviewController\.issuePublicFeedbackAccess/
  );
  assert.match(component, /feedback\/access/);
  assert.match(component, /searchParams\.set\('accessToken'/);
  assert.doesNotMatch(component, /return `\$\{baseUrl\}\/public\/feedback\/\$\{interviewId\}`/);
});

test('feedback capability is not issued across organization boundaries', async () => {
  const originalFindById = Interview.findById;
  const originalBelongs = capabilityService.belongsToOrganization;
  const originalIssue = capabilityService.issue;
  let issueCalled = false;

  try {
    Interview.findById = () => ({ select: async () => ({ _id: '66c4c7f0a96ae218df000011' }) });
    capabilityService.belongsToOrganization = async () => false;
    capabilityService.issue = async () => { issueCalled = true; return null; };

    const res = response();
    await interviewController.issuePublicFeedbackAccess({
      params: { interviewId: '66c4c7f0a96ae218df000011' },
      user: { currentOrganization: '66c4c7f0a96ae218df000012' }
    }, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'PUBLIC_FEEDBACK_ACCESS_NOT_FOUND');
    assert.equal(issueCalled, false);
  } finally {
    Interview.findById = originalFindById;
    capabilityService.belongsToOrganization = originalBelongs;
    capabilityService.issue = originalIssue;
  }
});
