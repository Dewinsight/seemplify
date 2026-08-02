const test = require('node:test');
const assert = require('node:assert/strict');
const candidateEmailService = require('../services/candidateEmailNotificationService');

test('candidate email uses the job organization and ignores legacy Mega senderName', async (t) => {
  const originalSendEmail = candidateEmailService.emailService.sendEmail;
  let sentEmail;

  candidateEmailService.emailService.sendEmail = async (options) => {
    sentEmail = options;
    return { messageId: 'test-message' };
  };

  t.after(() => {
    candidateEmailService.emailService.sendEmail = originalSendEmail;
  });

  await candidateEmailService.sendShortlistEmail({
    candidate: {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com'
    },
    job: {
      title: 'Software Engineer',
      organization: {
        _id: 'org-1',
        name: 'Acme Ltd',
        logo: 'https://example.com/acme.png'
      },
      emailSettings: {
        enableShortlistEmails: true,
        senderName: 'Mega'
      }
    }
  });

  assert.equal(sentEmail.organizationName, 'Acme Ltd');
  assert.equal('senderName' in sentEmail, false);
  assert.match(sentEmail.html, /Acme Ltd/);
  assert.doesNotMatch(sentEmail.html, /Mega/i);
});
