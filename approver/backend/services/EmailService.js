const axios = require('axios');

class EmailService {
    constructor() {
        this.apiKey = process.env.BREVO_API_KEY;
        this.apiUrl = 'https://api.brevo.com/v3/smtp/email';
    }

    async sendOtp(email, otp) {
        if (!this.apiKey) {
            console.warn('BREVO_API_KEY is missing. OTP will only be logged to console.');
            console.log(`[DEV MODE] OTP for ${email}: ${otp}`);
            return;
        }

        try {
            const data = {
                sender: { name: 'Approver System', email: 'no-reply@seemplify.com' },
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
            // Fallback for dev/debug
            console.log(`[FALLBACK] OTP for ${email}: ${otp}`);
        }
    }
}

module.exports = new EmailService();
