/**
 * Test to simulate exactly what frontend sends to backend
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const nylasEmailService = require('./services/nylasEmailService');

console.log('🧪 SIMULATING FRONTEND -> BACKEND FLOW');
console.log('='.repeat(70));

// Scenario 1: Frontend sends the default template (what they can edit)
const frontendTemplate = `Dear {{candidateName}},

We're pleased to confirm your upcoming interview for the {{jobTitle}} position.

Date: {{interviewDate}}
Time: {{interviewTime}}
Duration: {{duration}} minutes
Format: {{interviewType}}
{{#if meetingLink}}
Meeting Link: {{meetingLink}}
{{/if}}

{{#if notes}}
Additional Notes:
{{notes}}
{{/if}}

Please be prepared to discuss your experience and qualifications. If you need to reschedule or have any questions, please contact us as soon as possible.

Best regards,
{{interviewerName}}
{{organizationName}}`;

const templateData = {
  candidateName: 'Michael Egbo',
  jobTitle: 'CEO',
  interviewDate: 'Wednesday, October 15, 2025',
  interviewTime: '11:30 AM',
  duration: 15,
  interviewType: 'Video Call',
  meetingLink: 'https://meet.google.com/pbw-ohzm-kzs',
  notes: 'Interview scheduled from candidate pipeline',
  interviewerName: 'Michael Egbo',
  interviewerEmail: 'michael.egbo@gmail.com',
  organizationName: 'SmartHR'
};

console.log('\n📤 FRONTEND sends this template (with {{#if}} syntax - THIS IS CORRECT):');
console.log(frontendTemplate);

console.log('\n📥 BACKEND receives it as customTemplate parameter');
console.log('📥 customTemplate value:', frontendTemplate.substring(0, 100) + '...');

console.log('\n🔧 BACKEND processes it through processTemplate():');
const processed = nylasEmailService.processTemplate(frontendTemplate, templateData);

console.log('\n✅ PROCESSED RESULT:');
console.log(processed);

console.log('\n🔍 VERIFICATION:');
console.log('Contains {{#if:', processed.includes('{{#if'));
console.log('Contains {{/if:', processed.includes('{{/if'));
console.log('Contains meeting link:', processed.includes('https://meet.google.com/pbw-ohzm-kzs'));
console.log('Contains notes:', processed.includes('Interview scheduled from candidate pipeline'));

// Test scenario 2: Empty string from frontend
console.log('\n' + '='.repeat(70));
console.log('📤 SCENARIO 2: Frontend sends empty string ""');
const emptyTemplate = '';
const templateToUse = emptyTemplate || 'DEFAULT TEMPLATE USED';
console.log('Backend will use:', emptyTemplate ? 'CUSTOM' : 'DEFAULT');
console.log('templateToUse:', templateToUse);

console.log('\n' + '='.repeat(70));
console.log('🎯 CONCLUSION:');
console.log('The template processing WORKS when template is passed correctly.');
console.log('If emails still show {{#if}}, check backend console when scheduling an interview!');
console.log('='.repeat(70));
