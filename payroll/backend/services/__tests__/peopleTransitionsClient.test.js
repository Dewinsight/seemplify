const axios = require('axios');

jest.mock('axios');

const peopleTransitionsClient = require('../peopleTransitionsClient');

describe('peopleTransitionsClient', () => {
  const originalEnvironment = {};

  beforeAll(() => {
    for (const key of ['NODE_ENV', 'RECRUITER_INTERNAL_API_URL', 'PEOPLE_TRANSITIONS_SERVICE_SECRET']) {
      originalEnvironment[key] = process.env[key];
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.RECRUITER_INTERNAL_API_URL = 'http://recruiter-backend:5001';
    process.env.PEOPLE_TRANSITIONS_SERVICE_SECRET = 'test-only-service-secret';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('signs and sends a bulk transition summary request', async () => {
    axios.post.mockResolvedValueOnce({ data: { summaries: [] } });

    await peopleTransitionsClient.getTransitionSummaries({
      idpOrganizationId: 'org-idp',
      subjectIds: ['member-1'],
    });

    expect(axios.post).toHaveBeenCalledWith(
      'http://recruiter-backend:5001/api/internal/v1/people-transitions/summary',
      { idpOrganizationId: 'org-idp', subjectIds: ['member-1'] },
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-service-id': 'payroll',
          'x-service-signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
        }),
      })
    );
  });

  test('refuses unsigned production requests', async () => {
    delete process.env.PEOPLE_TRANSITIONS_SERVICE_SECRET;

    await expect(peopleTransitionsClient.startMemberOnboarding({
      idpOrganizationId: 'org-idp',
      member: { id: 'member-1', email: 'member@example.invalid' },
    })).rejects.toThrow('authentication is not configured');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
