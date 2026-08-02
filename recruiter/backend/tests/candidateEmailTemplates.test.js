const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const candidateEmailService = require('../services/candidateEmailNotificationService');

const templateNames = [
  'advancement-congratulations',
  'application-confirmation',
  'rejection-notice',
  'shortlist-congratulations',
  'shortlist-rejection'
];

test('candidate system templates use a plain email presentation', async () => {
  for (const templateName of templateNames) {
    const templatePath = path.join(
      __dirname,
      '..',
      'templates',
      'candidate-emails',
      `${templateName}.hbs`
    );
    const content = await fs.readFile(templatePath, 'utf8');

    assert.match(content, /{{candidateFirstName}}/);
    assert.match(content, /{{organizationName}}/);
    assert.doesNotMatch(content, /linear-gradient|box-shadow|border-radius|<style|<h[1-6]/i);
  }
});

test('all configurable candidate placeholders resolve before delivery', async (t) => {
  const originalSendEmail = candidateEmailService.emailService.sendEmail;
  const sentEmails = [];

  candidateEmailService.emailService.sendEmail = async (options) => {
    sentEmails.push(options);
    return { messageId: `message-${sentEmails.length}` };
  };

  t.after(() => {
    candidateEmailService.emailService.sendEmail = originalSendEmail;
  });

  const candidate = {
    firstName: 'Alex',
    lastName: 'Candidate',
    email: 'alex@example.com'
  };
  const baseJob = {
    title: 'Product Manager',
    location: 'London',
    organization: {
      _id: 'org-1',
      name: 'Acme Ltd'
    }
  };
  const commonTemplate = [
    '{{candidateName}}',
    '{{candidateFirstName}}',
    '{{candidateLastName}}',
    '{{candidateEmail}}',
    '{{jobTitle}}',
    '{{organizationName}}',
    '{{applicationDate}}'
  ].join('|');

  await candidateEmailService.sendAdvancementEmail({
    candidate,
    job: {
      ...baseJob,
      emailSettings: {
        enableAdvancementEmails: true,
        customTemplates: {
          advancement: `${commonTemplate}|{{previousStageName}}|{{nextStageName}}|{{stageDescription}}|{{notes}}`
        }
      }
    },
    fromStage: { name: 'Phone Screen' },
    toStage: { name: 'Technical Interview', description: 'A 45-minute call' },
    notes: 'Scheduling details will follow.'
  });

  await candidateEmailService.sendShortlistEmail({
    candidate,
    job: {
      ...baseJob,
      emailSettings: {
        enableShortlistEmails: true,
        customTemplates: { shortlist: commonTemplate }
      }
    }
  });

  await candidateEmailService.sendRejectionEmail({
    candidate,
    job: {
      ...baseJob,
      emailSettings: {
        enableRejectionEmails: true,
        customTemplates: { rejection: `${commonTemplate}|{{stage}}|{{feedback}}` }
      }
    },
    reason: 'Thank you for your time.',
    stage: 'Technical Interview',
    forceManual: true
  });

  await candidateEmailService.sendRejectionEmail({
    candidate,
    job: {
      ...baseJob,
      emailSettings: {
        enableRejectionEmails: true,
        customTemplates: { shortlistRejection: `${commonTemplate}|{{stage}}|{{feedback}}` }
      }
    },
    reason: 'We appreciate your application.',
    stage: 'Shortlist Review',
    isShortlistRejection: true,
    forceManual: true
  });

  await candidateEmailService.sendApplicationConfirmationEmail({
    candidate,
    job: {
      ...baseJob,
      emailSettings: {
        senderEmail: 'hiring@example.com',
        customTemplates: {
          applicationConfirmation: `${commonTemplate}|{{jobLocation}}|{{contactEmail}}`
        }
      }
    }
  });

  assert.equal(sentEmails.length, 5);
  for (const sentEmail of sentEmails) {
    assert.doesNotMatch(sentEmail.html, /{{[^}]+}}/);
    assert.match(sentEmail.html, /Alex/);
    assert.match(sentEmail.html, /Product Manager/);
    assert.match(sentEmail.html, /Acme Ltd/);
  }

  assert.match(sentEmails[0].html, /Phone Screen\|Technical Interview\|A 45-minute call/);
  assert.match(sentEmails[2].html, /Technical Interview\|Thank you for your time\./);
  assert.match(sentEmails[3].html, /Shortlist Review\|We appreciate your application\./);
  assert.match(sentEmails[4].html, /London\|hiring@example\.com/);
});
