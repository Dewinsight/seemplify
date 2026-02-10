const axios = require('axios');

class EmailService {
    constructor() {
        this.apiKey = process.env.BREVO_API_KEY;
        this.apiUrl = 'https://api.brevo.com/v3/smtp/email';
        this.senderName = process.env.SENDER_NAME || 'Mosaic Approver';
        this.senderEmail = process.env.SENDER_EMAIL || null;
    }

    getSender() {
        if (!this.senderEmail) {
            throw new Error('SENDER_EMAIL is required. Set it in your environment variables.');
        }
        return { name: this.senderName, email: this.senderEmail };
    }

    async sendOtp(email, otp) {
        if (!this.apiKey) {
            console.warn('BREVO_API_KEY is missing. OTP will only be logged to console.');
            console.log(`[DEV MODE] OTP for ${email}: ${otp}`);
            return;
        }

        try {
            const data = {
                sender: this.getSender(),
                to: [{ email: email }],
                subject: 'Your Verification Code',
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                        <h2>Verify Your Account</h2>
                        <p>Your verification code is:</p>
                        <h1 style="color: #646cff; letter-spacing: 5px;">${otp}</h1>
                        <p>This code expires in 10 minutes.</p>
                    </div>
                `
            };

            await axios.post(this.apiUrl, data, {
                headers: {
                    'api-key': this.apiKey,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`OTP sent to ${email}`);

        } catch (error) {
            console.error('Failed to send email:', error.response ? error.response.data : error.message);
            console.log(`[FALLBACK] OTP for ${email}: ${otp}`);
        }
    }

    async sendInvite(email, orgName, invitedByName) {
        if (!this.apiKey) {
            console.warn('BREVO_API_KEY is missing. Invite will only be logged to console.');
            console.log(`[DEV MODE] Invite for ${email} to join "${orgName}" (invited by ${invitedByName})`);
            return;
        }

        try {
            const data = {
                sender: this.getSender(),
                to: [{ email: email }],
                subject: `You've been invited to join ${orgName} on Mosaic`,
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                        <h2>Organization Invite</h2>
                        <p><strong>${invitedByName}</strong> has invited you to join <strong>${orgName}</strong> on Mosaic Approver.</p>
                        <p>To accept this invite:</p>
                        <ol>
                            <li>Sign up or log in to your Mosaic account</li>
                            <li>Go to the Invites page</li>
                            <li>Accept the invite from ${orgName}</li>
                        </ol>
                        <p style="color: #999; font-size: 12px;">This invite expires in 7 days.</p>
                    </div>
                `
            };

            await axios.post(this.apiUrl, data, {
                headers: {
                    'api-key': this.apiKey,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`Invite sent to ${email} for org ${orgName}`);

        } catch (error) {
            console.error('Failed to send invite email:', error.response ? error.response.data : error.message);
            console.log(`[FALLBACK] Invite for ${email} to join "${orgName}"`);
        }
    }
}

module.exports = new EmailService();
