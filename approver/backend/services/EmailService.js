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

    async sendInvite(email, orgName, invitedByName, hasAccount = false) {
        if (!this.apiKey) {
            console.warn('BREVO_API_KEY is missing. Invite will only be logged to console.');
            console.log(`[DEV MODE] Invite for ${email} to join "${orgName}" (invited by ${invitedByName})`);
            return;
        }

        const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        const loginUrl = `${baseUrl}/login`;
        const signupUrl = `${baseUrl}/register`;

        const ctaHtml = hasAccount
            ? `<p><a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background: #646cff; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Login</a> to accept this invite and join ${orgName}.</p>`
            : `<p><a href="${signupUrl}" style="display: inline-block; padding: 12px 24px; background: #646cff; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Sign up</a> to create your account and join ${orgName}.</p>`;

        const ctaText = hasAccount
            ? `You already have an account. Log in to accept this invite.`
            : `You don't have an account yet. Sign up to create one and join the organization.`;

        try {
            const data = {
                sender: this.getSender(),
                to: [{ email: email }],
                subject: `You've been invited to join ${orgName} on Mosaic`,
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                        <h2>Organization Invite</h2>
                        <p><strong>${invitedByName}</strong> has invited you to join <strong>${orgName}</strong> on Mosaic.</p>
                        <p>${ctaText}</p>
                        ${ctaHtml}
                        <p style="color: #999; font-size: 12px; margin-top: 24px;">This invite expires in 7 days.</p>
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
