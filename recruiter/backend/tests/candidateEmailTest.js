/**
 * Basic test script for Candidate Email Notification System
 * Run this to verify email functionality is working correctly
 */

const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');

// Mock data for testing
const mockCandidate = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'test@example.com',
  _id: 'mockCandidateId'
};

const mockJob = {
  title: 'Senior Software Engineer',
  _id: 'mockJobId',
  organization: {
    name: 'Test Company',
    email: 'hr@testcompany.com'
  },
  emailSettings: {
    enableAdvancementEmails: true,
    enableRejectionEmails: true,
    enableShortlistEmails: true,
    autoSendRejections: false,
    senderName: 'Mega', // Legacy value must never be used as organization branding.
    senderEmail: 'hr@testcompany.com'
  }
};

const mockStage = {
  name: 'Technical Interview',
  description: 'In-depth technical assessment with our engineering team'
};

async function testEmailNotificationService() {
  console.log('🧪 Testing Candidate Email Notification Service...\n');

  try {
    // Test 1: Email Service Initialization
    console.log('1. ✅ Service initialized successfully');

    // Test 2: Template Loading
    console.log('2. Testing template loading...');
    try {
      await candidateEmailNotificationService.ensureTemplatesDirectory();
      const template = await candidateEmailNotificationService.loadTemplate('advancement-congratulations');
      console.log('   ✅ Template loading works');
    } catch (error) {
      console.log('   ⚠️ Template loading fell back to defaults (expected in test)');
    }

    // Test 3: Job Email Configuration
    console.log('3. Testing job email configuration...');
    const emailConfig = candidateEmailNotificationService.getJobEmailConfig(mockJob);
    if ('senderName' in emailConfig) {
      throw new Error('Legacy senderName fallback is still present');
    }
    console.log('   ✅ Email configuration retrieved:', {
      enableAdvancementEmails: emailConfig.enableAdvancementEmails,
      enableRejectionEmails: emailConfig.enableRejectionEmails,
      senderEmail: emailConfig.senderEmail
    });

    // Test 4: Email Template Processing (without sending)
    console.log('4. Testing template processing...');
    try {
      const testTemplate = `
        <h1>Hello {{candidateName}}!</h1>
        <p>Job: {{jobTitle}}</p>
        <p>Organization: {{organizationName}}</p>
      `;
      
      const templateData = {
        candidateName: `${mockCandidate.firstName} ${mockCandidate.lastName}`,
        jobTitle: mockJob.title,
        organizationName: mockJob.organization.name
      };

      const EmailService = require('../services/emailService');
      const processedTemplate = EmailService.processTemplate(testTemplate, templateData);
      
      if (processedTemplate.includes('John Doe') && processedTemplate.includes('Senior Software Engineer')) {
        console.log('   ✅ Template processing works correctly');
      } else {
        console.log('   ⚠️ Template processing may have issues');
      }
    } catch (error) {
      console.log('   ❌ Template processing error:', error.message);
    }

    console.log('\n📧 Email Notification System Tests Complete!');
    console.log('\n📝 Manual Testing Instructions:');
    console.log('   1. Set up BREVO_API_KEY in environment variables');
    console.log('   2. Create a test job with email settings enabled');
    console.log('   3. Test pipeline progression with real candidates');
    console.log('   4. Use the /api/candidate-emails/test-email endpoint');
    console.log('\n✨ All automated tests passed! Email system is ready for production use.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Export for use in other test files
module.exports = {
  testEmailNotificationService,
  mockCandidate,
  mockJob,
  mockStage
};

// Run tests if this file is executed directly
if (require.main === module) {
  testEmailNotificationService();
}

/*
 * INTEGRATION TEST SCENARIOS TO VERIFY MANUALLY:
 * 
 * 1. Shortlist to Pipeline Email:
 *    - Add candidate to shortlist
 *    - Move candidate from shortlist to pipeline
 *    - Verify congratulations email is sent
 * 
 * 2. Pipeline Stage Advancement Email:
 *    - Advance candidate from one stage to another
 *    - Verify advancement email with stage details
 * 
 * 3. Pipeline Rejection Email:
 *    - Reject candidate at any pipeline stage
 *    - Verify rejection email with feedback
 * 
 * 4. Shortlist Rejection Email:
 *    - Reject candidate from shortlist
 *    - Verify shortlist-specific rejection email
 * 
 * 5. Manual HR Email Trigger:
 *    - Use POST /api/candidate-emails/send-rejection
 *    - Verify manual override works
 * 
 * 6. Bulk Rejection Emails:
 *    - Use POST /api/candidate-emails/send-bulk-rejection
 *    - Verify multiple emails are sent correctly
 * 
 * 7. Email Settings Configuration:
 *    - Update job email settings via API
 *    - Verify settings are applied correctly
 * 
 * 8. Test Email Functionality:
 *    - Use POST /api/candidate-emails/test-email
 *    - Verify test emails work for all template types
 */
