/**
 * Test Brevo email sending
 * Usage: node scripts/testBrevoEmail.js [recipient@email.com]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const emailService = require('../services/EmailService');

async function test() {
    const toEmail = process.argv[2] || process.env.TEST_EMAIL || 'tonyegboo@gmail.com';

    console.log('=== Brevo Email Test ===\n');
    console.log('BREVO_API_KEY:', process.env.BREVO_API_KEY ? `Set (${process.env.BREVO_API_KEY.substring(0, 15)}...)` : 'NOT SET');
    console.log('SENDER_EMAIL:', process.env.SENDER_EMAIL || 'not set (using default in EmailService)');
    console.log('SENDER_NAME:', process.env.SENDER_NAME || 'not set');
    console.log('Recipient:', toEmail);
    console.log('');

    // Test 1: OTP email
    console.log('1. Sending test OTP email...');
    try {
        await emailService.sendOtp(toEmail, '123456');
        console.log('   OTP send attempted (check for success log above)\n');
    } catch (e) {
        console.error('   OTP failed:', e.message);
    }

    // Test 2: Invite email (hasAccount = false for "Sign up" variant)
    console.log('2. Sending test Invite email (Sign up variant)...');
    try {
        await emailService.sendInvite(toEmail, 'Test Organization', 'Test Admin', false);
        console.log('   Invite send attempted (check for success log above)\n');
    } catch (e) {
        console.error('   Invite failed:', e.message);
    }

    // Direct API test for better error visibility
    if (process.env.BREVO_API_KEY) {
        console.log('3. Direct Brevo API test...');
        const axios = require('axios');
        try {
            const res = await axios.post(
                'https://api.brevo.com/v3/smtp/email',
                {
                    sender: {
                        name: process.env.SENDER_NAME || 'Mosaic Test',
                        email: process.env.SENDER_EMAIL || 'no-reply@seemplify.com'
                    },
                    to: [{ email: toEmail }],
                    subject: 'Brevo Test - Mosaic Approver',
                    htmlContent: '<p>If you received this, Brevo is working!</p>'
                },
                {
                    headers: {
                        'api-key': process.env.BREVO_API_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('   Direct API: SUCCESS (status:', res.status, ')');
        } catch (err) {
            console.error('   Direct API FAILED:');
            console.error('   Status:', err.response?.status);
            console.error('   Error:', JSON.stringify(err.response?.data || err.message, null, 2));
        }
    }

    console.log('\n=== Done. Check inbox (and spam) for', toEmail, '===');
}

test().catch(e => {
    console.error('Script error:', e);
    process.exit(1);
});
