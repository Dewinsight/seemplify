import dotenv from 'dotenv'

// Load environment variables BEFORE creating the service instance
dotenv.config()

// Note: Using Node.js built-in fetch (available in Node 18+)

class EmailService {
  constructor() {
    this.apiKey = process.env.BREVO_API_KEY
    this.apiBaseUrl = 'https://api.brevo.com/v3/smtp/email'
    this.senderEmail = process.env.SENDER_EMAIL || 'michael.egbo@aiinnigeria.com'
    this.senderName = process.env.SENDER_NAME || 'AIIN Identity'
    this.identityProviderUrl = process.env.ISSUER_URL || 'http://localhost:4000'
    
    // Log configuration status on startup
    console.log('📧 Identity Provider Email Service Configuration:')
    console.log('  - API Key:', this.apiKey ? '✅ Set' : '❌ MISSING')
    console.log('  - Sender Email:', this.senderEmail)
    console.log('  - Sender Name:', this.senderName)
    
    if (!this.apiKey) {
      console.error('❌ BREVO_API_KEY environment variable is not set! Emails will fail to send.')
    }
  }
  
  /**
   * Generic email sending method
   * @param {Object} options - Email options
   * @param {String} options.to - Recipient email
   * @param {String} options.subject - Email subject
   * @param {String} options.html - HTML content
   * @param {String} options.text - Plain text content (optional)
   * @returns {Promise} Send result
   */
  async sendEmail({ to, subject, html, text }) {
    if (!this.apiKey) {
      console.error('❌ BREVO_API_KEY not configured! Cannot send email.')
      throw new Error('Email service not properly configured')
    }

    try {
      const emailData = {
        sender: {
          name: this.senderName,
          email: this.senderEmail,
        },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html
      }

      if (text) {
        emailData.textContent = text
      }

      console.log('📨 Sending email to:', to, 'Subject:', subject)
      
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData)
      })

      const responseBody = await response.json()

      if (!response.ok) {
        console.error('❌ Brevo API Error:', responseBody)
        throw new Error(`Failed to send email: ${responseBody.message || response.statusText}`)
      }

      console.log('✅ Email sent successfully via Brevo')
      return responseBody
    } catch (error) {
      console.error('❌ Error sending email:', error)
      throw error
    }
  }

  /**
   * Send welcome email to new users
   * @param {String} to - Recipient email
   * @param {String} name - User's name
   * @returns {Promise}
   */
  async sendWelcomeEmail(to, name) {
    const displayName = name || to.split('@')[0]
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header with gradient -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              🔐
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Welcome to AIIN Identity!</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hi ${displayName},</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Thank you for creating your AIIN Identity account! Your account has been successfully created and you can now use it to sign in to any application that supports AIIN Identity authentication.
            </p>
            
            <div style="background: #f9fafb; border-left: 4px solid #667eea; padding: 20px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0; font-size: 14px; color: #666;">
                <strong style="color: #333;">Your Account Email:</strong><br>
                ${to}
              </p>
            </div>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 24px 0;">
              You can now use this account to securely sign in to applications powered by AIIN Identity. We use industry-standard OAuth 2.0 and OpenID Connect protocols to keep your information safe.
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${this.identityProviderUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Go to AIIN Identity
              </a>
            </div>
            
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>🔒 Security Tip:</strong> Never share your password with anyone. AIIN Identity will never ask for your password via email.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #666;">
              Need help? Contact us at <a href="mailto:support@aiinidentity.com" style="color: #667eea; text-decoration: none;">support@aiinidentity.com</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} AIIN Identity. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
Welcome to AIIN Identity!

Hi ${displayName},

Thank you for creating your AIIN Identity account! Your account has been successfully created and you can now use it to sign in to any application that supports AIIN Identity authentication.

Your Account Email: ${to}

You can now use this account to securely sign in to applications powered by AIIN Identity.

Security Tip: Never share your password with anyone. AIIN Identity will never ask for your password via email.

Need help? Contact us at support@aiinidentity.com

© ${new Date().getFullYear()} AIIN Identity. All rights reserved.
    `.trim()

    return this.sendEmail({
      to,
      subject: 'Welcome to AIIN Identity! 🎉',
      html: htmlContent,
      text: textContent
    })
  }

  /**
   * Send password reset email
   * @param {String} to - Recipient email
   * @param {String} token - Reset token
   * @returns {Promise}
   */
  async sendPasswordResetEmail(to, token) {
    const resetUrl = `${this.identityProviderUrl}/reset-password/${token}`
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header with gradient -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              🔑
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Password Reset Request</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hello,</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              We received a request to reset the password for your AIIN Identity account associated with <strong>${to}</strong>.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Click the button below to reset your password:
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Reset Your Password
              </a>
            </div>
            
            <p style="font-size: 14px; color: #999; margin: 24px 0; text-align: center;">
              Or copy and paste this link into your browser:<br>
              <a href="${resetUrl}" style="color: #667eea; word-break: break-all;">${resetUrl}</a>
            </p>
            
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #92400e;">
                <strong>⏰ Important:</strong> This password reset link will expire in 1 hour for security purposes.
              </p>
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>🛡️ Security:</strong> If you did not request this password reset, please ignore this email. Your password will remain unchanged.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #666;">
              Need help? Contact us at <a href="mailto:support@aiinidentity.com" style="color: #667eea; text-decoration: none;">support@aiinidentity.com</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} AIIN Identity. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
AIIN IDENTITY - PASSWORD RESET REQUEST
======================================

Hello,

We received a request to reset the password for your AIIN Identity account associated with ${to}.

RESET YOUR PASSWORD:
Click the link below or copy and paste it into your browser:
${resetUrl}

IMPORTANT SECURITY INFORMATION:
- This link will expire in 1 hour for security purposes
- If you did not request this password reset, please ignore this email
- Your password will remain unchanged if you do not click the link

NEED HELP?
If you have any questions, contact our support team at support@aiinidentity.com

Best regards,
The AIIN Identity Team

© ${new Date().getFullYear()} AIIN Identity. All rights reserved.
    `.trim()

    return this.sendEmail({
      to,
      subject: 'Password Reset Request - AIIN Identity',
      html: htmlContent,
      text: textContent
    })
  }

  /**
   * Send email verification OTP
   * @param {String} to - Recipient email
   * @param {String} otp - 6-digit OTP code
   * @param {String} name - User's name
   * @returns {Promise}
   */
  async sendEmailVerificationOTP(to, otp, name) {
    const displayName = name || to.split('@')[0]
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              ✉️
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Verify Your Email</h1>
          </div>
          
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hello ${displayName},</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Thank you for creating your AIIN Identity account! To complete your registration and verify your email address, please use the following verification code:
            </p>
            
            <div style="background: #f9fafb; border: 2px solid #667eea; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #666; font-weight: 600;">Your Verification Code</p>
              <p style="margin: 0; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${otp}</p>
            </div>
            
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #92400e;">
                <strong>⏰ Important:</strong> This code will expire in 10 minutes.
              </p>
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>🛡️ Security:</strong> Never share this code with anyone.
              </p>
            </div>
          </div>
          
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #666;">
              Need help? Contact us at <a href="mailto:support@aiinidentity.com" style="color: #667eea; text-decoration: none;">support@aiinidentity.com</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} AIIN Identity. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
