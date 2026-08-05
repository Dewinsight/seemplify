/**
 * Diagnostic for the self-hosted Seemplify mail service.
 *
 *   node scripts/testMailService.js                     # configuration check only
 *   node scripts/testMailService.js you@example.com     # also deliver test messages
 *
 * Without a recipient argument nothing leaves the process: the script only
 * reports whether MAIL_API_BASE_URL, MAIL_API_TOKEN and MAIL_FROM_EMAIL resolve.
 * The credential is never printed.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const emailService = require('../services/EmailService');
const { mailTransportStatus } = require('../services/mailClient');

async function test() {
    const status = mailTransportStatus();

    console.log('=== Seemplify mail service check ===\n');
    console.log('MAIL_API_BASE_URL:', status.baseUrl || 'NOT SET');
    console.log('MAIL_API_TOKEN:   ', process.env.MAIL_API_TOKEN || process.env.MAIL_API_TOKEN_FILE ? 'Set (value hidden)' : 'NOT SET');
    console.log('MAIL_FROM_EMAIL:  ', status.sender || 'NOT SET');
    console.log('MAIL_FROM_NAME:   ', status.senderName || '(none)');
    console.log('');

    if (!status.configured) {
        console.error(`Not configured: ${status.reason}`);
        console.log('Set MAIL_API_BASE_URL, MAIL_API_TOKEN (format <keyId>.<secret>) and MAIL_FROM_EMAIL');
        console.log('in approver/backend/.env or in the deployment secret store.');
        process.exit(1);
    }

    const toEmail = process.argv[2] || '';
    if (!toEmail) {
        console.log('Configuration resolves. No message was sent.');
        console.log('Re-run with a recipient address to deliver the test messages.');
        return;
    }

    console.log('1. Sending test OTP email to', toEmail, '...');
    try {
        await emailService.sendOtp(toEmail, '123456');
        console.log('   OTP send attempted (check for success log above)\n');
    } catch (error) {
        console.error('   OTP failed:', error.message, `(code=${error.code} retryable=${error.retryable})`);
    }

    console.log('2. Sending test Invite email (Sign up variant)...');
    try {
        await emailService.sendInvite(toEmail, 'Test Organization', 'Test Admin', false);
        console.log('   Invite send attempted (check for success log above)\n');
    } catch (error) {
        console.error('   Invite failed:', error.message, `(code=${error.code} retryable=${error.retryable})`);
    }

    console.log('\n=== Done. Check inbox (and spam) for', toEmail, '===');
}

test().catch((error) => {
    console.error('Script error:', error.message);
    process.exit(1);
});
