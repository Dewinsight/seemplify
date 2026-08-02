require('dotenv').config();
const emailService = require('../services/emailService');

async function testEmail() {
  try {
    console.log('Sending test email...');
    await emailService.sendPasswordResetEmail('michaelegbo@gmail.com', 'test-token');
    console.log('Test email sent successfully.');
  } catch (error) {
    console.error('Failed to send test email:', error);
  }
}

testEmail();