EMAIL VERIFICATION - AIIN IDENTITY
===================================

Hello ${displayName},

Thank you for creating your AIIN Identity account! To complete your registration, please use this verification code:

VERIFICATION CODE: ${otp}

IMPORTANT:
- This code will expire in 10 minutes
- Never share this code with anyone
- If you did not create this account, please ignore this email

Need help? Contact us at support@aiinidentity.com

© ${new Date().getFullYear()} AIIN Identity
    `.trim()

    return this.sendEmail({
      to,
      subject: 'Verify Your Email - AIIN Identity',
      html: htmlContent,
      text: textContent
    })
  }

  /**
   * Send password reset OTP (alternative to token-based reset)
   * @param {String} to - Recipient email
   * @param {String} otp - 6-digit OTP code
   * @returns {Promise}
   */
  async sendPasswordResetOTP(to, otp) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              🔑
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Password Reset Code</h1>
          </div>
          
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hello,</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              We received a request to reset your password. Use this code to reset your password:
            </p>
            
            <div style="background: #f9fafb; border: 2px solid #667eea; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #666; font-weight: 600;">Your Password Reset Code</p>
              <p style="margin: 0; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${otp}</p>
            </div>
            
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #92400e;">
                <strong>⏰ Important:</strong> This code will expire in 10 minutes.
              </p>
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>🛡️ Security:</strong> If you did not request this, ignore this email.
              </p>
            </div>
          </div>
          
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #666;">
              Need help? Contact us at <a href="mailto:support@aiinidentity.com" style="color: #667eea; text-decoration: none;">support@aiinidentity.com</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} AIIN Identity. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
PASSWORD RESET CODE - AIIN IDENTITY
====================================

Hello,

We received a request to reset your password. Use this code:

PASSWORD RESET CODE: ${otp}

This code will expire in 10 minutes.

If you did not request this, ignore this email.

© ${new Date().getFullYear()} AIIN Identity
    `.trim()

    return this.sendEmail({
      to,
      subject: 'Password Reset Code - AIIN Identity',
      html: htmlContent,
      text: textContent
    })
  }
}

export const emailService = new EmailService()


