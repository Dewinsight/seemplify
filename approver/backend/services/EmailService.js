const axios = require('axios');

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    async _sendWithRetry(data, label = 'email') {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const res = await axios.post(this.apiUrl, data, {
                    headers: {
                        'api-key': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });
                return { success: true, response: res };
            } catch (error) {
                const isRetryable = !error.response || (error.response.status >= 500 || error.response.status === 429);
                const errMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
                console.warn(`[Email] ${label} attempt ${attempt}/${MAX_RETRIES} failed:`, errMsg);

                if (attempt < MAX_RETRIES && isRetryable) {
                    const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
                    console.log(`[Email] Retrying in ${delay}ms...`);
                    await sleep(delay);
                } else {
                    throw error;
                }
            }
        }
    }

    async sendOtp(email, otp) {
        if (!this.apiKey) {
            console.warn('BREVO_API_KEY is missing. OTP will only be logged to console.');
            console.log(`[DEV MODE] OTP for ${email}: ${otp}`);
            return;
        }

        const otpHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f5f5f7; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden;">
<tr>
<td style="background: linear-gradient(135deg, #9B51E0 0%, #7B3FC0 100%); padding: 32px 40px; text-align: center;">
<div style="font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: 2px;">MOSAIC</div>
<div style="font-size: 14px; color: rgba(255,255,255,0.9); margin-top: 4px;">Verify your account</div>
</td>
</tr>
<tr>
<td style="padding: 40px 40px 32px;">
<p style="margin: 0 0 24px; font-size: 16px; color: #1a1a1a; line-height: 1.6;">Use the code below to verify your email address:</p>
<div style="background: #f8f4ff; border: 2px dashed #9B51E0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
<span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #7B3FC0; font-family: 'Courier New', monospace;">${otp}</span>
</div>
<p style="margin: 0; font-size: 14px; color: #6b7280;">This code expires in <strong>10 minutes</strong>. If you didn't request this, you can safely ignore this email.</p>
</td>
</tr>
<tr>
<td style="padding: 24px 40px; background: #fafafa; border-top: 1px solid #eee;">
<p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">© Mosaic · AI initiative approval platform</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;

        try {
            const data = {
                sender: this.getSender(),
                to: [{ email: email }],
                subject: 'Your Verification Code',
                htmlContent: otpHtml
            };

            await this._sendWithRetry(data, `OTP to ${email}`);
            console.log(`OTP sent to ${email}`);
        } catch (error) {
            console.error('Failed to send OTP:', error.response?.data || error.message);
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

        const ctaLabel = hasAccount ? 'Log in to accept' : 'Sign up to join';
        const ctaUrl = hasAccount ? loginUrl : signupUrl;
        const ctaSubtext = hasAccount
            ? `You already have an account. Log in to accept this invite.`
            : `Create your account to join ${orgName} and start collaborating.`;

        const inviteHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f5f5f7; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden;">
<tr>
<td style="background: linear-gradient(135deg, #9B51E0 0%, #7B3FC0 100%); padding: 32px 40px; text-align: center;">
<div style="font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: 2px;">MOSAIC</div>
<div style="font-size: 14px; color: rgba(255,255,255,0.9); margin-top: 4px;">Organization invite</div>
</td>
</tr>
<tr>
<td style="padding: 40px 40px 32px;">
<div style="background: #f8f4ff; border-radius: 12px; padding: 20px 24px; margin-bottom: 28px; border-left: 4px solid #9B51E0;">
<p style="margin: 0 0 8px; font-size: 12px; color: #7B3FC0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Invitation</p>
<p style="margin: 0; font-size: 18px; color: #1a1a1a; font-weight: 600;"><strong>${invitedByName}</strong> invited you to join <strong>${orgName}</strong></p>
</div>
<p style="margin: 0 0 28px; font-size: 16px; color: #374151; line-height: 1.6;">${ctaSubtext}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius: 10px; background: linear-gradient(135deg, #9B51E0 0%, #7B3FC0 100%);">
<a href="${ctaUrl}" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">${ctaLabel}</a>
</td></tr></table>
<p style="margin: 24px 0 0; font-size: 13px; color: #9ca3af;">This invite expires in <strong>7 days</strong>.</p>
</td>
</tr>
<tr>
<td style="padding: 24px 40px; background: #fafafa; border-top: 1px solid #eee;">
<p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">© Mosaic · AI initiative approval platform</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;

        try {
            const data = {
                sender: this.getSender(),
                to: [{ email: email }],
                subject: `You've been invited to join ${orgName} on Mosaic`,
                htmlContent: inviteHtml
            };

            await this._sendWithRetry(data, `Invite to ${email}`);
            console.log(`Invite sent to ${email} for org ${orgName}`);
        } catch (error) {
            console.error('Failed to send invite email:', error.response?.data || error.message);
            console.log(`[FALLBACK] Invite for ${email} to join "${orgName}"`);
        }
    }
}

module.exports = new EmailService();
