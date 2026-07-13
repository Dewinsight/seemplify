const test = require('node:test');
const assert = require('node:assert/strict');
const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');

test('uses the job organization instead of a legacy sender name', async (t) => {
  const originalEmailService = candidateEmailNotificationService.emailService;
  let sentEmail;

  t.after(() => {
    candidateEmailNotificationService.emailService = originalEmailService;
  });

  candidateEmailNotificationService.emailService = {
    sendEmail: async (email) => {
      sentEmail = email;
      return { messageId: 'test-message' };
    }
  };

  const result = await candidateEmailNotificationService.sendShortlistEmail({
    candidate: {
      firstName: 'Taylor',
      lastName: 'Applicant',
      email: 'taylor@example.com'
    },
    job: {
      title: 'Software Engineer',
      organization: {
        _id: 'organization-id',
        name: 'Acme Ltd'
      },
      emailSettings: {
        enableShortlistEmails: true,
        senderName: 'Mega',
        customTemplates: {
          shortlist: '<div><p>Organization: {{organizationName}}</p><p>Candidate: {{candidateName}}</p></div>'
        }
      }
    }
  });

  assert.equal(result.sent, true);
  assert.equal(sentEmail.senderName, 'Acme Ltd');
  assert.match(sentEmail.html, /Organization: Acme Ltd/);
  assert.doesNotMatch(sentEmail.html, /Mega/);
});
